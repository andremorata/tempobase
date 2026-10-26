/**
 * Role groups from the permissions matrix in docs/05-business-rules.md §5.
 * Pure module: safe to import from client components.
 */

import type { UserRole } from "@prisma/client";

/** Roles that manage clients, projects, tasks and other users' time entries. */
export const MANAGER_ROLES: readonly UserRole[] = ["Owner", "Admin", "Manager"];

/** Roles that track time, manage tags and share reports. Viewer is read-only. */
export const TRACKER_ROLES: readonly UserRole[] = ["Owner", "Admin", "Manager", "Member"];

export function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  return Boolean(role) && roles.includes(role as string);
}
