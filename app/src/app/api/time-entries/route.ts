/**
 * Time Entries API Routes
 *
 * GET /api/time-entries - List with filters
 * POST /api/time-entries - Create manual entry
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/extensions";
import { requireAuth, requireTracker, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, applyAccessFilter } from "@/lib/auth/access";
import { checkManualEntry, createManualEntry, ManualEntrySchema } from "@/lib/time-entries/manual-entry";
import { createAuditLog } from "@/lib/audit/logger";
import { mapTimeEntry } from "./mappers";
import { summarizeTimeEntryAudit, toTimeEntryAuditSnapshot } from "./audit";

// ─── List Time Entries ────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  from: z.string().optional(), // ISO date string
  to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = ListQuerySchema.parse(searchParams);

    const db = withTenant(prisma, accountId);

    const entryDate: Prisma.DateTimeFilter = {};

    if (query.from) {
      entryDate.gte = new Date(query.from);
    }

    if (query.to) {
      entryDate.lte = new Date(query.to);
    }

    const where: Prisma.TimeEntryWhereInput = {
      accountId,
      isDeleted: false,
      ...(query.from || query.to ? { entryDate } : {}),
    };

    // Apply user/project/task access restrictions (intersects with any caller-supplied filters)
    applyAccessFilter(where, access, query.projectId, query.taskId, query.userId);

    const entries = await db.timeEntry.findMany({
      where,
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        task: true,
      },
      orderBy: [
        { entryDate: "desc" },
        { startTime: "desc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    // Return array directly to match frontend contract
    return NextResponse.json(entries.map(mapTimeEntry));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List time entries error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch time entries" },
      { status: 500 }
    );
  }
}

// ─── Create Manual Time Entry ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();
    const user = await getCurrentUser();
    const userId = user.id;
    const access = await getMemberAccess(userId, accountId, user.role);

    const validated = ManualEntrySchema.parse(await request.json());

    const violation = await checkManualEntry(accountId, access, validated);
    if (violation) {
      return NextResponse.json({ error: violation.error }, { status: violation.status });
    }

    const entry = await prisma.$transaction((tx) => createManualEntry(tx, { accountId, userId }, validated));

    // Create audit log
    await createAuditLog({
      accountId,
      actorUserId: userId,
      actorEmail: user.email ?? "",
      actorName: user.name ?? "",
      actorRole: user.role ?? "User",
      action: "create",
      entityType: "TimeEntry",
      entityId: entry.id,
      summary: summarizeTimeEntryAudit("create", entry),
      changesJson: toTimeEntryAuditSnapshot(entry),
    });

    return NextResponse.json(mapTimeEntry(entry), { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create time entry error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create time entry" },
      { status: 500 }
    );
  }
}
