/**
 * Member access resolution helpers.
 *
 * Resolves per-user project and task restrictions for non-Owner/Admin members.
 * Results are used as Prisma where-clause filters across all data-fetching routes.
 */

import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MANAGER_ROLES, TRACKER_ROLES } from "./roles";

export { MANAGER_ROLES, TRACKER_ROLES };

export interface MemberAccess {
  /** null = unrestricted (Owner/Admin or no rows configured) */
  projectIds: string[] | null;
  /** null = unrestricted (no task-level rows configured) */
  taskIds: string[] | null;
  /** Set for roles limited to their own entries (Member); null = can see the whole team */
  userId: string | null;
}

/**
 * Resolves the effective project/task access filter for a given user.
 * Owner and Admin always receive null values (unrestricted).
 * Other roles receive the stored access lists, or null if none are configured
 * (meaning full access to all projects/tasks).
 */
export async function getMemberAccess(
  userId: string,
  accountId: string,
  role: string,
): Promise<MemberAccess> {
  if (role === "Owner" || role === "Admin") {
    return { projectIds: null, taskIds: null, userId: null };
  }

  const [projectAccess, taskAccess] = await Promise.all([
    prisma.userProjectAccess.findMany({
      where: { userId, accountId },
      select: { projectId: true },
    }),
    prisma.userTaskAccess.findMany({
      where: { userId, accountId },
      select: { taskId: true },
    }),
  ]);

  return {
    projectIds: projectAccess.length > 0 ? projectAccess.map((a) => a.projectId) : null,
    taskIds: taskAccess.length > 0 ? taskAccess.map((a) => a.taskId) : null,
    userId: role === "Member" ? userId : null,
  };
}

/**
 * Applies user, project and task access restrictions to a Prisma where clause object.
 *
 * If the caller already specified a concrete userId/projectId/taskId filter (e.g. from
 * query params), this intersects it with the allowed scope so out-of-scope IDs
 * yield zero results rather than leaking data.
 */
export function applyAccessFilter(
  where: Prisma.TimeEntryWhereInput,
  access: MemberAccess,
  queryProjectId?: string | null,
  queryTaskId?: string | null,
  queryUserId?: string | null,
): void {
  if (access.userId !== null) {
    where.userId = queryUserId && queryUserId !== access.userId ? { in: [] } : access.userId;
  } else if (queryUserId) {
    where.userId = queryUserId;
  }

  if (access.projectIds !== null) {
    // Intersect with any caller-supplied projectId
    const allowed = queryProjectId
      ? access.projectIds.filter((id) => id === queryProjectId)
      : access.projectIds;
    where.projectId = { in: allowed };
  } else if (queryProjectId) {
    where.projectId = queryProjectId;
  }

  if (access.taskIds !== null) {
    // Intersect with any caller-supplied taskId
    const allowed = queryTaskId
      ? access.taskIds.filter((id) => id === queryTaskId)
      : access.taskIds;
    where.taskId = { in: allowed };
  } else if (queryTaskId) {
    where.taskId = queryTaskId;
  }
}

/**
 * Returns true if the given projectId is accessible to the user.
 * A null/undefined projectId (no project selected) is always allowed.
 */
export function isProjectAccessible(
  access: MemberAccess,
  projectId: string | null | undefined,
): boolean {
  if (access.projectIds === null) return true;
  if (!projectId) return true;
  return access.projectIds.includes(projectId);
}

/**
 * Returns true if the given taskId is accessible to the user.
 * A null/undefined taskId (no task selected) is always allowed.
 */
export function isTaskAccessible(
  access: MemberAccess,
  taskId: string | null | undefined,
): boolean {
  if (access.taskIds === null) return true;
  if (!taskId) return true;
  return access.taskIds.includes(taskId);
}

/** True when the user's scope includes entries owned by entryUserId. */
export function isEntryVisible(access: MemberAccess, entryUserId: string): boolean {
  return access.userId === null || access.userId === entryUserId;
}

/** Viewers never write entries; Members only write their own. */
export function canModifyEntry(
  user: { id: string; role: UserRole },
  entryUserId: string,
): boolean {
  if (!TRACKER_ROLES.includes(user.role)) return false;
  return entryUserId === user.id || MANAGER_ROLES.includes(user.role);
}

type IdList = ReadonlyArray<string | null | undefined> | undefined;

function uniqueIds(ids: IdList): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => Boolean(id)))];
}

/**
 * True when every referenced id exists in the account. Foreign keys are single-column,
 * so without this check a request could link rows from another account.
 */
export async function refsBelongToAccount(
  accountId: string,
  refs: { projectIds?: IdList; taskIds?: IdList; tagIds?: IdList; clientIds?: IdList },
): Promise<boolean> {
  const checks: Array<[string[], (ids: string[]) => Promise<number>]> = [
    [uniqueIds(refs.projectIds), (ids) => prisma.project.count({ where: { id: { in: ids }, accountId, isDeleted: false } })],
    [uniqueIds(refs.taskIds), (ids) => prisma.projectTask.count({ where: { id: { in: ids }, accountId, isDeleted: false } })],
    [uniqueIds(refs.tagIds), (ids) => prisma.tag.count({ where: { id: { in: ids }, accountId, isDeleted: false } })],
    [uniqueIds(refs.clientIds), (ids) => prisma.client.count({ where: { id: { in: ids }, accountId, isDeleted: false } })],
  ];

  for (const [ids, count] of checks) {
    if (ids.length > 0 && (await count(ids)) !== ids.length) return false;
  }
  return true;
}

/**
 * Hourly rates are amounts. Managers always see them because they edit projects and
 * tasks; hiding the rate there would make the edit form save it back as empty.
 */
export function canSeeRates(user: { role: UserRole; canViewAmounts: boolean }): boolean {
  return user.canViewAmounts || MANAGER_ROLES.includes(user.role);
}
