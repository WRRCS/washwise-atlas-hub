import { zonedToUTCISO, hourMinuteTZ, dayKeyTZ } from "@/lib/tz";

/** "2026-11-12" -> "2026-11-13" (calendar arithmetic, no time zone involved). */
export function nextDayKey(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

/** "HH:mm" wall-clock time of an instant in the business time zone. */
export function wallTime(iso: string | null, tz: string) {
  if (!iso) return "";
  const { hour, minute } = hourMinuteTZ(iso, tz);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Turn the clock-in / clock-out boxes into instants. Clock-out earlier than (or equal to)
 * clock-in means the cleaner worked past midnight, so it lands on the next day.
 * Untouched boxes keep the exact original instant so nothing shifts by seconds.
 */
export function resolveLineTimes(opts: {
  dayKey: string; tz: string; inTime: string; outTime: string;
  original?: { arrived_at: string | null; left_at: string | null };
}) {
  const { tz, inTime, outTime, original } = opts;
  if (!inTime) throw new Error("Enter a clock-in time");
  const keepIn = original?.arrived_at && wallTime(original.arrived_at, tz) === inTime;
  const day = original?.arrived_at ? dayKeyTZ(original.arrived_at, tz) : opts.dayKey;
  const arrived = keepIn ? original!.arrived_at! : zonedToUTCISO(day, inTime, tz);
  if (!outTime) return { arrived_at: arrived, left_at: null as string | null };
  const keepOut = original?.left_at && wallTime(original.left_at, tz) === outTime && Date.parse(original.left_at) > Date.parse(arrived);
  if (keepOut) return { arrived_at: arrived, left_at: original!.left_at! };
  const arrivedDay = dayKeyTZ(arrived, tz);
  let left = zonedToUTCISO(arrivedDay, outTime, tz);
  if (Date.parse(left) <= Date.parse(arrived)) left = zonedToUTCISO(nextDayKey(arrivedDay), outTime, tz);
  return { arrived_at: arrived, left_at: left };
}

type Line = { key: string; employee_id: string; job_id: string | null; arrived_at: string | null; left_at: string | null };

/**
 * Lines created by repeated taps: under a minute long while the cleaner has another line at the
 * same appointment, or started within a minute of an earlier line that was still open.
 */
export function repeatedLineKeys(rows: Line[]) {
  const out = new Set<string>();
  const groups = new Map<string, Line[]>();
  for (const r of rows) if (r.arrived_at) groups.set(`${r.employee_id}|${r.job_id}`, [...(groups.get(`${r.employee_id}|${r.job_id}`) ?? []), r]);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(a.arrived_at!) - Date.parse(b.arrived_at!));
    sorted.forEach((r, i) => {
      const start = Date.parse(r.arrived_at!);
      if (r.left_at && Date.parse(r.left_at) - start < 60_000) { out.add(r.key); return; }
      for (let j = 0; j < i; j++) {
        const prev = sorted[j]!;
        const prevStart = Date.parse(prev.arrived_at!);
        const stillOpen = !prev.left_at || Date.parse(prev.left_at) > start;
        if (start - prevStart <= 60_000 && stillOpen) { out.add(r.key); return; }
      }
    });
  }
  return out;
}
