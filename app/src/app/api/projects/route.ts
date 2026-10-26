/**
 * Projects API Routes
 *
 * GET /api/projects - List projects
 * POST /api/projects - Create project
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireManager, requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { canSeeRates, refsBelongToAccount } from "@/lib/auth/access";

// ─── List Projects ────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();

    const where: Prisma.ProjectWhereInput = { accountId, isDeleted: false };

    // Enforce project-level access restrictions for non-Owner/Admin users
    if (currentUser.role !== "Owner" && currentUser.role !== "Admin") {
      const projectAccess = await prisma.userProjectAccess.findMany({
        where: { userId: currentUser.id, accountId },
        select: { projectId: true },
      });
      if (projectAccess.length > 0) {
        where.id = { in: projectAccess.map((a) => a.projectId) };
      }
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        tasks: {
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
            name: true,
            hourlyRate: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    const showRates = canSeeRates(currentUser);

    return NextResponse.json(
      projects.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        status: p.status,
        billingType: p.billingType,
        hourlyRate: p.hourlyRate === null || !showRates ? null : toNumber(p.hourlyRate),
        budgetHours: p.budgetHours === null ? null : toNumber(p.budgetHours),
        isArchived: p.status === "Archived",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        client: p.client,
        tasks: p.tasks.map((task) => ({
          ...task,
          hourlyRate: task.hourlyRate === null || !showRates ? null : toNumber(task.hourlyRate),
        })),
      }))
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List projects error:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

// ─── Create Project ───────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().max(20).nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  billingType: z.enum(["Hourly", "Fixed", "NonBillable"]).default("NonBillable"),
  hourlyRate: z.number().min(0).nullable().optional(),
  budgetHours: z.number().min(0).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();

    const body = await request.json();
    const validated = CreateProjectSchema.parse(body);

    if (!(await refsBelongToAccount(accountId, { clientIds: [validated.clientId] }))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const project = await prisma.project.create({
      data: {
        accountId,
        clientId: validated.clientId ?? null,
        name: validated.name,
        status: "Active",
        billingType: validated.billingType,
        hourlyRate: validated.hourlyRate ?? null,
        budgetHours: validated.budgetHours ?? null,
        ...(validated.color ? { color: validated.color } : {}),
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        id: project.id,
        accountId: project.accountId,
        clientId: project.clientId,
        name: project.name,
        color: project.color,
        status: project.status,
        billingType: project.billingType,
        hourlyRate: project.hourlyRate === null ? null : toNumber(project.hourlyRate),
        budgetHours: project.budgetHours === null ? null : toNumber(project.budgetHours),
        isArchived: false,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        client: project.client,
      },
      { status: 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create project error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
