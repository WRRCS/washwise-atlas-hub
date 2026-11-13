import { fmtDateTZ, fmtTimeTZ } from "@/lib/tz";
import { jobLocation } from "@/lib/job-location";

/** One cleaning as a client sees it: overall time only, never cleaners. */
export type ClientScheduleJob = {
  client_id: string | null;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  service_name?: string | null;
  service_address?: string | null;
  service_location_label?: string | null;
  location_needs_review?: boolean;
  property?: { label?: string | null; address?: string | null } | null;
};

export type ScheduleSendStatus = "new" | "changed" | "sent";

/** Group a week's cleanings by client into the lines a client would receive. */
export function buildClientSchedules(jobs: ClientScheduleJob[], tz: string) {
  const out = new Map<string, { lines: string[]; fingerprint: string }>();
  const sorted = [...jobs]
    .filter((j) => j.client_id && j.status !== "canceled")
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
  for (const j of sorted) {
    const loc = j.location_needs_review ? null : jobLocation(j);
    const where = loc ? loc.label || loc.address : null;
    const line = [
      fmtDateTZ(j.scheduled_start, tz),
      `${fmtTimeTZ(j.scheduled_start, tz)}–${fmtTimeTZ(j.scheduled_end, tz)}`,
      j.service_name?.trim() || "Cleaning",
      where,
    ].filter(Boolean).join(" · ");
    const entry = out.get(j.client_id!) ?? { lines: [], fingerprint: "" };
    entry.lines.push(line);
    // Each line carries its start so already-past cleanings can be ignored later.
    entry.fingerprint = [entry.fingerprint, `${new Date(j.scheduled_start).toISOString()}|${line}`].filter(Boolean).join("\n");
    out.set(j.client_id!, entry);
  }
  return out;
}

const upcoming = (fp: string, now: number) =>
  fp.split("\n").filter((l) => l && Date.parse(l.slice(0, l.indexOf("|"))) >= now).join("\n");

/** Whether a client already has exactly this schedule (still-upcoming cleanings) from an earlier send. */
export function scheduleSendStatus(fingerprint: string, lastSent: string | null | undefined, now: number = Date.now()): ScheduleSendStatus {
  if (!lastSent) return "new";
  return upcoming(lastSent, now) === upcoming(fingerprint, now) ? "sent" : "changed";
}

export function composeScheduleEmail(firstName: string | null | undefined, lines: string[], businessName: string) {
  const subject = "Your upcoming cleaning schedule";
  const body = [
    `Hi ${firstName?.trim() || "there"},`,
    "",
    "Here are your upcoming cleanings:",
    ...lines.map((l) => `• ${l}`),
    "",
    "Reply to this email if anything needs to change. Thank you!",
    "",
    businessName,
  ].join("\n");
  return { subject, body };
}
