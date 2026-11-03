import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  requireTracker: vi.fn(),
  authErrorResponse: vi.fn(() => null),
  getCurrentTenantId: vi.fn(),
  getCurrentUser: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  prisma: {
    importSession: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
    },
    projectTask: {
      findMany: vi.fn(),
    },
    userProjectAccess: {
      findMany: vi.fn(),
    },
    userTaskAccess: {
      findMany: vi.fn(),
    },
    timeEntry: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/helpers", () => authMock);
vi.mock("@/lib/db/prisma", () => prismaMock);

import { POST as parseImport } from "../parse/route";
import { POST as executeImport } from "../execute/route";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const importSessionId = "11111111-1111-4111-8111-111111111111";

function buildCsv(description: string) {
  return [
    "Client,Project,Task,Description,Billable,Start Date,Start Time,End Date,End Time",
    `Acme,Website,,${description},yes,2026-04-01,09:00,2026-04-01,10:00`,
  ].join("\n");
}

function buildParseRequest(csv: string, fileName = "timesheet.csv") {
  const formData = {
    get: (key: string) => {
      if (key === "file") {
        return {
          name: fileName,
          text: async () => csv,
        };
      }

      if (key === "dateFormat") {
        return "ymd";
      }

      return null;
    },
  };

  return {
    formData: async () => formData,
  } as unknown as NextRequest;
}

function buildExecuteRequest(rows = [
  {
    rowIndex: 0,
    startTime: "2026-04-01T09:00:00.000Z",
    endTime: "2026-04-01T10:00:00.000Z",
    description: "April work",
    isBillable: true,
    projectId: null,
    taskId: null,
    include: true,
  },
]) {
  return new NextRequest("http://localhost/api/imports/time-entries/execute", {
    method: "POST",
    body: JSON.stringify({ importSessionId, rows }),
    headers: { "content-type": "application/json" },
  });
}

describe("CSV import routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    authMock.requireTracker.mockResolvedValue(undefined);
    authMock.getCurrentTenantId.mockResolvedValue(accountId);
    authMock.getCurrentUser.mockResolvedValue({ id: userId, role: "Owner" });

    prismaMock.prisma.importSession.findFirst.mockResolvedValue(null);
    prismaMock.prisma.importSession.create.mockResolvedValue({ id: importSessionId });
    prismaMock.prisma.importSession.update.mockResolvedValue({ id: importSessionId });
    prismaMock.prisma.project.findMany.mockResolvedValue([]);
    prismaMock.prisma.projectTask.findMany.mockResolvedValue([]);
    prismaMock.prisma.userProjectAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.userTaskAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValue(null);
    prismaMock.prisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });
    prismaMock.prisma.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        return callback(prismaMock.prisma);
      }
      return Promise.all(callback as Promise<unknown>[]);
    });
  });

  it("parses the uploaded content and creates a session without using file name as the lookup key", async () => {
    const response = await parseImport(buildParseRequest(buildCsv("April work"), "same-name.csv"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.importSessionId).toBe(importSessionId);
    expect(body.rows[0].description).toBe("April work");
    expect(prismaMock.prisma.importSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ fileName: "same-name.csv" }),
      }),
    );
    expect(prismaMock.prisma.importSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: "same-name.csv",
          fileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          previewRowsJson: expect.stringContaining("April work"),
        }),
      }),
    );
  });

  it("reports when the same content was previously completed while still parsing the uploaded file", async () => {
    prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      completedAt: new Date("2026-04-30T12:00:00.000Z"),
    });

    const response = await parseImport(buildParseRequest(buildCsv("May work"), "same-name.csv"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows[0].description).toBe("May work");
    expect(body.duplicateOfImportSessionId).toBe("22222222-2222-4222-8222-222222222222");
    expect(body.previouslyImportedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("surfaces unmapped headers as parse warnings without blocking row preview", async () => {
    const csv = [
      "Client,Project,Task,Description,Bilable,Start Date,Start Time,End Date,End Time",
      "Acme,Website,,May work,yes,2026-04-01,09:00,2026-04-01,10:00",
    ].join("\n");

    const response = await parseImport(buildParseRequest(csv));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.parseErrors).toEqual([]);
    expect(body.parseWarnings).toHaveLength(1);
    expect(body.parseWarnings[0]).toContain("Bilable");
  });

  it("does not execute an import session that is already completed", async () => {
    prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
      id: importSessionId,
      accountId,
      userId,
      status: "completed",
      importedCount: 3,
      skippedCount: 0,
      previewRowsJson: "[]",
    });

    const response = await executeImport(buildExecuteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alreadyImported).toBe(true);
    expect(prismaMock.prisma.timeEntry.create).not.toHaveBeenCalled();
  });

  it("creates entries against a pending session and marks the session completed", async () => {
    prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
      id: importSessionId,
      accountId,
      userId,
      status: "pending",
      importedCount: 0,
      skippedCount: 0,
      previewRowsJson: JSON.stringify([
        {
          rowIndex: 0,
          startTime: "2026-04-01T09:00:00.000Z",
          endTime: "2026-04-01T10:00:00.000Z",
        },
      ]),
    });

    const response = await executeImport(buildExecuteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.importedCount).toBe(1);
    expect(prismaMock.prisma.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ importSessionId }),
      }),
    );
    expect(prismaMock.prisma.importSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: importSessionId },
        data: expect.objectContaining({ status: "completed", importedCount: 1 }),
      }),
    );
  });

  it("reports rows whose project is not active and imports the rest", async () => {
    const closedProjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const row = (rowIndex: number, projectId: string | null) => ({
      rowIndex,
      startTime: "2026-04-01T09:00:00.000Z",
      endTime: "2026-04-01T10:00:00.000Z",
      description: `Row ${rowIndex}`,
      isBillable: true,
      projectId,
      taskId: null,
      include: true,
    });
    prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
      id: importSessionId,
      accountId,
      userId,
      status: "pending",
      importedCount: 0,
      skippedCount: 0,
      previewRowsJson: JSON.stringify([row(0, closedProjectId), row(1, null)]),
    });

    const response = await executeImport(
      buildExecuteRequest([row(0, closedProjectId), row(1, null)] as never),
    );
    const body = await response.json();

    expect(prismaMock.prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId, status: "Active" }),
      }),
    );
    expect(body.importedCount).toBe(1);
    expect(body.errors).toEqual([{ rowIndex: 0, message: "Project is not active." }]);
  });

  it("skips duplicate rows instead of creating duplicate time entries", async () => {
    prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
      id: importSessionId,
      accountId,
      userId,
      status: "pending",
      importedCount: 0,
      skippedCount: 0,
      previewRowsJson: JSON.stringify([
        {
          rowIndex: 0,
          startTime: "2026-04-01T09:00:00.000Z",
          endTime: "2026-04-01T10:00:00.000Z",
        },
      ]),
    });
    prismaMock.prisma.timeEntry.findFirst.mockResolvedValueOnce({ id: "existing-entry" });

    const response = await executeImport(buildExecuteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.importedCount).toBe(0);
    expect(body.skippedCount).toBe(1);
    expect(body.skippedRows[0].message).toContain("already exists");
    expect(prismaMock.prisma.timeEntry.create).not.toHaveBeenCalled();
  });
  describe("member with restricted project and task access", () => {
    const allowedProjectId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const blockedProjectId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const allowedTaskId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const blockedTaskId = "99999999-9999-4999-8999-999999999999";
    const otherAccountTaskId = "88888888-8888-4888-8888-888888888888";

    beforeEach(() => {
      authMock.getCurrentUser.mockResolvedValue({ id: userId, role: "Member" });
      prismaMock.prisma.userProjectAccess.findMany.mockResolvedValue([{ projectId: allowedProjectId }]);
      prismaMock.prisma.userTaskAccess.findMany.mockResolvedValue([{ taskId: allowedTaskId }]);
    });

    it("flags rows naming a project or task the member cannot access", async () => {
      prismaMock.prisma.project.findMany.mockResolvedValue([
        { id: allowedProjectId, name: "Website", clientId: null },
        { id: blockedProjectId, name: "Secret", clientId: null },
      ]);
      prismaMock.prisma.projectTask.findMany.mockResolvedValue([
        { id: allowedTaskId, name: "Design", projectId: allowedProjectId },
        { id: blockedTaskId, name: "Infra", projectId: allowedProjectId },
      ]);
      const csv = [
        "Client,Project,Task,Description,Billable,Start Date,Start Time,End Date,End Time",
        "Acme,Website,Design,Ok,yes,2026-04-01,09:00,2026-04-01,10:00",
        "Acme,Secret,,No project access,yes,2026-04-01,10:00,2026-04-01,11:00",
        "Acme,Website,Infra,No task access,yes,2026-04-01,11:00,2026-04-01,12:00",
      ].join("\n");

      const body = await (await parseImport(buildParseRequest(csv))).json();

      expect(body.rows[0]).toMatchObject({ suggestedProjectId: allowedProjectId, suggestedTaskId: allowedTaskId, errors: [] });
      expect(body.rows[1]).toMatchObject({ suggestedProjectId: null, errors: ["You do not have access to project 'Secret'."] });
      expect(body.rows[2]).toMatchObject({ suggestedTaskId: null, errors: ["You do not have access to task 'Infra'."] });
    });

    it("rejects rows outside the member's access or account and imports the rest", async () => {
      const row = (rowIndex: number, projectId: string | null, taskId: string | null) => ({
        rowIndex,
        startTime: "2026-04-01T09:00:00.000Z",
        endTime: "2026-04-01T10:00:00.000Z",
        description: `Row ${rowIndex}`,
        isBillable: true,
        projectId,
        taskId,
        include: true,
      });
      const rows = [
        row(0, allowedProjectId, allowedTaskId),
        row(1, blockedProjectId, null),
        row(2, allowedProjectId, blockedTaskId),
        row(3, allowedProjectId, otherAccountTaskId),
      ];
      prismaMock.prisma.importSession.findFirst.mockResolvedValueOnce({
        id: importSessionId,
        accountId,
        userId,
        status: "pending",
        importedCount: 0,
        skippedCount: 0,
        previewRowsJson: JSON.stringify(rows),
      });
      prismaMock.prisma.project.findMany.mockResolvedValue([{ id: allowedProjectId }, { id: blockedProjectId }]);
      // The other-account task is filtered out by the accountId scope
      prismaMock.prisma.projectTask.findMany.mockResolvedValue([
        { id: allowedTaskId, projectId: allowedProjectId },
        { id: blockedTaskId, projectId: allowedProjectId },
      ]);

      const body = await (await executeImport(buildExecuteRequest(rows as never))).json();

      expect(prismaMock.prisma.projectTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId }) }),
      );
      expect(body.importedCount).toBe(1);
      expect(body.errors).toEqual([
        { rowIndex: 1, message: "You do not have access to this project." },
        { rowIndex: 2, message: "You do not have access to this task." },
        { rowIndex: 3, message: "You do not have access to this task." },
      ]);
      expect(prismaMock.prisma.timeEntry.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.prisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId, projectId: allowedProjectId, taskId: allowedTaskId }) }),
      );
    });
  });
});
