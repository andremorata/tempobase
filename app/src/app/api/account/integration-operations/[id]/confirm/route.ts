/**
 * POST /api/account/integration-operations/[id]/confirm - Create the prepared entry.
 *
 * Re-validates the token, role, access and entry rules. The pending -> confirmed flip and the
 * entry insert share one transaction, so repeated or concurrent confirms create one entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMemberAccess } from "@/lib/auth/access";
import { authErrorResponse, getCurrentUser } from "@/lib/auth/helpers";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import { createAuditLog } from "@/lib/audit/logger";
import { prisma } from "@/lib/db/prisma";
import {
  checkEntryPayload,
  findOwnOperation,
  OPERATION_NOT_FOUND,
  operationStatus,
  tokenUsable,
  toOperationView,
  type EntryPayload,
} from "@/lib/integrations/operations";
import { createManualEntry } from "@/lib/time-entries/manual-entry";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "@/app/api/time-entries/audit";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const op = await findOwnOperation(user, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });

    const now = new Date();
    const status = operationStatus(op, now);
    if (status === "confirmed") return NextResponse.json(await toOperationView(op, now));
    if (status !== "pending") return NextResponse.json({ error: `This operation is ${status}` }, { status: 409 });

    const { token } = op;
    if (!tokenUsable(token, now)) {
      return NextResponse.json(
        { error: "The integration token that prepared this operation was revoked, expired or lost the create scope" },
        { status: 403 },
      );
    }
    if (!hasRole(TRACKER_ROLES, user.role)) {
      return NextResponse.json({ error: "Your role cannot create time entries" }, { status: 403 });
    }

    const payload = op.payload as unknown as EntryPayload;
    const access = await getMemberAccess(user.id, user.accountId, user.role);
    const violation = await checkEntryPayload(user.accountId, access, payload);
    if (violation) return NextResponse.json({ error: violation.error }, { status: violation.status });

    const entry = await prisma.$transaction(async (tx) => {
      const claimed = await tx.integrationOperation.updateMany({
        where: {
          id: op.id,
          status: "pending",
          expiresAt: { gt: now },
          token: { revokedAt: null, expiresAt: { gt: now } },
        },
        data: { status: "confirmed", confirmedAt: now, updatedAt: now },
      });
      if (claimed.count === 0) return null;

      const created = await createManualEntry(
        tx,
        { accountId: user.accountId, userId: user.id },
        { ...payload, description: payload.description ?? undefined },
      );
      await tx.integrationOperation.update({ where: { id: op.id }, data: { resultEntryId: created.id } });
      return created;
    });

    const current = await findOwnOperation(user, op.id);
    if (!entry) {
      const settled = current && operationStatus(current, new Date());
      if (current && settled === "confirmed") return NextResponse.json(await toOperationView(current));
      return NextResponse.json({ error: `This operation is ${settled ?? "gone"}` }, { status: 409 });
    }

    await createAuditLog({
      accountId: user.accountId,
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      actorName: user.name ?? "",
      actorRole: user.role,
      action: "create",
      entityType: "TimeEntry",
      entityId: entry.id,
      summary: `${summarizeTimeEntryAudit("create", entry)} via integration "${token.name}"`,
      changesJson: {
        ...toTimeEntryAuditSnapshot(entry),
        integrationTokenId: token.id,
        integrationTokenName: token.name,
        operationId: op.id,
      },
    });

    return NextResponse.json(await toOperationView(current!));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Confirm integration operation error:", error);
    return NextResponse.json({ error: "Failed to confirm operation" }, { status: 500 });
  }
}
