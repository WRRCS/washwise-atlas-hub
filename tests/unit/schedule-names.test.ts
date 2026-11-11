import { describe, expect, it } from "vitest";
import { canSeeScheduleHours, scheduleFirstNames } from "@/lib/schedule-names";

describe("schedule first names", () => {
  it("shows only the first name", () => {
    expect(scheduleFirstNames([{ id: "a", full_name: "Alina Horiunenko" }]).get("a")).toBe("Alina");
  });
  it("uses a nickname in parentheses", () => {
    expect(scheduleFirstNames([{ id: "m", full_name: "Maria (Masha) Kutsynska" }]).get("m")).toBe("Masha");
  });
  it("adds a last initial when two people share a first name", () => {
    const names = scheduleFirstNames([
      { id: "1", full_name: "Leslie Walker" },
      { id: "2", full_name: "Leslie Casanova" },
    ]);
    expect(names.get("1")).toBe("Leslie W.");
    expect(names.get("2")).toBe("Leslie C.");
  });
});

describe("schedule hours visibility", () => {
  it("owners and managers see everyone's hours", () => {
    expect(canSeeScheduleHours({ isOwnerOrManager: true, userId: "boss" }, "someone")).toBe(true);
  });
  it("employees see their own hours", () => {
    expect(canSeeScheduleHours({ isOwnerOrManager: false, userId: "me" }, "me")).toBe(true);
  });
  it("employees do not see a teammate's hours", () => {
    expect(canSeeScheduleHours({ isOwnerOrManager: false, userId: "me" }, "teammate")).toBe(false);
  });
});
