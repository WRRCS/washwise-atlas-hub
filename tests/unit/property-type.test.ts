import { describe, expect, it } from "vitest";
import { requirePropertyType, selectedPropertyType } from "../../src/lib/property-type";

describe("persistent property types", () => {
  it("uses the saved type rather than a stale scheduling value", () => {
    expect(requirePropertyType("Office", "Airbnb")).toBe("Office");
  });
  it("asks when a property has no saved or supplied type", () => {
    expect(() => requirePropertyType(null, " ")).toThrow("Enter this property's type");
    expect(requirePropertyType(null, " Airbnb ")).toBe("Airbnb");
  });
  it("keeps two properties independent", () => {
    const draft = { key: "client:home", value: "Residence" };
    expect(selectedPropertyType("client:home", null, draft)).toBe("Residence");
    expect(selectedPropertyType("client:office", "Office", draft)).toBe("Office");
  });
  it("clears missing types when switching properties or clients", () => {
    const draft = { key: "client:home", value: "Residence" };
    expect(selectedPropertyType("client:office", null, draft)).toBe("");
    expect(selectedPropertyType("other:home", null, draft)).toBe("");
  });
});