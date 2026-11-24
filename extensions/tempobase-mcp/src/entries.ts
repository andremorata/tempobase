import { createHash } from "node:crypto";
import { formatLocal, isValidDate } from "./period.ts";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

function offsetAt(instant: number, timeZone: string): number {
  const local = formatLocal(new Date(instant).toISOString(), timeZone)!;
  return Date.parse(`${local.replace(" ", "T")}:00.000Z`) - instant;
}

/** The UTC instant of a wall-clock date and time in `timeZone`. Refuses DST gaps and overlaps. */
export function localToUtc(date: string, time: string, timeZone: string): Date {
  if (!isValidDate(date)) throw new Error(`Date "${date}" must be a valid YYYY-MM-DD.`);
  if (!TIME_PATTERN.test(time)) throw new Error(`Time "${time}" must be HH:mm (00:00 to 23:59).`);

  const wall = Date.parse(`${date}T${time}:00.000Z`);
  const offsets = new Set([offsetAt(wall - DAY_MS, timeZone), offsetAt(wall + DAY_MS, timeZone)]);
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => formatLocal(new Date(instant).toISOString(), timeZone) === `${date} ${time}`);

  if (matches.length === 0) {
    throw new Error(`${date} ${time} does not exist in ${timeZone} because of a clock change. Ask the user for another time.`);
  }
  if (matches.length > 1) {
    throw new Error(`${date} ${time} happens twice in ${timeZone} because of a clock change. Ask the user which one they mean.`);
  }
  return new Date(matches[0]!);
}

export interface EntryArgs {
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
}

export interface EntryPayload {
  startTime: string;
  endTime: string;
  description: string | null;
  projectId: string | null;
  taskId: string | null;
  isBillable: boolean;
}

export function buildEntryPayload(args: EntryArgs, timeZone: string): EntryPayload {
  const start = localToUtc(args.date, args.startTime, timeZone);
  const end = localToUtc(args.endDate ?? args.date, args.endTime, timeZone);
  if (end <= start) {
    throw new Error("endTime must be after startTime. For an entry that crosses midnight, pass endDate.");
  }
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    description: args.description?.trim() || null,
    projectId: args.projectId ?? null,
    taskId: args.taskId ?? null,
    isBillable: args.billable ?? true,
  };
}

export interface CorrectionArgs {
  entryId: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  description?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
}

export type EntryChanges = Partial<EntryPayload>;

/**
 * Only the fields the user asked to change. Times need the entry's local date, so a time without
 * `date` is refused instead of guessing the day.
 */
export function buildCorrectionChanges(args: CorrectionArgs, timeZone: string): EntryChanges {
  const changes: EntryChanges = {};
  if (args.startTime !== undefined || args.endTime !== undefined) {
    if (!args.date) {
      throw new Error("date is required with startTime or endTime: pass the entry's local date (startLocal from list_my_time_entries).");
    }
    if (args.startTime !== undefined) changes.startTime = localToUtc(args.date, args.startTime, timeZone).toISOString();
    if (args.endTime !== undefined) changes.endTime = localToUtc(args.endDate ?? args.date, args.endTime, timeZone).toISOString();
    if (changes.startTime && changes.endTime && changes.endTime <= changes.startTime) {
      throw new Error("endTime must be after startTime. For an entry that crosses midnight, pass endDate.");
    }
  }
  if (args.description !== undefined) changes.description = args.description?.trim() || null;
  if (args.projectId !== undefined) changes.projectId = args.projectId;
  if (args.taskId !== undefined) changes.taskId = args.taskId;
  if (args.billable !== undefined) changes.isBillable = args.billable;
  if (Object.keys(changes).length === 0) throw new Error("Nothing to correct: pass at least one field to change.");
  return changes;
}

/** Stable per entry and changes, so a retried correction returns the same operation. */
export function correctionKeyFor(entryId: string, changes: EntryChanges): string {
  const fields = ["startTime", "endTime", "description", "projectId", "taskId", "isBillable"] as const;
  const canonical = JSON.stringify([entryId, fields.filter((key) => key in changes).map((key) => [key, changes[key]])]);
  return `mcp-fix-${createHash("sha256").update(canonical).digest("hex").slice(0, 28)}`;
}

/** Stable per entry, so a retried or repeated prepare returns the same operation. */
export function idempotencyKeyFor(payload: EntryPayload): string {
  const canonical = JSON.stringify([
    payload.startTime,
    payload.endTime,
    payload.description,
    payload.projectId,
    payload.taskId,
    payload.isBillable,
  ]);
  return `mcp-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

/** The preview link on the configured host, built from the id so the server response cannot redirect it. */
export function confirmUrlFor(baseUrl: URL, operationId: string): string {
  return new URL(`/integrations/operations/${encodeURIComponent(operationId)}`, baseUrl).toString();
}

export type OperationStatus = "pending" | "confirmed" | "cancelled" | "expired";

export type OperationKind = "create_entry" | "correct_entry";

export function nextStepFor(op: { kind?: OperationKind; status: OperationStatus; entryDeleted: boolean }): string {
  if (op.kind === "correct_entry") return correctionStepFor(op);
  switch (op.status) {
    case "pending":
      return "Nothing is saved yet. Tell the user to review the preview in TempoBase and select Confirm or Cancel, then call get_operation_status with this id.";
    case "confirmed":
      return op.entryDeleted
        ? "The entry was created and later deleted in TempoBase. To create it again, call prepare_time_entry with a new idempotencyKey."
        : "The entry exists; entryId is its id. Do not prepare it again.";
    case "cancelled":
      return "The user cancelled; nothing was saved. If the user asks again, call prepare_time_entry with the same entry: it re-opens the preview.";
    case "expired":
      return "The preview expired after 15 minutes; nothing was saved. If the user still wants it, call prepare_time_entry with the same entry: it re-opens the preview.";
  }
}

function correctionStepFor(op: { status: OperationStatus; entryDeleted: boolean }): string {
  switch (op.status) {
    case "pending":
      return "Nothing is changed yet. Show the user the before and after, tell them to review the preview in TempoBase and select Confirm or Cancel, then call get_operation_status with this id. If the entry changed in the meantime, TempoBase shows the new values and asks to confirm again.";
    case "confirmed":
      return op.entryDeleted
        ? "The correction was saved, but the entry was deleted later in TempoBase."
        : "The entry was corrected; entry shows its values now. Do not prepare it again.";
    case "cancelled":
      return "The user cancelled; nothing was changed. If the user asks again, call prepare_time_entry_correction with the same changes: it re-opens the preview with the entry's current values.";
    case "expired":
      return "The preview expired after 15 minutes; nothing was changed. If the user still wants it, call prepare_time_entry_correction with the same changes: it re-opens the preview.";
  }
}
