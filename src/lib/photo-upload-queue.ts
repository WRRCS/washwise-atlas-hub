/**
 * Background photo upload queue. Capture never waits for earlier uploads:
 * photos are queued with a local preview and uploaded a few at a time.
 * Queues live at module level (keyed by viewer + appointment) so uploads keep
 * going while the cleaner switches tabs or pages inside the app.
 */
export type QueueStatus = "waiting" | "uploading" | "failed" | "saved";
export type QueueItem<M = unknown> = {
  id: string;
  file: File | Blob;
  meta: M;
  previewUrl: string | null;
  status: QueueStatus;
  error?: string;
  savedId?: string;
  /** Retrying cannot fix this one (e.g. the login changed), so it is never auto-resent. */
  permanent?: boolean;
};
/** Keeps unsent photos on the phone until they are safely stored. */
export type QueueStorage<M = unknown> = {
  save: (item: QueueItem<M>) => Promise<unknown>;
  drop: (id: string) => Promise<unknown>;
};
export type QueueHandlers<M> = {
  /** Uploads and registers one photo; resolves with the saved photo id. */
  upload: (item: QueueItem<M>) => Promise<string>;
  onSaved?: (savedId: string) => void;
  onFailed?: (message: string) => void;
  /** Called once the queue has nothing left to send, with ids saved since the last drain. */
  onDrained?: (savedIds: string[]) => void;
  storage?: QueueStorage<M>;
  /** The photo is still uploading, but could not be kept on the phone. */
  onStorageError?: (message: string) => void;
};

export class UploadQueue<M = unknown> {
  private items: QueueItem<M>[] = [];
  private listeners = new Set<() => void>();
  private savedSinceDrain: string[] = [];
  private active = 0;
  /** Pending phone-copy writes, so a fast upload never deletes the copy before it is written. */
  private storing = new Map<string, Promise<unknown>>();
  handlers: QueueHandlers<M>;
  constructor(handlers: QueueHandlers<M>, private concurrency = 2) { this.handlers = handlers; }

  getItems = () => this.items;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get busy() { return this.items.some(i => i.status === "waiting" || i.status === "uploading"); }

  add(entries: { id: string; file: File | Blob; meta: M; previewUrl?: string | null }[], opts?: { stored?: boolean }) {
    if (!entries.length) return;
    // The same photo can arrive twice (e.g. a screen remount re-reads the phone copy) — never queue it twice.
    const known = new Set(this.items.map(i => i.id));
    const fresh = entries.filter(e => !known.has(e.id));
    if (!fresh.length) return;
    const items = fresh.map(e => ({ id: e.id, file: e.file, meta: e.meta, previewUrl: e.previewUrl ?? null, status: "waiting" as const }));
    this.set([...this.items, ...items]);
    // Photos restored from the phone are already kept there; new ones must be.
    if (!opts?.stored) items.forEach(i => this.keep(i));
    this.pump();
  }
  retry(id: string) {
    this.set(this.items.map(i => (i.id === id && i.status === "failed" ? { ...i, status: "waiting" as const, error: undefined } : i)));
    this.pump();
  }
  /** Anything that failed for a fixable reason is queued again — used when signal returns. */
  resume() {
    if (this.hasRetryable()) {
      this.set(this.items.map(i => (i.status === "failed" && !i.permanent ? { ...i, status: "waiting" as const, error: undefined } : i)));
    }
    // Photos held back while there was no signal are still waiting — start them too.
    if (this.items.some(i => i.status === "waiting")) this.pump();
  }
  hasRetryable() {
    return this.items.some(i => i.status === "failed" && !i.permanent);
  }
  /** Drop an item that is not currently uploading (failed, waiting, or already saved). */
  remove(id: string) {
    const item = this.items.find(i => i.id === id);
    if (!item || item.status === "uploading") return;
    this.release(item);
    this.set(this.items.filter(i => i.id !== id));
    void this.dropStored(id);
  }
  /** Forget saved items once the photo list shows them. */
  pruneSaved(visibleIds: Set<string>) {
    const keep = this.items.filter(i => !(i.status === "saved" && i.savedId && visibleIds.has(i.savedId)));
    if (keep.length === this.items.length) return;
    this.items.filter(i => !keep.includes(i)).forEach(i => this.release(i));
    this.set(keep);
  }

  private release(item: QueueItem<M>) {
    if (item.previewUrl && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(item.previewUrl);
  }
  private set(next: QueueItem<M>[]) { this.items = next; this.listeners.forEach(l => l()); }
  private patch(id: string, p: Partial<QueueItem<M>>) { this.set(this.items.map(i => (i.id === id ? { ...i, ...p } : i))); }

  private keep(item: QueueItem<M>) {
    const storage = this.handlers.storage;
    if (!storage) return;
    let started: Promise<unknown>;
    try { started = Promise.resolve(storage.save(item)); } catch (e) { started = Promise.reject(e); }
    const write = started.catch((e) => {
        this.handlers.onStorageError?.(e instanceof Error ? e.message : "Could not keep the photo on this phone");
      });
    this.storing.set(item.id, write);
  }
  private async dropStored(id: string) {
    const storage = this.handlers.storage;
    if (!storage) return;
    // Wait for the phone copy to finish writing first, otherwise it would outlive the upload and be sent twice.
    await this.storing.get(id);
    this.storing.delete(id);
    await Promise.resolve(storage.drop(id)).catch(() => {});
  }

  private pump() {
    // No signal: photos stay queued instead of failing, and send when it returns.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    while (this.active < this.concurrency) {
      const next = this.items.find(i => i.status === "waiting");
      if (!next) break;
      this.active++;
      this.patch(next.id, { status: "uploading" });
      void this.run(next.id);
    }
    if (this.active === 0 && !this.busy && this.savedSinceDrain.length) {
      const ids = this.savedSinceDrain;
      this.savedSinceDrain = [];
      this.handlers.onDrained?.(ids);
    }
  }
  private async run(id: string) {
    const item = this.items.find(i => i.id === id);
    try {
      if (!item) return;
      const savedId = await this.handlers.upload(item);
      this.savedSinceDrain.push(savedId);
      this.patch(id, { status: "saved", savedId });
      // The copy is safe on the server, so the phone copy is no longer needed.
      void this.dropStored(id);
      this.handlers.onSaved?.(savedId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      const permanent = e instanceof Error && (e as Error & { permanent?: boolean }).permanent === true;
      this.patch(id, { status: "failed", error: message, permanent });
      this.handlers.onFailed?.(message);
    } finally {
      this.active--;
      this.pump();
    }
  }
}

const registry = new Map<string, UploadQueue<any>>();
/** One queue per viewer + appointment; handlers are refreshed on every call. */
export function photoUploadQueue<M>(key: string, handlers: QueueHandlers<M>): UploadQueue<M> {
  let q = registry.get(key) as UploadQueue<M> | undefined;
  if (!q) { q = new UploadQueue<M>(handlers); registry.set(key, q); }
  else q.handlers = handlers;
  return q;
}
/** Signal is back: every queue sends what failed for a fixable reason. */
export function resumeAllPhotoQueues() {
  for (const q of registry.values()) q.resume();
}
export function anyPhotoUploadsPending() {
  for (const q of registry.values()) if (q.busy) return true;
  return false;
}

/** Run tasks with a fixed number in flight, preserving result order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}
