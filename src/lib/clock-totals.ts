export type ClockInterval = { started_at: string; ended_at: string | null; kind?: string };
export function intervalMinutes(entry: ClockInterval, now = Date.now(), from = -Infinity, to = Infinity) {
  return Math.max(0, Math.min(entry.ended_at ? Date.parse(entry.ended_at) : now, to) - Math.max(Date.parse(entry.started_at), from)) / 60000;
}
/** Daily totals clip durations, never the saved timestamps supplied to editors. */
export function dailyIntervalMinutes(entry: ClockInterval, window: { from: string; to: string }, now = Date.now()) {
  return intervalMinutes(entry, now, Date.parse(window.from), Date.parse(window.to));
}
// Lunch is its own interval, never a deduction from already-split paid intervals.
export function clockTotals(entries: ClockInterval[], now = Date.now()) {
  return entries.reduce((t, e) => {
    t[e.kind === "lunch" ? "unpaid" : "paid"] += intervalMinutes(e, now);
    return t;
  }, { paid: 0, unpaid: 0 });
}