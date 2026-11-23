/**
 * GET /api/integrations/v1/hours - Total hours of the token owner for a period.
 *
 * Uses the Summary report aggregation, so the numbers match /api/reports/summary for the
 * same user, period, filters and round-up. Never returns amounts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import { getSummaryReport } from "@/lib/reports/summary";
import { integrationErrorResponse, isoDate, refsOutOfScope } from "../shared";

const QuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    projectId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(200).optional(),
    roundUp: z.enum(["true", "false"]).default("false"),
  })
  .refine((q) => q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

export async function GET(request: NextRequest) {
  try {
    const caller = await authenticateIntegration(request, "read");
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

    const outOfScope = await refsOutOfScope(caller, query);
    if (outOfScope) return outOfScope;

    const roundUp = query.roundUp === "true";
    const report = await getSummaryReport({
      accountId: caller.accountId,
      access: caller.access,
      canViewAmounts: false,
      filters: { ...query, groupBy: "Project", roundUp },
    });

    return NextResponse.json({
      from: query.from,
      to: query.to,
      roundUp,
      totalHours: report.totalHours,
      billableHours: report.billableHours,
      totalEntries: report.totalEntries,
      projects: report.groups.map((g) => ({
        projectId: g.groupId === "no-project" ? null : g.groupId,
        projectName: g.groupName,
        totalHours: g.totalHours,
        billableHours: g.billableHours,
        entryCount: g.entryCount,
      })),
    });
  } catch (error) {
    return integrationErrorResponse(error, "compute hours");
  }
}
