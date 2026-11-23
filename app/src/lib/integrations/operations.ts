/**
 * Integration operations: writes an integration token prepares and the same user confirms
 * in the app. Only `create_entry` exists so far.
 */

import type { IntegrationOperation } from "@prisma/client";
import { z } from "zod";
import type { MemberAccess } from "@/lib/auth/access";
import { prisma } from "@/lib/db/prisma";
import { checkManualEntry, type EntryRuleViolation } from "@/lib/time-entries/manual-entry";

export const OPERATION_TTL_MS = 15 * 60_000;
export const CREATE_ENTRY = "create_entry";

export type OperationStatus = "pending" | "confirmed" | "cancelled" | "expired";

export const PrepareEntrySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(100),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  description: z.string().max(1000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  isBillable: z.boolean(),
});

export interface EntryPayload {
  startTime: string;
  endTime: string;
  description: string | null;
  projectId: string | null;
  taskId: string | null;
  isBillable: boolean;
}

export function toEntryPayload(input: z.infer<typeof PrepareEntrySchema>): EntryPayload {
  return {
    startTime: new Date(input.startTime).toISOString(),
    endTime: new Date(input.endTime).toISOString(),
    description: input.description?.trim() || null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    isBillable: input.isBillable,
  };
}

const PAYLOAD_KEYS = ["startTime", "endTime", "description", "projectId", "taskId", "isBillable"] as const;

export function samePayload(a: EntryPayload, b: EntryPayload): boolean {
  return PAYLOAD_KEYS.every((key) => a[key] === b[key]);
}

export function operationStatus(op: Pick<IntegrationOperation, "status" | "expiresAt">, now: Date): OperationStatus {
  if (op.status === "pending" && op.expiresAt <= now) return "expired";
  return op.status as OperationStatus;
}

/**
 * Manual entry rules plus the integration's stricter task rule: a task needs its own project,
 * and both must be in the caller's account and access.
 */
export async function checkEntryPayload(
  accountId: string,
  access: MemberAccess,
  payload: EntryPayload,
): Promise<EntryRuleViolation | null> {
  if (payload.taskId) {
    if (!payload.projectId) return { status: 400, error: "taskId requires the task's projectId" };
    const task = await prisma.projectTask.findFirst({
      where: { id: payload.taskId, accountId, isDeleted: false },
      select: { projectId: true },
    });
    if (!task || task.projectId !== payload.projectId) return { status: 404, error: "Task not found" };
  }
  return checkManualEntry(accountId, access, { ...payload, description: payload.description ?? undefined });
}

export const operationInclude = {
  token: { select: { id: true, name: true, tokenPrefix: true, scopes: true, revokedAt: true, expiresAt: true } },
} as const;

type OperationToken = { name: string; tokenPrefix: string; scopes: string[]; revokedAt: Date | null; expiresAt: Date };
type OperationWithToken = IntegrationOperation & { token: OperationToken };

/** False once the token is revoked, expired or without `create`: its operations can no longer be confirmed. */
export function tokenUsable(token: Pick<OperationToken, "scopes" | "revokedAt" | "expiresAt">, now: Date): boolean {
  return !token.revokedAt && token.expiresAt > now && token.scopes.includes("create");
}

export function confirmPath(id: string) {
  return `/integrations/operations/${id}`;
}

/** The shape both the integration API and the app return. Names resolve at read time. */
export async function toOperationView(op: OperationWithToken, now = new Date()) {
  const payload = op.payload as unknown as EntryPayload;
  const [project, task, result] = await Promise.all([
    payload.projectId
      ? prisma.project.findFirst({ where: { id: payload.projectId, accountId: op.accountId }, select: { id: true, name: true } })
      : null,
    payload.taskId
      ? prisma.projectTask.findFirst({ where: { id: payload.taskId, accountId: op.accountId }, select: { id: true, name: true } })
      : null,
    op.resultEntryId
      ? prisma.timeEntry.findFirst({ where: { id: op.resultEntryId, accountId: op.accountId }, select: { isDeleted: true } })
      : null,
  ]);
  const status = operationStatus(op, now);
  const durationMs = new Date(payload.endTime).getTime() - new Date(payload.startTime).getTime();

  return {
    id: op.id,
    kind: op.kind,
    status,
    expiresAt: op.expiresAt.toISOString(),
    createdAt: op.createdAt.toISOString(),
    confirmedAt: op.confirmedAt?.toISOString() ?? null,
    cancelledAt: op.cancelledAt?.toISOString() ?? null,
    entryId: op.resultEntryId,
    // Entries are soft-deleted, so a confirmed operation can outlive its entry.
    entryDeleted: status === "confirmed" && (!result || result.isDeleted),
    entry: {
      startTime: payload.startTime,
      endTime: payload.endTime,
      durationHours: Number((durationMs / 3_600_000).toFixed(2)),
      description: payload.description,
      isBillable: payload.isBillable,
      project: project ? { id: project.id, name: project.name } : null,
      task: task ? { id: task.id, name: task.name } : null,
    },
    integration: { name: op.token.name, tokenPrefix: op.token.tokenPrefix, tokenUsable: tokenUsable(op.token, now) },
  };
}

/** The caller's own operation, or null (also for another user or account). */
export async function findOwnOperation(owner: { accountId: string; id: string }, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return prisma.integrationOperation.findFirst({
    where: { id, accountId: owner.accountId, userId: owner.id },
    include: operationInclude,
  });
}

export const OPERATION_NOT_FOUND = { error: "Operation not found" };
