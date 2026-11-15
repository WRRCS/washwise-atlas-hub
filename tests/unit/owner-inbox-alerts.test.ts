import { describe, expect, it } from "vitest";
import { formatDateRange, formatReceivedAt, inboxAlertSubject, inboxAlertText, needsEnglishTranslation } from "@/lib/owner-inbox-alerts";

describe("owner emails for incoming requests and messages", () => {
  it("titles each email by what it is", () => {
    expect(inboxAlertSubject("time_off", "Masha")).toBe("Time off request — Masha");
    expect(inboxAlertSubject("client_message", "Angela Smith")).toBe("Client message — Angela Smith");
    expect(inboxAlertSubject("employee_message", "Dalton Inkster")).toBe("Employee message — Dalton Inkster");
  });
  it("translates Ukrainian text, not English", () => {
    expect(needsEnglishTranslation("Мені потрібен вихідний у понеділок")).toBe(true);
    expect(needsEnglishTranslation("I need Monday off")).toBe(false);
  });
  it("shows the day and time of day the request came in, in Pacific time", () => {
    expect(formatReceivedAt("2026-11-15T05:33:00Z")).toBe("Saturday, November 14, 2026 at 9:33 PM PST");
  });
  it("shows which days are requested off", () => {
    expect(formatDateRange("2026-11-17", "2026-11-19")).toBe("Tuesday, November 17, 2026 through Thursday, November 19, 2026 (3 days)");
    expect(formatDateRange("2026-11-17", "2026-11-17")).toBe("Tuesday, November 17, 2026 (1 day)");
  });
  it("puts the English translation first and keeps the original", () => {
    const text = inboxAlertText({ kind: "time_off", from: "Masha", receivedAt: "2026-11-15T05:33:00Z", message: "Лікар", translation: "Doctor", link: "https://wrrcs.com/requests", linkLabel: "Approve, decline or ask a question" });
    expect(text.indexOf("Doctor")).toBeLessThan(text.indexOf("Лікар"));
    expect(text).toContain("translated from Ukrainian");
  });
});
