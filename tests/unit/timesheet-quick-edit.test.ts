import { describe, expect, it } from "vitest";
import { nextDayKey, repeatedLineKeys, resolveLineTimes } from "@/lib/timesheet-quick-edit";

const tz = "America/Los_Angeles";

describe("timesheet quick edit times", () => {
  it("a clock-out earlier than clock-in rolls to the next day", () => {
    const r = resolveLineTimes({ dayKey: "2026-11-12", tz, inTime: "22:00", outTime: "01:30" });
    expect(r.arrived_at).toBe("2026-11-13T06:00:00.000Z");
    expect(r.left_at).toBe("2026-11-13T09:30:00.000Z");
  });

  it("a forgotten clock-out is set on the same day as the clock-in", () => {
    const original = { arrived_at: "2026-11-12T19:55:21.476+00:00", left_at: null };
    const r = resolveLineTimes({ dayKey: "2026-11-12", tz, inTime: "11:55", outTime: "14:00", original });
    expect(r.arrived_at).toBe(original.arrived_at); // untouched box keeps the exact original time
    expect(r.left_at).toBe("2026-11-12T22:00:00.000Z");
  });

  it("requires a clock-in time", () => {
    expect(() => resolveLineTimes({ dayKey: "2026-11-12", tz, inTime: "", outTime: "14:00" })).toThrow("Enter a clock-in time");
  });

  it("next day crosses month ends", () => {
    expect(nextDayKey("2026-11-30")).toBe("2026-12-01");
  });
});

describe("repeated lines", () => {
  const base = { employee_id: "masha", job_id: "job1" };
  it("flags Masha's 1–2 second taps but not her real visit", () => {
    const keys = repeatedLineKeys([
      { ...base, key: "a", arrived_at: "2026-11-12T19:55:18.494Z", left_at: "2026-11-12T19:55:19.543Z" },
      { ...base, key: "b", arrived_at: "2026-11-12T19:55:19.543Z", left_at: "2026-11-12T19:55:21.476Z" },
      { ...base, key: "c", arrived_at: "2026-11-12T19:55:21.476Z", left_at: "2026-11-12T22:06:08Z" },
    ]);
    expect([...keys].sort()).toEqual(["a", "b"]);
  });

  it("flags the second of two overlapping lines started together (Alina)", () => {
    const keys = repeatedLineKeys([
      { ...base, key: "first", arrived_at: "2026-11-12T19:33:38.909Z", left_at: "2026-11-12T21:55:08Z" },
      { ...base, key: "second", arrived_at: "2026-11-12T19:33:39.042Z", left_at: "2026-11-12T21:55:08Z" },
    ]);
    expect([...keys]).toEqual(["second"]);
  });

  it("does not flag separate visits at the same appointment", () => {
    const keys = repeatedLineKeys([
      { ...base, key: "am", arrived_at: "2026-11-12T17:00:00Z", left_at: "2026-11-12T19:00:00Z" },
      { ...base, key: "pm", arrived_at: "2026-11-12T20:00:00Z", left_at: "2026-11-12T22:00:00Z" },
    ]);
    expect(keys.size).toBe(0);
  });
});
