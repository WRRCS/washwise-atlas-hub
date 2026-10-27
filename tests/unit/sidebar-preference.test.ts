import { describe, expect, it } from "vitest";
import { parseSidebarCollapsed, serializeSidebarCollapsed } from "@/lib/sidebar-preference";

describe("sidebar preference", () => {
  it("defaults to expanded for users with no saved choice", () => {
    expect(parseSidebarCollapsed(null)).toBe(false);
    expect(parseSidebarCollapsed(undefined)).toBe(false);
    expect(parseSidebarCollapsed("garbage")).toBe(false);
  });

  it("remembers a collapsed choice between sessions", () => {
    expect(parseSidebarCollapsed(serializeSidebarCollapsed(true))).toBe(true);
    expect(parseSidebarCollapsed(serializeSidebarCollapsed(false))).toBe(false);
  });
});
