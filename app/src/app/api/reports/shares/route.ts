/**
 * Shared Reports Endpoints
 *
 * GET /api/reports/shares - List all shared reports
 * POST /api/reports/shares - Create a new shared report link
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { ReportGroupByInput } from "@/lib/api/types";
import { requireAuth, requireTracker, getCurrentTenantId, getCurrentUser, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { toPersistedReportGroupBy } from "@/lib/reports/group-by";
import type { ChartGranularity } from "@/lib/reports/granularity";

type SharedReportFilters = {
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy?: ReportGroupByInput | null;
  showAmounts?: boolean | null;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
};

function parseSharedReportFilters(filtersJson: string): Partial<SharedReportFilters> {
  try {
    const parsed: unknown = JSON.parse(filtersJson);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Partial<SharedReportFilters>;
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

const CreateSharedReportSchema = z.object({
  name: z.string().min(1).max(160),
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
  showAmounts: z.boolean().default(false),
  roundUp: z.boolean().optional(),
  chartGranularity: z.enum(["day", "week", "month", "year"]).optional(),
  expiresAt: z.string().nullish(),
  overwrite: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();

    // Tokens are bearer credentials: only managers see links created by others
    const reports = await prisma.sharedReport.findMany({
      where: {
        accountId,
        ...(MANAGER_ROLES.includes(currentUser.role) ? {} : { createdByUserId: currentUser.id }),
      },
      select: {
        id: true,
        name: true,
        token: true,
        reportType: true,
        filtersJson: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Parse filtersJson and extract from/to dates
    const reportsWithFilters = reports.map((report) => {
      const filters = parseSharedReportFilters(report.filtersJson);

      return {
        id: report.id,
        name: report.name || `${report.reportType} share`,
        token: report.token,
        reportType: report.reportType,
        from: filters.from || null,
        to: filters.to || null,
        expiresAt: report.expiresAt,
        createdAt: report.createdAt,
      };
    });

    return NextResponse.json(reportsWithFilters);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List shared reports error:", error);
    return NextResponse.json(
      { error: "Failed to list shared reports" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const userPerms = await prisma.user.findUnique({
      where: { id: userId },
      select: { canViewAmounts: true },
    });
    const canViewAmounts = userPerms?.canViewAmounts ?? true;

    const body = await request.json();
    const validated = CreateSharedReportSchema.parse(body);
    const groupBy = toPersistedReportGroupBy(validated.groupBy);

    // Validate expiresAt if provided
    if (validated.expiresAt) {
      const expiresDate = new Date(validated.expiresAt);
      if (expiresDate <= new Date()) {
        return NextResponse.json(
          { error: "ExpiresAt must be in the future" },
          { status: 400 }
        );
      }
    }

    // Serialize filters to JSON — force showAmounts off if user cannot view amounts
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
      showAmounts: canViewAmounts ? validated.showAmounts : false,
      roundUp: validated.roundUp ?? false,
      chartGranularity: validated.chartGranularity ?? "month",
    });

    const expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;

    // A share name must be unique within the account. If one already exists,
    // require explicit overwrite confirmation instead of silently creating a duplicate.
    const existing = await prisma.sharedReport.findFirst({
      where: { accountId, name: validated.name },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existing && !validated.overwrite) {
      return NextResponse.json(
        {
          error: "A shared report with this name already exists",
          code: "DUPLICATE_NAME",
        },
        { status: 409 }
      );
    }

    let report;

    if (existing) {
      // Overwrite confirmed — replace the existing share's configuration while
      // preserving its token so any already-distributed links keep working.
      report = await prisma.sharedReport.update({
        where: { id: existing.id },
        data: {
          reportType: validated.reportType,
          filtersJson,
          expiresAt,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          token: true,
          reportType: true,
          filtersJson: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    } else {
      // Generate URL-safe token (18 bytes = 24 base64url chars)
      const token = randomBytes(18)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      report = await prisma.sharedReport.create({
        data: {
          accountId,
          createdByUserId: userId,
          name: validated.name,
          token,
          reportType: validated.reportType,
          filtersJson,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          token: true,
          reportType: true,
          filtersJson: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    }

    // Parse filters back for response
    const filters = parseSharedReportFilters(report.filtersJson);

    return NextResponse.json(
      {
        id: report.id,
        name: report.name || `${report.reportType} share`,
        token: report.token,
        reportType: report.reportType,
        from: filters.from || null,
        to: filters.to || null,
        expiresAt: report.expiresAt,
        createdAt: report.createdAt,
      },
      { status: existing ? 200 : 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create shared report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create shared report" },
      { status: 500 }
    );
  }
}
