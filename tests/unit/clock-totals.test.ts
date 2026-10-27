import { describe, expect, it } from "vitest";
import { clockTotals, dailyIntervalMinutes, intervalMinutes } from "../../src/lib/clock-totals";
const at = (h: string) => `2026-10-25T${h}:00Z`;
describe("explicit clock intervals", () => {
  it("splits overnight paid work between days without changing its real timestamps", () => {
    const entry = { started_at: "2026-10-26T06:00:00Z", ended_at: "2026-10-26T09:00:00Z" };
    expect(dailyIntervalMinutes(entry, { from: "2026-10-25T07:00:00Z", to: "2026-10-26T07:00:00Z" })).toBe(60);
    expect(dailyIntervalMinutes(entry, { from: "2026-10-26T07:00:00Z", to: "2026-10-27T07:00:00Z" })).toBe(120);
    expect(entry).toEqual({ started_at: "2026-10-26T06:00:00Z", ended_at: "2026-10-26T09:00:00Z" });
  });
  it("bounds forgotten clock-outs and unpaid lunches without inventing an end", () => {
    const entry = { started_at: "2026-10-26T06:00:00Z", ended_at: null, kind: "lunch" };
    expect(dailyIntervalMinutes(entry, { from: "2026-10-25T07:00:00Z", to: "2026-10-26T07:00:00Z" }, Date.parse("2026-10-27T10:00:00Z"))).toBe(60);
    expect(entry.ended_at).toBeNull();
  });
  it("counts unscheduled work before and after lunch with lunch excluded exactly once", () => {
    expect(clockTotals([
      { started_at: at("09:00"), ended_at: at("12:00"), kind: "work" },
      { started_at: at("12:00"), ended_at: at("12:30"), kind: "lunch" },
      { started_at: at("12:30"), ended_at: at("17:00"), kind: "work" },
    ])).toEqual({ paid: 450, unpaid: 30 });
  });
  it("does not deduct an automatic lunch", () => {
    expect(clockTotals([{ started_at: at("09:00"), ended_at: at("17:00") }])).toEqual({ paid: 480, unpaid: 0 });
  });
  it("counts employee unscheduled clock-in, lunch, resume and clock-out as 7.5 paid hours", () => {
    const entries = [
      { started_at: at("09:00"), ended_at: at("12:00"), kind: "work" },
      { started_at: at("12:00"), ended_at: at("12:30"), kind: "lunch" },
      { started_at: at("12:30"), ended_at: at("17:00"), kind: "work" },
    ];
    const totals = clockTotals(entries);
    expect(totals.paid / 60).toBe(7.5);
    expect(totals.unpaid / 60).toBe(0.5);
    expect(entries.reduce((sum, entry) => sum + intervalMinutes(entry), 0)).toBe(480);
  });
  it("leaves an open lunch unpaid without inventing an end", () => {
    expect(clockTotals([{ started_at: at("12:00"), ended_at: null, kind: "lunch" }], Date.parse(at("13:00")))).toEqual({ paid: 0, unpaid: 60 });
  });
  it("clips overnight intervals to the selected day", () => {
    expect(intervalMinutes({ started_at: at("09:00"), ended_at: at("17:00") }, 0, Date.parse(at("12:00")), Date.parse(at("13:00")))).toBe(60);
  });
  it("reflects an admin lunch correction without double deduction", () => {
    expect(clockTotals([
      { started_at: at("09:00"), ended_at: at("12:00"), kind: "work" },
      { started_at: at("12:00"), ended_at: at("12:45"), kind: "lunch" },
      { started_at: at("12:45"), ended_at: at("17:00"), kind: "work" },
    ])).toEqual({ paid: 435, unpaid: 45 });
  });
});