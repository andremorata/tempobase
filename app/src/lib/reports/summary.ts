import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toNumber } from "@/lib/db/decimal";
import { applyAccessFilter, type MemberAccess } from "@/lib/auth/access";
import type { SummaryGroupBy } from "@/lib/api/types";
import { roundUpToTenMin } from "./rounding";

export interface SummaryFilters {
  from?: string;
  to?: string;
  projectId?: string;
  clientId?: string;
  taskId?: string;
  tagId?: string;
  userId?: string;
  description?: string;
  billable?: "true" | "false";
  groupBy: SummaryGroupBy;
  roundUp: boolean;
}

type Rate = Prisma.Decimal | number | null;

export interface SummaryEntry {
  projectId: string | null;
  taskId: string | null;
  isBillable: boolean;
  durationDecimal: Prisma.Decimal | number | null;
  project: {
    id: string;
    name: string;
    color: string;
    hourlyRate: Rate;
    client: { id: string; name: string } | null;
  } | null;
  task: { id: string; name: string; hourlyRate: Rate } | null;
}

export interface SummaryGroup {
  groupId: string;
  groupName: string;
  color: string | null;
  totalHours: number;
  billableHours: number;
  billedAmount: number | null;
  entryCount: number;
}

export interface SummaryReport {
  groups: SummaryGroup[];
  totalHours: number;
  billableHours: number;
  totalBilledAmount: number | null;
  totalEntries: number;
}

function groupKeyOf(entry: SummaryEntry, groupBy: SummaryGroupBy) {
  switch (groupBy) {
    case "Client":
      return { key: entry.project?.client?.id || "no-client", name: entry.project?.client?.name || "No Client", color: null };
    case "Task":
      return { key: entry.taskId || "no-task", name: entry.task?.name || "No Task", color: null };
    default:
      return { key: entry.projectId || "no-project", name: entry.project?.name || "No Project", color: entry.project?.color || null };
  }
}

const fixed = (value: number) => Number(value.toFixed(2));

/**
 * Aggregates entries into the Summary report. Round-up applies per entry, the same
 * rule the Reports page, the Detailed report and shared links use.
 */
export function summarizeEntries(
  entries: SummaryEntry[],
  options: { groupBy: SummaryGroupBy; roundUp: boolean; canViewAmounts: boolean },
): SummaryReport {
  const { groupBy, roundUp, canViewAmounts } = options;
  const groups = new Map<string, Omit<SummaryGroup, "billedAmount"> & { billedAmount: number }>();
  const raw = { totalHours: 0, billableHours: 0, billedAmount: 0 };

  for (const entry of entries) {
    const { key, name, color } = groupKeyOf(entry, groupBy);
    let group = groups.get(key);
    if (!group) {
      group = { groupId: key, groupName: name, color, totalHours: 0, billableHours: 0, billedAmount: 0, entryCount: 0 };
      groups.set(key, group);
    }

    const stored = toNumber(entry.durationDecimal);
    const hours = roundUp && stored > 0 ? roundUpToTenMin(stored) : stored;

    group.totalHours += hours;
    group.entryCount += 1;
    raw.totalHours += hours;

    if (entry.isBillable) {
      group.billableHours += hours;
      raw.billableHours += hours;
      if (canViewAmounts) {
        const amount = hours * toNumber(entry.task?.hourlyRate ?? entry.project?.hourlyRate ?? null);
        group.billedAmount += amount;
        raw.billedAmount += amount;
      }
    }
  }

  const summary = Array.from(groups.values())
    .map((g) => ({
      ...g,
      totalHours: fixed(g.totalHours),
      billableHours: fixed(g.billableHours),
      billedAmount: canViewAmounts ? fixed(g.billedAmount) : null,
    }))
    .sort((a, b) => b.totalHours - a.totalHours);

  // NOTE: without round-up, totals stay the sum of the per-group 2-decimal values (the
  // historical Summary contract). With round-up, totals sum the rounded entries first,
  // which is what the Reports page KPI cards show.
  const totals = roundUp
    ? raw
    : summary.reduce(
        (acc, g) => ({
          totalHours: acc.totalHours + g.totalHours,
          billableHours: acc.billableHours + g.billableHours,
          billedAmount: acc.billedAmount + (g.billedAmount ?? 0),
        }),
        { totalHours: 0, billableHours: 0, billedAmount: 0 },
      );

  return {
    groups: summary,
    totalHours: fixed(totals.totalHours),
    billableHours: fixed(totals.billableHours),
    totalBilledAmount: canViewAmounts ? fixed(totals.billedAmount) : null,
    totalEntries: entries.length,
  };
}

export function buildSummaryWhere(
  accountId: string,
  access: MemberAccess,
  filters: Omit<SummaryFilters, "groupBy" | "roundUp">,
): Prisma.TimeEntryWhereInput {
  const where: Prisma.TimeEntryWhereInput = { accountId, isRunning: false, isDeleted: false };

  if (filters.from || filters.to) {
    const entryDate: Prisma.DateTimeFilter = {};
    if (filters.from) entryDate.gte = new Date(filters.from);
    if (filters.to) entryDate.lte = new Date(filters.to);
    where.entryDate = entryDate;
  }

  applyAccessFilter(where, access, filters.projectId, filters.taskId, filters.userId);

  if (filters.clientId) where.project = { clientId: filters.clientId };
  if (filters.tagId) where.tags = { some: { tagId: filters.tagId } };
  if (filters.billable === "true") where.isBillable = true;
  else if (filters.billable === "false") where.isBillable = false;
  if (filters.description) where.description = { contains: filters.description, mode: "insensitive" };

  return where;
}

export async function getSummaryReport(params: {
  accountId: string;
  access: MemberAccess;
  canViewAmounts: boolean;
  filters: SummaryFilters;
}): Promise<SummaryReport> {
  const { accountId, access, canViewAmounts, filters } = params;
  const entries = await prisma.timeEntry.findMany({
    where: buildSummaryWhere(accountId, access, filters),
    include: {
      project: {
        select: { id: true, name: true, color: true, hourlyRate: true, client: { select: { id: true, name: true } } },
      },
      task: { select: { id: true, name: true, hourlyRate: true } },
    },
  });

  return summarizeEntries(entries, { groupBy: filters.groupBy, roundUp: filters.roundUp, canViewAmounts });
}
