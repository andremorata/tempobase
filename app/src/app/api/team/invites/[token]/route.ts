/**
 * Revoke Invite Endpoint
 *
 * DELETE /api/team/invites/[token] - Revoke an invite
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, requireOwnerOrAdmin, authErrorResponse } from "@/lib/auth/helpers";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    void request;
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const { token } = await params;

    // Find the invite
    const invite = await prisma.accountInvite.findFirst({
      where: {
        token,
        accountId,
        isDeleted: false,
      },
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invite not found" },
        { status: 404 }
      );
    }

    // Soft delete the invite
    await prisma.accountInvite.update({
      where: { id: invite.id },
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Revoke invite error:", error);
    return NextResponse.json(
      { error: "Failed to revoke invite" },
      { status: 500 }
    );
  }
}
