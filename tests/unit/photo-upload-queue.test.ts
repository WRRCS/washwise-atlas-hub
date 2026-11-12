import { describe, expect, it } from "vitest";
import { UploadQueue, mapWithConcurrency, type QueueItem } from "../../src/lib/photo-upload-queue";
import { reuseSignedUrls, PHOTO_URL_REUSE_MS } from "../../src/lib/photo-url-reuse";
import { isOutboxRecordExpired, outboxScope, OUTBOX_MAX_AGE_MS, sendableOutboxJob } from "../../src/lib/photo-outbox";

function fakeStorage() {
  const kept = new Map<string, Blob>();
  return {
    kept,
    save: async (item: QueueItem) => { kept.set(item.id, item.file as Blob); },
    drop: async (id: string) => { kept.delete(id); },
  };
}

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

describe("unsent photos stay on the phone", () => {
  it("keeps a photo the moment it is taken and forgets it once the server has it", async () => {
    const s = fakeStorage();
    const d = deferred();
    const q = new UploadQueue({ upload: () => d.promise, storage: s }, 1);
    q.add([{ id: "a", file: new Blob(["x"]), meta: {} }]);
    expect([...s.kept.keys()]).toEqual(["a"]);
    d.resolve("p1"); await tick(); await tick();
    expect(s.kept.size).toBe(0);
  });

  it("keeps a photo that failed to send, so it can be sent again", async () => {
    const s = fakeStorage();
    const q = new UploadQueue({ upload: async () => { throw new Error("no signal"); }, storage: s }, 1);
    q.add([{ id: "a", file: new Blob(["x"]), meta: {} }]);
    await tick(); await tick();
    expect(q.getItems()[0].status).toBe("failed");
    expect([...s.kept.keys()]).toEqual(["a"]);
  });

  it("forgets a photo the cleaner removes", async () => {
    const s = fakeStorage();
    const q = new UploadQueue({ upload: async () => { throw new Error("no signal"); }, storage: s }, 1);
    q.add([{ id: "a", file: new Blob(["x"]), meta: {} }]);
    await tick(); await tick();
    q.remove("a"); await tick();
    expect(s.kept.size).toBe(0);
    expect(q.getItems().length).toBe(0);
  });

  it("queues a photo once even if the screen asks for it again", () => {
    const q = new UploadQueue({ upload: async () => "p1" }, 1);
    const entry = { id: "a", file: new Blob(["x"]), meta: {} };
    q.add([entry], { stored: true });
    q.add([entry], { stored: true });
    expect(q.getItems().map(i => i.id)).toEqual(["a"]);
  });

  it("sends failed photos again when signal returns, but never a photo that cannot work", async () => {
    const s = fakeStorage();
    let attempts = 0;
    const q = new UploadQueue<string>({
      upload: async (item) => {
        attempts++;
        if (item.meta === "login") throw Object.assign(new Error("login changed"), { permanent: true });
        if (attempts === 1) throw new Error("no signal");
        return `p${attempts}`;
      },
      storage: s,
    }, 1);
    q.add([{ id: "a", file: new Blob(), meta: "network" }, { id: "b", file: new Blob(), meta: "login" }]);
    await tick(); await tick(); await tick();
    expect(q.getItems().map(i => [i.status, i.permanent])).toEqual([["failed", false], ["failed", true]]);
    q.resume();
    await tick(); await tick();
    expect(q.getItems().map(i => i.status)).toEqual(["saved", "failed"]);
    q.resume();
    expect(attempts).toBe(3);
    // The photo that can never send is still kept on the phone for the cleaner to deal with.
    expect([...s.kept.keys()]).toEqual(["b"]);
  });

  it("holds photos in the queue instead of failing them while there is no signal", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
    try {
      const q = new UploadQueue({ upload: async () => "p1" }, 2);
      q.add([{ id: "a", file: new Blob(), meta: {} }]);
      expect(q.getItems().map(i => i.status)).toEqual(["waiting"]);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});

describe("kept-photo keys and expiry", () => {
  it("scopes kept photos to the cleaner, the appointment and the screen", () => {
    expect(outboxScope("u1", "j1")).toBe("u1:j1");
    expect(outboxScope("u1", "j1", "leaving")).toBe("u1:j1:leaving");
  });
  it("drops kept photos older than a week so the phone cannot fill up", () => {
    const now = Date.now();
    expect(isOutboxRecordExpired({ createdAt: now - OUTBOX_MAX_AGE_MS + 1000 }, now)).toBe(false);
    expect(isOutboxRecordExpired({ createdAt: now - OUTBOX_MAX_AGE_MS - 1000 }, now)).toBe(true);
  });
});

describe("Leaving-screen photos send in the background", () => {
  it("never deletes the phone copy before it has finished writing, so a photo is not sent twice", async () => {
    const order: string[] = [];
    let finishWrite!: () => void;
    const writing = new Promise<void>((r) => { finishWrite = r; });
    const q = new UploadQueue({
      upload: async () => "p1",
      storage: {
        save: async () => { await writing; order.push("saved"); },
        drop: async () => { order.push("dropped"); },
      },
    }, 1);
    q.add([{ id: "a", file: new Blob(), meta: {} }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    finishWrite();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["saved", "dropped"]);
  });

  it("starts photos held during no signal once signal returns", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const nav = { onLine: false };
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    try {
      let sent = 0;
      const q = new UploadQueue({ upload: async () => { sent++; return "p1"; } }, 2);
      q.add([{ id: "a", file: new Blob(), meta: {} }]);
      expect(sent).toBe(0);
      nav.onLine = true;
      q.resume();
      await new Promise((r) => setTimeout(r, 0));
      expect(sent).toBe(1);
      expect(q.getItems()[0].status).toBe("saved");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it("sends only this cleaner's appointment photos on its own, not ones still on the Leaving screen", () => {
    expect(sendableOutboxJob("u1:j1", "u1")).toBe("j1");
    expect(sendableOutboxJob("u1:j1:leaving", "u1")).toBeNull();
    expect(sendableOutboxJob("u2:j1", "u1")).toBeNull();
  });
});
