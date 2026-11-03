"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useParseCsvImport, useExecuteImport } from "@/lib/api/hooks/imports";
import { useProjects } from "@/lib/api/hooks/projects";
import { getApiErrorMessage } from "@/lib/api/client";
import { useAuth } from "@/contexts/auth-context";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import type { ImportDateFormat, ImportPreviewRow, ImportRowRequest } from "@/lib/api/types";
import { toast } from "sonner";

const DATE_FORMAT_OPTIONS: Array<{
  value: ImportDateFormat;
  label: string;
  hint: string;
}> = [
  {
    value: "dmy",
    label: "DD/MM/YYYY",
    hint: "Use this for day-first dates such as 01/03/2026 09:00.",
  },
  {
    value: "ymd",
    label: "YYYY-MM-DD",
    hint: "Use this for ISO-style exports such as 2026-03-01 09:00.",
  },
  {
    value: "mdy",
    label: "MM/DD/YYYY",
    hint: "Use this for month-first dates such as 03/01/2026 09:00.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(decimal: number): string {
  const hrs = Math.floor(decimal);
  const mins = Math.round((decimal - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/** Convert an ISO string to the `datetime-local` input value (YYYY-MM-DDTHH:MM). */
function toDateTimeLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/** Convert a `datetime-local` value back to an ISO string. */
function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString();
}

function formatExampleDate(date: Date, fmt: ImportDateFormat): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (fmt === "dmy") return `${d}/${m}/${y}`;
  if (fmt === "mdy") return `${m}/${d}/${y}`;
  return `${y}-${m}-${d}`;
}

function generateExampleCsv(fmt: ImportDateFormat): string {
  const rows: Array<[string, string, string, string, string, string, string, string, string]> = [
    ["Acme Corp", "Website Redesign", "Design",      "Homepage mockup",      "yes", "2026-03-10", "09:00", "2026-03-10", "11:30"],
    ["Acme Corp", "Website Redesign", "Development", "Implement navigation",  "yes", "2026-03-10", "13:00", "2026-03-10", "15:45"],
    ["",          "Internal",          "Planning",   "Weekly team sync",      "no",  "2026-03-11", "10:00", "2026-03-11", "11:00"],
    ["Globex Inc","API Integration",   "",           "Backend API research",  "yes", "2026-03-11", "14:00", "2026-03-11", "17:00"],
    ["",          "",                  "",           "Admin tasks",           "no",  "2026-03-12", "09:00", "2026-03-12", "09:30"],
  ];

  const header = "Client,Project,Task,Description,Billable,Start Date,Start Time,End Date,End Time";
  const lines = rows.map(([client, project, task, desc, billable, sd, st, ed, et]) => {
    const startDate = new Date(`${sd}T${st}:00`);
    const endDate = new Date(`${ed}T${et}:00`);
    const cols = [
      client, project, task, `"${desc}"`, billable,
      formatExampleDate(startDate, fmt), st,
      formatExampleDate(endDate, fmt), et,
    ];
    return cols.join(",");
  });

  return [header, ...lines].join("\n");
}

// ─── Editable row state ───────────────────────────────────────────────────────

interface RowState {
  rowIndex: number;
  startTime: string;
  endTime: string;
  description: string | null;
  isBillable: boolean;
  projectId: string | null;
  taskId: string | null;
  include: boolean;
  errors: string[];
}

function previewToRowState(row: ImportPreviewRow, forceExcluded = false): RowState {
  return {
    rowIndex: row.rowIndex,
    startTime: row.startTime,
    endTime: row.endTime,
    description: row.description ?? null,
    isBillable: row.isBillable,
    projectId: row.suggestedProjectId ?? null,
    taskId: row.suggestedTaskId ?? null,
    include: !forceExcluded && row.errors.length === 0,
    errors: row.errors,
  };
}

// ─── Row component ────────────────────────────────────────────────────────────

interface RowProps {
  row: RowState;
  projects: { id: string; name: string }[];
  onChange: (updated: RowState) => void;
}

function ImportRow({ row, projects, onChange }: RowProps) {
  const hasErrors = row.errors.length > 0;
  const selectedProjectName = row.projectId
    ? (projects.find((project) => project.id === row.projectId)?.name ?? row.projectId)
    : undefined;

  return (
    <tr className={`border-b transition-colors ${!row.include ? "opacity-50" : ""} ${hasErrors ? "bg-destructive/5" : ""}`}>
      {/* Include toggle */}
      <td className="px-3 py-2.5 text-center">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-emerald-500"
          checked={row.include}
          disabled={hasErrors}
          onChange={(e) => onChange({ ...row, include: e.target.checked })}
          aria-label={`Include row ${row.rowIndex + 1}`}
        />
      </td>

      {/* Start */}
      <td className="px-3 py-2.5">
        <input
          type="datetime-local"
          className="rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring px-1 py-0.5 text-muted-foreground"
          value={toDateTimeLocal(row.startTime)}
          onChange={(e) => {
            if (e.target.value) onChange({ ...row, startTime: fromDateTimeLocal(e.target.value) });
          }}
          aria-label="Start time"
        />
      </td>

      {/* End */}
      <td className="px-3 py-2.5">
        <input
          type="datetime-local"
          className="rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring px-1 py-0.5 text-muted-foreground"
          value={toDateTimeLocal(row.endTime)}
          onChange={(e) => {
            if (e.target.value) onChange({ ...row, endTime: fromDateTimeLocal(e.target.value) });
          }}
          aria-label="End time"
        />
      </td>

      {/* Duration */}
      <td className="px-3 py-2.5 text-sm tabular-nums whitespace-nowrap">
        {fmtDuration(
          Math.max(0, (new Date(row.endTime).getTime() - new Date(row.startTime).getTime()) / 3_600_000),
        )}
      </td>

      {/* Description */}
      <td className="px-3 py-2.5">
        <input
          type="text"
          className="w-full rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring px-1 py-0.5 placeholder:text-muted-foreground"
          value={row.description ?? ""}
          placeholder="No description"
          onChange={(e) => onChange({ ...row, description: e.target.value || null })}
        />
      </td>

      {/* Project */}
      <td className="px-3 py-2.5">
        <Select
          value={row.projectId ?? ""}
          onValueChange={(value) => onChange({ ...row, projectId: value || null, taskId: null })}
        >
          <SelectTrigger className="w-full bg-background/90 shadow-sm transition-colors hover:border-emerald-500/30 focus-visible:border-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/15">
            <SelectValue placeholder="No project">
              {selectedProjectName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Billable */}
      <td className="px-3 py-2.5 text-center">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-emerald-500"
          checked={row.isBillable}
          onChange={(e) => onChange({ ...row, isBillable: e.target.checked })}
          aria-label="Billable"
        />
      </td>

      {/* Errors / status */}
      <td className="px-3 py-2.5">
        {hasErrors ? (
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{row.errors[0]}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseAttemptRef = useRef(0);
  const [rows, setRows] = useState<RowState[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importSessionId, setImportSessionId] = useState<string | null>(null);
  const [duplicateImport, setDuplicateImport] = useState<{
    importSessionId: string;
    importedAt: string | null;
  } | null>(null);
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("dmy");
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [executeResult, setExecuteResult] = useState<{
    importedCount: number;
    skippedCount: number;
    errors: { rowIndex: number; message: string }[];
    skippedRows?: { rowIndex: number; message: string }[];
    alreadyImported?: boolean;
  } | null>(null);

  const { user } = useAuth();
  const parseMutation = useParseCsvImport();
  const executeMutation = useExecuteImport();
  const { data: allProjects = [] } = useProjects();
  const projects = allProjects.filter((project) => project.status === "Active");
  const selectedDateFormat = DATE_FORMAT_OPTIONS.find((option) => option.value === dateFormat) ?? DATE_FORMAT_OPTIONS[0];
  const selectedDateFormatLabel = selectedDateFormat.label;

  // ── Upload & parse ──────────────────────────────────────────────────────────

  const handleFilePick = useCallback(
    async (file: File, nextDateFormat: ImportDateFormat) => {
      const attemptId = parseAttemptRef.current + 1;
      parseAttemptRef.current = attemptId;

      setSelectedFile(file);
      setFileName(file.name);
      setImportSessionId(null);
      setDuplicateImport(null);
      setExecuteResult(null);
      setShowOnlyErrors(false);
      setRows([]);
      setParseErrors([]);
      setParseWarnings([]);

      try {
        const result = await parseMutation.mutateAsync({ file, dateFormat: nextDateFormat });

        if (attemptId !== parseAttemptRef.current) {
          return;
         }

        const isDuplicateImport = Boolean(result.duplicateOfImportSessionId);
        setImportSessionId(result.importSessionId ?? null);
        setDuplicateImport(
          result.duplicateOfImportSessionId
             ? {
                importSessionId: result.duplicateOfImportSessionId,
                importedAt: result.previouslyImportedAt ?? null,
               }
             : null,
         );
        setParseErrors(result.parseErrors);
        setParseWarnings(result.parseWarnings ?? []);
        setRows(result.rows.map((row) => previewToRowState(row, isDuplicateImport)));
        const parseWarnings = result.parseWarnings ?? [];

        if (result.parseErrors.length > 0) {
          toast.error("Parsed with issues.", {
            description: result.parseErrors[0] ?? "Review the parse errors before importing rows.",
           });
          return;
         }

        if (parseWarnings.length > 0) {
          toast.warning("Unrecognized columns detected.", {
            description: parseWarnings[0],
          });
        }

        if (isDuplicateImport) {
          toast.warning("This file content was imported before.", {
            description: "Rows were parsed from the uploaded file, but left deselected to prevent a duplicate import.",
          });
          return;
        }

        toast.success("File parsed.", {
          description: `${result.totalRows} row${result.totalRows === 1 ? "" : "s"} ready for review.`,
        });
      } catch (error) {
        if (attemptId !== parseAttemptRef.current) {
          return;
        }

        toast.error("Could not parse import file.", {
          description: getApiErrorMessage(error, "Failed to parse the uploaded CSV file."),
        });
      }
    },
    [parseMutation],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) handleFilePick(file, dateFormat);
    },
    [dateFormat, handleFilePick],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFilePick(file, dateFormat);
    },
    [dateFormat, handleFilePick],
  );

  const onDateFormatChange = useCallback(
    async (nextDateFormat: ImportDateFormat) => {
      setDateFormat(nextDateFormat);

      if (!selectedFile) {
        return;
      }

      await handleFilePick(selectedFile, nextDateFormat);
    },
    [handleFilePick, selectedFile],
  );

  // ── Execute ─────────────────────────────────────────────────────────────────

  const handleExecute = useCallback(async () => {
    if (!importSessionId) {
      toast.error("Parse the CSV file again before importing.");
      return;
    }

    const payload: ImportRowRequest[] = rows.map((r) => ({
      rowIndex: r.rowIndex,
      startTime: r.startTime,
      endTime: r.endTime,
      description: r.description,
      isBillable: r.isBillable,
      projectId: r.projectId,
      taskId: r.taskId,
      include: r.include,
    }));

    try {
      const result = await executeMutation.mutateAsync({ importSessionId, rows: payload });
      setExecuteResult(result);

      if (result.alreadyImported) {
        toast.warning("Import already completed.", {
          description: "No entries were created because this import session had already been completed.",
        });
        setRows([]);
        setImportSessionId(null);
        return;
      }

      if (result.errors.length > 0) {
        toast.error("Import completed with issues.", {
          description: `${result.importedCount} imported, ${result.errors.length} failed, ${result.skippedCount} skipped.`,
        });
      } else {
        toast.success("Import completed.", {
          description: `${result.importedCount} entr${result.importedCount === 1 ? "y was" : "ies were"} imported successfully.`,
        });
      }

      // Remove successfully imported or duplicate-skipped rows (keep user-skipped / errored)
      if (result.importedCount > 0 || (result.skippedRows?.length ?? 0) > 0) {
        const errorIndexes = new Set(result.errors.map((e) => e.rowIndex));
        const duplicateSkippedIndexes = new Set(result.skippedRows?.map((e) => e.rowIndex) ?? []);
        setRows((prev) =>
          prev.filter((r) => !r.include || (errorIndexes.has(r.rowIndex) && !duplicateSkippedIndexes.has(r.rowIndex))),
        );
      }
    } catch (error) {
      toast.error("Could not import selected entries.", {
        description: getApiErrorMessage(error, "Failed to import the selected rows."),
      });
    }
  }, [importSessionId, rows, executeMutation]);

  const handleDownloadExample = () => {
    const csv = generateExampleCsv(dateFormat);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tempobase-import-example.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const includedCount = rows.filter((r) => r.include).length;
  const totalCount = rows.length;
  const errorRowCount = rows.filter((r) => r.errors.length > 0).length;

  if (!hasRole(TRACKER_ROLES, user?.role)) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your role cannot import time entries.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV file to import time entries. Supports detailed time-report CSV exports.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-border/70 bg-card/60 p-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
        <div>
          <label htmlFor="import-date-format" className="text-sm font-medium text-foreground">
            CSV date format
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose how dates are written in the uploaded file before you parse it.
          </p>
        </div>
        <div className="space-y-2">
          <div className="max-w-sm">
            <Select
              id="import-date-format"
              value={dateFormat}
              onValueChange={(value) => void onDateFormatChange(value as ImportDateFormat)}
            >
              <SelectTrigger className="h-11 w-full bg-background/95 shadow-sm transition-colors hover:border-emerald-500/30 focus-visible:border-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/15">
                <SelectValue>
                  {selectedDateFormatLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMAT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedDateFormat.hint}
          </p>
        </div>
      </div>

      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-10 text-center transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5 cursor-pointer"
        onClick={() => {
          if (fileInputRef.current) fileInputRef.current.value = "";
          fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (fileInputRef.current) fileInputRef.current.value = "";
            fileInputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFileChange}
          aria-label="CSV file input"
        />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted ring-1 ring-border">
          <Upload className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            {fileName ? `Loaded: ${fileName}` : "Drop a CSV file here, or click to browse"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Detailed time-report CSV format supported. Current parser expects {selectedDateFormat.label}.
          </p>
        </div>
        {parseMutation.isPending && (
          <p className="text-xs text-emerald-500 animate-pulse">Parsing…</p>
        )}
      </div>

      {/* Example download */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleDownloadExample}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download example CSV
        </Button>
      </div>

      {/* Parse-level errors */}
      {parseErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Could not parse file</p>
              {parseErrors.map((err, i) => (
                <p key={i} className="mt-1 text-xs text-destructive/80">{err}</p>
              ))}
            </div>
          </div>
        </div>
      )}
       {/* Parse-level warnings (non-blocking) */}
       {parseWarnings.length > 0 && (
         <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
           <div className="flex items-start gap-2">
             <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
             <div>
               <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Unrecognized columns</p>
               {parseWarnings.map((warn, i) => (
                 <p key={i} className="mt-1 text-xs text-muted-foreground">{warn}</p>
               ))}
               <p className="mt-2 text-xs text-muted-foreground">
                Import will proceed - columns that don&apos;t match a known field will be ignored. Fix the CSV headers and re-upload if needed.
               </p>
             </div>
           </div>
         </div>
       )}
      {duplicateImport && rows.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                This file content was imported before
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The preview below comes from the file you just uploaded, but rows were deselected to avoid importing the same entries again
                {duplicateImport.importedAt ? ` after the previous import on ${new Date(duplicateImport.importedAt).toLocaleString()}` : ""}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Execute result */}
      {executeResult && (
        <div className={`rounded-lg border p-4 ${executeResult.errors.length > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
          <div className="flex items-start gap-2">
            <CheckCircle className={`h-4 w-4 mt-0.5 shrink-0 ${executeResult.errors.length > 0 ? "text-amber-500" : "text-emerald-500"}`} />
            <div className="text-sm">
              <p className="font-medium">
                {executeResult.importedCount} entr{executeResult.importedCount === 1 ? "y" : "ies"} imported
                {executeResult.skippedCount > 0 && `, ${executeResult.skippedCount} skipped`}
                {executeResult.errors.length > 0 && `, ${executeResult.errors.length} failed`}
              </p>
              {executeResult.errors.map((e) => (
                <p key={e.rowIndex} className="mt-1 text-xs text-muted-foreground">
                  Row {e.rowIndex + 1}: {e.message}
                </p>
              ))}
              {executeResult.skippedRows?.map((e) => (
                <p key={`skipped-${e.rowIndex}`} className="mt-1 text-xs text-muted-foreground">
                  Row {e.rowIndex + 1}: {e.message}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Skeleton while parsing */}
      {parseMutation.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && !parseMutation.isPending && (
        <div className="flex flex-col gap-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>
                <span className="font-medium text-foreground">{totalCount}</span> rows parsed
                {errorRowCount > 0 && (
                  <> — <span className="text-destructive">{errorRowCount} with errors</span></>
                )}
              </span>
              {includedCount > 0 && (
                <Badge variant="secondary">{includedCount} selected</Badge>
              )}
              {errorRowCount > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-destructive"
                    checked={showOnlyErrors}
                    onChange={(e) => setShowOnlyErrors(e.target.checked)}
                  />
                  <span className="text-xs text-destructive">Only errors</span>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows((prev) => prev.map((r) => ({ ...r, include: r.errors.length === 0 })))}
              >
                Select valid
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows((prev) => prev.map((r) => ({ ...r, include: false })))}
              >
                Deselect all
              </Button>
              <Button
                size="sm"
                onClick={handleExecute}
                disabled={includedCount === 0 || !importSessionId || executeMutation.isPending}
              >
                {executeMutation.isPending
                  ? "Importing…"
                  : `Import ${includedCount} entr${includedCount === 1 ? "y" : "ies"}`}
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm" role="table" aria-label="Import preview">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground w-10">
                    ✓
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Start
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    End
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Duration
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Project
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Bill.
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {(showOnlyErrors ? rows.filter((r) => r.errors.length > 0) : rows).map((row) => (
                  <ImportRow
                    key={row.rowIndex}
                    row={row}
                    projects={projects}
                    onChange={(updated) =>
                      setRows((prev) =>
                        prev.map((r) => (r.rowIndex === updated.rowIndex ? updated : r)),
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state — after parse, no rows */}
      {!parseMutation.isPending && fileName && rows.length === 0 && parseErrors.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-8 w-8" />
          <p className="text-sm">No rows found in the uploaded file.</p>
        </div>
      )}
    </div>
  );
}
