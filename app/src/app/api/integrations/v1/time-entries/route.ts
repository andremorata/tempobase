/**
 * GET /api/integrations/v1/time-entries - The token owner's own entries, newest first.
 *
 * Always scoped to the token owner, also for Owner/Admin. Never returns amounts.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { applyAccessFilter } from "@/lib/auth/access";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import { integrationErrorResponse, isoDate, refsOutOfScope } from "../shared";

const QuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export async function GET(request: NextRequest) {
  try {
    const caller = await authenticateIntegration(request, "read");
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));

    const outOfScope = await refsOutOfScope(caller, query);
    if (outOfScope) return outOfScope;

    const where: Prisma.TimeEntryWhereInput = { accountId: caller.accountId, isDeleted: false };
    if (query.from || query.to) {
      where.entryDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    applyAccessFilter(where, caller.access, query.projectId, query.taskId);
    if (query.description) where.description = { contains: query.description, mode: "insensitive" };

    const rows = await prisma.timeEntry.findMany({
      where,
      select: {
        id: true,
        entryDate: true,
        startTime: true,
        endTime: true,
        durationDecimal: true,
        description: true,
        isBillable: true,
        isRunning: true,
        project: { select: { id: true, name: true } },
        task: { select: { id: true, name: true } },
      },
      orderBy: [{ entryDate: "desc" }, { startTime: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize + 1,
    });

    return NextResponse.json({
      entries: rows.slice(0, query.pageSize).map((e) => ({
        id: e.id,
        date: e.entryDate.toISOString().slice(0, 10),
        startTime: e.startTime,
        endTime: e.endTime,
        durationHours: e.durationDecimal == null ? null : toNumber(e.durationDecimal),
        description: e.description,
        project: e.project,
        task: e.task,
        isBillable: e.isBillable,
        isRunning: e.isRunning,
      })),
      page: query.page,
      pageSize: query.pageSize,
      hasMore: rows.length > query.pageSize,
    });
  } catch (error) {
    return integrationErrorResponse(error, "list time entries");
  }
}
