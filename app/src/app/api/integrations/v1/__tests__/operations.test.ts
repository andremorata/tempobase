import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb>,
  session: null as null | { user: { id: string; accountId: string; role: string; email: string; name: string } },
}));

vi.mock("@/lib/db/prisma", () => ({
  get prisma() {
    return state.db.prisma;
  },
}));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(async () => state.session) }));

import { createFakeDb, ids } from "./fake-db";
import { POST as prepare } from "../operations/route";
import { GET as getStatus } from "../operations/[id]/route";
import { GET as getForUser } from "@/app/api/account/integration-operations/[id]/route";
import { POST as confirm } from "@/app/api/account/integration-operations/[id]/confirm/route";
import { POST as cancel } from "@/app/api/account/integration-operations/[id]/cancel/route";

const NOW = new Date("2026-11-22T12:00:00.000Z");

const ENTRY = {
  startTime: "2026-11-20T12:00:00.000Z",
  endTime: "2026-11-20T13:30:00.000Z",
  description: "Review PR #42",
  projectId: ids.projectA1,
  taskId: ids.taskA1,
  isBillable: true,
};

async function send(
  handler: (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  path: string,
  opts: { token?: string; body?: unknown; id?: string; method?: string } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const request = new NextRequest(`http://localhost${path}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(request, { params: Promise.resolve({ id: opts.id ?? "" }) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const prepareEntry = (token: string, body: Record<string, unknown> = {}) =>
  send(prepare, "/api/integrations/v1/operations", { token, body: { idempotencyKey: "key-1", ...ENTRY, ...body } });

const sessionOf = (id: string) => {
  const user = state.db.users.find((u) => u.id === id)!;
  return { user: { id, accountId: user.accountId, role: user.role, email: `${id}@example.com`, name: "Test User" } };
};

const statusOf = (token: string, id: string) => send(getStatus, `/api/integrations/v1/operations/${id}`, { token, id });
const confirmAs = (userId: string, id: string) => {
  state.session = sessionOf(userId);
  return send(confirm, `/api/account/integration-operations/${id}/confirm`, { id, method: "POST" });
};
const cancelAs = (userId: string, id: string) => {
  state.session = sessionOf(userId);
  return send(cancel, `/api/account/integration-operations/${id}/cancel`, { id, method: "POST" });
};
const viewAs = (userId: string, id: string) => {
  state.session = sessionOf(userId);
  return send(getForUser, `/api/account/integration-operations/${id}`, { id });
};

describe("integration operations", () => {
  let tokens: Record<"admin" | "adminRead" | "member" | "memberA2" | "viewer" | "ownerB", string>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    state.db = createFakeDb(NOW);
    state.session = null;
    const create = { scopes: ["read", "create"] };
    tokens = {
      admin: state.db.addToken(ids.adminA, create),
      adminRead: state.db.addToken(ids.adminA),
      member: state.db.addToken(ids.memberA, create),
      memberA2: state.db.addToken(ids.memberA2, create),
      viewer: state.db.addToken(ids.viewerA, create),
      ownerB: state.db.addToken(ids.ownerB, create),
    };
  });

  describe("prepare", () => {
    it("returns a pending preview with names and a confirm URL, and writes no entry", async () => {
      const entries = state.db.timeEntries.length;
      const { status, body } = await prepareEntry(tokens.admin);

      expect(status).toBe(201);
      expect(body).toMatchObject({
        kind: "create_entry",
        status: "pending",
        expiresAt: "2026-11-22T12:15:00.000Z",
        entryId: null,
        entry: {
          startTime: ENTRY.startTime,
          endTime: ENTRY.endTime,
          durationHours: 1.5,
          description: "Review PR #42",
          isBillable: true,
          project: { id: ids.projectA1, name: "Alpha" },
          task: { id: ids.taskA1, name: "Code review" },
        },
        integration: { name: "Raycast" },
      });
      expect(body.confirmUrl).toBe(`http://localhost/integrations/operations/${body.id}`);
      expect(body.confirmUrl).not.toContain("tbp_");
      expect(state.db.timeEntries.length).toBe(entries);
    });

    it("accepts the empty fields the MCP sends as null", async () => {
      const { status, body } = await prepareEntry(tokens.admin, { description: null, projectId: null, taskId: null });
      expect(status).toBe(201);
      expect(body.entry).toMatchObject({ description: null, project: null, task: null });
    });

    it("requires the create scope and a role that tracks time", async () => {
      expect((await prepareEntry(tokens.adminRead)).status).toBe(403);
      expect((await prepareEntry(tokens.viewer, { projectId: null, taskId: null })).status).toBe(403);
      expect(state.db.operations).toHaveLength(0);
    });

    it("returns the same operation for the same key and payload", async () => {
      const first = await prepareEntry(tokens.admin);
      const retry = await prepareEntry(tokens.admin, { description: "  Review PR #42 " });

      expect(retry.status).toBe(200);
      expect(retry.body.id).toBe(first.body.id);
      expect(state.db.operations).toHaveLength(1);
    });

    it("rejects the same key with a different payload", async () => {
      await prepareEntry(tokens.admin);
      const { status } = await prepareEntry(tokens.admin, { endTime: "2026-11-20T14:00:00.000Z" });

      expect(status).toBe(409);
      expect(state.db.operations).toHaveLength(1);
    });

    describe("asking again for a cancelled or expired entry", () => {
      it("re-opens a cancelled operation as pending", async () => {
        const { body: op } = await prepareEntry(tokens.member);
        await cancelAs(ids.memberA, op.id);
        vi.setSystemTime(new Date(NOW.getTime() + 60_000));

        const { status, body } = await prepareEntry(tokens.member);

        expect(status).toBe(200);
        expect(body).toMatchObject({ id: op.id, status: "pending", cancelledAt: null, expiresAt: "2026-11-22T12:16:00.000Z" });
        expect(state.db.operations).toHaveLength(1);
        expect((await confirmAs(ids.memberA, op.id)).body.status).toBe("confirmed");
      });

      it("re-opens an expired operation with a fresh expiry", async () => {
        const { body: op } = await prepareEntry(tokens.member);
        vi.setSystemTime(new Date(NOW.getTime() + 20 * 60_000));

        const { status, body } = await prepareEntry(tokens.member);

        expect(status).toBe(200);
        expect(body).toMatchObject({ id: op.id, status: "pending", expiresAt: "2026-11-22T12:35:00.000Z" });
      });

      it("re-opens once under concurrent retries", async () => {
        const { body: op } = await prepareEntry(tokens.member);
        await cancelAs(ids.memberA, op.id);

        const results = await Promise.all([prepareEntry(tokens.member), prepareEntry(tokens.member)]);

        expect(results.map((r) => [r.status, r.body.id, r.body.status])).toEqual([
          [200, op.id, "pending"],
          [200, op.id, "pending"],
        ]);
        expect(state.db.operations).toHaveLength(1);
      });

      it("checks the entry rules again before re-opening", async () => {
        const { body: op } = await prepareEntry(tokens.member);
        await cancelAs(ids.memberA, op.id);
        state.db.projects.find((p) => p.id === ids.projectA1)!.status = "Inactive";

        expect((await prepareEntry(tokens.member)).status).toBe(409);
        expect((await statusOf(tokens.member, op.id)).body.status).toBe("cancelled");
      });
    });

    it("returns the winner when a concurrent retry inserts the same key first", async () => {
      const { body: first } = await prepareEntry(tokens.member);
      // The second request looked before the first one's insert committed.
      vi.spyOn(state.db.prisma.integrationOperation, "findUnique").mockResolvedValueOnce(null);

      const { status, body } = await prepareEntry(tokens.member);

      expect(status).toBe(200);
      expect(body.id).toBe(first.id);
      expect(state.db.operations).toHaveLength(1);
    });

    it("keeps keys per token", async () => {
      const admin = await prepareEntry(tokens.admin);
      const member = await prepareEntry(tokens.member);
      expect(member.body.id).not.toBe(admin.body.id);
    });

    it.each([
      ["no start time", { startTime: undefined }, 400],
      ["a time without offset", { startTime: "2026-11-20T12:00:00" }, 400],
      ["an end before the start", { endTime: "2026-11-20T11:00:00.000Z" }, 400],
      ["more than 24 hours", { endTime: "2026-11-21T12:00:01.000Z" }, 400],
      ["no billable status", { isBillable: undefined }, 400],
      ["a task without its project", { projectId: null }, 400],
      ["a task of another project", { taskId: ids.taskA2 }, 404],
      ["another account's project", { projectId: ids.projectB, taskId: null }, 404],
      ["an unknown project", { projectId: ids.missing, taskId: null }, 404],
      ["an inactive project", { projectId: ids.projectA2, taskId: ids.taskA2 }, 409],
    ] as const)("rejects %s", async (_label, change, expected) => {
      const { status } = await prepareEntry(tokens.admin, change);
      expect(status).toBe(expected);
      expect(state.db.operations).toHaveLength(0);
    });

    it("rejects a project outside a restricted member's access", async () => {
      const { status } = await prepareEntry(tokens.member, { projectId: ids.projectA2, taskId: null });
      expect(status).toBe(404);
    });
  });

  describe("status", () => {
    it("is visible only to the token owner", async () => {
      const { body: op } = await prepareEntry(tokens.member);

      expect((await statusOf(tokens.member, op.id)).body).toMatchObject({ id: op.id, status: "pending", entryId: null });
      expect((await statusOf(tokens.memberA2, op.id)).status).toBe(404);
      expect((await statusOf(tokens.ownerB, op.id)).status).toBe(404);
      expect((await statusOf(tokens.member, "not-a-uuid")).status).toBe(404);
    });

    it("needs the create scope", async () => {
      const { body: op } = await prepareEntry(tokens.admin);
      expect((await statusOf(tokens.adminRead, op.id)).status).toBe(403);
    });

    it("reports expired after 15 minutes", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000));
      expect((await statusOf(tokens.member, op.id)).body.status).toBe("expired");
    });
  });

  describe("confirm", () => {
    it("creates the entry once, links it to the operation and audits user and integration", async () => {
      const { body: op } = await prepareEntry(tokens.member);

      const { status, body } = await confirmAs(ids.memberA, op.id);

      expect(status).toBe(200);
      expect(body.status).toBe("confirmed");
      const entry = state.db.timeEntries.find((e) => e.id === body.entryId)!;
      expect(entry).toMatchObject({
        accountId: ids.acctA,
        userId: ids.memberA,
        projectId: ids.projectA1,
        taskId: ids.taskA1,
        description: "Review PR #42",
        isBillable: true,
        startTime: new Date(ENTRY.startTime),
        endTime: new Date(ENTRY.endTime),
        duration: 5_400_000,
      });
      expect((await statusOf(tokens.member, op.id)).body).toMatchObject({ status: "confirmed", entryId: entry.id });

      const audit = state.db.auditLogs.find((log) => log.entityId === entry.id)!;
      expect(audit).toMatchObject({ accountId: ids.acctA, actorUserId: ids.memberA, action: "create", entityType: "TimeEntry" });
      const token = state.db.tokens.find((t) => t.userId === ids.memberA)!;
      expect(JSON.parse(audit.changesJson as string)).toMatchObject({
        integrationTokenId: token.id,
        integrationTokenName: "Raycast",
        operationId: op.id,
        projectId: ids.projectA1,
      });
    });

    it("reports a confirmed entry that was deleted afterwards", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      expect((await statusOf(tokens.member, op.id)).body.entryDeleted).toBe(false);
      const { body: confirmed } = await confirmAs(ids.memberA, op.id);
      expect(confirmed.entryDeleted).toBe(false);

      state.db.timeEntries.find((e) => e.id === confirmed.entryId)!.isDeleted = true;

      expect((await statusOf(tokens.member, op.id)).body).toMatchObject({ status: "confirmed", entryId: confirmed.entryId, entryDeleted: true });
    });

    it("creates one entry for a double confirm, also when concurrent", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      const before = state.db.timeEntries.length;

      state.session = sessionOf(ids.memberA);
      const [a, b] = await Promise.all([
        send(confirm, "/x", { id: op.id, method: "POST" }),
        send(confirm, "/x", { id: op.id, method: "POST" }),
      ]);
      const again = await confirmAs(ids.memberA, op.id);

      expect([a.status, b.status, again.status]).toEqual([200, 200, 200]);
      expect(new Set([a.body.entryId, b.body.entryId, again.body.entryId]).size).toBe(1);
      expect(state.db.timeEntries.length).toBe(before + 1);
    });

    it("preparing again after confirmation returns the confirmed operation, not a new entry", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      await confirmAs(ids.memberA, op.id);
      const before = state.db.timeEntries.length;

      const retry = await prepareEntry(tokens.member);

      expect(retry.body).toMatchObject({ id: op.id, status: "confirmed" });
      expect(state.db.timeEntries.length).toBe(before);
    });

    it.each([
      ["another user in the same account", ids.memberA2],
      ["an admin of the same account", ids.adminA],
      ["a user of another account", ids.ownerB],
    ])("returns 404 to %s", async (_label, userId) => {
      const { body: op } = await prepareEntry(tokens.member);
      const before = state.db.timeEntries.length;

      expect((await viewAs(userId, op.id)).status).toBe(404);
      expect((await confirmAs(userId, op.id)).status).toBe(404);
      expect((await cancelAs(userId, op.id)).status).toBe(404);
      expect(state.db.timeEntries.length).toBe(before);
      expect((await statusOf(tokens.member, op.id)).body.status).toBe("pending");
    });

    it("requires a session", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      state.session = null;
      expect((await send(confirm, "/x", { id: op.id, method: "POST" })).status).toBe(401);
    });

    it.each([
      ["the token was revoked", () => { state.db.tokens.find((t) => t.userId === ids.memberA)!.revokedAt = new Date(); }, 403],
      ["the token expired", () => { state.db.tokens.find((t) => t.userId === ids.memberA)!.expiresAt = new Date(NOW.getTime() - 1); }, 403],
      ["the token lost the create scope", () => { state.db.tokens.find((t) => t.userId === ids.memberA)!.scopes = ["read"]; }, 403],
      ["the operation expired", () => vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000)), 409],
      ["the user lost access to the project", () => { state.db.projectAccess[0]!.projectId = ids.projectA2; }, 404],
      ["the project became inactive", () => { state.db.projects.find((p) => p.id === ids.projectA1)!.status = "Inactive"; }, 409],
    ])("is rejected without an entry when %s", async (_label, change, expected) => {
      const { body: op } = await prepareEntry(tokens.member);
      const before = state.db.timeEntries.length;
      change();

      const { status } = await confirmAs(ids.memberA, op.id);

      expect(status).toBe(expected);
      expect(state.db.timeEntries.length).toBe(before);
      expect(state.db.operations[0]!.resultEntryId).toBeNull();
    });
  });

  describe("cancel", () => {
    it("prevents the write and is audited", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      const before = state.db.timeEntries.length;

      const cancelled = await cancelAs(ids.memberA, op.id);
      const confirmAfter = await confirmAs(ids.memberA, op.id);

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("cancelled");
      expect(confirmAfter.status).toBe(409);
      expect(state.db.timeEntries.length).toBe(before);
      expect((await statusOf(tokens.member, op.id)).body).toMatchObject({ status: "cancelled", entryId: null });
      expect(state.db.auditLogs.find((log) => log.entityId === op.id)).toMatchObject({
        actorUserId: ids.memberA,
        action: "cancel",
        entityType: "IntegrationOperation",
      });
    });

    it("cannot undo a confirmed operation", async () => {
      const { body: op } = await prepareEntry(tokens.member);
      await confirmAs(ids.memberA, op.id);
      expect((await cancelAs(ids.memberA, op.id)).status).toBe(409);
    });
  });

  it.each([
    ["revoked", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(NOW.getTime() - 1) }],
    ["without the create scope", { scopes: ["read"] }],
  ])("marks the token unusable in the view when it is %s", async (_label, change) => {
    const { body: op } = await prepareEntry(tokens.member);
    expect((await viewAs(ids.memberA, op.id)).body.integration.tokenUsable).toBe(true);

    Object.assign(state.db.tokens.find((t) => t.userId === ids.memberA)!, change);

    const { body } = await viewAs(ids.memberA, op.id);
    expect(body).toMatchObject({ status: "pending", integration: { tokenUsable: false } });
    expect((await cancelAs(ids.memberA, op.id)).body.status).toBe("cancelled");
  });

  it("shows the owner the preview and the token that prepared it", async () => {
    const { body: op } = await prepareEntry(tokens.member);
    const { status, body } = await viewAs(ids.memberA, op.id);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: op.id, status: "pending", integration: { name: "Raycast" }, entry: { description: "Review PR #42" } });
  });
});
