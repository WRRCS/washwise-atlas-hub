// Recurring appointment helpers.
// Occurrences are generated in the business's wall-clock timezone so a
// "Wednesday 10:00am" series stays at 10:00am across DST changes.

import { DEFAULT_TZ, dayKeyTZ, hourMinuteTZ, zonedToUTCISO } from "@/lib/tz";

export type RecurrenceRule = "weekly" | "biweekly" | "monthly";

export const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

/** How far ahead we materialize an open-ended series (months). */
export const RECURRENCE_HORIZON_MONTHS = 6;

/** Max occurrences created in one pass (safety bound). */
export const RECURRENCE_MAX_OCCURRENCES = 200;

function addCalendar(dateStr: string, rule: RecurrenceRule): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (rule === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (rule === "biweekly") dt.setUTCDate(dt.getUTCDate() + 14);
  else {
    const day = dt.getUTCDate();
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
  let day = dayKeyTZ(opts.anchorISO, tz);
  // Walk forward from the anchor day.
  for (let i = 0; i < max * 4; i++) {
    day = addCalendar(day, opts.rule);
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
