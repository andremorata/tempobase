import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  requireOwnerOrAdmin: vi.fn(),
  getCurrentTenantId: vi.fn(),
  getCurrentUserId: vi.fn(),
  authErrorResponse: vi.fn(() => null),
}));

const prismaMock = vi.hoisted(() => ({
  prisma: {
    user: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/auth/helpers", () => authMock);
vi.mock("@/lib/db/prisma", () => prismaMock);

import { DELETE, PUT } from "../route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  PUT({ json: async () => body } as NextRequest, params(id));

function actAs(role: string, id = "actor") {
  authMock.requireOwnerOrAdmin.mockResolvedValue({ user: { id, role } });
  authMock.getCurrentUserId.mockResolvedValue(id);
}

function target(role: string) {
  prismaMock.prisma.user.findFirst.mockResolvedValue({ id: "target", role });
}

describe("team member role rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getCurrentTenantId.mockResolvedValue("acct");
    prismaMock.prisma.user.update.mockResolvedValue({ id: "target" });
  });

  it("stops an Admin from granting Owner or Admin", async () => {
    actAs("Admin");
    target("Member");

    expect((await put("target", { role: "Owner" })).status).toBe(403);
    expect((await put("target", { role: "Admin" })).status).toBe(403);
    expect(prismaMock.prisma.user.update).not.toHaveBeenCalled();
  });

  it("stops an Admin from changing or removing an Owner", async () => {
    actAs("Admin");
    target("Owner");

    expect((await put("target", { role: "Viewer" })).status).toBe(403);
    expect((await DELETE({} as NextRequest, params("target"))).status).toBe(403);
    expect(prismaMock.prisma.user.update).not.toHaveBeenCalled();
  });

  it("stops anyone from changing their own role", async () => {
    actAs("Admin", "target");
    target("Admin");

    expect((await put("target", { role: "Owner" })).status).toBe(403);
  });

  it("lets an Admin manage regular roles and an Owner manage anyone", async () => {
    actAs("Admin");
    target("Member");
    expect((await put("target", { role: "Manager" })).status).toBe(200);

    actAs("Owner");
    target("Admin");
    expect((await put("target", { role: "Owner" })).status).toBe(200);
  });
});
