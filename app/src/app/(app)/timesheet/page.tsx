"use client";

import { useState, useMemo } from "react";
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  addHours,
} from "date-fns";
import { ChevronLeft, ChevronRight, MoreVertical, Plus, Clock } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useTimeEntries,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
} from "@/lib/api/hooks/time-entries";
import { useProjects } from "@/lib/api/hooks/projects";
import { useProjectTasks } from "@/lib/api/hooks/tasks";
import { apiFetch, getApiErrorMessage } from "@/lib/api/client";
import type { TimeEntry, Project, ProjectTask } from "@/lib/api/types";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decimalToHM(decimal: number): string {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return m > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${h}:00`;
}

function parseHoursInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return 0;

  // HH:MM format — e.g. "2:30"
  if (trimmed.includes(":")) {
    const [hStr, mStr] = trimmed.split(":");
    const h = parseInt(hStr || "0", 10);
    const m = parseInt(mStr || "0", 10);
    if (isNaN(h) || isNaN(m) || m >= 60) return null;
    const result = h + m / 60;
    return result > 24 ? null : result;
  }

  // Decimal format — e.g. "2.5"
  if (trimmed.includes(".")) {
    const n = parseFloat(trimmed);
    if (isNaN(n) || n < 0 || n > 24) return null;
    return n;
  }

  // Compact digit format — e.g. "2" → 2:00, "130" → 1:30, "200" → 2:00, "1500" → 15:00
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let hours: number;
  let minutes: number;
  if (digits.length <= 2) {
    hours = parseInt(digits, 10);
    minutes = 0;
  } else if (digits.length === 3) {
    hours = parseInt(digits[0], 10);
    minutes = parseInt(digits.slice(1), 10);
  } else {
    hours = parseInt(digits.slice(0, 2), 10);
    minutes = parseInt(digits.slice(2, 4), 10);
  }
  if (isNaN(hours) || isNaN(minutes) || minutes >= 60) return null;
  const result = hours + minutes / 60;
  return result > 24 ? null : result;
}

function formatTimeRange(entry: TimeEntry): string {
  if (!entry.endTime)
    return format(parseISO(entry.startTime), "HH:mm") + " – running";
  return `${format(parseISO(entry.startTime), "HH:mm")} – ${format(parseISO(entry.endTime), "HH:mm")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimesheetRow {
  rowKey: string;
  projectId: string | null;
  taskId: string | null;
  projectName: string;
  taskName: string | null;
  color: string;
  dayEntries: TimeEntry[][];
  dayTotals: number[];
  weekTotal: number;
}

interface EditingCell {
  rowKey: string;
  dayIdx: number;
  value: string;
}

// ─── Draft row ────────────────────────────────────────────────────────────────

function DraftRow({
  projects,
  onConfirm,
  onCancel,
}: {
  projects: Project[];
  onConfirm: (projectId: string | null, taskId: string | null) => void;
  onCancel: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data: tasks } = useProjectTasks(projectId ?? "");
  const activeTasks = tasks?.filter((t) => t.isActive) ?? [];

  return (
    <tr className="border-b bg-accent/20">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={projectId ?? ""}
            onValueChange={(v) => {
              setProjectId(v || null);
              setTaskId(null);
            }}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Select project…">
                {projectId ? (projects.find((p) => p.id === projectId)?.name ?? "Select project…") : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {projectId && activeTasks.length > 0 && (
            <Select
              value={taskId ?? ""}
              onValueChange={(v) => setTaskId(v || null)}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="No task">
                  {taskId ? (activeTasks.find((t) => t.id === taskId)?.name ?? "No task") : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No task</SelectItem>
                {activeTasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            className="h-8 text-xs px-3"
            onClick={() => onConfirm(projectId, taskId)}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs px-3"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </td>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-3 py-2 text-center text-muted-foreground/20">
          –
        </td>
      ))}
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TimesheetPage() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [showDraftRow, setShowDraftRow] = useState(false);
  const [addedRows, setAddedRows] = useState<
    Array<{ projectId: string | null; taskId: string | null }>
  >([]);
  const [defaultStartHour, setDefaultStartHour] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem("timesheetStartHour") ?? "9") || 9;
    } catch {
      return 9;
    }
  });
  const [editingStartHour, setEditingStartHour] = useState(false);
  const [startHourInput, setStartHourInput] = useState("");

  const { data: entries, isLoading } = useTimeEntries({
    from: format(weekStart, "yyyy-MM-dd"),
    to: format(weekEnd, "yyyy-MM-dd"),
  });
  const { data: projects } = useProjects();
  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry();
  const deleteEntry = useDeleteTimeEntry();

  // Collect project IDs that have task-linked entries so we can resolve task names
  const projectIdsWithTasks = useMemo(() => {
    if (!entries) return [] as string[];
    return [
      ...new Set(
        entries
          .filter((e) => e.taskId && e.projectId)
          .map((e) => e.projectId!),
      ),
    ];
  }, [entries]);

  // Fetch tasks for those projects and combine into a single Map
  const taskMap = useQueries({
    queries: projectIdsWithTasks.map((pid) => ({
      queryKey: ["tasks", { projectId: pid }],
      queryFn: () => apiFetch<ProjectTask[]>(`/projects/${pid}/tasks`),
    })),
    combine: (results) => {
      const map = new Map<string, ProjectTask>();
      results.forEach((r) => {
        if (r.data) r.data.forEach((t) => map.set(t.id, t));
      });
      return map;
    },
  });

  // Navigate weeks — also resets per-week draft state
  const navigate = (fn: (d: Date) => Date) => {
    setWeekStart(fn);
    setAddedRows([]);
    setShowDraftRow(false);
    setEditingCell(null);
  };

  // Build grid rows grouped by (projectId, taskId)
  const grid: TimesheetRow[] = (() => {
    const rowMap = new Map<string, TimesheetRow>();

    const getOrCreate = (
      projectId: string | null,
      taskId: string | null,
    ): TimesheetRow => {
      const key = `${projectId ?? "__none__"}|${taskId ?? "__none__"}`;
      if (!rowMap.has(key)) {
        const proj = projects?.find((p) => p.id === projectId);
        const task = taskId ? taskMap.get(taskId) : null;
        rowMap.set(key, {
          rowKey: key,
          projectId,
          taskId,
          projectName:
            proj?.name ?? (projectId ? "Unknown project" : "No project"),
          taskName: task?.name ?? null,
          color: proj?.color ?? "#71717a",
          dayEntries: Array.from({ length: 7 }, () => []),
          dayTotals: new Array(7).fill(0),
          weekTotal: 0,
        });
      }
      return rowMap.get(key)!;
    };

    if (entries) {
      for (const entry of entries) {
        if (entry.isRunning) continue;
        const row = getOrCreate(
          entry.projectId ?? null,
          entry.taskId ?? null,
        );
        const entryDate = parseISO(entry.entryDate);
        const dayIdx = days.findIndex((d) => isSameDay(d, entryDate));
        if (dayIdx !== -1) {
          row.dayEntries[dayIdx].push(entry);
          row.dayTotals[dayIdx] += entry.durationDecimal ?? 0;
        }
      }
    }

    // Ensure manually added rows appear even if they have no entries yet
    for (const ar of addedRows) {
      getOrCreate(ar.projectId, ar.taskId);
    }

    for (const row of rowMap.values()) {
      row.weekTotal = row.dayTotals.reduce((a, b) => a + b, 0);
    }

    return Array.from(rowMap.values());
  })();

  // Column totals (footer)
  const dayTotals = (() => {
    const totals = new Array(7).fill(0);
    grid.forEach((row) =>
      row.dayTotals.forEach((h, i) => {
        totals[i] += h;
      }),
    );
    return totals;
  })();

  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  // ─── Cell commit ──────────────────────────────────────────────────────────

  const commitCell = (row: TimesheetRow, dayIdx: number, raw: string) => {
    setEditingCell(null);
    const hours = parseHoursInput(raw);
    if (hours === null) return; // invalid input — silently discard

    const day = days[dayIdx];
    const existing = row.dayEntries[dayIdx];

    if (existing.length >= 2) return; // multiple entries — use ⋮ popover

    if (existing.length === 1) {
      const entry = existing[0];
      if (hours === 0) {
        deleteEntry.mutate(entry.id);
      } else {
        const newEnd = addHours(parseISO(entry.startTime), hours);
        updateEntry.mutate({
          id: entry.id,
          data: {
            startTime: entry.startTime,
            endTime: newEnd.toISOString(),
            description: entry.description,
            projectId: entry.projectId,
            taskId: entry.taskId,
            isBillable: entry.isBillable,
            tagIds: entry.tagIds,
          },
        });
      }
      return;
    }

    // No existing entry — create one using the default start hour
    if (hours === 0) return;
    const startTime = new Date(day);
    startTime.setHours(defaultStartHour, 0, 0, 0);
    createEntry.mutate(
      {
        startTime: startTime.toISOString(),
        endTime: addHours(startTime, hours).toISOString(),
        projectId: row.projectId,
        taskId: row.taskId,
        isBillable: true,
      },
      {
        onError: (error) => {
          toast.error("Could not log time.", {
            description: getApiErrorMessage(error, "Failed to create the time entry."),
          });
        },
      },
    );
  };

  // ─── Draft row confirm ────────────────────────────────────────────────────

  const handleAddDraftRow = (projectId: string | null, taskId: string | null) => {
    const key = `${projectId ?? "__none__"}|${taskId ?? "__none__"}`;
    setAddedRows((prev) => {
      if (
        prev.some(
          (r) =>
            `${r.projectId ?? "__none__"}|${r.taskId ?? "__none__"}` === key,
        )
      ) {
        return prev;
      }
      return [...prev, { projectId, taskId }];
    });
    setShowDraftRow(false);
  };

  // ─── Start-hour control ───────────────────────────────────────────────────

  const saveStartHour = (input: string) => {
    const h = parseInt(input, 10);
    if (!isNaN(h) && h >= 0 && h <= 23) {
      setDefaultStartHour(h);
      try {
        localStorage.setItem("timesheetStartHour", String(h));
      } catch {}
    }
    setEditingStartHour(false);
  };

  const activeProjects = projects?.filter((p) => p.status === "Active") ?? [];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Timesheet</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Default start-hour control */}
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs">Default start:</span>
            {editingStartHour ? (
              <input
                type="number"
                min={0}
                max={23}
                className="w-10 bg-transparent text-center text-xs tabular-nums outline-none text-foreground"
                value={startHourInput}
                onChange={(e) => setStartHourInput(e.target.value)}
                onBlur={() => saveStartHour(startHourInput)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveStartHour(startHourInput);
                  if (e.key === "Escape") setEditingStartHour(false);
                }}
                autoFocus
              />
            ) : (
              <button
                className="min-w-[3.5ch] text-center text-xs font-mono tabular-nums hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  setStartHourInput(String(defaultStartHour));
                  setEditingStartHour(true);
                }}
                title="Click to change the default start hour for new entries"
              >
                {String(defaultStartHour).padStart(2, "0")}:00
              </button>
            )}
          </div>

          {/* Week navigation */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate((w) => subWeeks(w, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-45 text-center">
            {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate((w) => addWeeks(w, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
            }
          >
            This week
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium w-55">
                Project / Task
              </th>
              {days.map((d) => (
                <th
                  key={d.toISOString()}
                  className="px-2 py-3 text-center font-medium w-22"
                >
                  <div>{format(d, "EEE")}</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    {format(d, "d")}
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-center font-medium w-20">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={9}
                  className="py-8 text-center text-muted-foreground"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && grid.length === 0 && !showDraftRow && (
              <tr>
                <td
                  colSpan={9}
                  className="py-8 text-center text-muted-foreground"
                >
                  No time entries this week.
                </td>
              </tr>
            )}

            {grid.map((row) => (
              <tr
                key={row.rowKey}
                className="border-b last:border-b-0 group/row"
              >
                {/* Row label */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="truncate">
                      {row.projectName}
                      {row.taskName && (
                        <span className="text-muted-foreground">
                          {" "}/ {row.taskName}
                        </span>
                      )}
                    </span>
                  </div>
                </td>

                {/* Day cells */}
                {row.dayEntries.map((dayEnts, dayIdx) => {
                  const hours = row.dayTotals[dayIdx];
                  const currentEdit =
                    editingCell?.rowKey === row.rowKey &&
                    editingCell.dayIdx === dayIdx
                      ? editingCell
                      : null;
                  const hasMultiple = dayEnts.length >= 2;

                  return (
                    <td key={dayIdx} className="px-1 py-1 text-center">
                      {currentEdit ? (
                        <Input
                          autoFocus
                          value={currentEdit.value}
                          onChange={(e) =>
                            setEditingCell({
                              ...currentEdit,
                              value: e.target.value,
                            })
                          }
                          onBlur={() =>
                            commitCell(row, dayIdx, currentEdit.value)
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              commitCell(row, dayIdx, currentEdit.value);
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                          className="h-8 w-16 mx-auto text-center font-mono text-xs tabular-nums px-1"
                          placeholder="0:00"
                        />
                      ) : (
                        <div className="group/cell relative flex items-center justify-center">
                          <button
                            className={`h-8 w-14 rounded text-xs font-mono tabular-nums transition-colors hover:bg-muted ${
                              hours > 0
                                ? "text-foreground"
                                : "text-muted-foreground/30 hover:text-muted-foreground"
                            } ${hasMultiple ? "cursor-default" : "cursor-text"}`}
                            onClick={() => {
                              if (!hasMultiple) {
                                setEditingCell({
                                  rowKey: row.rowKey,
                                  dayIdx,
                                  value:
                                    hours > 0 ? decimalToHM(hours) : "",
                                });
                              }
                            }}
                            title={
                              hasMultiple
                                ? "Multiple entries — use ⋮ to manage"
                                : hours > 0
                                  ? "Click to edit"
                                  : "Click to add hours"
                            }
                          >
                            {hours > 0 ? decimalToHM(hours) : "–"}
                          </button>

                          {/* Entries popover — ⋮ button */}
                          {dayEnts.length > 0 && (
                            <Popover>
                              <PopoverTrigger className="absolute right-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                                <MoreVertical className="h-3 w-3" />
                              </PopoverTrigger>
                              <PopoverContent
                                side="bottom"
                                align="end"
                                className="w-64 p-2"
                              >
                                <div className="space-y-1">
                                  <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground border-b">
                                    {format(days[dayIdx], "EEEE, MMM d")}
                                  </p>
                                  {dayEnts.map((e) => (
                                    <div
                                      key={e.id}
                                      className="flex items-start justify-between rounded px-2 py-1.5 hover:bg-muted text-xs gap-2"
                                    >
                                      <div className="min-w-0">
                                        <p className="font-mono tabular-nums">
                                          {formatTimeRange(e)}
                                        </p>
                                        {e.description && (
                                          <p className="truncate text-muted-foreground mt-0.5">
                                            {e.description}
                                          </p>
                                        )}
                                      </div>
                                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                                        {decimalToHM(e.durationDecimal ?? 0)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}

                {/* Week total */}
                <td className="px-4 py-2.5 text-center font-mono tabular-nums font-medium">
                  {row.weekTotal > 0 ? (
                    decimalToHM(row.weekTotal)
                  ) : (
                    <span className="text-muted-foreground/30">–</span>
                  )}
                </td>
              </tr>
            ))}

            {/* Draft row for adding a new project/task line */}
            {showDraftRow && (
              <DraftRow
                projects={activeProjects}
                onConfirm={handleAddDraftRow}
                onCancel={() => setShowDraftRow(false)}
              />
            )}
          </tbody>

          {/* Footer totals */}
          {(grid.length > 0 || showDraftRow) && (
            <tfoot>
              <tr className="border-t bg-muted/50 font-medium">
                <td className="px-4 py-3 text-sm">Daily total</td>
                {dayTotals.map((t, i) => (
                  <td
                    key={i}
                    className="px-2 py-3 text-center font-mono tabular-nums"
                  >
                    {t > 0 ? (
                      decimalToHM(t)
                    ) : (
                      <span className="text-muted-foreground/30">–</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 text-center font-mono tabular-nums">
                  {weekTotal > 0 ? (
                    decimalToHM(weekTotal)
                  ) : (
                    <span className="text-muted-foreground/30">–</span>
                  )}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Add row button */}
      {!showDraftRow && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowDraftRow(true)}
        >
          <Plus className="h-4 w-4" />
          Add row
        </Button>
      )}
    </div>
  );
}
