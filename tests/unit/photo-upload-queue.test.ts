import { describe, expect, it } from "vitest";
import { UploadQueue, mapWithConcurrency } from "../../src/lib/photo-upload-queue";
import { reuseSignedUrls, PHOTO_URL_REUSE_MS } from "../../src/lib/photo-url-reuse";

const tick = () => new Promise(r => setTimeout(r, 0));
function deferred() { let resolve!: (v: string) => void, reject!: (e: Error) => void; const promise = new Promise<string>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

describe("background photo uploads", () => {
  it("accepts new photos while earlier ones are still uploading", async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    const q = new UploadQueue({ upload: () => { const d = deferred(); pending.push(d); return d.promise; } }, 2);
    q.add([{ id: "a", file: new Blob(), meta: {} }]);
    q.add([{ id: "b", file: new Blob(), meta: {} }, { id: "c", file: new Blob(), meta: {} }]);
    expect(q.getItems().map(i => i.status)).toEqual(["uploading", "uploading", "waiting"]);
    pending[0].resolve("p1"); await tick();
    expect(q.getItems().map(i => i.status)).toEqual(["saved", "uploading", "uploading"]);
  });
  it("keeps going after a failure and lets the cleaner retry it", async () => {
    let n = 0; const drained: string[][] = [];
    const q = new UploadQueue({ upload: async () => { n++; if (n === 1) throw new Error("no signal"); return `p${n}`; }, onDrained: ids => drained.push(ids) }, 1);
    q.add([{ id: "a", file: new Blob(), meta: {} }, { id: "b", file: new Blob(), meta: {} }]);
    await tick(); await tick();
    expect(q.getItems().map(i => i.status)).toEqual(["failed", "saved"]);
    q.retry("a"); await tick(); await tick();
    expect(q.getItems().map(i => i.status)).toEqual(["saved", "saved"]);
    expect(drained).toEqual([["p2"], ["p3"]]);
  });
  it("never runs more uploads at once than allowed", async () => {
    let live = 0, peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => { live++; peak = Math.max(peak, live); await tick(); live--; });
    expect(peak).toBe(3);
  });
});

describe("photo URL reuse", () => {
  const row = (url: string) => ({ id: "x", storage_path: "t/j/u/x.jpg", url, thumb_url: `${url}-thumb` });
  it("keeps the already-loaded image URL on refresh so the phone doesn't re-download it", () => {
    const cache = new Map();
    reuseSignedUrls([row("first")], cache, 0);
    expect(reuseSignedUrls([row("second")], cache, 60_000)[0].url).toBe("first");
  });
  it("switches to the fresh URL before the old one expires", () => {
    const cache = new Map();
    reuseSignedUrls([row("first")], cache, 0);
    expect(reuseSignedUrls([row("second")], cache, PHOTO_URL_REUSE_MS + 1)[0].url).toBe("second");
  });
});
