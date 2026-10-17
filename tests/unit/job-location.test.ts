import { describe, expect, it } from "vitest";
import { jobLocation } from "../../src/lib/job-location";

describe("appointment locations", () => {
  it("keeps Property B with its unit rather than Property A", () => {
    expect(jobLocation({ service_address: "456 Oak Avenue, Unit 2", service_location_label: "Property B", property: { address: "123 Main Street", label: "Property A" } })).toEqual({ address: "456 Oak Avenue, Unit 2", label: "Property B", display: "Property B — 456 Oak Avenue, Unit 2" });
  });
  it("keeps separate appointments independent", () => {
    expect(jobLocation({ service_address: "123 Main Street" }).address).toBe("123 Main Street");
    expect(jobLocation({ service_address: "456 Oak Avenue, Unit 2" }).address).toBe("456 Oak Avenue, Unit 2");
  });
  it("flags ambiguous legacy appointments instead of guessing", () => {
    expect(jobLocation({ location_needs_review: true }).display).toBe("Location needs review");
  });
});