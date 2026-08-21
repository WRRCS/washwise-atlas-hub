// Business-timezone helpers.
// All job times are stored in UTC; the schedule must always render in the
// business's own timezone (set in Business profile), not the device timezone.

export const DEFAULT_TZ = "America/New_York";

function partsIn(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Intl can return hour 24 for midnight
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset in ms between the given tz and UTC at that instant. */
function tzOffsetMs(date: Date, tz: string) {
  const p = partsIn(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

/** "2026-08-21" for an ISO instant, in the business timezone. */
export function dayKeyTZ(iso: string | Date, tz: string = DEFAULT_TZ) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = partsIn(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "9am" / "1:30pm" in the business timezone. */
export function fmtTimeTZ(iso: string | Date, tz: string = DEFAULT_TZ) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return s.toLowerCase().replace(":00", "").replace(/\s/g, "");
}

/** "Fri Aug 21" in the business timezone. */
export function fmtDateTZ(iso: string | Date, tz: string = DEFAULT_TZ) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Hour-of-day (0-23) and minute in the business timezone. */
export function hourMinuteTZ(iso: string | Date, tz: string = DEFAULT_TZ) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = partsIn(d, tz);
  return { hour: p.hour, minute: p.minute };
}

/**
 * Convert a wall-clock date + time in the business timezone into a UTC ISO string.
 * dateStr: "yyyy-MM-dd", timeStr: "HH:mm"
 */
export function zonedToUTCISO(dateStr: string, timeStr: string, tz: string = DEFAULT_TZ) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0));
  // Apply offset twice to settle DST boundaries.
  let result = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  result = new Date(guess.getTime() - tzOffsetMs(result, tz));
  return result.toISOString();
}
