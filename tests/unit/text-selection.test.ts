import { describe, expect, it } from "vitest";
import { isSelectionDrag } from "@/lib/text-selection";

describe("highlighting text inside buttons", () => {
  it("treats a drag that highlights text as a selection, not a click", () => {
    expect(isSelectionDrag(120, 0, "1900 20th St Bellingham, WA")).toBe(true);
  });
  it("still clicks on a plain tap, even if old text is highlighted", () => {
    expect(isSelectionDrag(2, 1, "1900 20th St")).toBe(false);
  });
  it("still clicks when a drag highlighted nothing", () => {
    expect(isSelectionDrag(80, 0, "   ")).toBe(false);
  });
});
