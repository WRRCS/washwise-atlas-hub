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

const longDate = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
const longTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

/** Group a week's cleanings by client into the sentences a client would receive (one per cleaning). */
export function buildClientSchedules(jobs: ClientScheduleJob[], tz: string) {
  const out = new Map<string, { lines: string[]; fingerprint: string }>();
  const sorted = [...jobs]
    .filter((j) => j.client_id && j.status !== "canceled")
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
  for (const j of sorted) {
    const loc = j.location_needs_review ? null : jobLocation(j);
    const where = loc ? loc.label || loc.address : null;
    // Short form only for detecting changes between sends (kept stable across wording changes).
    const key = [
      fmtDateTZ(j.scheduled_start, tz),
      `${fmtTimeTZ(j.scheduled_start, tz)}–${fmtTimeTZ(j.scheduled_end, tz)}`,
      j.service_name?.trim() || "Cleaning",
      where,
    ].filter(Boolean).join(" · ");
    const place = loc ? loc.address || loc.label : null;
    const line = `We're scheduled to clean your home on ${longDate(j.scheduled_start, tz)}, at ${longTime(j.scheduled_start, tz)} and ${longTime(j.scheduled_end, tz)}${place ? ` at ${place}` : ""}.`;
    const entry = out.get(j.client_id!) ?? { lines: [], fingerprint: "" };
    entry.lines.push(line);
    // Each entry carries its start so already-past cleanings can be ignored later.
    entry.fingerprint = [entry.fingerprint, `${new Date(j.scheduled_start).toISOString()}|${key}`].filter(Boolean).join("\n");
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

const BUSINESS = "Wash Rinse Repeat Cleaning";

function scheduleBody(firstName: string | null | undefined, lines: string[]) {
  return [
    `Hi ${firstName?.trim() || "there"},`,
    `This is ${BUSINESS}. ${lines.join(" ")} Reply to this message if anything needs to change.`,
    "Thank you!",
  ];
}

export function composeScheduleEmail(firstName: string | null | undefined, lines: string[]) {
  return { subject: "Your upcoming cleaning schedule", body: scheduleBody(firstName, lines).join("\n") };
}

/** Text-message version: same wording plus the opt-out line. */
export function composeScheduleText(firstName: string | null | undefined, lines: string[]) {
  return [...scheduleBody(firstName, lines), "", "Reply STOP to opt out."].join("\n");
}

export type ScheduleChannel = "email" | "text" | "both";
export const channelIncludes = (c: ScheduleChannel, x: "email" | "text") => c === "both" || c === x;
