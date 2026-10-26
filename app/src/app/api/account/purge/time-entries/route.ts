/**
 * Purge Time Entries Endpoint
 *
 * POST /api/account/purge/time-entries - Delete time entries within date range (Owner/Admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, requireOwnerOrAdmin, authErrorResponse } from "@/lib/auth/helpers";

const PurgeTimeEntriesSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();

    const body = await request.json();
    const validated = PurgeTimeEntriesSchema.parse(body);

    const entryDate: Prisma.DateTimeFilter = {};

    if (validated.from) {
      entryDate.gte = new Date(validated.from);
    }

    if (validated.to) {
      entryDate.lte = new Date(validated.to);
    }

    const where: Prisma.TimeEntryWhereInput = {
      accountId,
      isDeleted: false,
      ...(validated.from || validated.to ? { entryDate } : {}),
    };

    // Soft delete time entries
    const result = await prisma.timeEntry.updateMany({
      where,
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      purgedCount: result.count,
      from: validated.from || null,
      to: validated.to || null,
      purgedAt: new Date().toISOString(),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Purge time entries error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to purge time entries" },
      { status: 500 }
    );
  }
}
