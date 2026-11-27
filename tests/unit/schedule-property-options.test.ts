import { describe, expect, it } from "vitest";
import {
  schedulePropertyOptions,
  schedulePropertySelection,
  schedulePropertyValue,
} from "../../src/lib/schedule-property-options";

describe("schedule property-first selection", () => {
  const clients = [
    { id: "client-angela", first_name: "Angela", service_address: "10 Main St" },
    { id: "client-bobbie", first_name: "Bobbie", service_address: "20 Main St" },
  ];
  const locations = [
    {
      client_id: "client-bobbie",
      property_id: "property-beach",
      label: "Beach house",
      client_name: "Bobbie",
      address: "30 Beach Rd",
    },
  ];

  it("selecting a property supplies its client", () => {
    const options = schedulePropertyOptions(clients, locations);
    const selected = schedulePropertySelection(
      options,
      schedulePropertyValue("client-bobbie", "property-beach"),
    );
    expect(selected).toEqual({ clientId: "client-bobbie", propertyId: "property-beach" });
  });

  it("selecting an eligible main address also supplies its client", () => {
    const options = schedulePropertyOptions(clients, locations);
    const selected = schedulePropertySelection(
      options,
      schedulePropertyValue("client-angela", "__main"),
    );
    expect(selected).toEqual({ clientId: "client-angela", propertyId: "__main" });
  });

  it("does not duplicate a main address already saved as a property", () => {
    const options = schedulePropertyOptions(
      [{ id: "client-angela", first_name: "Angela", service_address: "10 Main St" }],
      [{
        client_id: "client-angela",
        property_id: "property-main",
        label: "Home",
        client_name: "Angela",
        address: "10 Main St",
      }],
    );
    expect(options.filter((option) => option.address === "10 Main St")).toHaveLength(1);
  });
});
