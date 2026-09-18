// Recurring appointment helpers.
// Occurrences are generated in the business's wall-clock timezone so a
// "Wednesday 10:00am" series stays at 10:00am across DST changes.

import { DEFAULT_TZ, dayKeyTZ, hourMinuteTZ, zonedToUTCISO } from "@/lib/tz";

export type RecurrenceRule =
  | "weekly"
  | "biweekly"
  | "every3weeks"
  | "every4weeks"
  | "monthly"
  | "monthly_dow";

export const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  every3weeks: "Every 3 weeks",
  every4weeks: "Every 4 weeks",
  monthly: "Monthly (same date)",
  monthly_dow: "Monthly (same weekday)",
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const WEEK_STEP: Partial<Record<RecurrenceRule, number>> = {
  weekly: 7,
  biweekly: 14,
  every3weeks: 21,
  every4weeks: 28,
};

/** How far ahead we materialize an open-ended series (months). */
export const RECURRENCE_HORIZON_MONTHS = 6;

/** Max occurrences created in one pass (safety bound). */
export const RECURRENCE_MAX_OCCURRENCES = 200;

function parseDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 0 = Sunday … 6 = Saturday, for a "yyyy-MM-dd" date. */
export function weekdayOfDate(dateStr: string): number {
  return parseDay(dateStr).getUTCDay();
}

/** First date on or after `dateStr` that falls on `weekday` (0-6). */
export function shiftToWeekday(dateStr: string, weekday: number): string {
  const dt = parseDay(dateStr);
  const diff = (weekday - dt.getUTCDay() + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

/** Which occurrence of its weekday a date is within its month (1-5). */
export function weekdayOrdinal(dateStr: string): number {
  return Math.floor((parseDay(dateStr).getUTCDate() - 1) / 7) + 1;
}

export const ORDINAL_LABELS = ["", "1st", "2nd", "3rd", "4th", "5th"];

/** nth (1-5) weekday of a month, clamped to the last matching weekday. */
function nthWeekdayOfMonth(year: number, monthIdx: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  let day = 1 + offset + (nth - 1) * 7;
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  while (day > lastDay) day -= 7;
  return new Date(Date.UTC(year, monthIdx, day)).toISOString().slice(0, 10);
}

function addCalendar(dateStr: string, rule: RecurrenceRule, anchorDay: string): string {
  const step = WEEK_STEP[rule];
  const dt = parseDay(dateStr);
  if (step) {
    dt.setUTCDate(dt.getUTCDate() + step);
  } else if (rule === "monthly_dow") {
    const weekday = weekdayOfDate(anchorDay);
    const nth = weekdayOrdinal(anchorDay);
    const next = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
    return nthWeekdayOfMonth(next.getUTCFullYear(), next.getUTCMonth(), weekday, nth);
  } else {
    const day = parseDay(anchorDay).getUTCDate();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(day, last));
  }
  return dt.toISOString().slice(0, 10);
}


export function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/**
 * Generate occurrence start instants (UTC ISO) strictly AFTER `afterISO`,
 * following `rule` from the anchor instant, up to `throughISO` (inclusive).
 */
export function generateOccurrences(opts: {
  anchorISO: string;
  rule: RecurrenceRule;
  afterISO: string;
  throughISO: string;
  tz?: string;
  max?: number;
}): string[] {
  const tz = opts.tz || DEFAULT_TZ;
  const max = opts.max ?? RECURRENCE_MAX_OCCURRENCES;
  const { hour, minute } = hourMinuteTZ(opts.anchorISO, tz);
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const afterMs = new Date(opts.afterISO).getTime();
  const throughMs = new Date(opts.throughISO).getTime();

  const out: string[] = [];
  const anchorDay = dayKeyTZ(opts.anchorISO, tz);
  let day = anchorDay;
  // Walk forward from the anchor day.
  for (let i = 0; i < max * 4; i++) {
    day = addCalendar(day, opts.rule, anchorDay);
    const iso = zonedToUTCISO(day, time, tz);
    const ms = new Date(iso).getTime();
    if (ms > throughMs) break;
    if (ms > afterMs) out.push(iso);
    if (out.length >= max) break;
  }
  return out;
}

/** End-mode helpers for the UI. */
export type EndUnit = "days" | "weeks" | "months" | "years";

export function endDateFrom(startDate: string, count: number, unit: EndUnit): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (unit === "days") dt.setUTCDate(dt.getUTCDate() + count);
  else if (unit === "weeks") dt.setUTCDate(dt.getUTCDate() + count * 7);
  else if (unit === "months") dt.setUTCMonth(dt.getUTCMonth() + count);
  else dt.setUTCFullYear(dt.getUTCFullYear() + count);
  return dt.toISOString().slice(0, 10);
}
