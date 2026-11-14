import { dailyIntervalMinutes } from "@/lib/clock-totals";
import { weeklyPay } from "@/lib/pay-calc";

type Row = {
  employee_id: string; employee_name: string; job_id: string | null; client: string; property: string | null;
  scheduled_start: string | null; scheduled_end: string | null; arrived_at: string | null; left_at: string | null;
  drive_min: number; attendance_status?: string | null;
};
type Entry = { employee_id: string; employee_name: string; started_at: string; ended_at: string | null; job_id?: string | null; activity_type?: string };
export type DayData = { from: string; to: string; rows: Row[]; entries: Entry[]; clockRecords?: { employee_id: string; employee_name: string; kind: string; started_at: string; ended_at: string | null }[] };

/** Paid total = clock in → clock out (open entry counts to now); falls back to on-site + drive when no clock entry exists. */
export function computeTotals(data: DayData | undefined, now = Date.now()) {
  const m = new Map<string, { id: string; name: string; onSite: number; clocked: number; unpaid: number; hasClock: boolean; legacy: number; explicitDrive: number; corrected: boolean }>();
  const get = (id: string, name: string) => { const t = m.get(id) ?? { id, name, onSite: 0, clocked: 0, unpaid: 0, hasClock: false, legacy: 0, explicitDrive: 0, corrected: false }; m.set(id, t); return t; };
  for (const r of data?.rows ?? []) {
    const t = get(r.employee_id, r.employee_name);
    const on = r.arrived_at && data ? dailyIntervalMinutes({ started_at: r.arrived_at, ended_at: r.left_at }, data, now) : 0;
    t.onSite += on; if (r.attendance_status) t.corrected = true;
    t.legacy += on + (r.drive_min ?? 0);
  }
  if (data) {
    for (const e of data.entries) { const t = get(e.employee_id, e.employee_name); t.clocked += dailyIntervalMinutes(e, data, now); if (e.activity_type === "drive") t.explicitDrive += dailyIntervalMinutes(e, data, now); t.hasClock = true; }
    for (const e of data.clockRecords ?? []) if (e.kind === "lunch") { const t = get(e.employee_id, e.employee_name); t.unpaid += dailyIntervalMinutes(e, data, now); t.hasClock = true; }
  }
  return Array.from(m.values())
    .map((t) => { const total = t.hasClock ? t.clocked : t.legacy; return { ...t, total, drive: t.corrected || t.explicitDrive > 0 ? t.explicitDrive : Math.max(0, total - t.onSite) }; })
    .filter((t) => t.total > 0 || t.unpaid > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PayLine = {
  key: string; dayIndex: number; client: string; property: string | null;
  scheduled_start: string | null; arrived_at: string | null; left_at: string | null;
  scheduledMin: number; paidMin: number; cents: number | null; other: boolean;
};
export type PayGroup = {
  id: string; name: string; rateCents: number | null; lines: PayLine[];
  timeCards: number; scheduledMin: number; paidMin: number; unpaidMin: number;
  cents: number | null; overtimeMin: number;
};

const span = (a: string | null, b: string | null) => (a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000) : 0);

/**
 * Groups a Mon–Sun week by employee with one line per cleaning. Line paid hours add up exactly
 * to the employee's paid day total; time not tied to a listed cleaning becomes a "drive / other" line.
 * Wages are priced line by line in time order so weekly overtime (over 40 hrs) lands on the right lines.
 */
export function buildPayPeriod(days: (DayData | undefined)[], rates: Record<string, number> | null, now = Date.now()): PayGroup[] {
  const groups = new Map<string, PayGroup>();
  const group = (id: string, name: string) => {
    let g = groups.get(id);
    if (!g) { g = { id, name, rateCents: rates?.[id] ?? null, lines: [], timeCards: 0, scheduledMin: 0, paidMin: 0, unpaidMin: 0, cents: null, overtimeMin: 0 }; groups.set(id, g); }
    return g;
  };
  days.forEach((data, dayIndex) => {
    if (!data) return;
    const totals = new Map(computeTotals(data, now).map((t) => [t.id, t]));
    const byEmp = new Map<string, Row[]>();
    for (const r of data.rows) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) ?? []), r]);
    const emps = new Set<string>([...byEmp.keys(), ...totals.keys()]);
    for (const emp of emps) {
      const rows = byEmp.get(emp) ?? [];
      const tot = totals.get(emp);
      const g = group(emp, rows[0]?.employee_name ?? tot?.name ?? "Unknown");
      const hasClock = !!tot?.hasClock;
      const byJob = new Map<string, Row[]>();
      for (const r of rows) { const k = r.job_id ?? `row-${byJob.size}`; byJob.set(k, [...(byJob.get(k) ?? []), r]); }
      const dayLines: PayLine[] = [];
      for (const [job, list] of byJob) {
        const first = list[0];
        const arrived = list.map((r) => r.arrived_at).filter(Boolean).sort()[0] ?? null;
        const lefts = list.map((r) => r.left_at);
        const left = arrived && lefts.every(Boolean) ? (lefts as string[]).sort().at(-1)! : null;
        const paidMin = hasClock
          ? data.entries.filter((e) => e.employee_id === emp && e.job_id === job).reduce((s, e) => s + dailyIntervalMinutes(e, data, now), 0)
          : list.reduce((s, r) => s + (r.arrived_at ? dailyIntervalMinutes({ started_at: r.arrived_at, ended_at: r.left_at }, data, now) : 0) + (r.drive_min ?? 0), 0);
        dayLines.push({
          key: `${dayIndex}|${emp}|${job}`, dayIndex, client: first.client, property: first.property, scheduled_start: first.scheduled_start,
          arrived_at: arrived, left_at: left, scheduledMin: span(first.scheduled_start, first.scheduled_end),
          paidMin, cents: null, other: false,
        });
      }
      dayLines.sort((a, b) => (a.arrived_at ?? a.scheduled_start ?? "").localeCompare(b.arrived_at ?? b.scheduled_start ?? ""));
      const dayTotal = tot?.total ?? 0;
      const rest = dayTotal - dayLines.reduce((s, l) => s + l.paidMin, 0);
      if (rest >= 0.5) dayLines.push({ key: `${dayIndex}|${emp}|other`, dayIndex, client: "Drive / other work", property: null, scheduled_start: null, arrived_at: null, left_at: null, scheduledMin: 0, paidMin: rest, cents: null, other: true });
      g.lines.push(...dayLines);
      g.unpaidMin += tot?.unpaid ?? 0;
    }
  });
  for (const g of groups.values()) {
    g.timeCards = g.lines.filter((l) => l.paidMin > 0).length;
    g.scheduledMin = g.lines.reduce((s, l) => s + l.scheduledMin, 0);
    g.paidMin = g.lines.reduce((s, l) => s + l.paidMin, 0);
    if (g.rateCents) {
      const pay = weeklyPay(g.lines.map((l) => l.paidMin), g.rateCents);
      g.lines.forEach((l, i) => { l.cents = pay.days[i].cents; });
      g.cents = pay.totalCents; g.overtimeMin = pay.overtimeMin;
    }
  }
  return [...groups.values()].filter((g) => g.lines.length > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** Rounds hours the way timesheets display them: two decimals. */
export const hours2 = (min: number) => (min / 60).toFixed(2);
