import { describe, expect, it } from "vitest";
import { appointmentReminderStale, reminderTextBody, reminderTextDue } from "@/lib/employee-reminder-sms";

const job = { status: "scheduled", published_at: "2026-11-20T00:00:00Z", scheduled_start: "2026-11-23T18:00:00Z", assigned_to: null };

describe("team reminder texts", () => {
  it("sends a reminder that is due now", () => {
    expect(reminderTextDue("2026-11-23T17:00:00Z", new Date("2026-11-23T17:01:00Z"))).toBe("due");
  });
  it("drops a reminder more than 30 minutes late", () => {
    expect(reminderTextDue("2026-11-23T17:00:00Z", new Date("2026-11-23T17:31:00Z"))).toBe("expired");
  });
  it("does not text for an unpublished cleaning", () => {
    expect(appointmentReminderStale({ ...job, published_at: null }, true, "u1", job.scheduled_start)).toBe(true);
  });
  it("does not text for a canceled cleaning", () => {
    expect(appointmentReminderStale({ ...job, status: "canceled" }, true, "u1", job.scheduled_start)).toBe(true);
  });
  it("does not text a cleaner who was taken off the cleaning", () => {
    expect(appointmentReminderStale(job, false, "u1", job.scheduled_start)).toBe(true);
  });
  it("does not text after the cleaning moved to a new time", () => {
    expect(appointmentReminderStale(job, true, "u1", "2026-11-23T16:00:00Z")).toBe(true);
  });
  it("texts a published cleaning the cleaner is still on", () => {
    expect(appointmentReminderStale(job, true, "u1", job.scheduled_start)).toBe(false);
  });
  it("uses the cleaner's own start time when they have one", () => {
    expect(appointmentReminderStale(job, true, "u1", "2026-11-23T19:00:00Z", "2026-11-23T19:00:00Z")).toBe(false);
  });
  it("writes the text in Pacific time", () => {
    expect(reminderTextBody({ clientName: "Diane Hollands", startISO: "2026-11-23T18:00:00Z", tz: "America/Los_Angeles" }))
      .toBe("Wash Rinse Repeat Cleaning reminder: You're scheduled to clean for Diane Hollands on Mon, Nov 23 at 10:00 AM. Details are in the app.");
  });
  it("writes Ukrainian for Ukrainian cleaners", () => {
    expect(reminderTextBody({ clientName: "Diane", startISO: "2026-11-23T18:00:00Z", tz: "America/Los_Angeles", language: "uk" })).toContain("Нагадування");
  });
});
