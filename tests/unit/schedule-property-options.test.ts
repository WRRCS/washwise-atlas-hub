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

  it("hides the main address when the client has a saved property", () => {
    const options = schedulePropertyOptions(
      [{ id: "c1", company_name: "Birch Bay Water & Sewer", service_address: "Point Whitehorn Road, Birch Bay, Washington" }],
      [{ client_id: "c1", property_id: "p1", label: "BBWSD", client_name: "Birch Bay Water & Sewer", address: "Point Whitehorn Road, Birch Bay" }],
    );
    expect(options.map((o) => o.label)).toEqual(["BBWSD"]);
  });

  it("sorts alphabetically by the short property name", () => {
    const options = schedulePropertyOptions(
      [{ id: "c2", first_name: "Audrey", last_name: "Fine", service_address: "1 A St" }],
      [
        { client_id: "c1", property_id: "p1", label: "Chuckanut", client_name: "Chuckanut Bay Foods", address: "x" },
        { client_id: "c3", property_id: "p3", label: "BBWSD", client_name: "Birch Bay Water & Sewer", address: "y" },
      ],
    );
    expect(options.map((o) => o.label)).toEqual(["Audrey Fine", "BBWSD", "Chuckanut"]);
  });
});
