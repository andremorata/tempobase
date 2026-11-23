export const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"] as const;
export type Preset = (typeof PRESETS)[number];

export interface Period {
  from: string;
  to: string;
}

/** Calendar date (YYYY-MM-DD) of `now` in `timeZone`. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Wall-clock `YYYY-MM-DD HH:mm` of an instant in `timeZone`; null stays null. */
export function formatLocal(iso: string | null, timeZone: string): string | null {
  if (iso === null) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// Calendar math runs on UTC midnights so no host timezone or DST shift leaks in.
const toUtc = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromUtc(new Date(toUtc(date).getTime() + days * 86_400_000));

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

function monthOf(date: string, offset: number): Period {
  const d = toUtc(date);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));
  return { from: fromUtc(first), to: fromUtc(last) };
}

function weekOf(date: string, offset: number): Period {
  const monday = addDays(date, -((toUtc(date).getUTCDay() + 6) % 7) + offset * 7);
  return { from: monday, to: addDays(monday, 6) };
}

export function resolvePeriod(
  input: { preset?: Preset; from?: string; to?: string },
  now: Date,
  timeZone: string,
): Period {
  if (input.preset && (input.from || input.to)) {
    throw new Error("Use a preset or from/to, not both.");
  }

  if (input.preset) {
    const today = localDate(now, timeZone);
    switch (input.preset) {
      case "today":
        return { from: today, to: today };
      case "yesterday": {
        const day = addDays(today, -1);
        return { from: day, to: day };
      }
      case "this_week":
        return weekOf(today, 0);
      case "last_week":
        return weekOf(today, -1);
      case "this_month":
        return monthOf(today, 0);
      case "last_month":
        return monthOf(today, -1);
    }
  }

  if (!input.from) throw new Error("Give a preset or from (and optionally to).");
  const period = { from: input.from, to: input.to ?? input.from };
  if (!isValidDate(period.from) || !isValidDate(period.to)) throw new Error("Dates must be valid YYYY-MM-DD.");
  if (period.from > period.to) throw new Error("from must be on or before to.");
  return period;
}
