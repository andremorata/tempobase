/**
 * Account Export Endpoint
 *
 * GET /api/account/export - Export all account data (Owner/Admin only)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { getCurrentTenantId, requireOwnerOrAdmin, authErrorResponse } from "@/lib/auth/helpers";

export async function GET() {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();

    // Fetch account
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        currency: true,
        auditRetentionDays: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    // Fetch members
    const members = await prisma.user.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Fetch clients
    const clients = await prisma.client.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        notes: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch projects
    const projects = await prisma.project.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        clientId: true,
        name: true,
        color: true,
        status: true,
        billingType: true,
        hourlyRate: true,
        budgetHours: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch tasks
    const tasks = await prisma.projectTask.findMany({
      where: {
        project: {
          accountId,
        },
        isDeleted: false,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        hourlyRate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch tags
    const tags = await prisma.tag.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        color: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch time entries with tags
    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        userId: true,
        projectId: true,
        taskId: true,
        description: true,
        entryDate: true,
        startTime: true,
        endTime: true,
        durationDecimal: true,
        isBillable: true,
        isRunning: true,
        createdAt: true,
        updatedAt: true,
        tags: {
          select: {
            tagId: true,
          },
        },
      },
    });

    const timeEntriesFormatted = timeEntries.map((e) => ({
      id: e.id,
      userId: e.userId,
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      entryDate: e.entryDate,
      startTime: e.startTime,
      endTime: e.endTime,
      durationDecimal: toNumber(e.durationDecimal),
      isBillable: e.isBillable,
      isRunning: e.isRunning,
      tagIds: e.tags.map((t) => t.tagId),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));

    const exportData = {
      account,
      members,
      clients,
      projects,
      tasks,
      tags,
      timeEntries: timeEntriesFormatted,
      exportedAt: new Date().toISOString(),
    };

    return NextResponse.json(exportData);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Export account error:", error);
    return NextResponse.json(
      { error: "Failed to export account data" },
      { status: 500 }
    );
  }
}
