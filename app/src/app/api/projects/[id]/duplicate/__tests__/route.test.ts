import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  requireManager: vi.fn(),
  getCurrentTenantId: vi.fn(),
  getCurrentUser: vi.fn(),
  authErrorResponse: vi.fn(() => null),
}));

const accessMock = vi.hoisted(() => ({
  getMemberAccess: vi.fn(),
  isProjectAccessible: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  prisma: {
    project: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    projectTask: { createMany: vi.fn() },
    userProjectAccess: { createMany: vi.fn() },
    userTaskAccess: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/helpers", () => authMock);
vi.mock("@/lib/auth/access", () => accessMock);
vi.mock("@/lib/db/prisma", () => prismaMock);

import { POST } from "../route";

const db = prismaMock.prisma;
const duplicate = (id = "source") =>
  POST({} as NextRequest, { params: Promise.resolve({ id }) });

const source = {
  id: "source",
  accountId: "acct",
  clientId: "client-1",
  name: "Website",
  color: "#112233",
  status: "Archived",
  billingType: "Hourly",
  hourlyRate: 120,
  budgetHours: 40,
  userAccess: [{ userId: "member-1" }],
  tasks: [
    { id: "task-1", name: "Design", hourlyRate: 90, isActive: true, userAccess: [{ userId: "member-1" }] },
    { id: "task-2", name: "Build", hourlyRate: null, isActive: false, userAccess: [] },
  ],
};

describe("POST /api/projects/[id]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireManager.mockResolvedValue(undefined);
    authMock.getCurrentTenantId.mockResolvedValue("acct");
    authMock.getCurrentUser.mockResolvedValue({ id: "manager", role: "Manager" });
    accessMock.getMemberAccess.mockResolvedValue({ projectIds: null, taskIds: null, userId: null });
    accessMock.isProjectAccessible.mockReturnValue(true);
    db.project.findFirst.mockResolvedValue(source);
    db.project.create.mockResolvedValue({ id: "copy" });
    db.project.findUniqueOrThrow.mockResolvedValue({
      ...source,
      id: "copy",
      name: "Website (copy)",
      status: "Inactive",
      client: null,
      tasks: [],
    });
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  });

  it("creates an Inactive copy without time entries, whatever the source status", async () => {
    const response = await duplicate();

    expect(response.status).toBe(201);
    expect((await response.json()).status).toBe("Inactive");
    expect(db.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "acct",
        clientId: "client-1",
        name: "Website (copy)",
        status: "Inactive",
        billingType: "Hourly",
        hourlyRate: 120,
        budgetHours: 40,
      }),
    });
  });

  it("copies tasks and points member access at the new records", async () => {
    await duplicate();

    const tasks = db.projectTask.createMany.mock.calls[0][0].data;
    expect(tasks).toEqual([
      expect.objectContaining({ projectId: "copy", name: "Design", hourlyRate: 90, isActive: true }),
      expect.objectContaining({ projectId: "copy", name: "Build", hourlyRate: null, isActive: false }),
    ]);
    expect(tasks[0].id).not.toBe("task-1");

    expect(db.userProjectAccess.createMany).toHaveBeenCalledWith({
      data: [{ userId: "member-1", projectId: "copy", accountId: "acct" }],
    });
    expect(db.userTaskAccess.createMany).toHaveBeenCalledWith({
      data: [{ userId: "member-1", taskId: tasks[0].id, accountId: "acct" }],
    });
  });

  it("keeps the name within the column limit", async () => {
    db.project.findFirst.mockResolvedValue({ ...source, name: "x".repeat(200) });

    await duplicate();

    const { name } = db.project.create.mock.calls[0][0].data;
    expect(name).toHaveLength(200);
    expect(name.endsWith(" (copy)")).toBe(true);
  });

  it("scopes the lookup to the account and hides other accounts' projects", async () => {
    db.project.findFirst.mockResolvedValue(null);

    const response = await duplicate();

    expect(response.status).toBe(404);
    expect(db.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "source", accountId: "acct", isDeleted: false } }),
    );
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a project outside the manager's access list", async () => {
    accessMock.isProjectAccessible.mockReturnValue(false);

    const response = await duplicate();

    expect(response.status).toBe(404);
    expect(db.project.create).not.toHaveBeenCalled();
  });
});
