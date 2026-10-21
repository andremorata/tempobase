"use client";

import { useState, useEffect, useCallback, useReducer, useRef, useMemo } from "react";
import { Play, Square, Tags, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectSelector } from "@/components/shared/project-selector";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useStartTimer,
  useStopTimer,
  useRunningEntry,
  useAdjustTimerStart,
  useUpdateTimeEntry,
  useTimeEntries,
  useCancelTimer,
} from "@/lib/api/hooks/time-entries";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StaleTimerDialog } from "@/components/tracker/stale-timer-dialog";
import { useProjects } from "@/lib/api/hooks/projects";
import {
  DescriptionAutocomplete,
  type RecentSuggestion,
} from "@/components/tracker/description-autocomplete";
import { useCurrentUserProfile } from "@/lib/api/hooks/account";
import { useTags } from "@/lib/api/hooks/tags";
import { getApiErrorMessage } from "@/lib/api/client";
import { secondsToHMS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimeEntry } from "@/lib/api/types";
import { toast } from "sonner";

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  description: string;
  projectId: string | null;
  taskId: string | null;
  isBillable: boolean;
  tagIds: string[];
}

type FormAction =
  | { type: "sync"; entry: TimeEntry; preserveTags: boolean }
  | { type: "setDescription"; value: string }
  | { type: "setProjectId"; value: string | null }
  | { type: "setTaskId"; value: string | null }
  | { type: "setIsBillable"; value: boolean }
  | { type: "toggleTag"; id: string }
  | { type: "populateFromRecent"; suggestion: RecentSuggestion }
  | { type: "clear" };

const initialForm: FormState = {
  description: "",
  projectId: null,
  taskId: null,
  isBillable: true,
  tagIds: [],
};

const RECENT_ENTRIES_PAGE_SIZE = 120;
const MAX_RECENT_SUGGESTIONS = 60;

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "sync":
      return {
        description: action.entry.description ?? "",
        projectId: action.entry.projectId ?? null,
        taskId: action.entry.taskId ?? null,
        isBillable: action.entry.isBillable,
        tagIds: action.preserveTags ? state.tagIds : (action.entry.tagIds ?? []),
      };
    case "setDescription":
      return { ...state, description: action.value };
    case "setProjectId":
      return { ...state, projectId: action.value, taskId: null };
    case "setTaskId":
      return { ...state, taskId: action.value };
    case "setIsBillable":
      return { ...state, isBillable: action.value };
    case "toggleTag":
      return {
        ...state,
        tagIds: state.tagIds.includes(action.id)
          ? state.tagIds.filter((id) => id !== action.id)
          : [...state.tagIds, action.id],
      };
    case "populateFromRecent":
      return {
        ...state,
        description: action.suggestion.description,
        projectId: action.suggestion.projectId,
        taskId: action.suggestion.taskId,
        isBillable: action.suggestion.isBillable,
        tagIds: action.suggestion.tagIds,
      };
    case "clear":
      return initialForm;
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function parseTimeInput(raw: string): { hours: number; minutes: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let hours: number;
  let minutes: number;

  if (trimmed.includes(":")) {
    const [hStr, mStr] = trimmed.split(":");
    hours = parseInt(hStr ?? "0", 10);
    minutes = parseInt(mStr ?? "0", 10);
  } else {
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return null;
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
  }

  if (isNaN(hours) || isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function fmtHHMM(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimerBar() {
  const [form, dispatch] = useReducer(formReducer, initialForm);
  const [elapsed, setElapsed] = useState(0);

  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");
  const startInputRef = useRef<HTMLInputElement>(null);
  // Set by Escape so the blur that follows discards the edit instead of saving it
  const cancelStartEditRef = useRef(false);

  // Track which running entry we last synced to avoid overwriting live edits on refetch
  const syncedEntryId = useRef<string | null>(null);
  // Track when the user explicitly clicked Start (to preserve their tag selection)
  const justStartedRef = useRef(false);

  const { data: runningEntry } = useRunningEntry();
  const { data: profile } = useCurrentUserProfile();
  const { data: tags } = useTags();
  const { data: recentEntries } = useTimeEntries({ pageSize: RECENT_ENTRIES_PAGE_SIZE });
  const { data: projects } = useProjects();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const cancelTimer = useCancelTimer();
  const updateEntry = useUpdateTimeEntry();
  const adjustStart = useAdjustTimerStart();

  const showMutationErrorToast = useCallback((title: string, error: unknown, fallback: string) => {
    toast.error(title, {
      description: getApiErrorMessage(error, fallback),
    });
  }, []);

  const recentSuggestions = useMemo<RecentSuggestion[]>(() => {
    if (!recentEntries) return [];
    const seen = new Set<string>();
    const result: RecentSuggestion[] = [];
    for (const entry of recentEntries) {
      if (!entry.description) continue;
      const key = `${entry.description.toLowerCase()}||${entry.projectId ?? ""}||${entry.taskId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const project = projects?.find((p) => p.id === entry.projectId);
      result.push({
        description: entry.description,
        projectId: entry.projectId ?? null,
        taskId: entry.taskId ?? null,
        isBillable: entry.isBillable,
        tagIds: entry.tagIds,
        projectName: project?.name,
        projectColor: project?.color,
      });
      if (result.length >= MAX_RECENT_SUGGESTIONS) break;
    }
    return result;
  }, [recentEntries, projects]);

  // Tick the elapsed timer — reset is in the cleanup callback, not the effect body
  useEffect(() => {
    if (!runningEntry) return;
    const start = new Date(runningEntry.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [runningEntry]);

  // Sync fields from running entry — only on first detection of a new entry
  useEffect(() => {
    if (runningEntry && runningEntry.id !== syncedEntryId.current) {
      const isJustStarted = justStartedRef.current;
      justStartedRef.current = false;
      syncedEntryId.current = runningEntry.id;
      dispatch({ type: "sync", entry: runningEntry, preserveTags: isJustStarted });
    } else if (!runningEntry) {
      syncedEntryId.current = null;
    }
  }, [runningEntry]);

  useEffect(() => {
    if (runningEntry) return;
    if (!profile?.defaultProjectId) return;
    if (form.projectId) return;
    if (form.description || form.taskId || form.tagIds.length > 0) return;

    dispatch({ type: "setProjectId", value: profile.defaultProjectId });
  }, [
    runningEntry,
    profile?.defaultProjectId,
    form.projectId,
    form.description,
    form.taskId,
    form.tagIds.length,
  ]);

  // Auto-focus the start-time input when it opens
  useEffect(() => {
    if (editingStart) {
      startInputRef.current?.focus();
      startInputRef.current?.select();
    }
  }, [editingStart]);

  const openStartEdit = () => {
    if (!runningEntry) return;
    const d = new Date(runningEntry.startTime);
    setStartInput(fmtHHMM(d.getHours(), d.getMinutes()));
    setEditingStart(true);
  };

  const confirmStartEdit = useCallback(() => {
    if (!runningEntry) { setEditingStart(false); return; }

    const parsed = parseTimeInput(startInput);
    if (!parsed) { setEditingStart(false); return; }

    const base = new Date(runningEntry.startTime);
    // Tabbing through without changing the value must not rewrite the start time
    if (parsed.hours === base.getHours() && parsed.minutes === base.getMinutes()) {
      setEditingStart(false);
      return;
    }

    const newStart = new Date(
      base.getFullYear(), base.getMonth(), base.getDate(),
      parsed.hours, parsed.minutes, 0, 0,
    );

    if (newStart > new Date()) { setEditingStart(false); return; }

    adjustStart.mutate(
      { id: runningEntry.id, startTime: newStart.toISOString() },
      {
        onSuccess: () => setEditingStart(false),
        onError: (error) => {
          setEditingStart(false);
          showMutationErrorToast("Could not adjust start time.", error, "Failed to update the timer start time.");
        },
      },
    );
  }, [runningEntry, startInput, adjustStart, showMutationErrorToast]);

  const handleStart = useCallback(() => {
    justStartedRef.current = true;
    startTimer.mutate(
      {
        description: form.description || undefined,
        projectId: form.projectId,
        taskId: form.taskId,
        isBillable: form.isBillable,
      },
      {
        onError: (err) => {
          justStartedRef.current = false;
          showMutationErrorToast("Could not start timer.", err, "Failed to start timer.");
        },
      },
    );
  }, [form, startTimer, showMutationErrorToast]);

  const handleStop = useCallback(() => {
    if (!runningEntry) return;

    // Capture current local state before clearing
    const snap = { ...form, tagIds: [...form.tagIds] };
    stopTimer.mutate(undefined, {
      onSuccess: (stoppedEntry) => {
        // Save any local edits made while the timer was running
        const hasChanges =
          snap.description !== (stoppedEntry.description ?? "") ||
          snap.projectId !== (stoppedEntry.projectId ?? null) ||
          snap.taskId !== (stoppedEntry.taskId ?? null) ||
          snap.isBillable !== stoppedEntry.isBillable ||
          JSON.stringify([...snap.tagIds].sort()) !==
            JSON.stringify([...(stoppedEntry.tagIds ?? [])].sort());

        if (hasChanges && stoppedEntry.endTime) {
          updateEntry.mutate({
            id: stoppedEntry.id,
            data: {
              startTime: stoppedEntry.startTime,
              endTime: stoppedEntry.endTime,
              description: snap.description || undefined,
              projectId: snap.projectId,
              taskId: snap.taskId,
              isBillable: snap.isBillable,
              tagIds: snap.tagIds,
            },
          }, {
            onError: (error) => {
              showMutationErrorToast("Timer stopped, but edits were not saved.", error, "Failed to save the latest timer changes.");
            },
          });
        }

        dispatch({ type: "clear" });
      },
      onError: (err) => {
        showMutationErrorToast("Could not stop timer.", err, "Failed to stop timer.");
      },
    });
  }, [runningEntry, form, stopTimer, updateEntry, showMutationErrorToast]);

  // Warn before closing the window/tab with a timer running. The browser shows its own generic
  // dialog here — the text and buttons cannot be customized, and this does not fire on crashes,
  // OS shutdown or force-quit. StaleTimerDialog is what actually recovers those cases.
  useEffect(() => {
    if (!runningEntry) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [runningEntry]);

  // Keyboard shortcut: Ctrl+Shift+S to start/stop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        if (runningEntry) handleStop();
        else handleStart();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [runningEntry, handleStart, handleStop]);

  const isRunning = !!runningEntry;
  const hasTags = tags && tags.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <DescriptionAutocomplete
          className="min-w-0"
          placeholder="What are you working on?"
          value={form.description}
          onChange={(v) => dispatch({ type: "setDescription", value: v })}
          onSelect={(sug) => dispatch({ type: "populateFromRecent", suggestion: sug })}
          onConfirm={(sug) => {
            if (runningEntry) return;
            justStartedRef.current = true;
            startTimer.mutate(
              {
                description: sug.description || undefined,
                projectId: sug.projectId,
                taskId: sug.taskId,
                isBillable: sug.isBillable,
              },
              {
                onError: (err) => {
                  justStartedRef.current = false;
                  showMutationErrorToast("Could not start timer.", err, "Failed to start timer.");
                },
              },
            );
          }}
          suggestions={recentSuggestions}
        />
        <ProjectSelector
          projectId={form.projectId}
          taskId={form.taskId}
          onProjectChange={(v) => dispatch({ type: "setProjectId", value: v })}
          onTaskChange={(v) => dispatch({ type: "setTaskId", value: v })}
        />

        {/* Tag selector */}
        {hasTags && (
          <Popover>
            <PopoverTrigger
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "shrink-0 gap-1.5",
              )}
            >
              <Tags className="h-3.5 w-3.5" />
              {form.tagIds.length > 0 ? (
                <span>
                  {form.tagIds.length} tag{form.tagIds.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">Tags</span>
              )}
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-60 p-3">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = form.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => dispatch({ type: "toggleTag", id: tag.id })}
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground hover:text-foreground"
                      }`}
                      style={
                        selected && tag.color
                          ? { backgroundColor: tag.color, borderColor: tag.color, color: "#fff" }
                          : !selected && tag.color
                            ? { borderColor: tag.color, color: tag.color }
                            : undefined
                      }
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="billable"
            checked={form.isBillable}
            onCheckedChange={(v) => dispatch({ type: "setIsBillable", value: v })}
          />
          <Label htmlFor="billable" className="text-xl mb-0">
            $
          </Label>
        </div>
        <div className="flex items-center gap-3">
          {isRunning && editingStart ? (
            <Input
              ref={startInputRef}
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              onKeyDown={(e) => {
                // Both keys route through onBlur so a single path saves or discards
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  cancelStartEditRef.current = true;
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                if (cancelStartEditRef.current) {
                  cancelStartEditRef.current = false;
                  setEditingStart(false);
                  return;
                }
                confirmStartEdit();
              }}
              className="w-24 h-8 font-mono text-center tabular-nums"
              placeholder="09:00"
            />
          ) : (
            <span
              className={`font-mono text-lg tabular-nums ${
                isRunning
                  ? "text-emerald-500 cursor-pointer hover:text-emerald-400 transition-colors"
                  : "text-muted-foreground"
              }`}
              onClick={() => isRunning && openStartEdit()}
              title={isRunning ? "Click to adjust start time" : undefined}
            >
              {secondsToHMS(elapsed)}
            </span>
          )}
          {isRunning ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={cancelTimer.isPending}
                title="Discard timer"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon"
                onClick={handleStop}
                disabled={stopTimer.isPending}
                title="Stop timer (Ctrl+Shift+S)"
              >
                <Square className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={handleStart}
              disabled={startTimer.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
              title="Start timer (Ctrl+Shift+S)"
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <StaleTimerDialog
        entry={runningEntry}
        onResolved={() => dispatch({ type: "clear" })}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Discard timer?"
        description="The tracked time will be discarded and no entry will be saved."
        confirmLabel="Discard timer"
        variant="destructive"
        loading={cancelTimer.isPending}
        onConfirm={() => {
          if (!runningEntry) return;
          cancelTimer.mutate(runningEntry.id, {
            onSuccess: () => {
              dispatch({ type: "clear" });
              setCancelConfirmOpen(false);
            },
            onError: (err) => {
              showMutationErrorToast("Could not discard timer.", err, "Failed to discard the timer.");
              setCancelConfirmOpen(false);
            },
          });
        }}
      />

      {/* Selected tags preview strip */}
      {form.tagIds.length > 0 && tags && (
        <div className="flex flex-wrap gap-1 -mt-1">
          {form.tagIds.map((tid) => {
            const tag = tags.find((t) => t.id === tid);
            if (!tag) return null;
            return (
              <span
                key={tid}
                className="inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium leading-none"
                style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
              >
                {tag.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
