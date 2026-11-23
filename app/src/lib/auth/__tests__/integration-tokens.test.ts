import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  prisma: {
    integrationToken: { findUnique: vi.fn(), update: vi.fn() },
    userProjectAccess: { findMany: vi.fn() },
    userTaskAccess: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => prismaMock);
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));

import { AuthError } from "../helpers";
import {
  authenticateIntegration,
  generateIntegrationToken,
  hashIntegrationToken,
} from "../integration-tokens";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const { token: TOKEN, tokenHash: TOKEN_HASH } = generateIntegrationToken();

function tokenRow(overrides: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    accountId: "acct-a",
    userId: "user-a1",
    scopes: ["read"],
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    revokedAt: null,
    user: {
      id: "user-a1",
      accountId: "acct-a",
      role: "Admin",
      isActive: true,
      isDeleted: false,
      account: { isDeleted: false },
      ...user,
    },
    ...overrides,
  };
}

function request(authorization?: string) {
  return new Request("http://localhost/api/integrations/v1/hours", {
    headers: authorization ? { authorization } : {},
  });
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AuthError);
  return (error as AuthError).status;
}

describe("integration tokens", () => {
  const db = prismaMock.prisma;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.integrationToken.findUnique.mockReset();
    db.integrationToken.update.mockReset().mockResolvedValue({});
    db.userProjectAccess.findMany.mockReset().mockResolvedValue([]);
    db.userTaskAccess.findMany.mockReset().mockResolvedValue([]);
  });

  it("generates a prefixed random token and stores only its SHA-256 hash", () => {
    const { token, tokenHash, tokenPrefix } = generateIntegrationToken();

    expect(token).toMatch(/^tbp_[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashIntegrationToken(token)).toBe(tokenHash);
    expect(tokenPrefix).toBe(token.slice(0, 12));
    expect(generateIntegrationToken().token).not.toBe(token);
  });

  it("rejects a request without a bearer token before touching the database", async () => {
    expect(await rejection(authenticateIntegration(request(), "read"))).toBe(401);
    expect(await rejection(authenticateIntegration(request("Basic abc"), "read"))).toBe(401);
    expect(await rejection(authenticateIntegration(request("Bearer not-a-tempobase-token"), "read"))).toBe(401);
    expect(db.integrationToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    db.integrationToken.findUnique.mockResolvedValue(null);

    expect(await rejection(authenticateIntegration(request(`Bearer ${TOKEN}`), "read"))).toBe(401);
    expect(db.integrationToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: TOKEN_HASH } }),
    );
  });

  it.each([
    ["revoked", tokenRow({ revokedAt: new Date("2026-11-19T00:00:00.000Z") })],
    ["expired", tokenRow({ expiresAt: new Date("2026-11-20T11:59:59.000Z") })],
    ["deactivated user", tokenRow({}, { isActive: false })],
    ["removed user", tokenRow({}, { isDeleted: true })],
    ["deleted account", tokenRow({}, { account: { isDeleted: true } })],
    ["user moved to another account", tokenRow({}, { accountId: "acct-b" })],
  ])("rejects a token of a %s", async (_label, row) => {
    db.integrationToken.findUnique.mockResolvedValue(row);

    expect(await rejection(authenticateIntegration(request(`Bearer ${TOKEN}`), "read"))).toBe(401);
    expect(db.integrationToken.update).not.toHaveBeenCalled();
  });

  it("rejects a token without the required scope", async () => {
    db.integrationToken.findUnique.mockResolvedValue(tokenRow({ scopes: [] }));

    expect(await rejection(authenticateIntegration(request(`Bearer ${TOKEN}`), "read"))).toBe(403);
  });

  it("limits an admin token to the admin's own entries", async () => {
    db.integrationToken.findUnique.mockResolvedValue(tokenRow());

    const caller = await authenticateIntegration(request(`Bearer ${TOKEN}`), "read");

    expect(caller).toMatchObject({ tokenId: "token-1", userId: "user-a1", accountId: "acct-a" });
    expect(caller.access).toEqual({ projectIds: null, taskIds: null, userId: "user-a1" });
    expect(db.integrationToken.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { lastUsedAt: NOW },
    });
  });

  it("re-reads a member's project and task access on every call", async () => {
    db.integrationToken.findUnique.mockResolvedValue(tokenRow({}, { role: "Member" }));
    db.userProjectAccess.findMany.mockResolvedValue([{ projectId: "project-1" }]);

    const first = await authenticateIntegration(request(`Bearer ${TOKEN}`), "read");
    expect(first.access).toEqual({ projectIds: ["project-1"], taskIds: null, userId: "user-a1" });

    db.userProjectAccess.findMany.mockResolvedValue([{ projectId: "project-2" }]);
    const second = await authenticateIntegration(request(`Bearer ${TOKEN}`), "read");
    expect(second.access.projectIds).toEqual(["project-2"]);
  });
});
