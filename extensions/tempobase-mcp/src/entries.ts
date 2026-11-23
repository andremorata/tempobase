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

export function nextStepFor(op: { status: OperationStatus; entryDeleted: boolean }): string {
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
