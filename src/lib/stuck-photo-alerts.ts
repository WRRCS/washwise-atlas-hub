/** How long a stored photo may stay unattached before the owner hears about it (phones retry in the meantime). */
export const STUCK_PHOTO_GRACE_MS = 60 * 60 * 1000;
/** Only recent photos are checked, so the check stays small. */
export const STUCK_PHOTO_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type StuckObject = { name: string; created_at: string };
export type StuckGroup = { tenantId: string; jobId: string; uploaderId: string; objects: StuckObject[] };

/** Splits "tenant/job/uploader/file" paths into one group per cleaner per cleaning. */
export function groupStuckPhotos(objects: StuckObject[]): StuckGroup[] {
  const groups = new Map<string, StuckGroup>();
  for (const o of objects) {
    const [tenantId, jobId, uploaderId, file] = o.name.split("/");
    if (!tenantId || !jobId || !uploaderId || !file) continue;
    const key = `${tenantId}/${jobId}/${uploaderId}`;
    const g = groups.get(key) ?? { tenantId, jobId, uploaderId, objects: [] };
    g.objects.push(o);
    groups.set(key, g);
  }
  return [...groups.values()];
}

const pacific = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", ...opts });

export function stuckPhotoEmail(input: {
  cleanerName: string; clientName: string; propertyName: string; scheduledStart: string | null; jobId: string; uploaderId: string; storedAt: string[];
}) {
  const n = input.storedAt.length;
  const photos = n === 1 ? "1 photo" : `${n} photos`;
  const day = input.scheduledStart ? pacific(input.scheduledStart, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date needs review";
  const first = input.storedAt[0], last = input.storedAt[n - 1];
  const when = first && last ? (first === last ? pacific(first, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : `${pacific(first, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${pacific(last, { hour: "numeric", minute: "2-digit" })}`) : "";
  return {
    subject: `${photos} didn't finish saving — ${input.cleanerName} at ${input.propertyName} — WRRCS`,
    text: [
      `${photos} from ${input.cleanerName} reached storage but never finished saving to the cleaning, so ${n === 1 ? "it isn't" : "they aren't"} showing on the appointment.`,
      "",
      `Cleaner: ${input.cleanerName}`,
      `Client: ${input.clientName}`,
      `Property: ${input.propertyName}`,
      `Cleaning: ${day}`,
      `Sent from the phone: ${when} (Pacific)`,
      "",
      `If ${input.cleanerName}'s phone still has ${n === 1 ? "it" : "them"}, ${n === 1 ? "it" : "they"} will finish saving the next time they open the app with signal. Otherwise ask them to take or send ${n === 1 ? "it" : "them"} again.`,
      `https://wrrcs.com/jobs/${input.jobId}?cleaner=${encodeURIComponent(input.uploaderId)}#photos`,
    ].join("\n"),
  };
}
