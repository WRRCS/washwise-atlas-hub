import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import content from "../../src/lib/cleaner-training.json";

const guides = content as Record<"en" | "uk", { sections: { id: string; steps: string[]; images: string[] }[] }>;

describe("cleaner training", () => {
  it("offers the same sections in English and Ukrainian", () => {
    expect(guides.uk.sections.map((s) => s.id)).toEqual(guides.en.sections.map((s) => s.id));
  });

  it("has a screenshot in both languages for every pictured step", () => {
    for (const lang of ["en", "uk"] as const) {
      for (const s of guides[lang].sections) {
        for (const key of s.images) {
          expect(existsSync(resolve(__dirname, `../../src/assets/training/${lang}-${key}.jpg`)), `${lang}-${key}`).toBe(true);
        }
      }
    }
  });

  it("ships a printable PDF for each language", () => {
    expect(existsSync(resolve(__dirname, "../../src/assets/training/WRRCS-Cleaner-Training-EN.pdf"))).toBe(true);
    expect(existsSync(resolve(__dirname, "../../src/assets/training/WRRCS-Cleaner-Training-UK.pdf"))).toBe(true);
  });
});
