import { describe, expect, it } from "vitest";
import { shouldCompress, keepCompressed, UPLOAD_MAX_PX } from "@/lib/photo-compress";
import { thumbDimensions } from "@/lib/local-photo-thumb";

describe("photos are shrunk before upload", () => {
  it("shrinks a full-size phone photo", () => {
    expect(shouldCompress({ type: "image/jpeg", size: 3_400_000 })).toBe(true);
  });
  it("leaves an already small photo alone", () => {
    expect(shouldCompress({ type: "image/jpeg", size: 400_000 })).toBe(false);
  });
  it("never re-encodes non-photos like PDFs or GIFs", () => {
    expect(shouldCompress({ type: "application/pdf", size: 5_000_000 })).toBe(false);
    expect(shouldCompress({ type: "image/gif", size: 5_000_000 })).toBe(false);
  });
  it("keeps the original when shrinking barely helps", () => {
    expect(keepCompressed(1_000_000, 950_000)).toBe(false);
    expect(keepCompressed(3_400_000, 700_000)).toBe(true);
  });
  it("caps a 12 MP photo at 2560 px on its long edge, keeping its shape", () => {
    expect(thumbDimensions(4032, 3024, UPLOAD_MAX_PX)).toEqual({ width: 2560, height: 1920 });
  });
});

import { beginShrink, endShrink, SHRINK_CRASH_LIMIT, type ShrinkStore } from "@/lib/photo-compress";

function memoryStore(): ShrinkStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

describe("a photo that crashed the app while shrinking is sent as-is", () => {
  it("shrinks normally when nothing went wrong", () => {
    const s = memoryStore();
    expect(beginShrink(s, "a")).toBe(true);
    endShrink(s, "a");
    expect(beginShrink(s, "a")).toBe(true);
  });
  it("skips shrinking a photo whose last shrink never finished", () => {
    const s = memoryStore();
    expect(beginShrink(s, "a")).toBe(true); // app dies here, endShrink never runs
    expect(beginShrink(s, "a")).toBe(false);
    expect(beginShrink(s, "b")).toBe(true);
  });
  it("stops shrinking on this phone after two crashes", () => {
    const s = memoryStore();
    for (const id of ["a", "b"]) { beginShrink(s, id); beginShrink(s, id); }
    expect(SHRINK_CRASH_LIMIT).toBe(2);
    expect(beginShrink(s, "c")).toBe(false);
  });
});

describe("a preview that crashed the app is skipped next time", () => {
  it("tracks previews separately from uploads", () => {
    const s = memoryStore();
    expect(beginShrink(s, "a", "preview")).toBe(true); // app dies while making the preview
    expect(beginShrink(s, "a", "preview")).toBe(false);
    expect(beginShrink(s, "a", "upload")).toBe(true);
  });
});
