/**
 * POST /api/integrations/v1/operations - Prepare a manual time entry for confirmation in the app.
 *
 * Writes nothing to time entries. The same token and idempotencyKey return the same operation
 * (re-opened when it was cancelled or expired); reusing the key for a different entry returns 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import { authenticateIntegration, type IntegrationCaller } from "@/lib/auth/integration-tokens";
import { prisma } from "@/lib/db/prisma";
import {
  checkEntryPayload,
  confirmPath,
  CREATE_ENTRY,
  OPERATION_TTL_MS,
  operationInclude,
  operationStatus,
  PrepareEntrySchema,
  samePayload,
  toEntryPayload,
  toOperationView,
  type EntryPayload,
} from "@/lib/integrations/operations";
import { integrationErrorResponse } from "../shared";

/**
 * The operation already prepared with this key, or null. A cancelled or expired one is re-opened
 * as pending (after re-checking the entry rules), so asking again for the same entry works.
 */
async function existingOperation(caller: IntegrationCaller, idempotencyKey: string, payload: EntryPayload, request: NextRequest) {
  const existing = await prisma.integrationOperation.findUnique({
    where: { tokenId_idempotencyKey: { tokenId: caller.tokenId, idempotencyKey } },
    include: operationInclude,
  });
  if (!existing) return null;
  if (!samePayload(existing.payload as unknown as EntryPayload, payload)) {
    return NextResponse.json({ error: "idempotencyKey was already used for a different entry" }, { status: 409 });
  }

  const now = new Date();
  const status = operationStatus(existing, now);
  if (status !== "cancelled" && status !== "expired") return NextResponse.json(await withConfirmUrl(existing, request));

  const violation = await checkEntryPayload(caller.accountId, caller.access, payload);
  if (violation) return NextResponse.json({ error: violation.error }, { status: violation.status });

  // Only a still-dead row is re-opened, so a confirmed operation is never touched.
  await prisma.integrationOperation.updateMany({
    where: { id: existing.id, OR: [{ status: "cancelled" }, { status: "pending", expiresAt: { lte: now } }] },
    data: { status: "pending", expiresAt: new Date(now.getTime() + OPERATION_TTL_MS), cancelledAt: null, updatedAt: now },
  });
  const current = await prisma.integrationOperation.findUniqueOrThrow({ where: { id: existing.id }, include: operationInclude });
  return NextResponse.json(await withConfirmUrl(current, request));
}

async function withConfirmUrl(op: Parameters<typeof toOperationView>[0], request: NextRequest) {
  return { ...(await toOperationView(op)), confirmUrl: new URL(confirmPath(op.id), request.url).toString() };
}

export async function POST(request: NextRequest) {
  try {
    const caller = await authenticateIntegration(request, "create");
    if (!hasRole(TRACKER_ROLES, caller.role)) {
      return NextResponse.json({ error: "Your role cannot create time entries" }, { status: 403 });
    }

    const parsed = PrepareEntrySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
      return NextResponse.json({ error: `Validation failed (${fields.join("; ")})`, details: parsed.error.issues }, { status: 400 });
    }
    const { idempotencyKey } = parsed.data;
    const payload = toEntryPayload(parsed.data);

    const existing = await existingOperation(caller, idempotencyKey, payload, request);
    if (existing) return existing;

    const violation = await checkEntryPayload(caller.accountId, caller.access, payload);
    if (violation) return NextResponse.json({ error: violation.error }, { status: violation.status });

    try {
      const op = await prisma.integrationOperation.create({
        data: {
          accountId: caller.accountId,
          userId: caller.userId,
          tokenId: caller.tokenId,
          kind: CREATE_ENTRY,
          idempotencyKey,
          payload: payload as unknown as Prisma.InputJsonObject,
          expiresAt: new Date(Date.now() + OPERATION_TTL_MS),
        },
        include: operationInclude,
      });
      return NextResponse.json(await withConfirmUrl(op, request), { status: 201 });
    } catch (error) {
      // A concurrent retry with the same key won the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await existingOperation(caller, idempotencyKey, payload, request);
        if (raced) return raced;
      }
      throw error;
    }
  } catch (error) {
    return integrationErrorResponse(error, "prepare operation");
  }
}
