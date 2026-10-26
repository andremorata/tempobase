/**
 * Saved Report (Single) Endpoints
 *
 * PUT /api/reports/saved/[id] - Update a saved report
 * DELETE /api/reports/saved/[id] - Delete a saved report
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { ReportGroupByInput } from "@/lib/api/types";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { MANAGER_ROLES } from "@/lib/auth/access";
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

const UpdateSavedReportSchema = z.object({
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const { id } = await params;

    const body = await request.json();
    const validated = UpdateSavedReportSchema.parse(body);
    const groupBy = toPersistedReportGroupBy(validated.groupBy);

    // Check if report exists
    const existingReport = await prisma.savedReport.findUnique({
      where: { id },
      select: { accountId: true, createdByUserId: true },
    });

    if (
      !existingReport ||
      existingReport.accountId !== accountId ||
      (existingReport.createdByUserId !== currentUser.id && !MANAGER_ROLES.includes(currentUser.role))
    ) {
      return NextResponse.json(
        { error: "Saved report not found" },
        { status: 404 }
      );
    }

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

    const report = await prisma.savedReport.update({
      where: { id },
      data: {
        name: validated.name,
        reportType: validated.reportType,
        filtersJson,
        updatedAt: new Date(),
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

    return NextResponse.json({
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
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update saved report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update saved report" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const { id } = await params;

    // Check if report exists
    const existingReport = await prisma.savedReport.findUnique({
      where: { id },
      select: { accountId: true, createdByUserId: true },
    });

    if (
      !existingReport ||
      existingReport.accountId !== accountId ||
      (existingReport.createdByUserId !== currentUser.id && !MANAGER_ROLES.includes(currentUser.role))
    ) {
      return NextResponse.json(
        { error: "Saved report not found" },
        { status: 404 }
      );
    }

    // Hard delete saved reports (they're user preferences, not business data)
    await prisma.savedReport.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete saved report error:", error);
    return NextResponse.json(
      { error: "Failed to delete saved report" },
      { status: 500 }
    );
  }
}
