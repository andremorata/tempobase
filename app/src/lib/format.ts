/**
 * Format a duration (milliseconds number, HH:MM:SS string, or decimal-hours string) to HH:MM:SS display.
 */
export function formatDuration(duration: number | string | null | undefined): string {
  if (duration == null) return "0:00:00";
  // Numeric duration in milliseconds
  if (typeof duration === "number") {
    const totalSeconds = Math.round(duration / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  // Already HH:MM:SS format
  if (duration.includes(":")) {
    const parts = duration.split(":");
    const h = parseInt(parts[0], 10);
    const m = parts[1] ?? "00";
    const s = (parts[2] ?? "00").split(".")[0]; // strip fractional seconds
    return `${h}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
  }
  return duration;
}

/**
 * Format decimal hours to HH:MM:SS.
 */
export function decimalToHMS(decimal: number): string {
  const totalSeconds = Math.round(decimal * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Parse HH:MM or HH:MM:SS to total seconds.
 */
export function parseHMStoSeconds(hms: string): number {
  const parts = hms.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Format seconds to HH:MM:SS.
 */
export function secondsToHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Format an ISO date string to a locale-friendly display.
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type DateFormatPreference = "system" | "ymd" | "dmy" | "mdy";

/**
 * Format an ISO date in the browser's local timezone using the user's date-format setting.
 */
export function formatDateByPreference(dateStr: string, preference: DateFormatPreference = "system"): string {
  const date = new Date(dateStr);
  if (preference === "system") return date.toLocaleDateString();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (preference === "dmy") return `${day}/${month}/${year}`;
  if (preference === "mdy") return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

/**
 * Format an ISO datetime to time-only display (HH:MM).
 */
export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Quotes a value for a CSV cell. Doubles embedded quotes and prefixes a leading
 * = + - @ tab or CR with ' so spreadsheet apps don't run it as a formula.
 */
export function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
