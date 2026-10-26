/**
 * Team Members Endpoints
 *
 * GET /api/team/members - List all team members
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();

    const members = await prisma.user.findMany({
      where: {
        accountId,
        isDeleted: false,
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
        projectAccess: { select: { projectId: true } },
        taskAccess: { select: { taskId: true } },
      },
      orderBy: [
        { firstName: "asc" },
        { lastName: "asc" },
      ],
    });

    return NextResponse.json(
      members.map((m) => ({
        id: m.id,
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
        isActive: m.isActive,
        canViewAmounts: m.canViewAmounts,
        createdAt: m.createdAt,
        allowedProjectIds: m.projectAccess.map((a) => a.projectId),
        allowedTaskIds: m.taskAccess.map((a) => a.taskId),
      }))
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List team members error:", error);
    return NextResponse.json(
      { error: "Failed to fetch team members" },
      { status: 500 }
    );
  }
}
