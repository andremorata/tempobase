import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashIntegrationToken } from "@/lib/auth/integration-tokens";

const prismaMock = vi.hoisted(() => ({
  prisma: {
    integrationToken: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
const session = vi.hoisted(() => ({
  user: { id: "user-a1", accountId: "acct-a", role: "Member", email: "a1@example.com", name: "A One" },
}));

vi.mock("@/lib/db/prisma", () => prismaMock);
vi.mock("@/lib/audit/logger", () => auditMock);
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(async () => session) }));

import { GET, POST } from "../route";
import { DELETE } from "../[id]/route";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const TOKEN_ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/account/integration-tokens", { method: "POST", body: JSON.stringify(body) }),
  );
}

function revoke(id: string) {
  return DELETE(new NextRequest(`http://localhost/api/account/integration-tokens/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

describe("integration token management", () => {
  const db = prismaMock.prisma.integrationToken;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    Object.values(db).forEach((fn) => fn.mockReset());
    auditMock.createAuditLog.mockReset();
    db.create.mockImplementation(async ({ data }) => ({
      id: TOKEN_ID,
      name: data.name,
      tokenPrefix: data.tokenPrefix,
      scopes: data.scopes,
      expiresAt: data.expiresAt,
      lastUsedAt: null,
      createdAt: NOW,
    }));
  });

  it("issues a read token for the caller, stores only its hash and returns it once", async () => {
    const res = await post({ name: "Raycast", expiresInDays: 7 });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^tbp_/);
    const data = db.create.mock.calls[0]![0].data;
    expect(data).toEqual({
      accountId: "acct-a",
      userId: "user-a1",
      name: "Raycast",
      tokenHash: hashIntegrationToken(body.token),
      tokenPrefix: body.token.slice(0, 12),
      scopes: ["read"],
      expiresAt: new Date("2026-11-27T12:00:00.000Z"),
    });
    expect(JSON.stringify(data)).not.toContain(body.token);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entityType: "IntegrationToken", entityId: TOKEN_ID, actorUserId: "user-a1" }),
    );
    expect(JSON.stringify(auditMock.createAuditLog.mock.calls)).not.toContain(body.token);
  });

  it("always includes read and adds create only when asked", async () => {
    await post({ name: "Raycast", scopes: ["create"] });
    await post({ name: "Raycast", scopes: ["read"] });

    expect(db.create.mock.calls.map((call) => call[0].data.scopes)).toEqual([["read", "create"], ["read"]]);
    expect((await post({ name: "Raycast", scopes: ["delete"] })).status).toBe(400);
  });

  it("refuses the create scope to a viewer", async () => {
    session.user.role = "Viewer";
    try {
      expect((await post({ name: "Raycast", scopes: ["create"] })).status).toBe(403);
      expect((await post({ name: "Raycast" })).status).toBe(201);
    } finally {
      session.user.role = "Member";
    }
  });

  it("defaults to 30 days and refuses more than 90", async () => {
    await post({ name: "Raycast" });
    expect(db.create.mock.calls[0]![0].data.expiresAt).toEqual(new Date("2026-12-20T12:00:00.000Z"));

    expect((await post({ name: "Raycast", expiresInDays: 91 })).status).toBe(400);
    expect((await post({ name: "  " })).status).toBe(400);
  });

  it("lists only the caller's active tokens without their hash", async () => {
    db.findMany.mockResolvedValue([]);
    await GET();

    const args = db.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ accountId: "acct-a", userId: "user-a1", revokedAt: null });
    expect(args.select.tokenHash).toBeUndefined();
  });

  it("revokes only the caller's own token", async () => {
    db.findFirst.mockResolvedValue({ id: TOKEN_ID, name: "Raycast" });

    expect((await revoke(TOKEN_ID)).status).toBe(204);
    expect(db.findFirst.mock.calls[0]![0].where).toEqual({ id: TOKEN_ID, accountId: "acct-a", userId: "user-a1", revokedAt: null });
    expect(db.update).toHaveBeenCalledWith({ where: { id: TOKEN_ID }, data: { revokedAt: NOW, updatedAt: NOW } });
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", entityId: TOKEN_ID }));
  });

  it("returns 404 for another user's, an already revoked or a malformed token id", async () => {
    db.findFirst.mockResolvedValue(null);

    expect((await revoke(TOKEN_ID)).status).toBe(404);
    expect((await revoke("not-a-uuid")).status).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });
});
