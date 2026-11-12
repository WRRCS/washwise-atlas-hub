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
};
export type QueueHandlers<M> = {
  /** Uploads and registers one photo; resolves with the saved photo id. */
  upload: (item: QueueItem<M>) => Promise<string>;
  onSaved?: (savedId: string) => void;
  onFailed?: (message: string) => void;
  /** Called once the queue has nothing left to send, with ids saved since the last drain. */
  onDrained?: (savedIds: string[]) => void;
};

export class UploadQueue<M = unknown> {
  private items: QueueItem<M>[] = [];
  private listeners = new Set<() => void>();
  private savedSinceDrain: string[] = [];
  private active = 0;
  handlers: QueueHandlers<M>;
  constructor(handlers: QueueHandlers<M>, private concurrency = 2) { this.handlers = handlers; }

  getItems = () => this.items;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get busy() { return this.items.some(i => i.status === "waiting" || i.status === "uploading"); }

  add(entries: { id: string; file: File | Blob; meta: M; previewUrl?: string | null }[]) {
    if (!entries.length) return;
    this.set([...this.items, ...entries.map(e => ({ id: e.id, file: e.file, meta: e.meta, previewUrl: e.previewUrl ?? null, status: "waiting" as const }))]);
    this.pump();
  }
  retry(id: string) {
    this.set(this.items.map(i => (i.id === id && i.status === "failed" ? { ...i, status: "waiting" as const, error: undefined } : i)));
    this.pump();
  }
  /** Drop an item that is not currently uploading (failed, waiting, or already saved). */
  remove(id: string) {
    const item = this.items.find(i => i.id === id);
    if (!item || item.status === "uploading") return;
    this.release(item);
    this.set(this.items.filter(i => i.id !== id));
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

  private pump() {
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
      this.handlers.onSaved?.(savedId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      this.patch(id, { status: "failed", error: message });
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
