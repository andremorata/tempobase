/**
 * GET /api/integrations/v1/projects?q= - Projects and registered tasks the token owner can access.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import { integrationErrorResponse } from "../shared";

const QuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export async function GET(request: NextRequest) {
  try {
    const caller = await authenticateIntegration(request, "read");
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { projectIds, taskIds } = caller.access;

    const taskWhere: Prisma.ProjectTaskWhereInput = {
      isDeleted: false,
      ...(taskIds !== null ? { id: { in: taskIds } } : {}),
    };
    const where: Prisma.ProjectWhereInput = {
      accountId: caller.accountId,
      isDeleted: false,
      ...(projectIds !== null ? { id: { in: projectIds } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { tasks: { some: { ...taskWhere, name: { contains: query.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        client: { select: { name: true } },
        tasks: { where: taskWhere, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } },
      },
      orderBy: { name: "asc" },
      take: query.limit + 1,
    });

    return NextResponse.json({
      projects: projects.slice(0, query.limit).map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        clientName: p.client?.name ?? null,
        tasks: p.tasks,
      })),
      hasMore: projects.length > query.limit,
    });
  } catch (error) {
    return integrationErrorResponse(error, "search projects");
  }
}
