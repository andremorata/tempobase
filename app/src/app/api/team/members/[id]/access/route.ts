/**
 * Member Project & Task Access
 *
 * GET /api/team/members/[id]/access - Get member's allowed projects and tasks
 * PUT /api/team/members/[id]/access - Replace member's allowed projects and tasks
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnerOrAdmin, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";
import { refsBelongToAccount } from "@/lib/auth/access";

const SetAccessSchema = z.object({
  projectIds: z.array(z.string().uuid()),
  taskIds: z.array(z.string().uuid()),
});

async function resolveMember(id: string, accountId: string) {
  return prisma.user.findFirst({
    where: { id, accountId, isDeleted: false },
    select: { id: true },
  });
}

// GET /api/team/members/[id]/access
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    const member = await resolveMember(id, accountId);
    if (!member) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    const [projectAccess, taskAccess] = await Promise.all([
      prisma.userProjectAccess.findMany({
        where: { userId: id, accountId },
        select: { projectId: true },
      }),
      prisma.userTaskAccess.findMany({
        where: { userId: id, accountId },
        select: { taskId: true },
      }),
    ]);

    return NextResponse.json({
      allowedProjectIds: projectAccess.map((r) => r.projectId),
      allowedTaskIds: taskAccess.map((r) => r.taskId),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get member access error:", error);
    return NextResponse.json({ error: "Failed to fetch member access" }, { status: 500 });
  }
}

// PUT /api/team/members/[id]/access
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    const member = await resolveMember(id, accountId);
    if (!member) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    const body = await request.json();
    const { projectIds, taskIds } = SetAccessSchema.parse(body);

    if (!(await refsBelongToAccount(accountId, { projectIds, taskIds }))) {
      return NextResponse.json({ error: "Project or task not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.userProjectAccess.deleteMany({ where: { userId: id, accountId } }),
      prisma.userTaskAccess.deleteMany({ where: { userId: id, accountId } }),
      ...(projectIds.length > 0
        ? [
            prisma.userProjectAccess.createMany({
              data: projectIds.map((projectId) => ({ userId: id, projectId, accountId })),
            }),
          ]
        : []),
      ...(taskIds.length > 0
        ? [
            prisma.userTaskAccess.createMany({
              data: taskIds.map((taskId) => ({ userId: id, taskId, accountId })),
            }),
          ]
        : []),
    ]);

    return NextResponse.json({ allowedProjectIds: projectIds, allowedTaskIds: taskIds });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Set member access error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Failed to update member access" }, { status: 500 });
  }
}
