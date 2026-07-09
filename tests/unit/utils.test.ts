import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn (className merger)", () => {
  it("merges class strings", () => {
    expect(cn("a", "b")).toContain("a");
    expect(cn("a", "b")).toContain("b");
  });

  it("drops falsy values", () => {
    const result = cn("a", false && "b", null, undefined, "c");
    expect(result).toContain("a");
    expect(result).toContain("c");
    expect(result).not.toContain("b");
  });
});
