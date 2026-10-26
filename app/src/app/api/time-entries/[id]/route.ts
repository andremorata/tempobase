/**
 * Time Entry Operations (Single)
 *
 * GET /api/time-entries/[id] - Get single entry
 * PUT /api/time-entries/[id] - Update entry
 * DELETE /api/time-entries/[id] - Soft delete entry
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import {
  canModifyEntry,
  getMemberAccess,
  isEntryVisible,
  isProjectAccessible,
  isTaskAccessible,
  refsBelongToAccount,
} from "@/lib/auth/access";
import { createAuditLog } from "@/lib/audit/logger";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "../audit";

const UpdateTimeEntrySchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  isBillable: z.boolean().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

// GET /api/time-entries/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);
    const { id } = await params;

    const entry = await prisma.timeEntry.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
      include: {
        project: true,
        task: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!entry) {
      return NextResponse.json(
        { error: "Time entry not found" },
        { status: 404 }
      );
    }

    // Enforce access restrictions on the entry's owner/project/task
    if (!isEntryVisible(access, entry.userId) || !isProjectAccessible(access, entry.projectId)) {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }
    if (!isTaskAccessible(access, entry.taskId)) {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: entry.id,
      userId: entry.userId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      description: entry.description,
      entryDate: entry.entryDate.toISOString().split("T")[0],
      startTime: entry.startTime,
      endTime: entry.endTime,
      duration: entry.duration,
      durationDecimal: entry.durationDecimal != null ? Number(entry.durationDecimal) : null,
      isBillable: entry.isBillable,
      isRunning: entry.isRunning,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      project: entry.project
        ? {
            id: entry.project.id,
            name: entry.project.name,
            color: entry.project.color,
          }
        : null,
      task: entry.task
        ? {
            id: entry.task.id,
            name: entry.task.name,
          }
        : null,
      user: {
        id: entry.user.id,
        firstName: entry.user.firstName,
        lastName: entry.user.lastName,
        email: entry.user.email,
      },
      tags: entry.tags.map((tt) => ({
        id: tt.tag.id,
        name: tt.tag.name,
        color: tt.tag.color,
      })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get time entry error:", error);
    return NextResponse.json(
      { error: "Failed to fetch time entry" },
      { status: 500 }
    );
  }
}

// PUT /api/time-entries/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);
    const { id } = await params;

    const body = await request.json();
    const validated = UpdateTimeEntrySchema.parse(body);

    // Check if entry exists and belongs to this account
    const existingEntry = await prisma.timeEntry.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!existingEntry) {
      return NextResponse.json(
        { error: "Time entry not found" },
        { status: 404 }
      );
    }

    // Enforce access: the existing entry and any new project/task must be accessible
    if (!isEntryVisible(access, existingEntry.userId) || !isProjectAccessible(access, existingEntry.projectId)) {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }
    if (!canModifyEntry(currentUser, existingEntry.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (validated.projectId !== undefined && !isProjectAccessible(access, validated.projectId)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (validated.taskId !== undefined && !isTaskAccessible(access, validated.taskId)) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (!(await refsBelongToAccount(accountId, {
      projectIds: [validated.projectId],
      taskIds: [validated.taskId],
      tagIds: validated.tagIds,
    }))) {
      return NextResponse.json({ error: "Project, task or tag not found" }, { status: 404 });
    }

    // Cannot update running timer times
    if (existingEntry.isRunning && (validated.startTime || validated.endTime)) {
      return NextResponse.json(
        { error: "Cannot update times of running timer" },
        { status: 400 }
      );
    }

    // Prepare update data
    const updateData: Prisma.TimeEntryUncheckedUpdateInput = {
      updatedAt: new Date(),
    };

    if (validated.projectId !== undefined) {
      updateData.projectId = validated.projectId;
    }
    if (validated.taskId !== undefined) {
      updateData.taskId = validated.taskId;
    }
    if (validated.description !== undefined) {
      updateData.description = validated.description?.trim() || null;
    }
    if (validated.isBillable !== undefined) {
      updateData.isBillable = validated.isBillable;
    }

    // Handle time updates
    if (validated.startTime || validated.endTime) {
      const startTime = validated.startTime
        ? new Date(validated.startTime)
        : existingEntry.startTime;
      const endTime = validated.endTime
        ? new Date(validated.endTime)
        : existingEntry.endTime;

      if (startTime && endTime) {
        if (startTime >= endTime) {
          return NextResponse.json(
            { error: "End time must be after start time" },
            { status: 400 }
          );
        }

        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        if (durationHours > 24) {
          return NextResponse.json(
            { error: "Time entry cannot exceed 24 hours" },
            { status: 400 }
          );
        }

        updateData.startTime = startTime;
        updateData.endTime = endTime;
        updateData.duration = durationMs;
        updateData.durationDecimal = Number(durationHours.toFixed(4));

        const entryDate = new Date(startTime);
        entryDate.setHours(0, 0, 0, 0);
        updateData.entryDate = entryDate;
      }
    }

    // Update in transaction
    const updatedEntry = await prisma.$transaction(async (tx) => {
      // Handle tag updates
      if (validated.tagIds !== undefined) {
        // Remove existing tags
        await tx.timeEntryTag.deleteMany({
          where: { timeEntryId: id },
        });

        // Add new tags
        if (validated.tagIds.length > 0) {
          await tx.timeEntryTag.createMany({
            data: validated.tagIds.map((tagId) => ({
              timeEntryId: id,
              tagId,
            })),
          });
        }
      }

      // Update entry
      return tx.timeEntry.update({
        where: { id },
        data: updateData,
        include: {
          project: true,
          task: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          tags: {
            include: {
              tag: true,
            },
          },
        },
      });
    });

    await createAuditLog({
      accountId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email ?? "",
      actorName: currentUser.name ?? "",
      actorRole: currentUser.role ?? "User",
      action: "update",
      entityType: "TimeEntry",
      entityId: updatedEntry.id,
      summary: summarizeTimeEntryAudit("update", updatedEntry),
      changesJson: {
        before: toTimeEntryAuditSnapshot(existingEntry),
        after: toTimeEntryAuditSnapshot(updatedEntry),
      },
    });

    return NextResponse.json({
      id: updatedEntry.id,
      userId: updatedEntry.userId,
      projectId: updatedEntry.projectId,
      taskId: updatedEntry.taskId,
      description: updatedEntry.description,
      entryDate: updatedEntry.entryDate.toISOString().split("T")[0],
      startTime: updatedEntry.startTime,
      endTime: updatedEntry.endTime,
      duration: updatedEntry.duration,
      durationDecimal: updatedEntry.durationDecimal != null ? Number(updatedEntry.durationDecimal) : null,
      isBillable: updatedEntry.isBillable,
      isRunning: updatedEntry.isRunning,
      createdAt: updatedEntry.createdAt,
      updatedAt: updatedEntry.updatedAt,
      project: updatedEntry.project
        ? {
            id: updatedEntry.project.id,
            name: updatedEntry.project.name,
            color: updatedEntry.project.color,
          }
        : null,
      task: updatedEntry.task
        ? {
            id: updatedEntry.task.id,
            name: updatedEntry.task.name,
          }
        : null,
      user: {
        id: updatedEntry.user.id,
        firstName: updatedEntry.user.firstName,
        lastName: updatedEntry.user.lastName,
        email: updatedEntry.user.email,
      },
      tags: updatedEntry.tags.map((tt) => ({
        id: tt.tag.id,
        name: tt.tag.name,
        color: tt.tag.color,
      })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update time entry error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update time entry" },
      { status: 500 }
    );
  }
}

// DELETE /api/time-entries/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);
    const { id } = await params;

    // Check if entry exists
    const entry = await prisma.timeEntry.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!entry) {
      return NextResponse.json(
        { error: "Time entry not found" },
        { status: 404 }
      );
    }

    // Enforce access restrictions
    if (!isEntryVisible(access, entry.userId) || !isProjectAccessible(access, entry.projectId)) {
      return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    }
    if (!canModifyEntry(currentUser, entry.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Soft delete
    await prisma.timeEntry.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    await createAuditLog({
      accountId,
      actorUserId: currentUser.id,
      actorEmail: currentUser.email ?? "",
      actorName: currentUser.name ?? "",
      actorRole: currentUser.role ?? "User",
      action: "delete",
      entityType: "TimeEntry",
      entityId: entry.id,
      summary: summarizeTimeEntryAudit("delete", entry),
      changesJson: toTimeEntryAuditSnapshot(entry),
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete time entry error:", error);
    return NextResponse.json(
      { error: "Failed to delete time entry" },
      { status: 500 }
    );
  }
}
