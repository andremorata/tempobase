/**
 * Summary Report Endpoint
 *
 * GET /api/reports/summary - Get aggregated time summary
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess } from "@/lib/auth/access";
import { toSummaryReportGroupBy } from "@/lib/reports/group-by";
import { getSummaryReport } from "@/lib/reports/summary";

const summaryGroupBySchema = z.enum(["Project", "Client", "Task", "project", "client", "task"]);

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

    const report = await getSummaryReport({
      accountId,
      access,
      canViewAmounts,
      filters: {
        ...query,
        groupBy: toSummaryReportGroupBy(query.groupBy),
        roundUp: query.roundUp === "true",
      },
    });

    return NextResponse.json(report);
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
