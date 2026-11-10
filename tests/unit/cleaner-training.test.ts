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

const firstDay = content as unknown as Record<"en" | "uk", { firstDay: { steps: { id: string; image: string; lines: string[] }[] } }>;

describe("first-day guide", () => {
  it("has the same 10 steps in English and Ukrainian, each with a picture in that language", () => {
    for (const lang of ["en", "uk"] as const) {
      const steps = firstDay[lang].firstDay.steps;
      expect(steps).toHaveLength(10);
      expect(steps.map((s) => s.id)).toEqual(firstDay.en.firstDay.steps.map((s) => s.id));
      for (const s of steps) {
        expect(existsSync(resolve(__dirname, `../../src/assets/training/${lang}-${s.image}.jpg`)), `${lang}-${s.image}`).toBe(true);
      }
    }
  });

  it("ships one separate first-day PDF per language", () => {
    expect(existsSync(resolve(__dirname, "../../src/assets/training/WRRCS-First-Day-Guide-EN.pdf"))).toBe(true);
    expect(existsSync(resolve(__dirname, "../../src/assets/training/WRRCS-First-Day-Guide-UK.pdf"))).toBe(true);
  });
});
