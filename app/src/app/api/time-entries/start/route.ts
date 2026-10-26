/**
 * Start Timer Endpoint
 *
 * POST /api/time-entries/start
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireTracker, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, isProjectAccessible, isTaskAccessible, refsBelongToAccount } from "@/lib/auth/access";
import { createAuditLog } from "@/lib/audit/logger";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "../audit";
import { mapTimeEntry } from "../mappers";

const StartTimerSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).optional(),
  isBillable: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const userId = currentUser.id;
    const access = await getMemberAccess(userId, accountId, currentUser.role);

    const body = await request.json();
    const validated = StartTimerSchema.parse(body);

    // Enforce access restrictions on the selected project/task
    if (!isProjectAccessible(access, validated.projectId)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!isTaskAccessible(access, validated.taskId)) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (!(await refsBelongToAccount(accountId, {
      projectIds: [validated.projectId],
      taskIds: [validated.taskId],
    }))) {
      return NextResponse.json({ error: "Project or task not found" }, { status: 404 });
    }

    // Check if there's already a running timer
    const runningTimer = await prisma.timeEntry.findFirst({
      where: {
        accountId,
        userId,
        isRunning: true,
        isDeleted: false,
      },
    });

    if (runningTimer) {
      return NextResponse.json(
        { error: "A timer is already running. Stop it before starting a new one." },
        { status: 409 }
      );
    }

    const now = new Date();
    const entryDate = new Date(now);
    entryDate.setHours(0, 0, 0, 0);

    const entry = await prisma.timeEntry.create({
      data: {
        accountId,
        userId,
        projectId: validated.projectId ?? null,
        taskId: validated.taskId ?? null,
        description: validated.description?.trim() || null,
        entryDate,
        startTime: now,
        isBillable: validated.isBillable,
        isRunning: true,
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await createAuditLog({
      accountId,
      actorUserId: userId,
      actorEmail: currentUser.email ?? "",
      actorName: currentUser.name ?? "",
      actorRole: currentUser.role ?? "User",
      action: "start",
      entityType: "TimeEntry",
      entityId: entry.id,
      summary: summarizeTimeEntryAudit("start", entry),
      changesJson: toTimeEntryAuditSnapshot(entry),
    });

    return NextResponse.json(mapTimeEntry(entry), { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Start timer error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to start timer" },
      { status: 500 }
    );
  }
}
