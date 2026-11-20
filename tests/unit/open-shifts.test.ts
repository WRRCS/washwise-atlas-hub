import { describe, expect, it } from "vitest";
import { canPickUp, isOpenShift, openSpotsLeft, spotsAfterAdding } from "@/lib/open-shifts";

const zoe = { id: "zoe" };

describe("open shifts after a cleaner is archived", () => {
  it("a shared cleaning with one open spot shows in Open shifts while the partner stays on", () => {
    const job = { status: "scheduled", open_spots: 1, assignees: [zoe] };
    expect(isOpenShift(job)).toBe(true);
    expect(openSpotsLeft(job)).toBe(1);
  });
  it("a cleaning with nobody on it is open", () => {
    expect(isOpenShift({ status: "scheduled", open_spots: 0, assignees: [] })).toBe(true);
  });
  it("a fully staffed cleaning is not open", () => {
    expect(isOpenShift({ status: "scheduled", open_spots: 0, assignees: [zoe] })).toBe(false);
  });
  it("canceled and finished cleanings are never open", () => {
    expect(isOpenShift({ status: "canceled", open_spots: 1, assignees: [] })).toBe(false);
    expect(isOpenShift({ status: "completed", open_spots: 1, assignees: [] })).toBe(false);
  });
  it("another cleaner can pick up the open spot", () => {
    expect(canPickUp({ status: "scheduled", open_spots: 1, assignees: [zoe] }, "barbra")).toBe(true);
  });
  it("the partner already on the cleaning cannot pick up its open spot", () => {
    expect(canPickUp({ status: "scheduled", open_spots: 1, assignees: [zoe] }, "zoe")).toBe(false);
  });
  it("adding a cleaner fills an open spot", () => {
    expect(spotsAfterAdding(1, 1)).toBe(0);
    expect(spotsAfterAdding(1, 3)).toBe(0);
    expect(spotsAfterAdding(0, 1)).toBe(0);
  });
});
