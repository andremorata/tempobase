/**
 * Duplicate Project
 *
 * POST /api/projects/[id]/duplicate - Copy a project, its tasks and its member access.
 * The copy starts Inactive so nobody logs time on it before it is adjusted.
 * Time entries are not copied.
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireManager, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, isProjectAccessible } from "@/lib/auth/access";

const COPY_SUFFIX = " (copy)";
const MAX_NAME_LENGTH = 200;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const { id } = await params;

    const source = await prisma.project.findFirst({
      where: { id, accountId, isDeleted: false },
      include: {
        userAccess: { select: { userId: true } },
        tasks: {
          where: { isDeleted: false },
          include: { userAccess: { select: { userId: true } } },
        },
      },
    });

    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    if (!source || !isProjectAccessible(access, source.id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const tasks = source.tasks.map((task) => ({ ...task, copyId: randomUUID() }));

    const project = await prisma.$transaction(async (tx) => {
      const copy = await tx.project.create({
        data: {
          accountId,
          clientId: source.clientId,
          name: `${source.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
          color: source.color,
          status: "Inactive",
          billingType: source.billingType,
          hourlyRate: source.hourlyRate,
          budgetHours: source.budgetHours,
        },
      });

      await tx.projectTask.createMany({
        data: tasks.map((task) => ({
          id: task.copyId,
          accountId,
          projectId: copy.id,
          name: task.name,
          hourlyRate: task.hourlyRate,
          isActive: task.isActive,
        })),
      });

      await tx.userProjectAccess.createMany({
        data: source.userAccess.map(({ userId }) => ({ userId, projectId: copy.id, accountId })),
      });

      await tx.userTaskAccess.createMany({
        data: tasks.flatMap((task) =>
          task.userAccess.map(({ userId }) => ({ userId, taskId: task.copyId, accountId })),
        ),
      });

      return tx.project.findUniqueOrThrow({
        where: { id: copy.id },
        include: {
          client: { select: { id: true, name: true } },
          tasks: { select: { id: true, name: true, hourlyRate: true } },
        },
      });
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
        tasks: project.tasks.map((task) => ({
          ...task,
          hourlyRate: task.hourlyRate === null ? null : toNumber(task.hourlyRate),
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Duplicate project error:", error);
    return NextResponse.json(
      { error: "Failed to duplicate project" },
      { status: 500 }
    );
  }
}
