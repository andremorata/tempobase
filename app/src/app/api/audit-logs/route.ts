/**
 * Audit Logs Endpoint
 *
 * GET /api/audit-logs - List audit logs (Owner/Admin only)
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, requireOwnerOrAdmin, authErrorResponse } from "@/lib/auth/helpers";

const QuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = QuerySchema.parse(searchParams);

    const where: Prisma.AuditLogWhereInput = {
      accountId,
    };

    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) {
        createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        createdAt.lte = new Date(query.to);
      }
      where.createdAt = createdAt;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { entityType: { contains: query.search, mode: "insensitive" } },
        { actorEmail: { contains: query.search, mode: "insensitive" } },
        { actorName: { contains: query.search, mode: "insensitive" } },
        { summary: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          accountId: true,
          actorUserId: true,
          actorEmail: true,
          actorName: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          summary: true,
          changesJson: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Map to match AuditLogItem interface from frontend types
    const items = logs.map((log) => ({
      id: log.id,
      occurredAt: log.createdAt,
      accountId: log.accountId,
      actorUserId: log.actorUserId,
      actorEmail: log.actorEmail,
      actorName: log.actorName,
      actorRole: log.actorRole,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      summary: log.summary,
      changesJson: log.changesJson,
    }));

    return NextResponse.json({
      items,
      totalCount: total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      hasNextPage: query.page < Math.ceil(total / query.pageSize),
      hasPreviousPage: query.page > 1,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List audit logs error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}
