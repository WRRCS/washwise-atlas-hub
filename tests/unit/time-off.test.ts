import { describe, expect, it } from "vitest";
import { defaultTimeOffHours, timeOffCoversDay, timeOffInputError, timeOffOverlaps, timeOffWindow } from "@/lib/time-off";

const TZ = "America/Los_Angeles";

describe("schedule time off", () => {
  it("a whole day runs midnight to midnight Pacific", () => {
    const w = timeOffWindow({ start_date: "2026-11-23", end_date: "2026-11-23", all_day: true }, TZ);
    expect(w.starts_at).toBe("2026-11-23T08:00:00.000Z");
    expect(w.ends_at).toBe("2026-11-24T08:00:00.000Z");
  });

  it("a few hours covers only those hours", () => {
    const w = timeOffWindow({ start_date: "2026-11-23", end_date: "2026-11-23", all_day: false, start_time: "13:00", end_time: "16:00" }, TZ);
    expect(w.starts_at).toBe("2026-11-23T21:00:00.000Z");
    expect(w.ends_at).toBe("2026-11-24T00:00:00.000Z");
  });

  it("suggests 8 hours per whole day and the length of a part day", () => {
    expect(defaultTimeOffHours({ start_date: "2026-11-23", end_date: "2026-11-25", all_day: true })).toBe(24);
    expect(defaultTimeOffHours({ start_date: "2026-11-23", end_date: "2026-11-23", all_day: false, start_time: "09:00", end_time: "11:30" })).toBe(2.5);
  });

  it("part-day time off must be one day with the end after the start", () => {
    expect(timeOffInputError({ start_date: "2026-11-23", end_date: "2026-11-24", all_day: false, start_time: "09:00", end_time: "10:00" })).not.toBeNull();
    expect(timeOffInputError({ start_date: "2026-11-23", end_date: "2026-11-23", all_day: false, start_time: "10:00", end_time: "09:00" })).not.toBeNull();
    expect(timeOffInputError({ start_date: "2026-11-25", end_date: "2026-11-23", all_day: true })).not.toBeNull();
    expect(timeOffInputError({ start_date: "2026-11-23", end_date: "2026-11-25", all_day: true })).toBeNull();
  });

  it("shows on each covered day and flags overlapping cleanings only", () => {
    const row = { start_date: "2026-11-23", end_date: "2026-11-24", starts_at: "2026-11-23T21:00:00.000Z", ends_at: "2026-11-24T00:00:00.000Z" };
    expect(timeOffCoversDay(row, "2026-11-24")).toBe(true);
    expect(timeOffCoversDay(row, "2026-11-25")).toBe(false);
    expect(timeOffOverlaps(row, "2026-11-23T18:00:00.000Z", "2026-11-23T20:00:00.000Z")).toBe(false); // 10am-12pm
    expect(timeOffOverlaps(row, "2026-11-23T22:00:00.000Z", "2026-11-23T23:00:00.000Z")).toBe(true); // 2pm-3pm
  });
});
