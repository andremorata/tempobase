/**
 * POST /api/account/integration-operations/[id]/confirm - Apply the prepared write.
 *
 * Re-validates the token, role, access and entry rules. The pending -> confirmed flip and the
 * entry write share one transaction, so repeated or concurrent confirms write once.
 *
 * A correction writes only while the entry still matches its preview. If it changed (for example
 * edited in the app), nothing is written: the preview is refreshed with the current values and
 * the response is 409 `entry_changed`, so the user confirms again.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getMemberAccess, type MemberAccess } from "@/lib/auth/access";
import { authErrorResponse, getCurrentUser } from "@/lib/auth/helpers";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import { createAuditLog } from "@/lib/audit/logger";
import { prisma } from "@/lib/db/prisma";
import {
  checkCorrection,
  checkEntryPayload,
  correctionData,
  CORRECT_ENTRY,
  ENTRY_CHANGED,
  entrySnapshot,
  findCorrectableEntry,
  findOwnOperation,
  OPERATION_NOT_FOUND,
  OPERATION_TTL_MS,
  operationStatus,
  tokenUsable,
  toOperationView,
  unchangedSince,
  type CorrectionPayload,
  type EntryPayload,
} from "@/lib/integrations/operations";
import { createManualEntry } from "@/lib/time-entries/manual-entry";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "@/app/api/time-entries/audit";

type User = Awaited<ReturnType<typeof getCurrentUser>>;
type Operation = NonNullable<Awaited<ReturnType<typeof findOwnOperation>>>;

/** Claims the pending operation inside `tx`; false when another confirm, a cancel or expiry got there first. */
async function claim(tx: Prisma.TransactionClient, op: Operation, now: Date) {
  const claimed = await tx.integrationOperation.updateMany({
    where: {
      id: op.id,
      status: "pending",
      expiresAt: { gt: now },
      token: { revokedAt: null, expiresAt: { gt: now } },
    },
    data: { status: "confirmed", confirmedAt: now, updatedAt: now },
  });
  return claimed.count > 0;
}

function auditBase(user: User, op: Operation) {
  return {
    accountId: user.accountId,
    actorUserId: user.id,
    actorEmail: user.email ?? "",
    actorName: user.name ?? "",
    actorRole: user.role,
    entityType: "TimeEntry",
    integration: { integrationTokenId: op.token.id, integrationTokenName: op.token.name, operationId: op.id },
  };
}

/** The response when the claim lost: the settled operation, or 409 with its state. */
async function settledResponse(user: User, id: string) {
  const current = await findOwnOperation(user, id);
  const settled = current && operationStatus(current, new Date());
  if (current && settled === "confirmed") return NextResponse.json(await toOperationView(current));
  return NextResponse.json({ error: `This operation is ${settled ?? "gone"}` }, { status: 409 });
}

async function confirmCreate(user: User, access: MemberAccess, op: Operation, now: Date) {
  const payload = op.payload as unknown as EntryPayload;
  const violation = await checkEntryPayload(user.accountId, access, payload);
  if (violation) return NextResponse.json({ error: violation.error }, { status: violation.status });

  const entry = await prisma.$transaction(async (tx) => {
    if (!(await claim(tx, op, now))) return null;
    const created = await createManualEntry(
      tx,
      { accountId: user.accountId, userId: user.id },
      { ...payload, description: payload.description ?? undefined },
    );
    await tx.integrationOperation.update({ where: { id: op.id }, data: { resultEntryId: created.id } });
    return created;
  });
  if (!entry) return settledResponse(user, op.id);

  const { integration, ...base } = auditBase(user, op);
  await createAuditLog({
    ...base,
    action: "create",
    entityId: entry.id,
    summary: `${summarizeTimeEntryAudit("create", entry)} via integration "${op.token.name}"`,
    changesJson: { ...toTimeEntryAuditSnapshot(entry), ...integration },
  });
  return NextResponse.json(await toOperationView((await findOwnOperation(user, op.id))!));
}

class EntryChanged extends Error {}

async function confirmCorrection(user: User, access: MemberAccess, op: Operation, now: Date) {
  const { entryId, changes, before } = op.payload as unknown as CorrectionPayload;
  const owner = { accountId: user.accountId, userId: user.id };

  const found = await findCorrectableEntry(owner, entryId);
  if ("violation" in found) {
    return NextResponse.json({ error: `This entry can no longer be corrected: ${found.violation.error}` }, { status: 409 });
  }
  const violation = await checkCorrection(user.accountId, access, before, changes);
  if (violation) return NextResponse.json({ error: violation.error }, { status: violation.status });

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (!(await claim(tx, op, now))) return null;
      // Compare and write in one statement: a concurrent edit makes it match nothing.
      const written = await tx.timeEntry.updateMany({
        where: { id: entryId, ...owner, isDeleted: false, isRunning: false, ...unchangedSince(before) },
        data: correctionData(before, changes, now),
      });
      if (written.count === 0) throw new EntryChanged();
      await tx.integrationOperation.update({ where: { id: op.id }, data: { resultEntryId: entryId } });
      return tx.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    });
  } catch (error) {
    if (!(error instanceof EntryChanged)) throw error;
    return entryChangedResponse(user, op, now);
  }
  if (!updated) return settledResponse(user, op.id);

  const { integration, ...base } = auditBase(user, op);
  await createAuditLog({
    ...base,
    action: "update",
    entityId: entryId,
    summary: `${summarizeTimeEntryAudit("update", updated)} via integration "${op.token.name}"`,
    changesJson: { before: toTimeEntryAuditSnapshot(found.entry), after: toTimeEntryAuditSnapshot(updated), ...integration },
  });
  return NextResponse.json(await toOperationView((await findOwnOperation(user, op.id))!));
}

/** Nothing was written. Re-snapshot the entry so the page shows the new before/after to confirm again. */
async function entryChangedResponse(user: User, op: Operation, now: Date) {
  const payload = op.payload as unknown as CorrectionPayload;
  const found = await findCorrectableEntry({ accountId: user.accountId, userId: user.id }, payload.entryId);
  if ("violation" in found) {
    return NextResponse.json({ error: `This entry can no longer be corrected: ${found.violation.error}` }, { status: 409 });
  }
  await prisma.integrationOperation.updateMany({
    where: { id: op.id, status: "pending" },
    data: {
      payload: { ...payload, before: entrySnapshot(found.entry) } as unknown as Prisma.InputJsonObject,
      expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      updatedAt: now,
    },
  });
  const current = (await findOwnOperation(user, op.id))!;
  return NextResponse.json(
    {
      error: "This entry changed after the preview, so nothing was saved. Review the current values and confirm again.",
      code: ENTRY_CHANGED,
      operation: await toOperationView(current),
    },
    { status: 409 },
  );
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const op = await findOwnOperation(user, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });

    const now = new Date();
    const status = operationStatus(op, now);
    if (status === "confirmed") return NextResponse.json(await toOperationView(op, now));
    if (status !== "pending") return NextResponse.json({ error: `This operation is ${status}` }, { status: 409 });

    if (!tokenUsable(op.token, op.kind, now)) {
      return NextResponse.json(
        { error: "The integration token that prepared this operation was revoked, expired or lost the scope it needs" },
        { status: 403 },
      );
    }
    if (!hasRole(TRACKER_ROLES, user.role)) {
      return NextResponse.json({ error: "Your role cannot change time entries" }, { status: 403 });
    }

    const access = await getMemberAccess(user.id, user.accountId, user.role);
    return op.kind === CORRECT_ENTRY
      ? await confirmCorrection(user, access, op, now)
      : await confirmCreate(user, access, op, now);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Confirm integration operation error:", error);
    return NextResponse.json({ error: "Failed to confirm operation" }, { status: 500 });
  }
}
