/**
 * POST /api/integrations/v1/operations - Prepare a write for confirmation in the app.
 *
 * Without `kind` (or `create_entry`) it prepares a new manual entry and needs the `create` scope.
 * With `kind: "correct_entry"` it prepares a correction of one of the caller's own entries and needs
 * `correct`; only the fields sent are changed, and the preview records the entry as it is now.
 *
 * Writes nothing to time entries. The same token and idempotencyKey return the same operation
 * (re-opened when it was cancelled or expired); reusing the key for a different write returns 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type IntegrationOperation } from "@prisma/client";
import type { z } from "zod";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import { authenticateIntegration, type IntegrationCaller } from "@/lib/auth/integration-tokens";
import { prisma } from "@/lib/db/prisma";
import {
  changedFields,
  checkCorrection,
  checkEntryPayload,
  confirmPath,
  CORRECT_ENTRY,
  CREATE_ENTRY,
  entrySnapshot,
  findCorrectableEntry,
  KIND_SCOPE,
  mergeChanges,
  OPERATION_TTL_MS,
  operationInclude,
  operationStatus,
  PrepareCorrectionSchema,
  PrepareEntrySchema,
  sameCorrection,
  samePayload,
  toEntryChanges,
  toEntryPayload,
  toOperationView,
  type CorrectionPayload,
  type EntryPayload,
  type OperationKind,
} from "@/lib/integrations/operations";
import type { EntryRuleViolation } from "@/lib/time-entries/manual-entry";
import { integrationErrorResponse } from "../shared";

/** One kind's rules: whether a stored payload is the same request, and the payload to store now. */
interface Prepared {
  kind: OperationKind;
  idempotencyKey: string;
  same: (stored: IntegrationOperation["payload"]) => boolean;
  build: () => Promise<{ payload: object } | { violation: EntryRuleViolation }>;
}

function prepareCreate(caller: IntegrationCaller, input: z.infer<typeof PrepareEntrySchema>): Prepared {
  const payload = toEntryPayload(input);
  return {
    kind: CREATE_ENTRY,
    idempotencyKey: input.idempotencyKey,
    same: (stored) => samePayload(stored as unknown as EntryPayload, payload),
    build: async () => {
      const violation = await checkEntryPayload(caller.accountId, caller.access, payload);
      return violation ? { violation } : { payload };
    },
  };
}

function prepareCorrection(caller: IntegrationCaller, input: z.infer<typeof PrepareCorrectionSchema>): Prepared {
  const request = { entryId: input.entryId, changes: toEntryChanges(input) };
  return {
    kind: CORRECT_ENTRY,
    idempotencyKey: input.idempotencyKey,
    same: (stored) => sameCorrection(stored as unknown as CorrectionPayload, request),
    // Snapshot the entry now: this is the "before" the user sees and confirm compares against.
    build: async () => {
      const found = await findCorrectableEntry({ accountId: caller.accountId, userId: caller.userId }, request.entryId);
      if ("violation" in found) return found;
      const before = entrySnapshot(found.entry);
      if (changedFields(before, mergeChanges(before, request.changes)).length === 0) {
        return { violation: { status: 400, error: "The entry already has these values; nothing to correct" } };
      }
      const violation = await checkCorrection(caller.accountId, caller.access, before, request.changes);
      return violation ? { violation } : { payload: { ...request, before } satisfies CorrectionPayload };
    },
  };
}

const violationResponse = (violation: EntryRuleViolation) =>
  NextResponse.json({ error: violation.error }, { status: violation.status });

/**
 * The operation already prepared with this key, or null. A cancelled or expired one is re-opened
 * as pending (after building its payload again), so asking again for the same write works.
 */
async function existingOperation(caller: IntegrationCaller, prepared: Prepared, request: NextRequest) {
  const existing = await prisma.integrationOperation.findUnique({
    where: { tokenId_idempotencyKey: { tokenId: caller.tokenId, idempotencyKey: prepared.idempotencyKey } },
    include: operationInclude,
  });
  if (!existing) return null;
  if (existing.kind !== prepared.kind || !prepared.same(existing.payload)) {
    return NextResponse.json({ error: "idempotencyKey was already used for a different request" }, { status: 409 });
  }

  const now = new Date();
  const status = operationStatus(existing, now);
  if (status !== "cancelled" && status !== "expired") return NextResponse.json(await withConfirmUrl(existing, request));

  const built = await prepared.build();
  if ("violation" in built) return violationResponse(built.violation);

  // Only a still-dead row is re-opened, so a confirmed operation is never touched.
  await prisma.integrationOperation.updateMany({
    where: { id: existing.id, OR: [{ status: "cancelled" }, { status: "pending", expiresAt: { lte: now } }] },
    data: {
      status: "pending",
      payload: built.payload as Prisma.InputJsonObject,
      expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      cancelledAt: null,
      updatedAt: now,
    },
  });
  const current = await prisma.integrationOperation.findUniqueOrThrow({ where: { id: existing.id }, include: operationInclude });
  return NextResponse.json(await withConfirmUrl(current, request));
}

async function withConfirmUrl(op: Parameters<typeof toOperationView>[0], request: NextRequest) {
  return { ...(await toOperationView(op)), confirmUrl: new URL(confirmPath(op.id), request.url).toString() };
}

function validationError(error: z.ZodError) {
  const fields = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
  return NextResponse.json({ error: `Validation failed (${fields.join("; ")})`, details: error.issues }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const kind: OperationKind = body?.kind === CORRECT_ENTRY ? CORRECT_ENTRY : CREATE_ENTRY;
    const caller = await authenticateIntegration(request, KIND_SCOPE[kind]);
    if (!hasRole(TRACKER_ROLES, caller.role)) {
      return NextResponse.json({ error: "Your role cannot change time entries" }, { status: 403 });
    }

    let prepared: Prepared;
    if (kind === CORRECT_ENTRY) {
      const parsed = PrepareCorrectionSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      prepared = prepareCorrection(caller, parsed.data);
    } else {
      const parsed = PrepareEntrySchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      prepared = prepareCreate(caller, parsed.data);
    }

    const existing = await existingOperation(caller, prepared, request);
    if (existing) return existing;

    const built = await prepared.build();
    if ("violation" in built) return violationResponse(built.violation);

    try {
      const op = await prisma.integrationOperation.create({
        data: {
          accountId: caller.accountId,
          userId: caller.userId,
          tokenId: caller.tokenId,
          kind: prepared.kind,
          idempotencyKey: prepared.idempotencyKey,
          payload: built.payload as Prisma.InputJsonObject,
          expiresAt: new Date(Date.now() + OPERATION_TTL_MS),
        },
        include: operationInclude,
      });
      return NextResponse.json(await withConfirmUrl(op, request), { status: 201 });
    } catch (error) {
      // A concurrent retry with the same key won the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await existingOperation(caller, prepared, request);
        if (raced) return raced;
      }
      throw error;
    }
  } catch (error) {
    return integrationErrorResponse(error, "prepare operation");
  }
}
