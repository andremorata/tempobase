/**
 * Task Operations (Single)
 *
 * GET /api/projects/[id]/tasks/[taskId] - Get single task
 * PUT /api/projects/[id]/tasks/[taskId] - Update task
 * DELETE /api/projects/[id]/tasks/[taskId] - Soft delete task
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireManager, requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { canSeeRates, getMemberAccess, isProjectAccessible, isTaskAccessible } from "@/lib/auth/access";

const UpdateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
});

// GET /api/projects/[id]/tasks/[taskId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const { id: projectId, taskId } = await params;

    // Verify project exists and belongs to this account
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        accountId,
        isDeleted: false,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const task = await prisma.projectTask.findFirst({
      where: {
        id: taskId,
        projectId,
        isDeleted: false,
      },
    });

    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    if (!task || !isProjectAccessible(access, projectId) || !isTaskAccessible(access, task.id)) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      isActive: task.isActive,
      hourlyRate: task.hourlyRate === null || !canSeeRates(currentUser) ? null : toNumber(task.hourlyRate),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get task error:", error);
    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[id]/tasks/[taskId]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const { id: projectId, taskId } = await params;

    // Verify project exists and belongs to this account
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        accountId,
        isDeleted: false,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validated = UpdateTaskSchema.parse(body);

    // Check if task exists
    const existingTask = await prisma.projectTask.findFirst({
      where: {
        id: taskId,
        projectId,
        isDeleted: false,
      },
    });

    if (!existingTask) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    const updateData: Prisma.ProjectTaskUpdateInput = {
      updatedAt: new Date(),
    };

    if (validated.name !== undefined) {
      updateData.name = validated.name;
    }
    if (validated.hourlyRate !== undefined) {
      updateData.hourlyRate = validated.hourlyRate;
    }

    const task = await prisma.projectTask.update({
      where: { id: taskId },
      data: updateData,
    });

    return NextResponse.json({
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      isActive: task.isActive,
      hourlyRate: task.hourlyRate === null ? null : toNumber(task.hourlyRate),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update task error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id]/tasks/[taskId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const { id: projectId, taskId } = await params;

    // Verify project exists and belongs to this account
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        accountId,
        isDeleted: false,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check if task exists
    const task = await prisma.projectTask.findFirst({
      where: {
        id: taskId,
        projectId,
        isDeleted: false,
      },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // Soft delete
    await prisma.projectTask.update({
      where: { id: taskId },
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete task error:", error);
    return NextResponse.json(
      { error: "Failed to delete task" },
      { status: 500 }
    );
  }
}
