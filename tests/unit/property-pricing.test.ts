import { describe, expect, it } from "vitest";
import { FREQUENCY_OPTIONS, normalizeFrequency, pricingTypeOf, newJobPriceCents } from "@/lib/property-pricing";

describe("property service frequency", () => {
  it("offers weekly, biweekly, monthly and one-off", () => {
    expect([...FREQUENCY_OPTIONS]).toEqual(["Weekly", "Biweekly", "Monthly", "One-off"]);
  });
  it("maps older typed values onto the dropdown", () => {
    expect(normalizeFrequency("Bi-weekly")).toBe("Biweekly");
    expect(normalizeFrequency("Oneoff")).toBe("One-off");
    expect(normalizeFrequency("Moveout")).toBe("Moveout");
  });
});

describe("property pricing", () => {
  it("flat rate properties pre-fill their price on a new cleaning", () => {
    expect(newJobPriceCents({ pricing_type: "flat", price_cents: 14000 })).toBe(14000);
  });
  it("hourly properties leave the cleaning price blank so it bills by the hour", () => {
    expect(newJobPriceCents({ pricing_type: "hourly", price_cents: 5000 })).toBeNull();
  });
  it("older properties with a price count as flat rate", () => {
    expect(pricingTypeOf({ pricing_type: null, price_cents: 26000 })).toBe("flat");
    expect(pricingTypeOf({ pricing_type: null, price_cents: null })).toBe("hourly");
  });
});
