/**
 * Archive Project
 *
 * POST /api/projects/[id]/archive - Toggle archive status
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireManager, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    // Check if project exists
    const existingProject = await prisma.project.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!existingProject) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Toggle archive status
    const newStatus = existingProject.status === "Archived" ? "Active" : "Archived";

    const project = await prisma.project.update({
      where: { id },
      data: {
        status: newStatus,
        updatedAt: new Date(),
      },
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
    });

    return NextResponse.json({
      id: project.id,
      accountId: project.accountId,
      clientId: project.clientId,
      name: project.name,
      color: project.color,
      status: project.status,
      billingType: project.billingType,
      hourlyRate: project.hourlyRate,
      budgetHours: project.budgetHours,
      isArchived: project.status === "Archived",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      client: project.client,
      tasks: project.tasks,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Archive project error:", error);
    return NextResponse.json(
      { error: "Failed to archive project" },
      { status: 500 }
    );
  }
}
