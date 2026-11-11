import { describe, expect, it } from "vitest";
import { blockedRemovals, findPasteTarget, planAssigneeChange, type PasteCandidate } from "../../src/lib/job-assignees";

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

describe("pasting a copied shift onto a cleaner", () => {
  const day = (iso: string) => iso.slice(0, 10);
  const justin: PasteCandidate = {
    id: "justin-job", client_id: "justin", property_id: "justin-home", service_type_id: "residential",
    status: "scheduled", scheduled_start: "2026-11-12T10:00:00Z", scheduled_end: "2026-11-12T11:30:00Z", assignee_ids: ["maria"],
  };
  const target = { start: "2026-11-12T10:00:00Z", end: "2026-11-12T11:30:00Z", dayKey: "2026-11-12" };

  it("joins the existing Justin job on Nov 12 instead of creating a second one", () => {
    expect(findPasteTarget(justin, target, [justin], day)?.id).toBe("justin-job");
  });
  it("joins a job whose time overlaps the pasted shift", () => {
    expect(findPasteTarget(justin, { ...target, start: "2026-11-12T11:00:00Z", end: "2026-11-12T12:30:00Z" }, [justin], day)?.id).toBe("justin-job");
  });
  it("creates a new job when pasted onto a different day", () => {
    expect(findPasteTarget(justin, { start: "2026-11-13T10:00:00Z", end: "2026-11-13T11:30:00Z", dayKey: "2026-11-13" }, [justin], day)).toBeNull();
  });
  it("never joins a job for a different client", () => {
    expect(findPasteTarget(justin, target, [{ ...justin, id: "other", client_id: "someone-else" }], day)).toBeNull();
  });
  it("leaves open (unassigned) shifts alone", () => {
    expect(findPasteTarget(justin, target, [{ ...justin, assignee_ids: [] }], day)).toBeNull();
  });
  it("does not join a canceled visit", () => {
    expect(findPasteTarget(justin, target, [{ ...justin, status: "canceled" }], day)).toBeNull();
  });
});
