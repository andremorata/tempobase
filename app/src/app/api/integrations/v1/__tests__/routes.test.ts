import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("./fake-db").createFakeDb>,
  session: null as null | { user: { id: string; accountId: string; role: string } },
}));

vi.mock("@/lib/db/prisma", () => ({
  get prisma() {
    return state.db.prisma;
  },
}));
const authMock = vi.hoisted(() => vi.fn(async () => state.session));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));

import { createFakeDb, ids } from "./fake-db";
import { GET as getHours } from "../hours/route";
import { GET as getProjects } from "../projects/route";
import { GET as getEntries } from "../time-entries/route";
import { GET as getSummary } from "@/app/api/reports/summary/route";

const NOW = new Date("2026-11-22T12:00:00.000Z");

function call(handler: (r: NextRequest) => Promise<Response>, path: string, token?: string) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  return handler(new NextRequest(`http://localhost${path}`, { headers }));
}

async function json(handler: (r: NextRequest) => Promise<Response>, path: string, token?: string) {
  const res = await call(handler, path, token);
  return { status: res.status, body: await res.json() };
}

const WEEK = "from=2026-11-16&to=2026-11-22";

describe("integration API", () => {
  let tokens: Record<"adminA" | "memberA" | "memberA2" | "ownerB" | "expired" | "revoked", string>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    state.db = createFakeDb(NOW);
    state.session = null;
    authMock.mockClear();
    const add = state.db.addToken;
    tokens = {
      adminA: add(ids.adminA),
      memberA: add(ids.memberA),
      memberA2: add(ids.memberA2),
      ownerB: add(ids.ownerB),
      expired: add(ids.adminA, { expiresAt: new Date(NOW.getTime() - 1) }),
      revoked: add(ids.adminA, { revokedAt: new Date(NOW.getTime() - 1000) }),
    };
  });

  describe("authentication", () => {
    it.each([
      ["missing", undefined],
      ["malformed", "not-a-token"],
      ["unknown", `tbp_${"z".repeat(43)}`],
      ["expired", "expired"],
      ["revoked", "revoked"],
    ])("rejects a %s token with 401 on every route", async (_label, token) => {
      const value = token && token in tokens ? tokens[token as keyof typeof tokens] : token;
      for (const [handler, path] of [
        [getHours, `/api/integrations/v1/hours?${WEEK}`],
        [getProjects, "/api/integrations/v1/projects"],
        [getEntries, "/api/integrations/v1/time-entries"],
      ] as const) {
        expect((await call(handler, path, value)).status).toBe(401);
      }
    });

    it("rejects a removed or deactivated user and a deleted account", async () => {
      state.db.users.find((u) => u.id === ids.memberA)!.isDeleted = true;
      state.db.users.find((u) => u.id === ids.memberA2)!.isActive = false;
      state.db.accounts.find((a) => a.id === ids.acctB)!.isDeleted = true;

      for (const token of [tokens.memberA, tokens.memberA2, tokens.ownerB]) {
        expect((await call(getEntries, "/api/integrations/v1/time-entries", token)).status).toBe(401);
      }
    });

    it("authenticates by bearer token alone, without reading the Auth.js session", async () => {
      expect((await call(getEntries, "/api/integrations/v1/time-entries", tokens.adminA)).status).toBe(200);
      expect(authMock).not.toHaveBeenCalled();
    });
  });

  describe("get hours", () => {
    it("totals only the admin's own entries", async () => {
      const { status, body } = await json(getHours, `/api/integrations/v1/hours?${WEEK}`, tokens.adminA);

      expect(status).toBe(200);
      expect(body).toMatchObject({ totalHours: 1.6, billableHours: 1.5, totalEntries: 3, roundUp: false });
      expect(JSON.stringify(body)).not.toMatch(/billedAmount|hourlyRate/);
    });

    it("isolates users in the same account and across accounts", async () => {
      expect((await json(getHours, `/api/integrations/v1/hours?${WEEK}`, tokens.memberA2)).body.totalHours).toBe(3);
      expect((await json(getHours, `/api/integrations/v1/hours?${WEEK}`, tokens.ownerB)).body.totalHours).toBe(4);
    });

    it("counts a day by entry date, so the next day stays out", async () => {
      const { body } = await json(getHours, "/api/integrations/v1/hours?from=2026-11-20&to=2026-11-20", tokens.adminA);
      expect(body).toMatchObject({ totalHours: 1.55, totalEntries: 2 });
    });

    it("filters by project, registered task and description text", async () => {
      const base = `/api/integrations/v1/hours?${WEEK}`;
      expect((await json(getHours, `${base}&projectId=${ids.projectA1}`, tokens.adminA)).body.totalHours).toBe(1.55);
      expect((await json(getHours, `${base}&taskId=${ids.taskA1}`, tokens.adminA)).body.totalHours).toBe(1.5);
      expect((await json(getHours, `${base}&description=REVIEW`, tokens.adminA)).body.totalHours).toBe(1.55);
    });

    it("rounds each entry up to 10 minutes when asked", async () => {
      const { body } = await json(getHours, `/api/integrations/v1/hours?${WEEK}&roundUp=true`, tokens.adminA);
      // 1.5 h + 10 min + 10 min
      expect(body.totalHours).toBe(1.83);
    });

    it.each([
      ["another account's project", `projectId=${ids.projectB}`, "adminA"],
      ["another account's task", `taskId=${ids.taskB}`, "adminA"],
      ["an unknown project", `projectId=${ids.missing}`, "adminA"],
      ["a project outside the member's access", `projectId=${ids.projectA2}`, "memberA"],
    ] as const)("returns 404 for %s", async (_label, filter, who) => {
      const { status } = await json(getHours, `/api/integrations/v1/hours?${WEEK}&${filter}`, tokens[who]);
      expect(status).toBe(404);
    });

    it("requires a valid period", async () => {
      expect((await call(getHours, "/api/integrations/v1/hours", tokens.adminA)).status).toBe(400);
      expect((await call(getHours, "/api/integrations/v1/hours?from=2026-11-22&to=2026-11-16", tokens.adminA)).status).toBe(400);
    });

    it.each([false, true])("equals the Summary report for the same user, period and filters (roundUp=%s)", async (roundUp) => {
      state.session = { user: { id: ids.adminA, accountId: ids.acctA, role: "Admin" } };
      for (const filter of ["", `&projectId=${ids.projectA1}`, `&taskId=${ids.taskA1}`, "&description=review"]) {
        const qs = `${WEEK}${filter}&roundUp=${roundUp}`;
        const hours = (await json(getHours, `/api/integrations/v1/hours?${qs}`, tokens.adminA)).body;
        const summary = (await json(getSummary, `/api/reports/summary?${qs}&userId=${ids.adminA}`)).body;

        expect(hours.totalHours).toBe(summary.totalHours);
        expect(hours.billableHours).toBe(summary.billableHours);
        expect(hours.totalEntries).toBe(summary.totalEntries);
      }
    });
  });

  describe("search projects", () => {
    it("returns the account's projects and tasks without rates", async () => {
      const { body } = await json(getProjects, "/api/integrations/v1/projects", tokens.adminA);

      expect(body.projects.map((p: { name: string }) => p.name)).toEqual(["Alpha", "Beta"]);
      expect(body.projects[0]).toEqual({
        id: ids.projectA1,
        name: "Alpha",
        status: "Active",
        clientName: "Acme",
        tasks: [{ id: ids.taskA1, name: "Code review", isActive: true }],
      });
    });

    it("limits a restricted member to accessible projects", async () => {
      const { body } = await json(getProjects, "/api/integrations/v1/projects", tokens.memberA);
      expect(body.projects.map((p: { id: string }) => p.id)).toEqual([ids.projectA1]);
    });

    it("matches project or task names", async () => {
      const byTask = await json(getProjects, "/api/integrations/v1/projects?q=review", tokens.adminA);
      expect(byTask.body.projects.map((p: { id: string }) => p.id)).toEqual([ids.projectA1]);
      const byProject = await json(getProjects, "/api/integrations/v1/projects?q=bet", tokens.adminA);
      expect(byProject.body.projects.map((p: { id: string }) => p.id)).toEqual([ids.projectA2]);
    });
  });

  describe("list own time entries", () => {
    it("lists only the admin's own, non-deleted entries, newest first, without amounts", async () => {
      const { body } = await json(getEntries, "/api/integrations/v1/time-entries", tokens.adminA);

      expect(body.entries).toHaveLength(4);
      expect(body.entries.map((e: { date: string }) => e.date)).toEqual(["2026-11-21", "2026-11-21", "2026-11-20", "2026-11-20"]);
      expect(body.entries.some((e: { isRunning: boolean }) => e.isRunning)).toBe(true);
      expect(Object.keys(body.entries.find((e: { description: string }) => e.description === "Review PR #42")).sort()).toEqual(
        ["date", "description", "durationHours", "endTime", "id", "isBillable", "isRunning", "project", "startTime", "task"],
      );
      expect(body.entries.find((e: { description: string }) => e.description === "Review PR #42")).toMatchObject({
        project: { id: ids.projectA1, name: "Alpha" },
        task: { id: ids.taskA1, name: "Code review" },
        isBillable: true,
        durationHours: 1.5,
      });
      expect(body.hasMore).toBe(false);
    });

    it("never returns entries of other users or accounts", async () => {
      const b = await json(getEntries, "/api/integrations/v1/time-entries", tokens.ownerB);
      expect(b.body.entries.map((e: { description: string }) => e.description)).toEqual(["Review PR #42"]);
      expect(b.body.entries[0].project.id).toBe(ids.projectB);

      const a2 = await json(getEntries, "/api/integrations/v1/time-entries?userId=" + ids.adminA, tokens.memberA2);
      expect(a2.body.entries).toHaveLength(1);
      expect(a2.body.entries[0].project.id).toBe(ids.projectA2);
    });

    it("paginates", async () => {
      const first = await json(getEntries, "/api/integrations/v1/time-entries?pageSize=3", tokens.adminA);
      expect(first.body).toMatchObject({ page: 1, pageSize: 3, hasMore: true });
      expect(first.body.entries).toHaveLength(3);

      const second = await json(getEntries, "/api/integrations/v1/time-entries?pageSize=3&page=2", tokens.adminA);
      expect(second.body).toMatchObject({ page: 2, hasMore: false });
      expect(second.body.entries).toHaveLength(1);

      expect((await call(getEntries, "/api/integrations/v1/time-entries?pageSize=101", tokens.adminA)).status).toBe(400);
    });

    it("filters by period, project and description, and 404s out-of-scope references", async () => {
      const day = await json(getEntries, "/api/integrations/v1/time-entries?from=2026-11-20&to=2026-11-20&description=review", tokens.adminA);
      expect(day.body.entries.map((e: { description: string }) => e.description)).toEqual(["Review PR #42"]);

      const project = await json(getEntries, `/api/integrations/v1/time-entries?projectId=${ids.projectA2}`, tokens.adminA);
      expect(project.body.entries).toHaveLength(2);

      expect((await call(getEntries, `/api/integrations/v1/time-entries?projectId=${ids.projectB}`, tokens.adminA)).status).toBe(404);
      expect((await call(getEntries, `/api/integrations/v1/time-entries?taskId=${ids.taskB}`, tokens.adminA)).status).toBe(404);
    });
  });
});
