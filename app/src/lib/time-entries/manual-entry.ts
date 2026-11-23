/**
 * Manual time entry rules shared by POST /api/time-entries and confirmed integration operations.
 */

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  isProjectAccessible,
  isProjectOpenForEntries,
  isTaskAccessible,
  PROJECT_NOT_ACTIVE_ERROR,
  refsBelongToAccount,
  type MemberAccess,
} from "@/lib/auth/access";

export const ManualEntrySchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  isBillable: z.boolean().default(false),
  tagIds: z.array(z.string().uuid()).optional(),
});

export type ManualEntryInput = z.infer<typeof ManualEntrySchema>;

export interface EntryRuleViolation {
  status: number;
  error: string;
}

/** Access, account, project-status and time-range rules; null when the entry may be created. */
export async function checkManualEntry(
  accountId: string,
  access: MemberAccess,
  input: ManualEntryInput,
): Promise<EntryRuleViolation | null> {
  if (!isProjectAccessible(access, input.projectId)) return { status: 404, error: "Project not found" };
  if (!isTaskAccessible(access, input.taskId)) return { status: 404, error: "Task not found" };
  if (
    !(await refsBelongToAccount(accountId, {
      projectIds: [input.projectId],
      taskIds: [input.taskId],
      tagIds: input.tagIds,
    }))
  ) {
    return { status: 404, error: "Project, task or tag not found" };
  }
  if (!(await isProjectOpenForEntries(accountId, input.projectId))) {
    return { status: 409, error: PROJECT_NOT_ACTIVE_ERROR };
  }

  const durationMs = new Date(input.endTime).getTime() - new Date(input.startTime).getTime();
  if (durationMs <= 0) return { status: 400, error: "End time must be after start time" };
  if (durationMs > 24 * 3_600_000) return { status: 400, error: "Time entry cannot exceed 24 hours" };
  return null;
}

/** Creates a validated manual entry (and its tags) inside the caller's transaction. */
export async function createManualEntry(
  tx: Prisma.TransactionClient,
  owner: { accountId: string; userId: string },
  input: ManualEntryInput,
) {
  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationHours = durationMs / 3_600_000;

  // NOTE: entry_date uses the server's timezone (issue #27).
  const entryDate = new Date(startTime);
  entryDate.setHours(0, 0, 0, 0);

  const entry = await tx.timeEntry.create({
    data: {
      accountId: owner.accountId,
      userId: owner.userId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      description: input.description?.trim() || null,
      entryDate,
      startTime,
      endTime,
      duration: durationMs,
      durationDecimal: Number(durationHours.toFixed(4)),
      isBillable: input.isBillable,
      isRunning: false,
    },
  });

  if (input.tagIds && input.tagIds.length > 0) {
    await tx.timeEntryTag.createMany({
      data: input.tagIds.map((tagId) => ({ timeEntryId: entry.id, tagId })),
    });
  }

  return tx.timeEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { tags: { include: { tag: true } } },
  });
}
