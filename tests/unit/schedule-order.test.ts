import { describe, expect, it } from "vitest";
import { applyTeamOrder, moveTeamMember } from "@/lib/schedule-order";

const people = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("schedule team order", () => {
  it("shows people in the saved order", () => {
    expect(applyTeamOrder(people, ["c", "a", "d", "b"]).map((p) => p.id)).toEqual(["c", "a", "d", "b"]);
  });
  it("puts a new team member at the bottom", () => {
    expect(applyTeamOrder(people, ["d", "b", "a"]).map((p) => p.id)).toEqual(["d", "b", "a", "c"]);
  });
  it("keeps the default order when nothing is saved", () => {
    expect(applyTeamOrder(people, []).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("moves a person directly above or below the one they are dropped on", () => {
    expect(moveTeamMember(["a", "b", "c", "d"], "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
    expect(moveTeamMember(["a", "b", "c", "d"], "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });
});
