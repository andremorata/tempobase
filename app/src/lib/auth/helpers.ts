/**
 * Auth.js Helper Functions
 *
 * Utilities for authentication and authorization in Next.js API routes.
 */

import { NextResponse } from "next/server";
import { auth } from "./config";
import type { UserRole } from "@prisma/client";
import { MANAGER_ROLES, TRACKER_ROLES } from "./roles";

/**
 * Get current session or throw 401
 */
export async function requireAuth() {
  const session = await auth();

  if (!session || !session.user) {
    throw new AuthError(401, "Unauthorized");
  }

  return session;
}

/**
 * Check if user has required role
 */
export async function requireRole(allowedRoles: readonly UserRole[]) {
  const session = await requireAuth();

  if (!allowedRoles.includes(session.user.role)) {
    throw new AuthError(403, "Forbidden");
  }

  return session;
}

/**
 * Get current tenant (account) ID from session
 */
export async function getCurrentTenantId(): Promise<string> {
  const session = await requireAuth();
  return session.user.accountId;
}

/**
 * Get current user ID from session
 */
export async function getCurrentUserId(): Promise<string> {
  const session = await requireAuth();
  return session.user.id;
}

/**
 * Get full session user
 */
export async function getCurrentUser() {
  const session = await requireAuth();
  return session.user;
}

/**
 * Check if user is owner or admin
 */
export async function requireOwnerOrAdmin() {
  return requireRole(["Owner", "Admin"]);
}

/**
 * Check if user is owner
 */
export async function requireOwner() {
  return requireRole(["Owner"]);
}

/**
 * Check if user can manage clients, projects, tasks and other users' entries
 */
export async function requireManager() {
  return requireRole(MANAGER_ROLES);
}

/**
 * Check if user can track time (everyone except Viewer)
 */
export async function requireTracker() {
  return requireRole(TRACKER_ROLES);
}

/**
 * Maps an AuthError to its 401/403 response; returns null for any other error
 */
export function authErrorResponse(error: unknown) {
  if (!(error instanceof AuthError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

/**
 * Auth error class
 */
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}
