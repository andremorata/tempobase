/**
 * Saved Reports Endpoints
 *
 * GET /api/reports/saved - List all saved reports
 * POST /api/reports/saved - Create a new saved report
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { ReportGroupByInput } from "@/lib/api/types";
import { requireAuth, getCurrentTenantId, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";
import { toPersistedReportGroupBy } from "@/lib/reports/group-by";
import type { ChartGranularity } from "@/lib/reports/granularity";

type SavedReportFilters = {
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy?: ReportGroupByInput | null;
  preset?: string | null;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
};

function parseSavedReportFilters(filtersJson: string): Partial<SavedReportFilters> {
  try {
    const parsed: unknown = JSON.parse(filtersJson);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Partial<SavedReportFilters>;
    }
  } catch (error) {
    console.error("Failed to parse filters JSON:", error);
  }

  return {};
}

const reportGroupBySchema = z.enum([
  "project",
  "client",
  "user",
  "task",
  "tag",
  "Project",
  "Client",
  "Task",
]);

const CreateSavedReportSchema = z.object({
  name: z.string().min(1).max(200),
  reportType: z.enum(["Summary", "Detailed", "Weekly"]),
  from: z.string().nullish(),
  to: z.string().nullish(),
  projectId: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  taskId: z.string().uuid().nullish(),
  tagId: z.string().uuid().nullish(),
  billable: z.boolean().nullish(),
  description: z.string().nullish(),
  groupBy: reportGroupBySchema.nullish(),
  preset: z.string().nullish(),
  roundUp: z.boolean().optional(),
  chartGranularity: z.enum(["day", "week", "month", "year"]).optional(),
});

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();

    const reports = await prisma.savedReport.findMany({
      where: {
        accountId,
      },
      select: {
        id: true,
        name: true,
        reportType: true,
        filtersJson: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // Parse filtersJson back into individual fields
    const reportsWithFilters = reports.map((report) => {
      const filters = parseSavedReportFilters(report.filtersJson);

      return {
        id: report.id,
        name: report.name,
        reportType: report.reportType,
        from: filters.from || null,
        to: filters.to || null,
        projectId: filters.projectId || null,
        clientId: filters.clientId || null,
        taskId: filters.taskId || null,
        tagId: filters.tagId || null,
        billable: filters.billable ?? null,
        description: filters.description || null,
        groupBy: toPersistedReportGroupBy(filters.groupBy),
        preset: filters.preset || "custom",
        roundUp: filters.roundUp ?? null,
        chartGranularity: filters.chartGranularity ?? null,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt || report.createdAt,
      };
    });

    return NextResponse.json(reportsWithFilters);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List saved reports error:", error);
    return NextResponse.json(
      { error: "Failed to list saved reports" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const body = await request.json();
    const validated = CreateSavedReportSchema.parse(body);
    const groupBy = toPersistedReportGroupBy(validated.groupBy);

    // Serialize filters to JSON
    const filtersJson = JSON.stringify({
      from: validated.from,
      to: validated.to,
      projectId: validated.projectId,
      clientId: validated.clientId,
      taskId: validated.taskId,
      tagId: validated.tagId,
      billable: validated.billable,
      description: validated.description,
      groupBy,
      preset: validated.preset ?? "custom",
      roundUp: validated.roundUp ?? false,
      chartGranularity: validated.chartGranularity ?? "month",
    });

    const report = await prisma.savedReport.create({
      data: {
        accountId,
        createdByUserId: userId,
        name: validated.name,
        reportType: validated.reportType,
        filtersJson,
      },
      select: {
        id: true,
        name: true,
        reportType: true,
        filtersJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Parse filters back for response
    const filters = parseSavedReportFilters(report.filtersJson);

    return NextResponse.json(
      {
        id: report.id,
        name: report.name,
        reportType: report.reportType,
        from: filters.from || null,
        to: filters.to || null,
        projectId: filters.projectId || null,
        clientId: filters.clientId || null,
        taskId: filters.taskId || null,
        tagId: filters.tagId || null,
        billable: filters.billable ?? null,
        description: filters.description || null,
        groupBy: toPersistedReportGroupBy(filters.groupBy),
        preset: filters.preset || "custom",
        roundUp: filters.roundUp ?? null,
        chartGranularity: filters.chartGranularity ?? null,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt || report.createdAt,
      },
      { status: 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create saved report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create saved report" },
      { status: 500 }
    );
  }
}
