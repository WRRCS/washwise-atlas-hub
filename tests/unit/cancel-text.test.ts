import { describe, expect, it } from "vitest";
import { shouldTextOnCancel, cancelTextBody } from "@/lib/cancel-text";

const now = new Date("2026-11-17T19:00:00Z");

describe("cleaners are texted when a published cleaning is canceled", () => {
  it("texts for a published upcoming cleaning", () => {
    expect(shouldTextOnCancel({ status: "scheduled", published_at: "2026-11-16T06:14:27Z", scheduled_end: "2026-11-17T22:00:00Z" }, now)).toBe(true);
  });
  it("does not text for an unpublished draft cleaning", () => {
    expect(shouldTextOnCancel({ status: "scheduled", published_at: null, scheduled_end: "2026-11-17T22:00:00Z" }, now)).toBe(false);
  });
  it("does not text for a cleaning that is already over", () => {
    expect(shouldTextOnCancel({ status: "scheduled", published_at: "2026-11-16T06:14:27Z", scheduled_end: "2026-11-17T18:00:00Z" }, now)).toBe(false);
  });
  it("does not text again for a cleaning already canceled", () => {
    expect(shouldTextOnCancel({ status: "canceled", published_at: "2026-11-16T06:14:27Z", scheduled_end: "2026-11-17T22:00:00Z" }, now)).toBe(false);
  });
  it("uses the approved English wording with client, day and time", () => {
    expect(cancelTextBody({ clientName: "Diane Hollands", startISO: "2026-11-17T20:00:00Z", tz: "America/Los_Angeles" }))
      .toBe("Wash Rinse Repeat Cleaning: Your cleaning for Diane Hollands on Tue, Nov 17 at 12:00 PM has been canceled. Please check your schedule in the app.");
  });
});
