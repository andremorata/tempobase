/**
 * Summary Report Endpoint
 *
 * GET /api/reports/summary - Get aggregated time summary
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, applyAccessFilter } from "@/lib/auth/access";
import { toSummaryReportGroupBy } from "@/lib/reports/group-by";
import { roundUpToTenMin } from "@/lib/reports/rounding";

const summaryGroupBySchema = z.enum(["Project", "Client", "Task", "project", "client", "task"]);

type SummaryGroupAggregate = {
  groupId: string;
  groupName: string;
  color: string | null;
  totalHours: number;
  billableHours: number;
  billedAmount: number;
  entryCount: number;
};

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  projectId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  description: z.string().optional(),
  billable: z.enum(["true", "false"]).optional(),
  groupBy: summaryGroupBySchema.default("Project"),
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
    const groupBy = toSummaryReportGroupBy(query.groupBy);

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

    if (query.billable === "true") {
      where.isBillable = true;
    } else if (query.billable === "false") {
      where.isBillable = false;
    }

    if (query.description) {
      where.description = {
        contains: query.description,
        mode: "insensitive",
      };
    }

    // Fetch entries based on group by
    const entries = await prisma.timeEntry.findMany({
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
      },
    });

    // Group and aggregate
    const groups = new Map<string, SummaryGroupAggregate>();

    for (const entry of entries) {
      let groupKey = "";
      let groupName = "";
      let color: string | null = null;

      switch (groupBy) {
        case "Project":
          groupKey = entry.projectId || "no-project";
          groupName = entry.project?.name || "No Project";
          color = entry.project?.color || null;
          break;
        case "Client":
          groupKey = entry.project?.client?.id || "no-client";
          groupName = entry.project?.client?.name || "No Client";
          break;
        case "Task":
          groupKey = entry.taskId || "no-task";
          groupName = entry.task?.name || "No Task";
          break;
        default:
          groupKey = entry.projectId || "no-project";
          groupName = entry.project?.name || "No Project";
          color = entry.project?.color || null;
      }

      let group = groups.get(groupKey);

      if (!group) {
        group = {
          groupId: groupKey,
          groupName,
          color,
          totalHours: 0,
          billableHours: 0,
          billedAmount: 0,
          entryCount: 0,
        };
        groups.set(groupKey, group);
      }

      const hours = toNumber(entry.durationDecimal);

      group.totalHours += hours;
      group.entryCount += 1;

      if (entry.isBillable) {
        group.billableHours += hours;
        if (canViewAmounts) {
          // Calculate billed amount using task rate > project rate
          const rate = entry.task?.hourlyRate ?? entry.project?.hourlyRate;
          group.billedAmount += hours * toNumber(rate);
        }
      }
    }

    let summary = Array.from(groups.values())
      .map((g) => ({
        groupId: g.groupId,
        groupName: g.groupName,
        color: g.color,
        totalHours: Number(g.totalHours.toFixed(2)),
        billableHours: Number(g.billableHours.toFixed(2)),
        billedAmount: canViewAmounts ? Number(g.billedAmount.toFixed(2)) : null,
        entryCount: g.entryCount,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    let totals = summary.reduce(
      (acc, g) => ({
        totalHours: acc.totalHours + g.totalHours,
        billableHours: acc.billableHours + g.billableHours,
        totalBilledAmount: acc.totalBilledAmount + (g.billedAmount ?? 0),
        entryCount: acc.entryCount + g.entryCount,
      }),
      { totalHours: 0, billableHours: 0, totalBilledAmount: 0, entryCount: 0 }
    );


    // Apply rounding if requested
    if (query.roundUp === "true") {
      summary = summary.map((g) => ({
        ...g,
        totalHours: g.totalHours > 0 ? roundUpToTenMin(g.totalHours) : 0,
        billableHours: g.billableHours > 0 ? roundUpToTenMin(g.billableHours) : 0,
        billedAmount: g.billedAmount != null && g.totalHours > 0
           ? Number(((g.billedAmount / g.totalHours) * roundUpToTenMin(g.totalHours)).toFixed(2))
           : g.billedAmount,
       }));
      totals = summary.reduce(
         (acc, g) => ({
          totalHours: acc.totalHours + g.totalHours,
          billableHours: acc.billableHours + g.billableHours,
          totalBilledAmount: acc.totalBilledAmount + (g.billedAmount ?? 0),
          entryCount: acc.entryCount + g.entryCount,
         }),
         { totalHours: 0, billableHours: 0, totalBilledAmount: 0, entryCount: 0 }
       );
    }

    // Match SummaryReportResponse interface
    return NextResponse.json({
      groups: summary,
      totalHours: Number(totals.totalHours.toFixed(2)),
      billableHours: Number(totals.billableHours.toFixed(2)),
      totalBilledAmount: canViewAmounts ? Number(totals.totalBilledAmount.toFixed(2)) : null,
      totalEntries: totals.entryCount,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Summary report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate summary report" },
      { status: 500 }
    );
  }
}
