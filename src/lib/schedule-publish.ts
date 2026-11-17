import { dayKeyTZ, hourMinuteTZ, zonedToUTCISO } from "@/lib/tz";

type Publishable = { published_at: string | null; status: string };

/** Employees see a cleaning only once it is published, or once it is underway or finished. */
export function visibleToEmployees(job: Publishable): boolean {
  return !!job.published_at || job.status === "in_progress" || job.status === "completed";
}

/** Canceled cleanings come off every schedule (owner's and every assigned cleaner's). */
export function showsOnSchedule(job: { status: string }): boolean {
  return job.status !== "canceled";
}

/** Add whole days to a yyyy-MM-dd key. */
export function addDaysToKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two yyyy-MM-dd keys. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86400000);
}

/**
 * Move a start/end pair by whole days, keeping the same clock time in the
 * business time zone (so 10:00 AM stays 10:00 AM across a time change).
 */
export function shiftByDaysKeepTime(startISO: string, endISO: string, days: number, tz: string) {
  const { hour, minute } = hourMinuteTZ(startISO, tz);
  const key = addDaysToKey(dayKeyTZ(startISO, tz), days);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = new Date(zonedToUTCISO(key, `${pad(hour)}:${pad(minute)}`, tz));
  const end = new Date(start.getTime() + (Date.parse(endISO) - Date.parse(startISO)));
  return { start, end };
}
