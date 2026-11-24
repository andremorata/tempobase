/**
 * Integration operations: writes an integration token prepares and the same user confirms
 * in the app. `create_entry` adds a manual entry; `correct_entry` changes fields of an existing one.
 */

import type { IntegrationOperation, Prisma, TimeEntry } from "@prisma/client";
import { z } from "zod";
import {
  isProjectAccessible,
  isProjectOpenForEntries,
  isTaskAccessible,
  PROJECT_NOT_ACTIVE_ERROR,
  refsBelongToAccount,
  type MemberAccess,
} from "@/lib/auth/access";
import type { IntegrationScope } from "@/lib/auth/integration-tokens";
import { prisma } from "@/lib/db/prisma";
import { checkManualEntry, type EntryRuleViolation } from "@/lib/time-entries/manual-entry";

export const OPERATION_TTL_MS = 15 * 60_000;
export const CREATE_ENTRY = "create_entry";
export const CORRECT_ENTRY = "correct_entry";
export type OperationKind = typeof CREATE_ENTRY | typeof CORRECT_ENTRY;

/** The token scope that may prepare and confirm each kind. */
export const KIND_SCOPE: Record<OperationKind, IntegrationScope> = { create_entry: "create", correct_entry: "correct" };

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
type EntryField = (typeof PAYLOAD_KEYS)[number];

export function samePayload(a: EntryPayload, b: EntryPayload): boolean {
  return PAYLOAD_KEYS.every((key) => a[key] === b[key]);
}

// ─── correct_entry ─────────────────────────────────────────────────────────

export const PrepareCorrectionSchema = z
  .object({
    kind: z.literal(CORRECT_ENTRY),
    idempotencyKey: z.string().trim().min(1).max(100),
    entryId: z.string().uuid(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    description: z.string().max(1000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
    isBillable: z.boolean().optional(),
  })
  .refine((input) => PAYLOAD_KEYS.some((key) => input[key] !== undefined), { message: "Nothing to correct" });

/** Only the fields the caller asked to change; the rest of the entry is never written. */
export type EntryChanges = Partial<EntryPayload>;

export interface CorrectionPayload {
  entryId: string;
  changes: EntryChanges;
  /** The previewed fields as they were when the preview was made; confirm writes only if they still match. */
  before: EntryPayload;
}

export function toEntryChanges(input: z.infer<typeof PrepareCorrectionSchema>): EntryChanges {
  const changes: EntryChanges = {};
  if (input.startTime !== undefined) changes.startTime = new Date(input.startTime).toISOString();
  if (input.endTime !== undefined) changes.endTime = new Date(input.endTime).toISOString();
  if (input.description !== undefined) changes.description = input.description?.trim() || null;
  if (input.projectId !== undefined) changes.projectId = input.projectId;
  if (input.taskId !== undefined) changes.taskId = input.taskId;
  if (input.isBillable !== undefined) changes.isBillable = input.isBillable;
  return changes;
}

export function sameCorrection(a: CorrectionPayload, b: Pick<CorrectionPayload, "entryId" | "changes">): boolean {
  return a.entryId === b.entryId && PAYLOAD_KEYS.every((key) => a.changes[key] === b.changes[key]);
}

export function mergeChanges(before: EntryPayload, changes: EntryChanges): EntryPayload {
  return { ...before, ...changes };
}

export function changedFields(before: EntryPayload, after: EntryPayload): EntryField[] {
  return PAYLOAD_KEYS.filter((key) => before[key] !== after[key]);
}

export function entrySnapshot(entry: Pick<TimeEntry, EntryField>): EntryPayload {
  return {
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime!.toISOString(),
    description: entry.description,
    projectId: entry.projectId,
    taskId: entry.taskId,
    isBillable: entry.isBillable,
  };
}

/**
 * The owner's entry that a correction may target: not another user's, another account's or a
 * deleted one (404), and not a running timer (409).
 */
export async function findCorrectableEntry(
  owner: { accountId: string; userId: string },
  entryId: string,
): Promise<{ entry: TimeEntry } | { violation: EntryRuleViolation }> {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, accountId: owner.accountId, userId: owner.userId, isDeleted: false },
  });
  if (!entry) return { violation: { status: 404, error: "Time entry not found" } };
  if (entry.isRunning || !entry.endTime) return { violation: { status: 409, error: "A running timer cannot be corrected" } };
  return { entry };
}

/**
 * The rules of PUT /api/time-entries/[id], applied to the entry as it was previewed plus the changes.
 * The project-open check runs only when the project actually changes.
 */
export async function checkCorrection(
  accountId: string,
  access: MemberAccess,
  before: EntryPayload,
  changes: EntryChanges,
): Promise<EntryRuleViolation | null> {
  if (!isProjectAccessible(access, before.projectId)) return { status: 404, error: "Time entry not found" };
  if (changes.projectId !== undefined && !isProjectAccessible(access, changes.projectId)) {
    return { status: 404, error: "Project not found" };
  }
  if (changes.taskId !== undefined && !isTaskAccessible(access, changes.taskId)) return { status: 404, error: "Task not found" };
  if (!(await refsBelongToAccount(accountId, { projectIds: [changes.projectId], taskIds: [changes.taskId] }))) {
    return { status: 404, error: "Project or task not found" };
  }

  const after = mergeChanges(before, changes);
  if (after.projectId !== before.projectId && !(await isProjectOpenForEntries(accountId, after.projectId))) {
    return { status: 409, error: PROJECT_NOT_ACTIVE_ERROR };
  }
  if (after.taskId) {
    const task = await prisma.projectTask.findFirst({
      where: { id: after.taskId, accountId, isDeleted: false },
      select: { projectId: true },
    });
    if (!task || task.projectId !== after.projectId) {
      return { status: 400, error: "The task does not belong to the entry's project. Pass taskId too (null clears it)." };
    }
  }

  const durationMs = new Date(after.endTime).getTime() - new Date(after.startTime).getTime();
  if (durationMs <= 0) return { status: 400, error: "End time must be after start time" };
  if (durationMs > 24 * 3_600_000) return { status: 400, error: "Time entry cannot exceed 24 hours" };
  return null;
}

/** Matches the entry only while its previewed fields are unchanged. */
export function unchangedSince(before: EntryPayload): Prisma.TimeEntryWhereInput {
  // A millisecond window, so a timestamp stored with microseconds still matches its JS Date.
  const instant = (iso: string) => ({ gte: new Date(iso), lt: new Date(new Date(iso).getTime() + 1) });
  return {
    startTime: instant(before.startTime),
    endTime: instant(before.endTime),
    description: before.description,
    projectId: before.projectId,
    taskId: before.taskId,
    isBillable: before.isBillable,
  };
}

/** The write for the requested fields only, deriving duration and entry date like PUT does. */
export function correctionData(before: EntryPayload, changes: EntryChanges, now: Date): Prisma.TimeEntryUncheckedUpdateManyInput {
  const data: Prisma.TimeEntryUncheckedUpdateManyInput = { updatedAt: now };
  if (changes.projectId !== undefined) data.projectId = changes.projectId;
  if (changes.taskId !== undefined) data.taskId = changes.taskId;
  if (changes.description !== undefined) data.description = changes.description;
  if (changes.isBillable !== undefined) data.isBillable = changes.isBillable;
  if (changes.startTime !== undefined || changes.endTime !== undefined) {
    const after = mergeChanges(before, changes);
    const startTime = new Date(after.startTime);
    const endTime = new Date(after.endTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    // NOTE: entry_date uses the server's timezone (issue #27).
    const entryDate = new Date(startTime);
    entryDate.setHours(0, 0, 0, 0);
    Object.assign(data, {
      startTime,
      endTime,
      duration: durationMs,
      durationDecimal: Number((durationMs / 3_600_000).toFixed(4)),
      entryDate,
    });
  }
  return data;
}

export const ENTRY_CHANGED = "entry_changed";

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

/** False once the token is revoked, expired or without the kind's scope: its operations can no longer be confirmed. */
export function tokenUsable(
  token: Pick<OperationToken, "scopes" | "revokedAt" | "expiresAt">,
  kind: string,
  now: Date,
): boolean {
  const scope = KIND_SCOPE[kind as OperationKind];
  return !token.revokedAt && token.expiresAt > now && scope !== undefined && token.scopes.includes(scope);
}

export function confirmPath(id: string) {
  return `/integrations/operations/${id}`;
}

/** Previewed fields with project and task names resolved at read time. */
async function describeEntry(accountId: string, fields: EntryPayload) {
  const [project, task] = await Promise.all([
    fields.projectId
      ? prisma.project.findFirst({ where: { id: fields.projectId, accountId }, select: { id: true, name: true } })
      : null,
    fields.taskId
      ? prisma.projectTask.findFirst({ where: { id: fields.taskId, accountId }, select: { id: true, name: true } })
      : null,
  ]);
  const durationMs = new Date(fields.endTime).getTime() - new Date(fields.startTime).getTime();
  return {
    startTime: fields.startTime,
    endTime: fields.endTime,
    durationHours: Number((durationMs / 3_600_000).toFixed(2)),
    description: fields.description,
    isBillable: fields.isBillable,
    project: project ? { id: project.id, name: project.name } : null,
    task: task ? { id: task.id, name: task.name } : null,
  };
}

/**
 * The shape both the integration API and the app return. `entry` is what confirming saves: the new
 * entry, or for a correction the entry after the changes, with `before` and `changedFields`.
 */
export async function toOperationView(op: OperationWithToken, now = new Date()) {
  const correction = op.kind === CORRECT_ENTRY ? (op.payload as unknown as CorrectionPayload) : null;
  const fields = correction ? mergeChanges(correction.before, correction.changes) : (op.payload as unknown as EntryPayload);
  const entryId = correction ? correction.entryId : op.resultEntryId;
  const [entry, before, result] = await Promise.all([
    describeEntry(op.accountId, fields),
    correction ? describeEntry(op.accountId, correction.before) : null,
    entryId ? prisma.timeEntry.findFirst({ where: { id: entryId, accountId: op.accountId }, select: { isDeleted: true } }) : null,
  ]);
  const status = operationStatus(op, now);

  return {
    id: op.id,
    kind: op.kind,
    status,
    expiresAt: op.expiresAt.toISOString(),
    createdAt: op.createdAt.toISOString(),
    confirmedAt: op.confirmedAt?.toISOString() ?? null,
    cancelledAt: op.cancelledAt?.toISOString() ?? null,
    // For a correction, the entry it targets.
    entryId,
    // Entries are soft-deleted, so a confirmed operation can outlive its entry.
    entryDeleted: status === "confirmed" && (!result || result.isDeleted),
    entry,
    before,
    changedFields: correction ? changedFields(correction.before, fields) : [],
    integration: { name: op.token.name, tokenPrefix: op.token.tokenPrefix, tokenUsable: tokenUsable(op.token, op.kind, now) },
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
