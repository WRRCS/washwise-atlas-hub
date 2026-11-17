import { describe, expect, it } from "vitest";
import { visibleToEmployees, showsOnSchedule, shiftByDaysKeepTime, daysBetweenKeys } from "@/lib/schedule-publish";

const TZ = "America/Los_Angeles";

describe("employees only see published cleanings", () => {
  it("hides an unpublished upcoming cleaning", () => {
    expect(visibleToEmployees({ published_at: null, status: "scheduled" })).toBe(false);
  });
  it("shows a published cleaning", () => {
    expect(visibleToEmployees({ published_at: "2026-11-15T20:00:00Z", status: "scheduled" })).toBe(true);
  });
  it("keeps a cleaning that is already underway visible", () => {
    expect(visibleToEmployees({ published_at: null, status: "in_progress" })).toBe(true);
  });
});

describe("changing the day of a cleaning", () => {
  it("moves Wednesday 10–12 to Friday 10–12", () => {
    // Wed Nov 25 2026, 10:00–12:00 Pacific
    const { start, end } = shiftByDaysKeepTime("2026-11-25T18:00:00.000Z", "2026-11-25T20:00:00.000Z", 2, TZ);
    expect(start.toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-27T20:00:00.000Z");
  });
  it("keeps 10:00 AM across the November time change", () => {
    // Fri Oct 30 2026 10:00 PDT -> Mon Nov 2 2026 10:00 PST
    const { start } = shiftByDaysKeepTime("2026-10-30T17:00:00.000Z", "2026-10-30T19:00:00.000Z", 3, TZ);
    expect(start.toISOString()).toBe("2026-11-02T18:00:00.000Z");
  });
  it("counts days between two dates in the same week", () => {
    expect(daysBetweenKeys("2026-11-25", "2026-11-23")).toBe(-2);
  });
});

describe("canceled cleanings come off the schedule", () => {
  it("removes a canceled cleaning", () => {
    expect(showsOnSchedule({ status: "canceled" })).toBe(false);
  });
  it("keeps a scheduled cleaning", () => {
    expect(showsOnSchedule({ status: "scheduled" })).toBe(true);
  });
});
