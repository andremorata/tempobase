import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    sharedReport: { findUnique: vi.fn() },
    timeEntry: { findMany: vi.fn(() => Promise.resolve([])) },
    userProjectAccess: { findMany: vi.fn(() => Promise.resolve([{ projectId: "p1" }])) },
    userTaskAccess: { findMany: vi.fn(() => Promise.resolve([])) },
  },
  __esModule: true,
}));

import { prisma } from "@/lib/db/prisma";
import { GET } from "../route";

function sharedReport(accountDeleted: boolean, createdBy = { id: "user-1", role: "Owner", canViewAmounts: true }) {
  return {
    id: "share-1",
    accountId: "acct-1",
    name: "Client report",
    reportType: "Detailed",
    filtersJson: "{}",
    expiresAt: null,
    account: { isDeleted: accountDeleted },
    createdBy,
  } as unknown as Awaited<ReturnType<typeof prisma.sharedReport.findUnique>>;
}

const call = () =>
  GET({} as NextRequest, { params: Promise.resolve({ token: "tok" }) });

describe("Public shared report route", () => {
  const mockedPrisma = vi.mocked(prisma, true);

  beforeEach(() => {
    mockedPrisma.sharedReport.findUnique.mockReset();
    mockedPrisma.timeEntry.findMany.mockClear();
  });

  it("returns 404 without reading entries when the workspace was deleted", async () => {
    mockedPrisma.sharedReport.findUnique.mockResolvedValue(sharedReport(true));

    const response = await call();

    expect(response.status).toBe(404);
    expect(mockedPrisma.timeEntry.findMany).not.toHaveBeenCalled();
  });

  it("never shows more than a restricted creator can see", async () => {
    mockedPrisma.sharedReport.findUnique.mockResolvedValue(
      sharedReport(false, { id: "member-1", role: "Member", canViewAmounts: false })
    );

    const response = await call();

    expect(response.status).toBe(200);
    expect((await response.json()).showAmounts).toBe(false);
    expect(mockedPrisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "member-1", projectId: { in: ["p1"] } }),
      })
    );
  });

  it("serves the report while the workspace is active", async () => {
    mockedPrisma.sharedReport.findUnique.mockResolvedValue(sharedReport(false));

    const response = await call();

    expect(response.status).toBe(200);
  });
});
