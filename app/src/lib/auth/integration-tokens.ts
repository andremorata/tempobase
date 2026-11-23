/**
 * Personal integration tokens (TempoBase MCP).
 *
 * The plain token is shown once; the database keeps only its SHA-256 hash. Every call
 * re-validates the token, its owner, the account and the owner's access, and scopes
 * time entries to the owner even for Owner/Admin.
 */

import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getMemberAccess, type MemberAccess } from "./access";
import { AuthError } from "./helpers";

export const INTEGRATION_TOKEN_PREFIX = "tbp_";
export const INTEGRATION_TOKEN_MAX_DAYS = 90;
export const INTEGRATION_SCOPES = ["read"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

const TOKEN_PATTERN = /^tbp_[A-Za-z0-9_-]{43}$/;

export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateIntegrationToken() {
  const token = INTEGRATION_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashIntegrationToken(token), tokenPrefix: token.slice(0, 12) };
}

export interface IntegrationCaller {
  tokenId: string;
  userId: string;
  accountId: string;
  role: UserRole;
  /** Access with `userId` forced to the token owner. */
  access: MemberAccess;
}

export async function authenticateIntegration(
  request: Request,
  scope: IntegrationScope,
): Promise<IntegrationCaller> {
  const [scheme, token] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token || !TOKEN_PATTERN.test(token)) {
    throw new AuthError(401, "Invalid integration token");
  }

  const row = await prisma.integrationToken.findUnique({
    where: { tokenHash: hashIntegrationToken(token) },
    select: {
      id: true,
      accountId: true,
      userId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          accountId: true,
          role: true,
          isActive: true,
          isDeleted: true,
          account: { select: { isDeleted: true } },
        },
      },
    },
  });

  const now = new Date();
  const user = row?.user;
  if (
    !row ||
    !user ||
    row.revokedAt ||
    row.expiresAt <= now ||
    !user.isActive ||
    user.isDeleted ||
    user.account.isDeleted ||
    user.accountId !== row.accountId
  ) {
    throw new AuthError(401, "Invalid integration token");
  }

  if (!row.scopes.includes(scope)) {
    throw new AuthError(403, "Token lacks the required scope");
  }

  await prisma.integrationToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });

  const access = await getMemberAccess(user.id, row.accountId, user.role);
  return {
    tokenId: row.id,
    userId: user.id,
    accountId: row.accountId,
    role: user.role,
    access: { ...access, userId: user.id },
  };
}
