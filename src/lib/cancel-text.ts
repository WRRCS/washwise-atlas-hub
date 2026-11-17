// Pure rules for texting cleaners when a published cleaning is canceled.

export type CancelSnapshot = {
  status: string;
  published_at: string | null;
  scheduled_end: string;
};

/**
 * Cleaners are texted only when a cleaning they could already see on their
 * schedule (published, still scheduled, not yet over) is canceled.
 */
export function shouldTextOnCancel(job: CancelSnapshot, now: Date = new Date()): boolean {
  return job.status === "scheduled" && !!job.published_at && Date.parse(job.scheduled_end) > now.getTime();
}

function fmtWhen(iso: string, tz: string, locale: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat(locale === "uk-UA" ? "uk-UA" : "en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: locale !== "uk-UA" }).format(d);
  return { date, time };
}

/** The cancellation text, in the cleaner's language (Ukrainian or English). */
export function cancelTextBody(opts: { clientName: string; startISO: string; tz: string; language?: string | null }): string {
  if (opts.language === "uk") {
    const { date, time } = fmtWhen(opts.startISO, opts.tz, "uk-UA");
    return `Wash Rinse Repeat Cleaning: Ваше прибирання у ${opts.clientName} (${date} о ${time}) скасовано. Будь ласка, перевірте свій розклад у застосунку.`;
  }
  const { date, time } = fmtWhen(opts.startISO, opts.tz, "en-US");
  return `Wash Rinse Repeat Cleaning: Your cleaning for ${opts.clientName} on ${date} at ${time} has been canceled. Please check your schedule in the app.`;
}

/** One-line note for the owner after a cancel: who was texted, and who wasn't and why. */
export function cancelTextNote(r: { texted: string[]; skipped: { name: string; reason: string }[]; notSetUp?: boolean } | null | undefined): string | null {
  if (!r || (!r.texted.length && !r.skipped.length)) return null;
  if (r.notSetUp && !r.texted.length) return `No text sent to ${r.skipped.map((x) => x.name).join(", ")}: texting isn't set up yet.`;
  const parts: string[] = [];
  if (r.texted.length) parts.push(`Texted ${r.texted.join(", ")}`);
  if (r.skipped.length) parts.push(`not texted: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(", ")}`);
  return parts.join("; ") + ".";
}
