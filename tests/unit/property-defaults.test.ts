import { describe, expect, it } from "vitest";
import { defaultServiceTypeId, serviceDefaultOverridden } from "../../src/lib/property-type";

describe("persistent property service defaults", () => {
  it("returns the saved default service for a property", () => {
    expect(defaultServiceTypeId({ default_service_type_id: "svc-1" })).toBe("svc-1");
  });
  it("returns empty when no default is saved or no property is selected", () => {
    expect(defaultServiceTypeId({ default_service_type_id: null })).toBe("");
    expect(defaultServiceTypeId(null)).toBe("");
    expect(defaultServiceTypeId(undefined)).toBe("");
  });
  it("keeps two properties' defaults independent", () => {
    const beach = { default_service_type_id: "svc-airbnb" };
    const office = { default_service_type_id: "svc-commercial" };
    expect(defaultServiceTypeId(beach)).toBe("svc-airbnb");
    expect(defaultServiceTypeId(office)).toBe("svc-commercial");
  });
  it("detects an override only when the choice differs from the saved default", () => {
    const property = { default_service_type_id: "svc-1" };
    expect(serviceDefaultOverridden(property, "svc-2")).toBe(true);
    expect(serviceDefaultOverridden(property, "svc-1")).toBe(false);
  });
  it("never offers an override without a property or a chosen service", () => {
    expect(serviceDefaultOverridden(null, "svc-1")).toBe(false);
    expect(serviceDefaultOverridden({ default_service_type_id: "svc-1" }, "")).toBe(false);
  });
  it("treats a first-time choice on a property without defaults as not an override", () => {
    expect(serviceDefaultOverridden({ default_service_type_id: null }, "svc-1")).toBe(true);
  });
});
