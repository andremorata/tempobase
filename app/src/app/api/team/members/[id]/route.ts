/**
 * Team Member Management (Single)
 *
 * PUT /api/team/members/[id] - Update member role
 * DELETE /api/team/members/[id] - Remove member
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, requireOwnerOrAdmin, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";
import type { UserRole } from "@prisma/client";

/**
 * Only an Owner may grant, change or remove Owner and Admin roles; Admins manage
 * Manager/Member/Viewer. Nobody changes their own role, so an Owner always remains.
 */
function canManageMember(actorRole: UserRole, targetRole: UserRole, newRole?: UserRole): boolean {
  if (actorRole === "Owner") return true;
  const privileged = (role?: UserRole) => role === "Owner" || role === "Admin";
  return !privileged(targetRole) && !privileged(newRole);
}

const UpdateMemberRoleSchema = z.object({
  role: z.enum(["Owner", "Admin", "Manager", "Member", "Viewer"]).optional(),
  canViewAmounts: z.boolean().optional(),
});

// PUT /api/team/members/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    void request;
    const session = await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    const body = await request.json();
    const validated = UpdateMemberRoleSchema.parse(body);

    // Check if member exists and belongs to this account
    const member = await prisma.user.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!member) {
      return NextResponse.json(
        { error: "Team member not found" },
        { status: 404 }
      );
    }

    if (validated.role !== undefined && id === session.user.id) {
      return NextResponse.json({ error: "You cannot change your own role" }, { status: 403 });
    }
    if (!canManageMember(session.user.role, member.role, validated.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update member settings
    const updatedMember = await prisma.user.update({
      where: { id },
      data: {
        ...(validated.role !== undefined && { role: validated.role }),
        ...(validated.canViewAmounts !== undefined && { canViewAmounts: validated.canViewAmounts }),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        canViewAmounts: true,
        createdAt: true,
      },
    });

    return NextResponse.json(updatedMember);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update member role error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update member role" },
      { status: 500 }
    );
  }
}

// DELETE /api/team/members/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const currentUserId = await getCurrentUserId();
    const { id } = await params;

    // Can't remove yourself
    if (id === currentUserId) {
      return NextResponse.json(
        { error: "You cannot remove yourself from the workspace" },
        { status: 400 }
      );
    }

    // Check if member exists and belongs to this account
    const member = await prisma.user.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!member) {
      return NextResponse.json(
        { error: "Team member not found" },
        { status: 404 }
      );
    }

    if (!canManageMember(session.user.role, member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Soft delete the member
    await prisma.user.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Remove member error:", error);
    return NextResponse.json(
      { error: "Failed to remove team member" },
      { status: 500 }
    );
  }
}
