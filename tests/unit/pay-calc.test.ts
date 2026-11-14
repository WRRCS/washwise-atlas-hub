import { describe, expect, it } from "vitest";
import { weeklyPay } from "../../src/lib/pay-calc";

describe("timesheet earnings", () => {
  it("pays straight time up to 40 hours a week", () => {
    const r = weeklyPay([8 * 60, 8 * 60, 8 * 60, 8 * 60, 8 * 60, 0, 0], 2500);
    expect(r.totalCents).toBe(100000);
    expect(r.overtimeMin).toBe(0);
  });
  it("pays 1.5x for hours over 40 in the week, on the day it happens", () => {
    const r = weeklyPay([9 * 60, 9 * 60, 9 * 60, 9 * 60, 9 * 60, 0, 0], 2500);
    expect(r.overtimeMin).toBe(5 * 60);
    expect(r.days[4]).toEqual({ regularMin: 4 * 60, overtimeMin: 5 * 60, cents: 4 * 2500 + 5 * 3750 });
    expect(r.totalCents).toBe(40 * 2500 + 5 * 3750);
  });
  it("counts earlier days of the week when pricing a single day", () => {
    const r = weeklyPay([3 * 60], 2300, 38 * 60);
    expect(r.days[0]).toEqual({ regularMin: 120, overtimeMin: 60, cents: 2 * 2300 + 3450 });
  });
});
