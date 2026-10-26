/**
 * Stop Timer Endpoint
 *
 * POST /api/time-entries/stop
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { createAuditLog } from "@/lib/audit/logger";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "../audit";
import { mapTimeEntry } from "../mappers";

// `endTime` lets stale-timer recovery close an entry at the last heartbeat instead of now.
const StopTimerSchema = z.object({
  endTime: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const userId = currentUser.id;

    // The plain "stop now" call sends no body at all, so treat an unparseable body as empty
    const validated = StopTimerSchema.parse(
      await request.json().catch(() => ({}))
    );

    // Find the running timer
    const runningTimer = await prisma.timeEntry.findFirst({
      where: {
        accountId,
        userId,
        isRunning: true,
        isDeleted: false,
      },
    });

    if (!runningTimer) {
      return NextResponse.json(
        { error: "No running timer found" },
        { status: 404 }
      );
    }

    // Stop at the caller-supplied time when given, otherwise now
    const now = new Date();
    const endTime = validated.endTime ? new Date(validated.endTime) : now;
    const startTime = new Date(runningTimer.startTime);

    if (endTime > now) {
      return NextResponse.json(
        { error: "End time cannot be in the future" },
        { status: 400 }
      );
    }
    if (endTime <= startTime) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 }
      );
    }

    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);

    // Update the entry
    const stoppedEntry = await prisma.timeEntry.update({
      where: { id: runningTimer.id },
      data: {
        endTime,
        duration: durationMs,
        durationDecimal: Number(durationHours.toFixed(4)),
        isRunning: false,
        updatedAt: now,
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
      action: "stop",
      entityType: "TimeEntry",
      entityId: stoppedEntry.id,
      summary: summarizeTimeEntryAudit("stop", stoppedEntry),
      changesJson: toTimeEntryAuditSnapshot(stoppedEntry),
    });

    return NextResponse.json(mapTimeEntry(stoppedEntry));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Stop timer error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to stop timer" },
      { status: 500 }
    );
  }
}
