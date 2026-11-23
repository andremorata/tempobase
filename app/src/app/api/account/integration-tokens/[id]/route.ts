/**
 * DELETE /api/account/integration-tokens/[id] - Revoke one of the signed-in user's tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { createAuditLog } from "@/lib/audit/logger";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const user = await getCurrentUser();
    const { id } = await params;

    const token = z.string().uuid().safeParse(id).success
      ? await prisma.integrationToken.findFirst({
          where: { id, accountId: user.accountId, userId: user.id, revokedAt: null },
          select: { id: true, name: true },
        })
      : null;
    if (!token) {
      return NextResponse.json({ error: "Integration token not found" }, { status: 404 });
    }

    const now = new Date();
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: { revokedAt: now, updatedAt: now },
    });

    await createAuditLog({
      accountId: user.accountId,
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      actorName: user.name ?? "",
      actorRole: user.role,
      action: "delete",
      entityType: "IntegrationToken",
      entityId: token.id,
      summary: `Revoked integration token "${token.name}"`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Revoke integration token error:", error);
    return NextResponse.json({ error: "Failed to revoke integration token" }, { status: 500 });
  }
}
