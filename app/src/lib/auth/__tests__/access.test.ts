import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  prisma: {
    userProjectAccess: { findMany: vi.fn() },
    userTaskAccess: { findMany: vi.fn() },
    project: { count: vi.fn() },
    projectTask: { count: vi.fn() },
    tag: { count: vi.fn() },
    client: { count: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => prismaMock);

import {
  applyAccessFilter,
  canModifyEntry,
  canSeeRates,
  getMemberAccess,
  isEntryVisible,
  refsBelongToAccount,
} from "../access";

const db = prismaMock.prisma;

describe("member access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.userProjectAccess.findMany.mockResolvedValue([]);
    db.userTaskAccess.findMany.mockResolvedValue([]);
  });

  it("limits Members to their own entries and lets other roles see the team", async () => {
    expect((await getMemberAccess("u1", "a1", "Member")).userId).toBe("u1");
    expect((await getMemberAccess("u1", "a1", "Manager")).userId).toBeNull();
    expect((await getMemberAccess("u1", "a1", "Viewer")).userId).toBeNull();
    expect((await getMemberAccess("u1", "a1", "Owner")).userId).toBeNull();
  });

  it("intersects a requested userId with the caller's scope", () => {
    const member = { projectIds: null, taskIds: null, userId: "me" };
    const team = { projectIds: null, taskIds: null, userId: null };

    const own: Prisma.TimeEntryWhereInput = {};
    applyAccessFilter(own, member);
    expect(own.userId).toBe("me");

    const other: Prisma.TimeEntryWhereInput = {};
    applyAccessFilter(other, member, undefined, undefined, "someone-else");
    expect(other.userId).toEqual({ in: [] });

    const filtered: Prisma.TimeEntryWhereInput = {};
    applyAccessFilter(filtered, team, undefined, undefined, "someone-else");
    expect(filtered.userId).toBe("someone-else");

    expect(isEntryVisible(member, "someone-else")).toBe(false);
    expect(isEntryVisible(team, "someone-else")).toBe(true);
  });

  it("follows the permissions matrix for writing entries", () => {
    expect(canModifyEntry({ id: "me", role: "Member" }, "me")).toBe(true);
    expect(canModifyEntry({ id: "me", role: "Member" }, "other")).toBe(false);
    expect(canModifyEntry({ id: "me", role: "Manager" }, "other")).toBe(true);
    expect(canModifyEntry({ id: "me", role: "Viewer" }, "me")).toBe(false);
  });

  it("hides rates only from non-managers without the amounts permission", () => {
    expect(canSeeRates({ role: "Member", canViewAmounts: false })).toBe(false);
    expect(canSeeRates({ role: "Member", canViewAmounts: true })).toBe(true);
    expect(canSeeRates({ role: "Manager", canViewAmounts: false })).toBe(true);
  });

  it("rejects ids that do not belong to the account", async () => {
    db.project.count.mockResolvedValue(1);
    db.tag.count.mockResolvedValue(1);

    expect(await refsBelongToAccount("a1", { projectIds: ["p1", null], tagIds: ["t1", "t2"] })).toBe(false);
    expect(db.tag.count).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, accountId: "a1", isDeleted: false },
    });

    db.tag.count.mockResolvedValue(2);
    expect(await refsBelongToAccount("a1", { projectIds: ["p1"], tagIds: ["t1", "t2", "t1"] })).toBe(true);
    expect(await refsBelongToAccount("a1", { projectIds: [null, undefined] })).toBe(true);
  });
});
