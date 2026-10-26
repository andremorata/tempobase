/**
 * Get Running Timer Endpoint
 *
 * GET /api/time-entries/running
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";
import { mapTimeEntry } from "../mappers";

// Comfortably above the client's 30s poll interval, which also pauses while the window is
// unfocused. A false positive here is harmless: the next real gap overwrites it.
const SESSION_GAP_MS = 5 * 60 * 1000;

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const runningTimer = await prisma.timeEntry.findFirst({
      where: {
        accountId,
        userId,
        isRunning: true,
        isDeleted: false,
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        task: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Return null directly when no timer is running (frontend expects TimeEntry | null)
    if (!runningTimer) {
      return NextResponse.json(null);
    }

    // This GET doubles as the presence heartbeat: the client polls it every 30s while the app is
    // visible, so `lastSeenAt` tracks "the app was still open at this moment" for free. A gap far
    // longer than that poll means the app was away in between, so the heartbeat we are about to
    // overwrite is where that session ended — the moment stale-timer recovery offers as a stop
    // time. It has to be persisted, or the next poll would overwrite the only record of it.
    const now = new Date();
    const sessionEnd =
      runningTimer.lastSeenAt &&
      now.getTime() - runningTimer.lastSeenAt.getTime() > SESSION_GAP_MS
        ? runningTimer.lastSeenAt
        : null;

    await prisma.timeEntry.update({
      where: { id: runningTimer.id },
      // Deliberately not touching updatedAt — a heartbeat is not a user edit.
      data: { lastSeenAt: now, ...(sessionEnd ? { lastSessionEndAt: sessionEnd } : {}) },
    });

    return NextResponse.json(
      mapTimeEntry(sessionEnd ? { ...runningTimer, lastSessionEndAt: sessionEnd } : runningTimer)
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get running timer error:", error);
    return NextResponse.json(
      { error: "Failed to fetch running timer" },
      { status: 500 }
    );
  }
}
