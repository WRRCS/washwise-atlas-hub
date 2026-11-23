// Pure rules for texting cleaners their schedule reminders (appointment_reminder_employee, channel "sms").

/** Reminders are only texted close to their due time; older ones (e.g. while texting was down) are dropped. */
export const REMINDER_TEXT_GRACE_MS = 30 * 60 * 1000;

export function reminderTextDue(scheduledForISO: string, now: Date = new Date()): "due" | "early" | "expired" {
  const at = Date.parse(scheduledForISO);
  if (at > now.getTime()) return "early";
  return now.getTime() - at > REMINDER_TEXT_GRACE_MS ? "expired" : "due";
}

export type ReminderJobState = {
  status: string;
  published_at: string | null;
  scheduled_start: string;
  assigned_to: string | null;
} | null;

/** A reminder is stale when the cleaning is gone, canceled, finished, unpublished, reassigned or moved. */
export function appointmentReminderStale(job: ReminderJobState, onJob: boolean, recipientId: string, payloadStart: unknown, cleanerStart?: string | null): boolean {
  if (!job) return true;
  if (["canceled", "completed"].includes(job.status)) return true;
  if (job.status === "scheduled" && !job.published_at) return true;
  if (!onJob && job.assigned_to !== recipientId) return true;
  if (typeof payloadStart === "string") {
    const expected = Date.parse(cleanerStart ?? job.scheduled_start);
    const jobStart = Date.parse(job.scheduled_start);
    if (Date.parse(payloadStart) !== expected && Date.parse(payloadStart) !== jobStart) return true;
  }
  return false;
}

function fmtWhen(iso: string, tz: string, uk: boolean) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat(uk ? "uk-UA" : "en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: !uk }).format(d);
  return { date, time };
}

/** The reminder text, in the cleaner's language (Ukrainian or English). Never includes door codes. */
export function reminderTextBody(opts: { clientName: string; startISO: string; tz: string; language?: string | null }): string {
  if (opts.language === "uk") {
    const { date, time } = fmtWhen(opts.startISO, opts.tz, true);
    return `Wash Rinse Repeat Cleaning: Нагадування — ваше прибирання у ${opts.clientName} ${date} о ${time}. Деталі в застосунку.`;
  }
  const { date, time } = fmtWhen(opts.startISO, opts.tz, false);
  return `Wash Rinse Repeat Cleaning reminder: You're scheduled to clean for ${opts.clientName} on ${date} at ${time}. Details are in the app.`;
}
