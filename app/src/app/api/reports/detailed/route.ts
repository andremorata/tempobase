/**
 * Detailed Report Endpoint
 *
 * GET /api/reports/detailed - Get detailed time entry list
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { roundUpToTenMin } from "@/lib/reports/rounding";
import { getMemberAccess, applyAccessFilter } from "@/lib/auth/access";

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  projectId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  description: z.string().optional(),
  billable: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(100),
  roundUp: z.enum(["true", "false"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    const userPerms = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { canViewAmounts: true },
    });
    const canViewAmounts = userPerms?.canViewAmounts ?? true;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = QuerySchema.parse(searchParams);

    const where: Prisma.TimeEntryWhereInput = {
      accountId,
      isRunning: false,
      isDeleted: false,
    };

    if (query.from || query.to) {
      const entryDate: Prisma.DateTimeFilter = {};
      if (query.from) {
        entryDate.gte = new Date(query.from);
      }
      if (query.to) {
        entryDate.lte = new Date(query.to);
      }
      where.entryDate = entryDate;
    }

    // Apply user/project/task access restrictions (intersects with any caller-supplied filters)
    applyAccessFilter(where, access, query.projectId, query.taskId, query.userId);

    if (query.clientId) {
      where.project = {
        clientId: query.clientId,
      };
    }

    if (query.tagId) {
      where.tags = {
        some: {
          tagId: query.tagId,
        },
      };
    }

    if (query.description) {
      where.description = {
        contains: query.description,
        mode: "insensitive",
      };
    }

    if (query.billable === "true") {
      where.isBillable = true;
    } else if (query.billable === "false") {
      where.isBillable = false;
    }

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              color: true,
              hourlyRate: true,
              client: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          task: {
            select: {
              id: true,
              name: true,
              hourlyRate: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [
          { entryDate: "desc" },
          { startTime: "desc" },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    // Calculate billed amounts and map to DetailedEntryRow interface
    let mappedEntries = entries.map((entry) => {
      const hours = toNumber(entry.durationDecimal);
      const rate = toNumber(entry.task?.hourlyRate ?? entry.project?.hourlyRate);
      const billedAmount = canViewAmounts && entry.isBillable ? hours * rate : null;

      return {
        id: entry.id,
        projectName: entry.project?.name || null,
        projectColor: entry.project?.color || null,
        clientName: entry.project?.client?.name || null,
        taskName: entry.task?.name || null,
        description: entry.description,
        entryDate: entry.entryDate.toISOString().split("T")[0],
        startTime: entry.startTime,
        endTime: entry.endTime,
        durationDecimal: hours,
        isBillable: entry.isBillable,
        billedAmount: billedAmount !== null ? Number(billedAmount.toFixed(2)) : null,
        tagNames: entry.tags.map((tt) => tt.tag.name),
      };
    });

    let totalHours = mappedEntries.reduce(
      (sum, e) => sum + e.durationDecimal,
      0
    );

    let billableHours = mappedEntries
      .filter(e => e.isBillable)
      .reduce((sum, e) => sum + e.durationDecimal, 0);

    let totalBilled = mappedEntries.reduce(
      (sum, e) => sum + (e.billedAmount || 0),
      0
    );


     // Apply rounding if requested
    if (query.roundUp === "true") {
      mappedEntries = mappedEntries.map((e) => ({
         ...e,
        durationDecimal: e.durationDecimal != null && e.durationDecimal > 0 ? roundUpToTenMin(e.durationDecimal) : e.durationDecimal,
        billedAmount: e.billedAmount != null && e.billedAmount > 0
            ? Number(((e.billedAmount / e.durationDecimal) * roundUpToTenMin(e.durationDecimal)).toFixed(2))
            : e.billedAmount,
        }));
      totalHours = mappedEntries.reduce((sum, e) => sum + (e.durationDecimal || 0), 0);
      billableHours = mappedEntries.filter(e => e.isBillable).reduce((sum, e) => sum + (e.durationDecimal || 0), 0);
      totalBilled = mappedEntries.reduce((sum, e) => sum + (e.billedAmount || 0), 0);
     }

    // Match DetailedReportResponse interface
    return NextResponse.json({
      entries: mappedEntries,
      totalHours: Number(totalHours.toFixed(2)),
      billableHours: Number(billableHours.toFixed(2)),
      totalBilledAmount: canViewAmounts ? Number(totalBilled.toFixed(2)) : null,
      totalEntries: total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Detailed report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate detailed report" },
      { status: 500 }
    );
  }
}
