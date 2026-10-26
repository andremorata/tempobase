/**
 * Dashboard Endpoint
 *
 * GET /api/dashboard - Get dashboard data with KPIs, charts, and recent entries
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess } from "@/lib/auth/access";

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    // Build a reusable owner/project restriction clause for time-entry queries
    const entryRestriction = {
      ...(access.projectIds !== null ? { projectId: { in: access.projectIds } } : {}),
      ...(access.userId !== null ? { userId: access.userId } : {}),
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Calculate week start (Monday)
    const dayOfWeek = today.getDay();
    const dayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 0, Monday = 1
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOffset);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Last 7 days for chart
    const last7Start = new Date(today);
    last7Start.setDate(today.getDate() - 6);

    // Fetch week entries (scoped to accessible projects)
    const weekEntries = await prisma.timeEntry.findMany({
      where: {
        accountId,
        isRunning: false,
        isDeleted: false,
        entryDate: {
          gte: weekStart,
          lte: weekEnd,
        },
        ...entryRestriction,
      },
      select: {
        durationDecimal: true,
        isBillable: true,
        entryDate: true,
        projectId: true,
      },
    });

    // KPIs
    const totalHoursThisWeek = weekEntries.reduce(
      (sum, e) => sum + toNumber(e.durationDecimal),
      0
    );

    const todayHours = weekEntries
      .filter((e) => {
        const entryDate = new Date(e.entryDate);
        return entryDate.toDateString() === today.toDateString();
      })
      .reduce((sum, e) => sum + toNumber(e.durationDecimal), 0);

    const billableHours = weekEntries
      .filter((e) => e.isBillable)
      .reduce((sum, e) => sum + toNumber(e.durationDecimal), 0);

    const billablePercentage =
      totalHoursThisWeek > 0
        ? Math.round((billableHours / totalHoursThisWeek) * 1000) / 10
        : 0;

    const activeProjectsCount = await prisma.project.count({
      where: {
        accountId,
        status: "Active",
        isDeleted: false,
        ...(access.projectIds !== null ? { id: { in: access.projectIds } } : {}),
      },
    });

    const kpis = {
      totalHoursThisWeek: Number(totalHoursThisWeek.toFixed(2)),
      totalHoursToday: Number(todayHours.toFixed(2)),
      activeProjectsCount,
      billablePercentage: Number(billablePercentage.toFixed(1)),
    };

    // Hours per day (last 7 days, scoped to accessible projects)
    const last7Entries = await prisma.timeEntry.findMany({
      where: {
        accountId,
        isRunning: false,
        isDeleted: false,
        entryDate: {
          gte: last7Start,
          lte: today,
        },
        ...entryRestriction,
      },
      select: {
        entryDate: true,
        durationDecimal: true,
      },
    });

    const hoursByDay = new Map<string, number>();
    last7Entries.forEach((e) => {
      const dateKey = new Date(e.entryDate).toISOString().split("T")[0];
      hoursByDay.set(dateKey, (hoursByDay.get(dateKey) || 0) + toNumber(e.durationDecimal));
    });

    const hoursPerDay = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(last7Start);
      date.setDate(last7Start.getDate() + i);
      const dateKey = date.toISOString().split("T")[0];
      return {
        date: dateKey,
        totalHours: Number((hoursByDay.get(dateKey) || 0).toFixed(2)),
      };
    });

    // Hours by project (this week)
    const projectHoursMap = new Map<string, { name: string; color: string | null; hours: number }>();

    for (const entry of weekEntries) {
      if (!entry.projectId) continue;

      const existing = projectHoursMap.get(entry.projectId);
      if (existing) {
        existing.hours += toNumber(entry.durationDecimal);
      } else {
        const project = await prisma.project.findFirst({
          where: { id: entry.projectId, accountId },
          select: { name: true, color: true },
        });

        if (project) {
          projectHoursMap.set(entry.projectId, {
            name: project.name,
            color: project.color,
            hours: toNumber(entry.durationDecimal),
          });
        }
      }
    }

    const hoursByProject = Array.from(projectHoursMap.entries())
      .map(([projectId, data]) => ({
        projectId,
        projectName: data.name,
        projectColor: data.color,
        totalHours: Number(data.hours.toFixed(2)),
      }))
      .sort((a, b) => b.totalHours - a.totalHours)
      .slice(0, 10); // Top 10 projects

    // Recent entries (last 10, scoped to accessible projects)
    const recentEntries = await prisma.timeEntry.findMany({
      where: {
        accountId,
        isDeleted: false,
        ...entryRestriction,
      },
      include: {
        project: {
          select: {
            name: true,
            color: true,
          },
        },
      },
      orderBy: [
        { entryDate: "desc" },
        { startTime: "desc" },
      ],
      take: 10,
    });

    const recentEntriesFormatted = recentEntries.map((e) => ({
      id: e.id,
      description: e.description,
      projectName: e.project?.name || null,
      projectColor: e.project?.color || null,
      entryDate: e.entryDate,
      startTime: e.startTime,
      endTime: e.endTime,
      durationDecimal: toNumber(e.durationDecimal),
      isRunning: e.isRunning,
    }));

    return NextResponse.json({
      kpis,
      hoursPerDay,
      hoursByProject,
      recentEntries: recentEntriesFormatted,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
