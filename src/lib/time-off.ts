// Pure rules for schedule time off (shared by the browser and server).
import { zonedToUTCISO } from "@/lib/tz";

export const TIME_OFF_REASONS = [
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick" },
  { value: "personal", label: "Personal" },
  { value: "appointment", label: "Appointment" },
  { value: "family", label: "Family" },
  { value: "other", label: "Other" },
] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number]["value"];
export type TimeOffCategory = "paid" | "unpaid";

export const HOURS_PER_WHOLE_DAY = 8;

export type TimeOffInput = {
  start_date: string; // yyyy-MM-dd, business-local
  end_date: string;
  all_day: boolean;
  start_time?: string | null; // HH:mm, partial days only
  end_time?: string | null;
};

function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  return dt.toISOString().slice(0, 10);
}

/** Number of calendar days from start_date to end_date, inclusive. */
export function timeOffDayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Validate and normalise what the form sends. Returns an error message or null. */
export function timeOffInputError(i: TimeOffInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(i.end_date)) return "Pick the dates";
  if (i.all_day) {
    if (i.end_date < i.start_date) return "The end date is before the start date";
    if (timeOffDayCount(i.start_date, i.end_date) > 366) return "Time off can be at most one year at a time";
    return null;
  }
  if (i.start_date !== i.end_date) return "Part-day time off is for one day";
  if (!i.start_time || !i.end_time) return "Pick the start and end time";
  if (i.end_time <= i.start_time) return "The end time must be after the start time";
  return null;
}

/** UTC window covered by the time off, using the business timezone. Whole days run midnight to midnight. */
export function timeOffWindow(i: TimeOffInput, tz: string): { starts_at: string; ends_at: string } {
  if (i.all_day) {
    return {
      starts_at: zonedToUTCISO(i.start_date, "00:00", tz),
      ends_at: zonedToUTCISO(addDaysKey(i.end_date, 1), "00:00", tz),
    };
  }
  return {
    starts_at: zonedToUTCISO(i.start_date, i.start_time ?? "00:00", tz),
    ends_at: zonedToUTCISO(i.start_date, i.end_time ?? "00:00", tz),
  };
}

/** Suggested total hours: 8 per whole day, or the length of a part day. */
export function defaultTimeOffHours(i: TimeOffInput): number {
  if (i.all_day) return timeOffDayCount(i.start_date, i.end_date) * HOURS_PER_WHOLE_DAY;
  if (!i.start_time || !i.end_time || i.end_time <= i.start_time) return 0;
  const [sh, sm] = i.start_time.split(":").map(Number);
  const [eh, em] = i.end_time.split(":").map(Number);
  return Math.round((((eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0))) / 60) * 100) / 100;
}

/** True when the time off appears in the schedule cell for this business-local day. */
export function timeOffCoversDay(row: { start_date: string; end_date: string }, dayKey: string): boolean {
  return dayKey >= row.start_date && dayKey <= row.end_date;
}

/** True when a cleaning [start, end) overlaps the time off window. */
export function timeOffOverlaps(row: { starts_at: string; ends_at: string }, start: string, end: string): boolean {
  return Date.parse(start) < Date.parse(row.ends_at) && Date.parse(end) > Date.parse(row.starts_at);
}

export function timeOffReasonLabel(reason: string): string {
  return TIME_OFF_REASONS.find((r) => r.value === reason)?.label ?? "Other";
}

export function timeOffCategoryLabel(category: string): string {
  return category === "paid" ? "Paid time off" : "Unpaid time off";
}
