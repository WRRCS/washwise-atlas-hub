import { describe, expect, it } from "vitest";
import { canManageSops } from "@/lib/sop-access";

describe("SOP library access", () => {
  it("lets owners and managers change SOPs", () => {
    expect(canManageSops(["owner"])).toBe(true);
    expect(canManageSops(["manager"])).toBe(true);
  });
  it("keeps employees read-only", () => {
    expect(canManageSops(["employee"])).toBe(false);
    expect(canManageSops([])).toBe(false);
  });
});
