import { describe, expect, it } from "vitest";
import { wantsPerVisitClientDraft } from "@/lib/month-end-billing";

describe("month-end-only clients", () => {
  it("skips the after-cleaning client draft for month-end clients", () => {
    expect(wantsPerVisitClientDraft({ bill_monthly: true })).toBe(false);
  });
  it("keeps the after-cleaning client draft for per-visit clients", () => {
    expect(wantsPerVisitClientDraft({ bill_monthly: false })).toBe(true);
    expect(wantsPerVisitClientDraft(null)).toBe(true);
  });
});
