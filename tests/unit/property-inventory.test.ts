import { describe, expect, it } from "vitest";
import { INVENTORY_LEVELS, parseInventoryQuantity, validateInventoryEntry } from "@/lib/inventory";

describe("property inventory", () => {
  it("offers exactly High, Med, Low and Out for level items", () => {
    expect([...INVENTORY_LEVELS]).toEqual(["high", "med", "low", "out"]);
    expect(validateInventoryEntry("level", { level: "low", quantity: null })).toBe(true);
    expect(validateInventoryEntry("level", { level: "half", quantity: null })).toBe(false);
  });

  it("level items never accept a typed number", () => {
    expect(validateInventoryEntry("level", { level: null, quantity: 3 })).toBe(false);
  });

  it("count items (garbage bags, paper towels, toilet paper) take a typed whole number only", () => {
    expect(validateInventoryEntry("count", { level: null, quantity: 12 })).toBe(true);
    expect(validateInventoryEntry("count", { level: "high", quantity: null })).toBe(false);
    expect(validateInventoryEntry("count", { level: null, quantity: -1 })).toBe(false);
  });

  it("parses typed counts and rejects non-numbers", () => {
    expect(parseInventoryQuantity(" 8 ")).toEqual({ ok: true, value: 8 });
    expect(parseInventoryQuantity("")).toEqual({ ok: true, value: null });
    expect(parseInventoryQuantity("2.5")).toEqual({ ok: false });
    expect(parseInventoryQuantity("10000")).toEqual({ ok: false });
  });
});
