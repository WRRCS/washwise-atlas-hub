/**
 * Unsent-photo outbox.
 *
 * A captured photo is written to the phone's own storage the moment it is
 * taken and deleted only once the copy is safely on the server. That way a
 * cleaner who loses signal, or closes the app mid-clean, does not lose the
 * picture: it is still on the phone and sends itself when signal returns.
 *
 * Records are scoped to the signed-in cleaner + appointment, hold no signed
 * URLs, and the whole outbox is cleared on sign-out / account change.
 */
export type OutboxMeta = Record<string, unknown>;

export type OutboxRecord<M extends OutboxMeta = OutboxMeta> = {
  id: string;
  /** viewerId:jobId (plus a surface suffix for the Leaving dialog). */
  scope: string;
  viewerId: string;
  file: Blob;
  meta: M;
  createdAt: number;
};

/** Photos that could not be sent this long are dropped so storage cannot fill up. */
export const OUTBOX_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export function isOutboxRecordExpired(record: { createdAt: number }, now = Date.now()): boolean {
  return now - record.createdAt > OUTBOX_MAX_AGE_MS;
}

/** One place that decides how outbox/queue keys are shaped. */
export function outboxScope(viewerId: string, jobId: string, surface?: string): string {
  return surface ? `${viewerId}:${jobId}:${surface}` : `${viewerId}:${jobId}`;
}

const DB_NAME = "wrrcs-photo-outbox";
const DB_VERSION = 1;
const STORE = "photos";

export function outboxAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("scope", "scope", { unique: false });
          store.createIndex("viewerId", "viewerId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open photo storage"));
      req.onblocked = () => reject(new Error("Photo storage is busy"));
    });
  }
  // Never hand back a cached rejection: allow a later retry to open the database again.
  return dbPromise.catch((err) => {
    dbPromise = null;
    throw err;
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error("Photo storage write failed"));
    t.onerror = () => reject(t.error ?? new Error("Photo storage write failed"));
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Photo storage read failed"));
  });
}

/** Unsent photos for one appointment, oldest first. Expired ones are dropped. */
export async function loadOutbox<M extends OutboxMeta>(scope: string): Promise<OutboxRecord<M>[]> {
  if (!outboxAvailable()) return [];
  let found: OutboxRecord<M>[] = [];
  try {
    const db = await openDb();
    found = (await result(db.transaction(STORE, "readonly").objectStore(STORE).index("scope").getAll(scope))) as OutboxRecord<M>[];
  } catch {
    return [];
  }
  const now = Date.now();
  const fresh = found.filter(r => r && !isOutboxRecordExpired(r, now)).sort((a, b) => a.createdAt - b.createdAt);
  const staleIds = found.filter(r => !fresh.includes(r)).map(r => r.id);
  if (staleIds.length) void deleteOutboxItems(staleIds).catch(() => {});
  return fresh;
}

/** Every unsent photo this cleaner has on the phone, across appointments. Expired ones are dropped. */
export async function loadViewerOutbox<M extends OutboxMeta>(viewerId: string): Promise<OutboxRecord<M>[]> {
  if (!outboxAvailable()) return [];
  let found: OutboxRecord<M>[] = [];
  try {
    const db = await openDb();
    found = (await result(db.transaction(STORE, "readonly").objectStore(STORE).index("viewerId").getAll(viewerId))) as OutboxRecord<M>[];
  } catch {
    return [];
  }
  const now = Date.now();
  const fresh = found.filter(r => r && r.viewerId === viewerId && !isOutboxRecordExpired(r, now)).sort((a, b) => a.createdAt - b.createdAt);
  const staleIds = found.filter(r => r && r.viewerId === viewerId && isOutboxRecordExpired(r, now)).map(r => r.id);
  if (staleIds.length) void deleteOutboxItems(staleIds).catch(() => {});
  return fresh;
}

/**
 * The appointment whose photos are ready to send on their own, or null for photos
 * still sitting on a screen (e.g. the Leaving dialog before the cleaner taps Leaving).
 */
export function sendableOutboxJob(scope: string, viewerId: string): string | null {
  const parts = scope.split(":");
  if (parts.length !== 2 || parts[0] !== viewerId || !parts[1]) return null;
  return parts[1];
}

/** Keeps one captured photo on the phone. Rejects when the phone is out of space. */
export async function saveOutboxItem<M extends OutboxMeta>(record: OutboxRecord<M>): Promise<void> {
  if (!outboxAvailable()) throw new Error("This phone cannot keep photos offline");
  const db = await openDb();
  const t = db.transaction(STORE, "readwrite");
  t.objectStore(STORE).put(record);
  await done(t);
}

/** Forgets photos that are safely stored, removed by the cleaner, or expired. */
export async function deleteOutboxItems(ids: string[]): Promise<void> {
  if (!outboxAvailable() || !ids.length) return;
  const db = await openDb();
  const t = db.transaction(STORE, "readwrite");
  const store = t.objectStore(STORE);
  ids.forEach((id) => store.delete(id));
  await done(t);
}

/** Wipes every kept photo: called on sign-out / account change so photos cannot cross accounts. */
export async function clearOutbox(): Promise<void> {
  if (!outboxAvailable()) return;
  const db = await openDb();
  const t = db.transaction(STORE, "readwrite");
  t.objectStore(STORE).clear();
  await done(t);
}
