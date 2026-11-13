import { describe, expect, it } from "vitest";
import { coveringTimes, needsSplitChoice, ownHours, withOwnHours } from "@/lib/cleaner-hours";

const job = {
  scheduled_start: "2026-11-17T18:00:00.000Z", // Tue 10:00 am Pacific
  scheduled_end: "2026-11-17T20:00:00.000Z", // 12:00 pm
  assignees: [
    { id: "ana", scheduled_start: null, scheduled_end: null },
    { id: "bo", scheduled_start: "2026-11-17T18:00:00.000Z", scheduled_end: "2026-11-17T19:00:00.000Z" },
  ],
};

describe("per-cleaner hours", () => {
  it("a cleaner with their own hours keeps them (10–11) while the other follows the cleaning (10–12)", () => {
    expect(ownHours(job, "bo")).toEqual({ scheduled_start: "2026-11-17T18:00:00.000Z", scheduled_end: "2026-11-17T19:00:00.000Z" });
    expect(ownHours(job, "ana")).toEqual({ scheduled_start: "2026-11-17T18:00:00.000Z", scheduled_end: "2026-11-17T20:00:00.000Z" });
  });

  it("a cleaner's row shows their hours but remembers the cleaning's time", () => {
    const row = withOwnHours(job, "bo");
    expect(row.scheduled_end).toBe("2026-11-17T19:00:00.000Z");
    expect(row.job_end).toBe("2026-11-17T20:00:00.000Z");
    expect(row.own_hours).toBe(true);
    expect(withOwnHours(job, "ana").own_hours).toBe(false);
  });

  it("moving one of several cleaners to another day asks about the invoice", () => {
    expect(needsSplitChoice(2, "2026-11-17", "2026-11-19")).toBe(true);
  });

  it("moving the only cleaner, or staying on the same day, does not ask", () => {
    expect(needsSplitChoice(1, "2026-11-17", "2026-11-19")).toBe(false);
    expect(needsSplitChoice(3, "2026-11-17", "2026-11-17")).toBe(false);
  });

  it("a cleaner moved to 12–1 grows a 10–12 cleaning to 10–1 and flags it", () => {
    const r = coveringTimes(job, { scheduled_start: "2026-11-17T20:00:00.000Z", scheduled_end: "2026-11-17T21:00:00.000Z" });
    expect(r).toEqual({ scheduled_start: "2026-11-17T18:00:00.000Z", scheduled_end: "2026-11-17T21:00:00.000Z", grew: true });
  });

  it("a shorter cleaner inside the cleaning never changes the client's time", () => {
    const r = coveringTimes(job, { scheduled_start: "2026-11-17T18:30:00.000Z", scheduled_end: "2026-11-17T19:00:00.000Z" });
    expect(r.grew).toBe(false);
    expect(r.scheduled_start).toBe(job.scheduled_start);
    expect(r.scheduled_end).toBe(job.scheduled_end);
  });
});
