import { describe, expect, it } from "vitest";
import { distinctSopAttachments, sopContentIsCovered } from "../../src/lib/sop-content";

describe("distinct appointment SOP content", () => {
  it("recognizes the source text despite PDF line wrapping", () => {
    expect(sopContentIsCovered("Clean the kitchen.\nCheck the oven.", "Clean the kitchen. Check the oven.")).toBe(true);
  });
  it("retains attachment-only instructions even when readable text exists", () => {
    expect(sopContentIsCovered("Clean the kitchen. Check the garage.", "Clean the kitchen.")).toBe(false);
  });
  it("never suppresses document-only or unreadable content", () => {
    expect(sopContentIsCovered("Clean the kitchen.", "")).toBe(false);
    expect(sopContentIsCovered("", "Clean the kitchen.")).toBe(false);
  });
  it("retains different numbers and negations", () => {
    expect(sopContentIsCovered("Use 2 towels", "Use 3 towels")).toBe(false);
    expect(sopContentIsCovered("Do not unplug", "Do unplug")).toBe(false);
  });
  it("deduplicates repeated relationships without deleting distinct files", () => {
    const first = { id: "a", storage_path: "source.pdf" };
    const unique = { id: "c", storage_path: "additional.pdf" };
    expect(distinctSopAttachments([first, first, { id: "b", storage_path: "source.pdf" }, unique])).toEqual([first, unique]);
  });
});