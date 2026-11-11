import { describe, expect, it } from "vitest";
import { blockedRemovals, planAssigneeChange } from "../../src/lib/job-assignees";

describe("changing cleaners on an appointment", () => {
  it("adds a second cleaner without removing the first", () => {
    expect(planAssigneeChange(["barbra"], ["barbra", "dalton"])).toEqual({ add: ["dalton"], remove: [], primary: "barbra" });
  });
  it("swaps one cleaner for another", () => {
    expect(planAssigneeChange(["barbra"], ["masha"])).toEqual({ add: ["masha"], remove: ["barbra"], primary: "masha" });
  });
  it("removing everyone leaves the appointment unassigned", () => {
    expect(planAssigneeChange(["barbra", "dalton"], [])).toEqual({ add: [], remove: ["barbra", "dalton"], primary: null });
  });
  it("keeps the current lead cleaner when another cleaner is added", () => {
    expect(planAssigneeChange(["dalton", "barbra"], ["dalton", "barbra", "alina"], "barbra").primary).toBe("barbra");
  });
  it("a cleaner who already recorded work on the visit cannot be removed", () => {
    expect(blockedRemovals(["barbra", "dalton"], ["dalton"])).toEqual(["dalton"]);
  });
});
