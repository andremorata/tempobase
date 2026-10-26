/**
 * Weekly Report Endpoint
 *
 * GET /api/reports/weekly - Get week-by-week breakdown with day totals
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
  billable: z.enum(["true", "false"]).optional(),
  roundUp: z.enum(["true", "false"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

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

    if (query.billable === "true") {
      where.isBillable = true;
    } else if (query.billable === "false") {
      where.isBillable = false;
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      select: {
        entryDate: true,
        durationDecimal: true,
      },
    });

    if (entries.length === 0) {
      return NextResponse.json({
        weeks: [],
        grandTotal: 0,
      });
    }

    // Get Monday for a given date (Monday-anchored weeks)
    function getMonday(date: Date): string {
      const d = new Date(date);
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // If Sunday (0), go back 6 days; otherwise go to Monday
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().split("T")[0];
    }

    // Group entries by Monday-anchored week
    const weekMap = new Map<string, Array<(typeof entries)[number]>>();

    for (const entry of entries) {
      const monday = getMonday(entry.entryDate);
      if (!weekMap.has(monday)) {
        weekMap.set(monday, []);
      }
      weekMap.get(monday)!.push(entry);
    }

    // Sort weeks by Monday date
    const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    // Build week rows
    let weeks = sortedWeeks.map(([mondayStr, weekEntries]) => {
      const weekStart = new Date(mondayStr);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Initialize day totals array [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
      const dayTotals = [0, 0, 0, 0, 0, 0, 0];

      for (const entry of weekEntries) {
        const entryDay = new Date(entry.entryDate).getUTCDay();
        // Convert Sunday (0) to index 6, Monday (1) to index 0, etc.
        const dayIndex = entryDay === 0 ? 6 : entryDay - 1;
        dayTotals[dayIndex] += toNumber(entry.durationDecimal);
      }

      const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0);

      return {
        weekStart: weekStart.toISOString().split("T")[0],
        weekEnd: weekEnd.toISOString().split("T")[0],
        dayTotals: dayTotals.map(h => Number(h.toFixed(2))),
        weekTotal: Number(weekTotal.toFixed(2)),
      };
    });

    let grandTotal = weeks.reduce((sum, w) => sum + w.weekTotal, 0);


     // Apply rounding if requested
    if (query.roundUp === "true") {
      weeks = weeks.map((w) => {
        const roundedDayTotals = w.dayTotals.map((d) => (d > 0 ? roundUpToTenMin(d) : 0));
        const weekTotal = roundedDayTotals.reduce((s, h) => s + h, 0);
        return { ...w, dayTotals: roundedDayTotals, weekTotal: Number(weekTotal.toFixed(2)) };
       });
      grandTotal = weeks.reduce((sum, w) => sum + w.weekTotal, 0);
      }

    return NextResponse.json({
      weeks,
      grandTotal: Number(grandTotal.toFixed(2)),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Weekly report error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate weekly report" },
      { status: 500 }
    );
  }
}
