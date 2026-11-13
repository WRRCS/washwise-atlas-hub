/**
 * Each cleaner on a shared cleaning can have their own scheduled hours.
 * A cleaner without their own hours follows the cleaning's time.
 */
export type CleaningTimes = { scheduled_start: string; scheduled_end: string };
export type CleanerLink = { id: string; scheduled_start?: string | null; scheduled_end?: string | null };

/** The hours a cleaner is scheduled on a cleaning. */
export function ownHours(job: CleaningTimes & { assignees?: CleanerLink[] }, employeeId: string): CleaningTimes {
  const link = job.assignees?.find((a) => a.id === employeeId);
  if (link?.scheduled_start && link?.scheduled_end) return { scheduled_start: link.scheduled_start, scheduled_end: link.scheduled_end };
  return { scheduled_start: job.scheduled_start, scheduled_end: job.scheduled_end };
}

/** A copy of the cleaning seen from one cleaner's row; the cleaning's own time stays on job_start/job_end. */
export function withOwnHours<T extends CleaningTimes & { assignees?: CleanerLink[] }>(job: T, employeeId: string) {
  const own = ownHours(job, employeeId);
  return { ...job, ...own, job_start: job.scheduled_start, job_end: job.scheduled_end, own_hours: own.scheduled_start !== job.scheduled_start || own.scheduled_end !== job.scheduled_end };
}

/**
 * Moving one cleaner of a shared cleaning to another day asks whether it is
 * a separate cleaning (its own invoice) or the same cleaning across days.
 */
export function needsSplitChoice(cleanerCount: number, fromDayKey: string, toDayKey: string) {
  return cleanerCount > 1 && fromDayKey !== toDayKey;
}

/** What the cleaning's overall time becomes when one cleaner's hours change: it only grows to cover them. */
export function coveringTimes(cleaning: CleaningTimes, cleaner: CleaningTimes): CleaningTimes & { grew: boolean } {
  const s = Math.min(Date.parse(cleaning.scheduled_start), Date.parse(cleaner.scheduled_start));
  const e = Math.max(Date.parse(cleaning.scheduled_end), Date.parse(cleaner.scheduled_end));
  const grew = s !== Date.parse(cleaning.scheduled_start) || e !== Date.parse(cleaning.scheduled_end);
  return grew
    ? { scheduled_start: new Date(s).toISOString(), scheduled_end: new Date(e).toISOString(), grew }
    : { ...cleaning, grew };
}
