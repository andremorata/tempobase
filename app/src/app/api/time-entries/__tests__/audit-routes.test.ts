import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTracker: vi.fn(),
  authErrorResponse: vi.fn(() => null),
  getCurrentTenantId: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

const accessMock = vi.hoisted(() => ({
  getMemberAccess: vi.fn(),
  applyAccessFilter: vi.fn(),
  isProjectAccessible: vi.fn(),
  isTaskAccessible: vi.fn(),
  isEntryVisible: vi.fn(),
  canModifyEntry: vi.fn(),
  refsBelongToAccount: vi.fn(),
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
}));

const withTenantMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => {
  const timeEntry = {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const timeEntryTag = {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  };

  return {
    prisma: {
      timeEntry,
      timeEntryTag,
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth/helpers", () => authMock);
vi.mock("@/lib/auth/access", () => accessMock);
vi.mock("@/lib/audit/logger", () => auditMock);
vi.mock("@/lib/db/extensions", () => ({ withTenant: withTenantMock }));
vi.mock("@/lib/db/prisma", () => prismaMock);

import { POST as createTimeEntry } from "../route";
import { POST as startTimer } from "../start/route";
import { POST as stopTimer } from "../stop/route";
import { PUT as updateTimeEntry, DELETE as deleteTimeEntry } from "../[id]/route";

function buildEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    description: "Tracked work",
    entryDate: new Date("2026-03-31T00:00:00.000Z"),
    startTime: new Date("2026-03-31T09:00:00.000Z"),
    endTime: new Date("2026-03-31T10:30:00.000Z"),
    duration: 5_400_000,
    durationDecimal: 1.5,
    isBillable: true,
    isRunning: false,
    createdAt: new Date("2026-03-31T10:31:00.000Z"),
    updatedAt: new Date("2026-03-31T10:31:00.000Z"),
    project: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Project One",
      color: "#10b981",
    },
    task: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Task One",
    },
    user: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      firstName: "Owner",
      lastName: "Example",
      email: "owner@example.com",
    },
    tags: [],
    ...overrides,
  };
}

describe("time-entry audit routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMock.requireAuth.mockResolvedValue(undefined);
    authMock.getCurrentTenantId.mockResolvedValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    authMock.getCurrentUserId.mockResolvedValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    authMock.getCurrentUser.mockResolvedValue({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "owner@example.com",
      name: "Owner Example",
      role: "Owner",
    });

    accessMock.getMemberAccess.mockResolvedValue({ projectIds: null, taskIds: null });
    accessMock.isProjectAccessible.mockReturnValue(true);
    accessMock.isTaskAccessible.mockReturnValue(true);
    accessMock.isEntryVisible.mockReturnValue(true);
    accessMock.canModifyEntry.mockReturnValue(true);
    accessMock.refsBelongToAccount.mockResolvedValue(true);
    withTenantMock.mockImplementation((db) => db);

    prismaMock.prisma.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        return callback(prismaMock.prisma);
      }
      return Promise.all(callback as Promise<unknown>[]);
    });
  });

  it("creates an audit record for manual time-entry creation", async () => {
    const entry = buildEntry();
    prismaMock.prisma.timeEntry.create.mockResolvedValue(entry);
    prismaMock.prisma.timeEntry.findUniqueOrThrow.mockResolvedValue(entry);

    const request = new NextRequest("http://localhost/api/time-entries", {
      method: "POST",
      body: JSON.stringify({
        projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        description: "Tracked work",
        startTime: "2026-03-31T09:00:00.000Z",
        endTime: "2026-03-31T10:30:00.000Z",
        isBillable: true,
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await createTimeEntry(request);

    expect(response.status).toBe(201);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        entityType: "TimeEntry",
        entityId: "11111111-1111-4111-8111-111111111111",
        actorEmail: "owner@example.com",
      }),
    );
  });

  it("creates an audit record when a timer starts", async () => {
    const runningEntry = buildEntry({
      endTime: null,
      duration: null,
      durationDecimal: null,
      isRunning: true,
    });
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.prisma.timeEntry.create.mockResolvedValue(runningEntry);

    const request = new NextRequest("http://localhost/api/time-entries/start", {
      method: "POST",
      body: JSON.stringify({
        projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        description: "Start timer",
        isBillable: false,
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await startTimer(request);

    expect(response.status).toBe(201);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "start",
        entityId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("creates an audit record when a timer stops", async () => {
    const runningEntry = buildEntry({
      endTime: null,
      duration: null,
      durationDecimal: null,
      isRunning: true,
    });
    const stoppedEntry = buildEntry({
      endTime: new Date("2026-03-31T10:30:00.000Z"),
      duration: 5_400_000,
      durationDecimal: 1.5,
      isRunning: false,
    });
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValue(runningEntry);
    prismaMock.prisma.timeEntry.update.mockResolvedValue(stoppedEntry);

    const request = new NextRequest("http://localhost/api/time-entries/stop", {
      method: "POST",
    });

    const response = await stopTimer(request);

    expect(response.status).toBe(200);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stop",
        entityId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("creates an audit record with before and after snapshots when an entry updates", async () => {
    const existingEntry = buildEntry({ description: "Before update" });
    const updatedEntry = buildEntry({ description: "After update", durationDecimal: 2 });
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValue(existingEntry);
    prismaMock.prisma.timeEntry.update.mockResolvedValue(updatedEntry);

    const request = new NextRequest("http://localhost/api/time-entries/entry-1", {
      method: "PUT",
      body: JSON.stringify({
        description: "After update",
        startTime: "2026-03-31T09:00:00.000Z",
        endTime: "2026-03-31T11:00:00.000Z",
        isBillable: true,
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await updateTimeEntry(request, {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changesJson: expect.objectContaining({
          before: expect.objectContaining({ description: "Before update" }),
          after: expect.objectContaining({ description: "After update" }),
        }),
      }),
    );
  });

  it("creates an audit record with the final snapshot when an entry is deleted", async () => {
    const existingEntry = buildEntry({ description: "Delete me" });
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValue(existingEntry);
    prismaMock.prisma.timeEntry.update.mockResolvedValue(existingEntry);

    const request = new NextRequest("http://localhost/api/time-entries/entry-1", {
      method: "DELETE",
    });

    const response = await deleteTimeEntry(request, {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete",
        changesJson: expect.objectContaining({
          description: "Delete me",
          isRunning: false,
        }),
      }),
    );
  });
});
