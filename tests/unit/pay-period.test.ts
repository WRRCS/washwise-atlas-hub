import { describe, expect, it } from "vitest";
import { buildPayPeriod, type DayData } from "@/lib/pay-period";

const day = (date: string, extra: Partial<DayData>): DayData => ({
  from: `${date}T08:00:00.000Z`, to: new Date(Date.parse(`${date}T08:00:00.000Z`) + 86400000).toISOString(),
  rows: [], entries: [], clockRecords: [], ...extra,
});
const row = (job: string, client: string, sched: [string, string], arrived: string | null, left: string | null) => ({
  employee_id: "alina", employee_name: "Alina Horiunenko", job_id: job, client, property: null,
  scheduled_start: sched[0], scheduled_end: sched[1], arrived_at: arrived, left_at: left, drive_min: 0, attendance_status: null,
});
const entry = (job: string | null, start: string, end: string) => ({ employee_id: "alina", employee_name: "Alina Horiunenko", job_id: job, started_at: start, ended_at: end });

describe("pay period by employee", () => {
  it("lists one line per cleaning with scheduled hours, paid hours and wages at the hourly rate", () => {
    const mon = day("2026-11-09", {
      rows: [
        row("j1", "ANGELA", ["2026-11-09T18:00:00Z", "2026-11-09T21:00:00Z"], "2026-11-09T18:00:00Z", "2026-11-09T21:00:00Z"),
        row("j2", "JAN", ["2026-11-09T22:00:00Z", "2026-11-09T23:30:00Z"], null, null),
      ],
      entries: [entry("j1", "2026-11-09T18:00:00Z", "2026-11-09T21:00:00Z")],
    });
    const [g] = buildPayPeriod([mon], { alina: 2500 });
    expect(g.lines.map((l) => [l.client, l.scheduledMin, l.paidMin, l.cents])).toEqual([
      ["ANGELA", 180, 180, 7500],
      ["JAN", 90, 0, 0],
    ]);
    expect(g.timeCards).toBe(1);
    expect(g.scheduledMin).toBe(270);
    expect(g.paidMin).toBe(180);
    expect(g.cents).toBe(7500);
  });

  it("adds clocked time outside any cleaning as a drive / other line so lines add up to paid total", () => {
    const mon = day("2026-11-09", {
      rows: [row("j1", "ANGELA", ["2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z"], "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z")],
      entries: [entry("j1", "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z"), entry(null, "2026-11-09T19:00:00Z", "2026-11-09T19:30:00Z")],
    });
    const [g] = buildPayPeriod([mon], { alina: 2500 });
    expect(g.lines.at(-1)).toMatchObject({ other: true, paidMin: 30, cents: 1250 });
    expect(g.paidMin).toBe(90);
    expect(g.cents).toBe(3750);
  });

  it("pays 1.5x on the cleaning that goes past 40 hours in the Mon–Sun week", () => {
    const days = Array.from({ length: 5 }, (_, i) => {
      const d = `2026-11-${String(9 + i).padStart(2, "0")}`;
      return day(d, { rows: [row(`j${i}`, `C${i}`, [`${d}T16:00:00Z`, `${d}T01:00:00Z`], `${d}T16:00:00Z`, null)], entries: [entry(`j${i}`, `${d}T16:00:00Z`, `${d}T23:00:00Z`)] });
    });
    // 5 days × 7h = 35h, then a sixth day of 7h: 5h regular + 2h overtime.
    const sat = day("2026-11-14", { rows: [row("j5", "C5", ["2026-11-14T16:00:00Z", "2026-11-14T23:00:00Z"], "2026-11-14T16:00:00Z", "2026-11-14T23:00:00Z")], entries: [entry("j5", "2026-11-14T16:00:00Z", "2026-11-14T23:00:00Z")] });
    const [g] = buildPayPeriod([...days, sat], { alina: 2000 });
    expect(g.overtimeMin).toBe(120);
    expect(g.lines.at(-1)!.cents).toBe(5 * 2000 + 2 * 3000);
    expect(g.cents).toBe(35 * 2000 + 5 * 2000 + 2 * 3000);
  });

  it("shows no wages when the employee has no rate", () => {
    const mon = day("2026-11-09", { rows: [row("j1", "ANGELA", ["2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z"], "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z")], entries: [entry("j1", "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z")] });
    const [g] = buildPayPeriod([mon], null);
    expect(g.cents).toBeNull();
    expect(g.lines[0].cents).toBeNull();
  });
});
