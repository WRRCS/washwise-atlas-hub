import { describe, expect, it } from "vitest";
import { toggleCaddyEmployee, uniqueCaddyEmployees } from "../../src/lib/caddy-expansion";

describe("employee caddy expansion", () => {
  it("starts collapsed and toggles only the selected employee", () => {
    const initial = new Set<string>();
    const first = toggleCaddyEmployee(initial, "employee-a");
    expect([...initial]).toEqual([]);
    expect([...first]).toEqual(["employee-a"]);
    const both = toggleCaddyEmployee(first, "employee-b");
    expect([...toggleCaddyEmployee(both, "employee-a")]).toEqual(["employee-b"]);
    expect([...toggleCaddyEmployee(first, "employee-a")]).toEqual([]);
  });
  it("keeps choices keyed to identity when data is replaced or reordered", () => {
    const expanded = toggleCaddyEmployee(new Set<string>(), "employee-a");
    const refreshed = [{ id: "employee-b" }, { id: "employee-a" }];
    expect(refreshed.map((employee) => expanded.has(employee.id))).toEqual([false, true]);
  });
  it("renders one employee per identity even for repeated data rows", () => {
    expect(uniqueCaddyEmployees([{ id: "employee-a" }, { id: "employee-a" }, { id: "employee-b" }])).toEqual([{ id: "employee-a" }, { id: "employee-b" }]);
  });
});