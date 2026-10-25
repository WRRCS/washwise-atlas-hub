import { describe, expect, it } from "vitest";
import { clockTotals, intervalMinutes } from "../../src/lib/clock-totals";
const at = (h: string) => `2026-10-25T${h}:00Z`;
describe("explicit clock intervals", () => {
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