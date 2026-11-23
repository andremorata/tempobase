import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(() => "user-update") },
    integrationToken: { updateMany: vi.fn(() => "tokens-revoke") },
    $transaction: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/db/prisma", () => prismaMock);
vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-a1", accountId: "acct-a", role: "Member" } })),
}));

import { POST } from "../route";

describe("change password", () => {
  it("revokes the user's integration tokens together with the password change", async () => {
    prismaMock.prisma.user.findUnique.mockResolvedValue({ id: "user-a1", passwordHash: await bcrypt.hash("old-password", 4) });

    const res = await POST(
      new NextRequest("http://localhost/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password-1" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.prisma.integrationToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-a1", revokedAt: null },
      data: { revokedAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(prismaMock.prisma.$transaction).toHaveBeenCalledWith(["user-update", "tokens-revoke"]);
  });
});
