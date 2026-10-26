"use client";

import { useState, useMemo, useCallback } from "react";
import {
  format,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfYear, endOfYear,
  subWeeks, subMonths, subDays, subYears,
  parseISO,
} from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from "recharts";
import {
  Download, Filter, ChevronDown, ChevronRight, Search, Calendar,
  Bookmark, Trash2, Plus, DollarSign, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSummaryReport,
  useDetailedReport,
  useWeeklyReport,
  useSharedReports,
  useCreateSharedReport,
  useDeleteSharedReport,
  useSavedReports,
  useCreateSavedReport,
  useUpdateSavedReport,
  useDeleteSavedReport,
} from "@/lib/api/hooks/reports";
import type { SavedReportDto, SharedReportResponse } from "@/lib/api/types";
import { useProjects } from "@/lib/api/hooks/projects";
import { useClients } from "@/lib/api/hooks/clients";
import { useProjectTasks } from "@/lib/api/hooks/tasks";
import { useCurrentUserProfile } from "@/lib/api/hooks/account";
import { NameInput, SharedReportsControl } from "@/components/reports/shared-reports-control";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ApiError, getApiErrorMessage } from "@/lib/api/client";
import { toast } from "sonner";

import { roundUpToTenMin } from "@/lib/reports/rounding";
import { csvCell } from "@/lib/format";
import {
  type ChartGranularity,
  CHART_GRANULARITIES,
  DEFAULT_CHART_GRANULARITY,
  granularityBucketKey,
  granularityBucketLabel,
  granularityChartTitle,
  toChartGranularity,
} from "@/lib/reports/granularity";
// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRANULARITY_LABELS: Record<ChartGranularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function fmtMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Renders an entry description, or a differentiated placeholder when it is
 * missing. Treats null, empty, and whitespace-only strings as "no description"
 * so entries saved without a description (e.g. created in the timesheet) still
 * render visibly instead of as an empty row.
 */
function DescriptionText({ value }: { value: string | null | undefined }) {
  const trimmed = value?.trim();
  if (trimmed) return <>{trimmed}</>;
  return <em className="text-muted-foreground/50">No description</em>;
}


function showMutationErrorToast(title: string, error: unknown, fallback: string) {
  toast.error(title, {
    description: getApiErrorMessage(error, fallback),
  });
}

type DatePreset =
  | "this-week" | "last-week"
  | "this-month" | "last-month"
  | "this-year" | "last-year"
  | "last-90-days"
  | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  "this-week":    "This week",
  "last-week":    "Last week",
  "this-month":   "This month",
  "last-month":   "Last month",
  "this-year":    "This year",
  "last-year":    "Last year",
  "last-90-days": "Last 90 days",
  "custom":       "Custom range",
};

function presetDates(preset: DatePreset): { from: string; to: string } | null {
  const now = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "this-week":
      return { from: fmt(startOfWeek(now, { weekStartsOn: 1 })), to: fmt(endOfWeek(now, { weekStartsOn: 1 })) };
    case "last-week": {
      const prev = subWeeks(now, 1);
      return { from: fmt(startOfWeek(prev, { weekStartsOn: 1 })), to: fmt(endOfWeek(prev, { weekStartsOn: 1 })) };
    }
    case "this-month":
      return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    case "last-month": {
      const prev = subMonths(now, 1);
      return { from: fmt(startOfMonth(prev)), to: fmt(endOfMonth(prev)) };
    }
    case "this-year":
      return { from: fmt(startOfYear(now)), to: fmt(endOfYear(now)) };
    case "last-year": {
      const prev = subYears(now, 1);
      return { from: fmt(startOfYear(prev)), to: fmt(endOfYear(prev)) };
    }
    case "last-90-days":
      return { from: fmt(subDays(now, 90)), to: fmt(now) };
    default:
      return null;
  }
}

function ymToDisplay(ym: string): string {
  return format(parseISO(ym + "-01"), "MMMM yyyy");
}

const CHART_COLORS = [
  "#10b981", "#6366f1", "#f59e0b", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];

// ─── Filter state ─────────────────────────────────────────────────────────────

interface FilterState {
  from: string | null;
  to: string | null;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  billable: boolean | null;
  preset: DatePreset;
  descriptionSearch: string;
  showAmounts: boolean;
  roundUp: boolean;
  chartGranularity: ChartGranularity;
}

// ─── Date range picker ────────────────────────────────────────────────────────

function DateRangePicker({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const [open, setOpen] = useState(false);

  const handlePreset = (preset: DatePreset) => {
    const dates = presetDates(preset);
    onChange({ ...filters, preset, from: dates?.from ?? filters.from, to: dates?.to ?? filters.to });
    if (preset !== "custom") setOpen(false);
  };

  const label =
    filters.preset === "custom"
      ? filters.from && filters.to
        ? `${filters.from} – ${filters.to}`
        : "Custom range"
      : PRESET_LABELS[filters.preset];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
      >
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-xl border bg-popover p-3 shadow-lg">
            <div className="grid grid-cols-2 gap-1 mb-3">
              {(Object.keys(PRESET_LABELS) as DatePreset[])
                .filter((p) => p !== "custom")
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePreset(p)}
                    className={`rounded-md px-3 py-2 text-xs font-medium text-left transition-colors ${
                      filters.preset === p
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                ))}
            </div>

            <div className="border-t pt-3 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Custom range
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">From</p>
                  <input
                    type="date"
                    value={filters.from ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, preset: "custom", from: e.target.value || null })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">To</p>
                  <input
                    type="date"
                    value={filters.to ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, preset: "custom", to: e.target.value || null })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              {filters.from && filters.to && filters.preset === "custom" && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Apply range
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  canViewAmounts,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  canViewAmounts: boolean;
}) {
  const { data: projects } = useProjects();
  const { data: clients } = useClients();
  const { data: tasks } = useProjectTasks(filters.projectId ?? "");

  const hasActiveFilters =
    filters.projectId || filters.clientId || filters.taskId ||
    filters.billable !== null || filters.descriptionSearch;
  const selectedClientName = filters.clientId
    ? (clients?.find((client) => client.id === filters.clientId)?.name ?? filters.clientId)
    : undefined;
  const selectedProjectName = filters.projectId
    ? (projects?.find((project) => project.id === filters.projectId)?.name ?? filters.projectId)
    : undefined;
  const selectedTaskName = filters.taskId
    ? (tasks?.find((task) => task.id === filters.taskId)?.name ?? filters.taskId)
    : undefined;
  const billableLabel =
    filters.billable === true ? "Billable only"
    : filters.billable === false ? "Non-billable only"
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Client */}
      {clients && clients.length > 0 && (
        <Select
          value={filters.clientId ?? ""}
          onValueChange={(value) => onChange({ ...filters, clientId: value || null })}
        >
          <SelectTrigger className="w-37.5 text-xs">
            <SelectValue placeholder="All clients">
              {selectedClientName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All clients</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}

      {/* Project */}
      {projects && projects.length > 0 && (
        <Select
          value={filters.projectId ?? ""}
          onValueChange={(value) =>
            onChange({ ...filters, projectId: value || null, taskId: null })
          }
        >
          <SelectTrigger className="w-40 text-xs">
            <SelectValue placeholder="All projects">
              {selectedProjectName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}

      {/* Task — only when a project is selected */}
      {filters.projectId && tasks && tasks.length > 0 && (
        <Select
          value={filters.taskId ?? ""}
          onValueChange={(value) => onChange({ ...filters, taskId: value || null })}
        >
          <SelectTrigger className="w-37.5 text-xs">
            <SelectValue placeholder="All tasks">
              {selectedTaskName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All tasks</SelectItem>
          {tasks.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}

      {/* Description search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search description…"
          value={filters.descriptionSearch}
          onChange={(e) => onChange({ ...filters, descriptionSearch: e.target.value })}
          className="h-8 w-44 rounded-md border border-input bg-background pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Billable */}
      <Select
        value={
          filters.billable === true ? "true" : filters.billable === false ? "false" : ""
        }
        onValueChange={(value) =>
          onChange({
            ...filters,
            billable:
              value === "true" ? true
              : value === "false" ? false
              : null,
          })
        }
      >
        <SelectTrigger className="w-37.5 text-xs">
          <SelectValue placeholder="All entries">
            {billableLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All entries</SelectItem>
          <SelectItem value="true">Billable only</SelectItem>
          <SelectItem value="false">Non-billable only</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...filters,
              projectId: null,
              clientId: null,
              taskId: null,
              billable: null,
              descriptionSearch: "",
            })
          }
          className="flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Filter className="h-3 w-3" />
          Clear
        </button>
      )}

      {/* Display options separator */}
      <div className="h-5 w-px bg-border/60 mx-0.5" />

      {/* Show amounts toggle — hidden when user lacks canViewAmounts permission */}
      {canViewAmounts && (
        <button
          type="button"
          onClick={() => onChange({ ...filters, showAmounts: !filters.showAmounts })}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
            filters.showAmounts
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          title="Show monetary amounts"
        >
          <DollarSign className="h-3 w-3" />
          Amounts
        </button>
      )}

      {/* Round up toggle */}
      <button
        type="button"
        onClick={() => onChange({ ...filters, roundUp: !filters.roundUp })}
        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
          filters.roundUp
            ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
        title="Round all durations up to nearest 10 minutes"
      >
        <Clock className="h-3 w-3" />
        Round up
      </button>
    </div>
  );
}

// ─── Summary tab ──────────────────────────────────────────────────────────────

function SummaryTab({
  filters,
  onFiltersChange,
}: {
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
}) {
  // KPI totals
  const { data: summaryData, isLoading: summaryLoading } = useSummaryReport({
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    projectId: filters.projectId ?? undefined,
    clientId: filters.clientId ?? undefined,
    taskId: filters.taskId ?? undefined,
    billable: filters.billable ?? undefined,
    description: filters.descriptionSearch || undefined,
    groupBy: "Project",
  });

  // All entries for hierarchical table
  const { data: detailedData, isLoading: detailedLoading } = useDetailedReport({
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    projectId: filters.projectId ?? undefined,
    clientId: filters.clientId ?? undefined,
    taskId: filters.taskId ?? undefined,
    billable: filters.billable ?? undefined,
    description: filters.descriptionSearch || undefined,
    page: 1,
    pageSize: 500,
  });

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const showAmounts = filters.showAmounts;
  const roundUp = filters.roundUp;

  const filteredEntries = useMemo(() => detailedData?.entries ?? [], [detailedData?.entries]);

  // Apply rounding when enabled (display-only; does not affect stored data).
  // Billed amounts are scaled proportionally to the rounded duration.
  const displayEntries = useMemo(
    () =>
      roundUp
        ? filteredEntries.map((e) => {
            if (e.durationDecimal == null || e.durationDecimal === 0) return e;
            const rounded = roundUpToTenMin(e.durationDecimal);
            return {
              ...e,
              durationDecimal: rounded,
              billedAmount:
                e.billedAmount != null
                  ? (e.billedAmount / e.durationDecimal) * rounded
                  : null,
            };
          })
        : filteredEntries,
    [filteredEntries, roundUp]
  );

  // Group: yearMonth → entryDate → entries[]
  const grouped = useMemo(() => {
    const months = new Map<string, Map<string, typeof displayEntries>>();
    for (const entry of displayEntries) {
      const ym = entry.entryDate.slice(0, 7);
      if (!months.has(ym)) months.set(ym, new Map());
      const dates = months.get(ym)!;
      if (!dates.has(entry.entryDate)) dates.set(entry.entryDate, []);
      dates.get(entry.entryDate)!.push(entry);
    }
    // Sort months descending (most recent first)
    return new Map([...months.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  }, [displayEntries]);

  // Donut distribution data — always grouped by month (ascending for display)
  const chartData = useMemo(
    () =>
      [...grouped.entries()]
        .map(([ym, dates]) => {
          const allEntries = [...dates.values()].flat();
          return {
            month: format(parseISO(ym + "-01"), "MMM yy"),
            hours: Number(allEntries.reduce((s, e) => s + (e.durationDecimal ?? 0), 0).toFixed(2)),
            billedAmount: allEntries.reduce((s, e) => s + (e.billedAmount ?? 0), 0),
          };
        })
        .reverse(),
    [grouped]
  );

  // Bar chart data — bucketed by the selected granularity (Day/Month/Year),
  // sorted ascending so the timeline reads left-to-right.
  const chartGranularity = filters.chartGranularity;
  const barChartData = useMemo(() => {
    const buckets = new Map<string, { hours: number; billedAmount: number }>();
    for (const entry of displayEntries) {
      const key = granularityBucketKey(entry.entryDate, chartGranularity);
      const acc = buckets.get(key) ?? { hours: 0, billedAmount: 0 };
      acc.hours += entry.durationDecimal ?? 0;
      acc.billedAmount += entry.billedAmount ?? 0;
      buckets.set(key, acc);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({
        label: granularityBucketLabel(key, chartGranularity),
        hours: Number(value.hours.toFixed(2)),
        billedAmount: value.billedAmount,
      }));
  }, [displayEntries, chartGranularity]);

   // KPI totals: derive from displayEntries when Roundup is active so that
   // every number on the page — cards, charts, grid — reflects the same values.
  const roundedTotals = useMemo(() => {
    if (!roundUp) return summaryData ?? null;
    const totalHours = displayEntries.reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
    const billableHours = displayEntries
       .filter((e) => e.isBillable)
       .reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
    const totalBilledAmount = displayEntries.reduce((s, e) => s + (e.billedAmount ?? 0), 0);
    return {
      ...summaryData!,
      totalHours: Number(totalHours.toFixed(2)),
      billableHours: Number(billableHours.toFixed(2)),
      totalBilledAmount: summaryData && filters.showAmounts ? Number(totalBilledAmount.toFixed(2)) : null,
     };
   }, [displayEntries, roundUp, summaryData, filters.showAmounts]);

  const toggleMonth = (ym: string) =>
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) {
        next.delete(ym);
      } else {
        next.add(ym);
      }
      return next;
    });

  const toggleDate = (date: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });

  const handleExportCsv = () => {
    if (!displayEntries.length) return;
    const header = "Month,Date,Project,Client,Task,Description,Hours,Billable,Amount\n";
    const rows = displayEntries
      .map(
        (e) =>
          `"${e.entryDate.slice(0, 7)}","${e.entryDate}",${csvCell(e.projectName)},${csvCell(e.clientName)},${csvCell(e.taskName)},${csvCell(e.description)},${e.durationDecimal?.toFixed(2) ?? ""},${e.isBillable},${e.billedAmount != null ? e.billedAmount.toFixed(2) : ""}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "summary-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (summaryLoading || detailedLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["Total Hours", "Billable Hours", "Billed Amount", "Total Entries"] as const).map((label) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <Skeleton className="mt-2 h-8 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-52 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className={`grid grid-cols-2 gap-3 ${filters.showAmounts ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Hours</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {roundedTotals ? fmtHours(roundedTotals.totalHours) : "—"}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Billable Hours</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-500">
            {roundedTotals ? fmtHours(roundedTotals.billableHours) : "—"}
          </p>
        </div>
        {filters.showAmounts && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Billed Amount</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-500">
              {roundedTotals ? fmtMoney(roundedTotals.totalBilledAmount ?? 0) : "—"}
            </p>
          </div>
        )}
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Entries</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {summaryData?.totalEntries ?? "—"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!displayEntries.length}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {grouped.size === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">No data for the selected period and filters.</p>
        </div>
      ) : (
        <>
          {/* Hours per period bar chart — granularity selectable */}
          {barChartData.length >= 1 && (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {granularityChartTitle(chartGranularity)}
                </p>
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {CHART_GRANULARITIES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onFiltersChange({ ...filters, chartGranularity: g })}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        chartGranularity === g
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {GRANULARITY_LABELS[g]}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barChartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v, _name, props) => {
                      const entry = props?.payload as (typeof barChartData)[0] | undefined;
                      const label =
                        showAmounts && entry?.billedAmount != null && entry.billedAmount > 0
                          ? `${fmtHours(Number(v))} (${fmtMoney(entry.billedAmount)})`
                          : fmtHours(Number(v));
                      return [label, "Hours"];
                    }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {barChartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Grid + Donut side-by-side */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Hierarchical table: Month → Date → Entries */}
            <div className="flex-1 min-w-0 overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Period
              </span>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Duration
                </span>
                {showAmounts && (
                  <span className="w-20 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Amount
                  </span>
                )}
              </div>
            </div>

            <div className="divide-y">
              {[...grouped.entries()].map(([ym, dateMap]) => {
                const allMonthEntries = [...dateMap.values()].flat();
                const monthTotal = allMonthEntries.reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
                const monthBilled = allMonthEntries.reduce((s, e) => s + (e.billedAmount ?? 0), 0);
                const monthExpanded = expandedMonths.has(ym);
                const dateEntries = [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

                return (
                  <div key={ym}>
                    {/* Month row */}
                    <button
                      type="button"
                      onClick={() => toggleMonth(ym)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {monthExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                        <span className="text-sm font-semibold">{ymToDisplay(ym)}</span>
                        <span className="text-xs text-muted-foreground">
                          ({allMonthEntries.length} entries)
                        </span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-sm font-bold tabular-nums">{fmtHours(monthTotal)}</span>
                        {showAmounts && (
                          <span className="w-20 text-right text-sm font-bold tabular-nums text-emerald-500">
                            {monthBilled > 0 ? fmtMoney(monthBilled) : <span className="text-muted-foreground">—</span>}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Date rows */}
                    {monthExpanded && dateEntries.map(([date, entries]) => {
                      const dateTotal = entries.reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
                      const dateBilled = entries.reduce((s, e) => s + (e.billedAmount ?? 0), 0);
                      const dateExpanded = expandedDates.has(date);

                      return (
                        <div key={date} className="bg-muted/10">
                          <button
                            type="button"
                            onClick={() => toggleDate(date)}
                            className="flex w-full items-center justify-between px-4 py-2.5 pl-10 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {dateExpanded
                                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                              }
                              <span className="text-sm text-muted-foreground">
                                {format(parseISO(date), "EEEE, MMM d")}
                              </span>
                              <span className="text-xs text-muted-foreground/50">({entries.length})</span>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <span className="text-sm tabular-nums text-muted-foreground">
                                {fmtHours(dateTotal)}
                              </span>
                              {showAmounts && (
                                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
                                  {dateBilled > 0 ? (
                                    <span className="text-emerald-500">{fmtMoney(dateBilled)}</span>
                                  ) : "—"}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Entry rows */}
                          {dateExpanded && entries.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex flex-col gap-0.5 border-t border-border/20 px-4 py-2 pl-16 text-xs"
                            >
                              {/* Line 1: color dot + description + project + billable */}
                              <div className="flex min-w-0 items-center gap-2">
                                {entry.projectColor && (
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: entry.projectColor }}
                                  />
                                )}
                                <span className="truncate text-foreground">
                                  <DescriptionText value={entry.description} />
                                </span>
                                {entry.projectName && (
                                  <span className="shrink-0 text-muted-foreground/60">
                                    · {entry.projectName}
                                    {entry.taskName ? ` / ${entry.taskName}` : ""}
                                  </span>
                                )}
                                {entry.isBillable && (
                                  <span className="shrink-0 font-bold text-emerald-500">$</span>
                                )}
                              </div>
                              {/* Line 2: duration + amount */}
                              <div className="flex items-center gap-4 pl-4 shrink-0">
                                <span className="tabular-nums text-muted-foreground">
                                  {fmtHours(entry.durationDecimal ?? 0)}
                                </span>
                                {showAmounts && (
                                  <span className="tabular-nums">
                                    {entry.billedAmount != null && entry.billedAmount > 0 ? (
                                      <span className="text-emerald-500">{fmtMoney(entry.billedAmount)}</span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

            {/* Donut distribution chart */}
            <div className="w-full lg:w-56 lg:shrink-0 rounded-lg border bg-card p-4 flex flex-col items-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground self-start">
                Distribution
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="hours"
                    nameKey="month"
                    cx="50%"
                    cy="50%"
                    innerRadius="29%"
                    outerRadius="44%"
                    paddingAngle={2}
                  >
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, _name, props) => {
                      const entry = props?.payload as (typeof chartData)[0] | undefined;
                      const label =
                        showAmounts && entry?.billedAmount != null && entry.billedAmount > 0
                          ? `${fmtHours(Number(v))} (${fmtMoney(entry.billedAmount)})`
                          : fmtHours(Number(v));
                      return [label, "Hours"];
                    }}
                    contentStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 w-full grid grid-cols-2 gap-x-4 gap-y-1 lg:grid-cols-1">
                {chartData.map((item, i) => (
                  <div key={item.month} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground">{item.month}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="tabular-nums font-medium">{fmtHours(item.hours)}</span>
                      {showAmounts && item.billedAmount > 0 && (
                        <span className="tabular-nums text-emerald-500">{fmtMoney(item.billedAmount)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Detailed tab ─────────────────────────────────────────────────────────────

function DetailedTab({ filters }: { filters: FilterState }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDetailedReport({
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    projectId: filters.projectId ?? undefined,
    clientId: filters.clientId ?? undefined,
    taskId: filters.taskId ?? undefined,
    billable: filters.billable ?? undefined,
    description: filters.descriptionSearch || undefined,
    page,
    pageSize: 50,
  });

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const roundUp = filters.roundUp;

  const displayEntries = useMemo(
    () => roundUp ? entries.map((e) => {
      if (e.durationDecimal == null || e.durationDecimal === 0) return e;
      const rounded = roundUpToTenMin(e.durationDecimal);
      return { ...e, durationDecimal: rounded, billedAmount: e.billedAmount != null ? (e.billedAmount / e.durationDecimal) * rounded : null };
     }) : entries,
     [entries, roundUp],
   );

  const totals = useMemo(() => {
    if (!roundUp) return data!;
    const totalHours = displayEntries.reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
    const billableHours = displayEntries.filter((e) => e.isBillable).reduce((s, e) => s + (e.durationDecimal ?? 0), 0);
    const totalBilledAmount = displayEntries.reduce((s, e) => s + (e.billedAmount ?? 0), 0);
    return {
       ...data!,
      totalHours: Number(totalHours.toFixed(2)),
      billableHours: Number(billableHours.toFixed(2)),
      totalBilledAmount: data && filters.showAmounts ? Number(totalBilledAmount.toFixed(2)) : (data?.totalBilledAmount ?? null),
     };
   }, [displayEntries, roundUp, data, filters.showAmounts]);


  const handleExportCsv = () => {
    if (!displayEntries.length) return;
    const header = "Date,Project,Client,Task,Description,Start,End,Hours,Billable,Amount\n";
    const rows = entries
      .map(
        (e) =>
          `"${e.entryDate}",${csvCell(e.projectName)},${csvCell(e.clientName)},${csvCell(e.taskName)},${csvCell(e.description)},"${e.startTime}","${e.endTime ?? ""}",${e.durationDecimal?.toFixed(2) ?? ""},${e.isBillable},${e.billedAmount != null ? e.billedAmount.toFixed(2) : ""}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "detailed-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <div className="rounded-lg border bg-card px-4 py-2">
            <span className="text-xs text-muted-foreground">Total </span>
            <span className="font-bold tabular-nums">{fmtHours(totals.totalHours)}</span>
          </div>
          <div className="rounded-lg border bg-card px-4 py-2">
            <span className="text-xs text-muted-foreground">Billable </span>
            <span className="font-bold tabular-nums text-emerald-500">{fmtHours(totals.billableHours)}</span>
          </div>
          <div className="rounded-lg border bg-card px-4 py-2">
            <span className="text-xs text-muted-foreground">Billed </span>
            <span className="font-bold tabular-nums text-emerald-500">{fmtMoney(totals.totalBilledAmount ?? 0)}</span>
          </div>
          <div className="rounded-lg border bg-card px-4 py-2">
            <span className="text-xs text-muted-foreground">Entries </span>
            <span className="font-bold tabular-nums">{data.totalEntries}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!displayEntries.length}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {displayEntries.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">No entries for the selected period and filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Project</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {entry.entryDate}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {entry.projectColor && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: entry.projectColor }}
                          />
                        )}
                        <span className="max-w-36 truncate">
                          {entry.projectName ?? <span className="text-muted-foreground">—</span>}
                        </span>
                        {entry.taskName && (
                          <span className="truncate text-xs text-muted-foreground">· {entry.taskName}</span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-2.5 text-muted-foreground">
                      <span className="block truncate">
                        <DescriptionText value={entry.description} />
                      </span>
                      {entry.tagNames.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {entry.tagNames.map((tag) => (
                            <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                      {fmtHours(entry.durationDecimal ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                      {entry.billedAmount != null && entry.billedAmount > 0 ? (
                        <span className="text-emerald-500">{fmtMoney(entry.billedAmount)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {data.page} of {data.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Weekly tab ───────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeeklyTab({ filters }: { filters: FilterState }) {
  const { data, isLoading } = useWeeklyReport({
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    projectId: filters.projectId ?? undefined,
    clientId: filters.clientId ?? undefined,
    billable: filters.billable ?? undefined,
  });

  const roundUp = filters.roundUp;

  const displayWeeks = useMemo(() => {
    if (!data) return [];
    return data.weeks.map((w) => {
      if (!roundUp) return w;
      const roundedDayTotals = w.dayTotals.map((d) => (d > 0 ? roundUpToTenMin(d) : 0));
      const weekTotal = roundedDayTotals.reduce((s, h) => s + h, 0);
      return { ...w, dayTotals: roundedDayTotals, weekTotal: Number(weekTotal.toFixed(2)) };
    });
  }, [data, roundUp]);

  const displayGrandTotal = useMemo(() => {
    if (!roundUp) return data?.grandTotal ?? 0;
    return Number(displayWeeks.reduce((s, w) => s + w.weekTotal, 0).toFixed(2));
  }, [displayWeeks, roundUp, data]);

  const handleExportCsv = () => {
    if (!data) return;
    const header = `Week,${DAY_LABELS.join(",")},Total\n`;
    const rows = displayWeeks
      .map(
        (w) =>
          `"${w.weekStart}–${w.weekEnd}",${w.dayTotals.map((d) => d.toFixed(2)).join(",")},${w.weekTotal.toFixed(2)}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "weekly-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!data) return null;

  const chartData = displayWeeks.map((w) => ({
    week: format(new Date(w.weekStart + "T00:00:00"), "MMM d"),
    hours: Number(w.weekTotal.toFixed(2)),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="rounded-lg border bg-card px-4 py-2">
          <span className="text-xs text-muted-foreground">Grand Total </span>
          <span className="font-bold tabular-nums">{fmtHours(displayGrandTotal)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!displayWeeks.length}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {displayWeeks.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">No data for the selected period and filters.</p>
        </div>
      ) : (
        <>
          {chartData.length > 1 && (
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Hours per Week
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [fmtHours(Number(v)), "Hours"]} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="hours" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground">Week</th>
                  {DAY_LABELS.map((d) => (
                    <th key={d} className="px-3 py-2.5 text-right font-medium text-muted-foreground">{d}</th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayWeeks.map((week) => (
                  <tr key={week.weekStart} className="hover:bg-muted/30 transition-colors">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {week.weekStart}
                    </td>
                    {week.dayTotals.map((h, i) => (
                      <td
                        key={i}
                        className={`px-3 py-2.5 text-right text-xs tabular-nums ${h > 0 ? "font-medium" : "text-muted-foreground"}`}
                      >
                        {h > 0 ? fmtHours(h) : "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtHours(week.weekTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30">
                <tr>
                  <td className="px-4 py-2.5 text-xs font-medium">Grand Total</td>
                  {DAY_LABELS.map((_, i) => (
                    <td key={i} className="px-3 py-2.5 text-right text-xs font-medium tabular-nums">
                      {fmtHours(displayWeeks.reduce((sum, w) => sum + (w.dayTotals[i] ?? 0), 0))}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-emerald-500">
                    {fmtHours(displayGrandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


// ─── Saved views ──────────────────────────────────────────────────────────────

const FILTERS_KEY = "reports_filters";

function SavedReportsControl({
  savedReports,
  activeReportId,
  isDirty,
  onLoad,
  onSaveNew,
  onSaveAsNew,
  onUpdate,
  onDelete,
  onRevert,
}: {
  savedReports: SavedReportDto[];
  activeReportId: string | null;
  isDirty: boolean;
  onLoad: (id: string | null) => void;
  onSaveNew: (name: string) => void;
  onSaveAsNew: (name: string) => void;
  onUpdate: () => void;
  onDelete: (id: string) => void;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  // "new" = save current as new view; "as-new" = fork dirty loaded view
  const [inputMode, setInputMode] = useState<"new" | "as-new" | null>(null);

  const active = savedReports.find((r) => r.id === activeReportId) ?? null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Dropdown listing saved views */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-40 truncate">
            {active ? active.name : "Saved views"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-xl border bg-popover p-1.5 shadow-lg">
              {savedReports.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No saved views yet.</p>
              ) : (
                savedReports.map((r) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${
                      r.id === activeReportId ? "bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left text-sm truncate"
                      onClick={() => { onLoad(r.id); setOpen(false); setInputMode(null); }}
                    >
                      {r.name}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
                      className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete view"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Active + dirty: unsaved changes with Save / Save as new / Undo */}
      {active && isDirty && (
        inputMode === "as-new" ? (
          <NameInput
            onConfirm={(n) => { onSaveAsNew(n); setInputMode(null); }}
            onCancel={() => setInputMode(null)}
          />
        ) : (
          <>
            <span className="text-xs font-medium text-amber-500">Unsaved changes</span>
            <Button size="sm" variant="outline" onClick={onUpdate} className="h-7 px-2.5 text-xs">Save</Button>
            <Button size="sm" variant="outline" onClick={() => setInputMode("as-new")} className="h-7 px-2.5 text-xs gap-1">
              <Plus className="h-3 w-3" />
              Save as new
            </Button>
            <Button size="sm" variant="ghost" onClick={onRevert} className="h-7 px-2.5 text-xs">Undo</Button>
          </>
        )
      )}

      {/* No active report: save current view */}
      {!active && (
        inputMode === "new" ? (
          <NameInput
            onConfirm={(n) => { onSaveNew(n); setInputMode(null); }}
            onCancel={() => setInputMode(null)}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setInputMode("new")} className="h-7 px-2.5 text-xs gap-1">
            <Plus className="h-3 w-3" />
            Save view
          </Button>
        )
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function defaultFilters(): FilterState {
  const dates = presetDates("this-month");
  return {
    from: dates?.from ?? null,
    to: dates?.to ?? null,
    projectId: null,
    clientId: null,
    taskId: null,
    billable: null,
    preset: "this-month",
    descriptionSearch: "",
    showAmounts: false,
    roundUp: false,
    chartGranularity: DEFAULT_CHART_GRANULARITY,
  };
}

function loadInitialFilters(): FilterState {
  const fallback = defaultFilters();

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as FilterState) } : fallback;
  } catch {
    return fallback;
  }
}

function filtersToApiBody(filters: FilterState, reportType: string) {
  return {
    reportType,
    from: filters.from ?? null,
    to: filters.to ?? null,
    projectId: filters.projectId ?? null,
    clientId: filters.clientId ?? null,
    taskId: filters.taskId ?? null,
    billable: filters.billable ?? null,
    description: filters.descriptionSearch || null,
    groupBy: "project" as const,
    preset: filters.preset,
    showAmounts: filters.showAmounts,
    roundUp: filters.roundUp,
    chartGranularity: filters.chartGranularity,
  };
}

function savedReportToFilters(r: SavedReportDto): FilterState {
  const preset = (r.preset as DatePreset | null) ?? "custom";
  const dates = preset !== "custom" ? presetDates(preset) : null;
  return {
    from: dates?.from ?? r.from ?? null,
    to: dates?.to ?? r.to ?? null,
    projectId: r.projectId ?? null,
    clientId: r.clientId ?? null,
    taskId: r.taskId ?? null,
    billable: r.billable ?? null,
    preset,
    descriptionSearch: r.description ?? "",
    showAmounts: false,
    roundUp: r.roundUp ?? false,
    chartGranularity: toChartGranularity(r.chartGranularity),
  };
}

function getActiveReportType(activeTab: "summary" | "detailed" | "weekly") {
  if (activeTab === "weekly") return "Weekly";
  if (activeTab === "detailed") return "Detailed";
  return "Summary";
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<"summary" | "detailed" | "weekly">("summary");

  const { data: profile } = useCurrentUserProfile();
  const canViewAmounts = profile?.canViewAmounts ?? true;

  const [filters, setFilters] = useState<FilterState>(loadInitialFilters);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [baseFilters, setBaseFilters] = useState<FilterState | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  // Name of a share pending overwrite confirmation (set when POST returns 409).
  const [overwriteShareName, setOverwriteShareName] = useState<string | null>(null);

  const { data: sharedReports = [] } = useSharedReports();
  const createShare = useCreateSharedReport();
  const deleteShare = useDeleteSharedReport();
  const { data: savedReports = [] } = useSavedReports();
  const createSaved = useCreateSavedReport();
  const updateSaved = useUpdateSavedReport();
  const deleteSaved = useDeleteSavedReport();

  const isDirty = useMemo(
    () => activeReportId !== null && baseFilters !== null && JSON.stringify(filters) !== JSON.stringify(baseFilters),
    [activeReportId, baseFilters, filters],
  );

  const handleFiltersChange = useCallback((f: FilterState) => {
    setFilters(f);
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  }, []);

  const handleLoadReport = useCallback((id: string | null) => {
    if (id === null) { setActiveReportId(null); setBaseFilters(null); return; }
    const report = savedReports.find((r) => r.id === id);
    if (!report) return;
    const f = savedReportToFilters(report);
    setActiveReportId(id);
    setBaseFilters(f);
    setFilters(f);
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  }, [savedReports]);

  const handleSaveNew = useCallback((name: string) => {
    createSaved.mutate(
      { name, ...filtersToApiBody(filters, getActiveReportType(activeTab)) },
      {
        onSuccess: (r) => {
          setActiveReportId(r.id);
          setBaseFilters(filters);
          toast.success("Saved view created.", {
            description: `${r.name} is now available in Saved views.`,
          });
        },
        onError: (error) => {
          showMutationErrorToast("Could not save view.", error, "Failed to save report view.");
        },
      },
    );
  }, [filters, activeTab, createSaved]);

  const handleSaveAsNew = useCallback((name: string) => {
    createSaved.mutate(
      { name, ...filtersToApiBody(filters, getActiveReportType(activeTab)) },
      {
        onSuccess: (r) => {
          setActiveReportId(r.id);
          setBaseFilters(filters);
          toast.success("Saved as new view.", {
            description: `${r.name} was created from the current filters.`,
          });
        },
        onError: (error) => {
          showMutationErrorToast("Could not save as new view.", error, "Failed to create a new saved view.");
        },
      },
    );
  }, [filters, activeTab, createSaved]);

  const handleUpdateReport = useCallback(() => {
    if (!activeReportId) return;
    const active = savedReports.find((r) => r.id === activeReportId);
    if (!active) return;
    updateSaved.mutate(
      { id: activeReportId, name: active.name, ...filtersToApiBody(filters, active.reportType) },
      {
        onSuccess: () => {
          setBaseFilters(filters);
          toast.success("Saved view updated.");
        },
        onError: (error) => {
          showMutationErrorToast("Could not update saved view.", error, "Failed to update the saved view.");
        },
      },
    );
  }, [activeReportId, filters, savedReports, updateSaved]);

  const handleDeleteReport = useCallback((id: string) => {
    deleteSaved.mutate(id, {
      onSuccess: () => {
        if (activeReportId === id) {
          setActiveReportId(null);
          setBaseFilters(null);
        }

        toast.success("Saved view deleted.");
      },
      onError: (error) => {
        showMutationErrorToast("Could not delete saved view.", error, "Failed to delete the saved view.");
      },
    });
  }, [activeReportId, deleteSaved]);

  const handleRevertReport = useCallback(() => {
    if (!baseFilters) return;
    setFilters(baseFilters);
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(baseFilters)); } catch { /* ignore */ }
  }, [baseFilters]);

  const submitShare = useCallback((name: string, overwrite: boolean) => {
    createShare.mutate(
      { name, overwrite, ...filtersToApiBody(filters, getActiveReportType(activeTab)) },
      {
        onSuccess: async (share) => {
          setOverwriteShareName(null);
          const url = `${window.location.origin}/shared/${share.token}`;
          setShareUrl(url);
          const copied = navigator.clipboard?.writeText
            ? await navigator.clipboard.writeText(url).then(() => true).catch(() => false)
            : false;

          toast.success(overwrite ? "Shared report updated." : "Shared report created.", {
            description: copied
              ? `${share.name} was copied to your clipboard.`
              : `${share.name} is ready to copy from the page.`,
          });
        },
        onError: (error) => {
          // A 409 means a share with this name already exists — ask to overwrite
          // rather than surfacing it as a hard error.
          if (error instanceof ApiError && error.status === 409) {
            setOverwriteShareName(name);
            return;
          }
          setOverwriteShareName(null);
          showMutationErrorToast("Could not create shared report.", error, "Failed to create shared report.");
        },
      },
    );
  }, [activeTab, createShare, filters]);

  const handleCreateShare = useCallback((name: string) => {
    submitShare(name, false);
  }, [submitShare]);

  const handleCopyShare = useCallback(async (share: SharedReportResponse) => {
    const url = `${window.location.origin}/shared/${share.token}`;
    setShareUrl(url);
    const copied = navigator.clipboard?.writeText
      ? await navigator.clipboard.writeText(url).then(() => true).catch(() => false)
      : false;

    if (copied) {
      toast.success("Share link copied.", {
        description: `${share.name} is now on your clipboard.`,
      });
      return;
    }

    toast.success("Share link ready.", {
      description: `${share.name} could not be copied automatically, but the link is shown on the page.`,
    });
  }, []);

  const handleDeleteShare = useCallback((share: SharedReportResponse) => {
    deleteShare.mutate(share.id, {
      onSuccess: () => {
        toast.success("Shared report deleted.", {
          description: `${share.name} is no longer available.`,
        });
      },
      onError: (error) => {
        showMutationErrorToast("Could not delete shared report.", error, "Failed to delete shared report.");
      },
    });
  }, [deleteShare]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Analyze your time data with filters and charts.</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="space-y-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="detailed">Detailed</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 flex-wrap">
            <SharedReportsControl
              sharedReports={sharedReports}
              latestShareUrl={shareUrl}
              onCreate={handleCreateShare}
              onCopy={handleCopyShare}
              onDelete={handleDeleteShare}
              isCreating={createShare.isPending}
              deletingShareId={deleteShare.variables}
            />
            <SavedReportsControl
              savedReports={savedReports}
              activeReportId={activeReportId}
              isDirty={isDirty}
              onLoad={handleLoadReport}
              onSaveNew={handleSaveNew}
              onSaveAsNew={handleSaveAsNew}
              onUpdate={handleUpdateReport}
              onDelete={handleDeleteReport}
              onRevert={handleRevertReport}
            />
            <DateRangePicker filters={filters} onChange={handleFiltersChange} />
          </div>
        </div>

        <FilterBar filters={filters} onChange={handleFiltersChange} canViewAmounts={canViewAmounts} />

        <TabsContent value="summary">
          <SummaryTab filters={filters} onFiltersChange={handleFiltersChange} />
        </TabsContent>
        <TabsContent value="detailed">
          <DetailedTab filters={filters} />
        </TabsContent>
        <TabsContent value="weekly">
          <WeeklyTab filters={filters} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={overwriteShareName !== null}
        onOpenChange={(open) => { if (!open) setOverwriteShareName(null); }}
        title="Overwrite shared report?"
        description={`A shared report named “${overwriteShareName ?? ""}” already exists. Overwriting replaces its filters and report type while keeping the same link.`}
        confirmLabel="Overwrite"
        loading={createShare.isPending}
        onConfirm={() => { if (overwriteShareName) submitShare(overwriteShareName, true); }}
      />
    </div>
  );
}
