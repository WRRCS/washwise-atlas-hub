/**
 * Shrink camera photos in the browser before upload. Phone photos average
 * ~3.4 MB; a 2560 px JPEG at 85% quality keeps them sharp on any screen
 * (and zoomable) at roughly a fifth of the size, which cuts storage and the
 * data every later view downloads. Any problem falls back to the original.
 */
import { shrinkPhoto } from "@/lib/local-photo-thumb";

export const UPLOAD_MAX_PX = 2560;
export const UPLOAD_JPEG_QUALITY = 0.85;
/** Photos already this small are uploaded as they are. */
export const UPLOAD_SKIP_BELOW_BYTES = 900 * 1024;

/** Only sizeable still images are re-encoded (never GIFs, PDFs or other files). */
export function shouldCompress(file: { type: string; size: number }): boolean {
  if (file.size < UPLOAD_SKIP_BELOW_BYTES) return false;
  const t = (file.type || "").toLowerCase();
  return t === "image/jpeg" || t === "image/jpg" || t === "image/png" || t === "image/webp" || t === "image/heic" || t === "image/heif" || t === "";
}

/** Use the shrunk copy only when it is meaningfully smaller than the original. */
export function keepCompressed(originalBytes: number, compressedBytes: number): boolean {
  return compressedBytes > 0 && compressedBytes < originalBytes * 0.9;
}

function jpegName(name: string) {
  const base = (name || "photo").replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

/**
 * Crash guard. If the phone runs out of memory while shrinking a photo, the app
 * dies (iPhones show a black screen) and the same photo is retried at the next
 * launch, so the crash repeats forever. Before shrinking we note the photo; if
 * that note is still there on the next try, the app died mid-shrink, so that
 * photo is sent as-is. After two such crashes this phone stops shrinking.
 */
export type ShrinkStore = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
const PENDING_KEY = "wrrcs-photo-shrink-pending";
const CRASHES_KEY = "wrrcs-photo-shrink-crashes";
export const SHRINK_CRASH_LIMIT = 2;

function readList(store: ShrinkStore, key: string): string[] {
  try { const v = JSON.parse(store.get(key) ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** Decides whether to shrink this photo, recording any earlier crash it caused. */
export function beginShrink(store: ShrinkStore, photoId: string): boolean {
  const pending = readList(store, PENDING_KEY);
  let crashes = Number(store.get(CRASHES_KEY) ?? "0") || 0;
  if (pending.includes(photoId)) {
    crashes += 1;
    store.set(CRASHES_KEY, String(crashes));
    store.set(PENDING_KEY, JSON.stringify(pending.filter((id) => id !== photoId)));
    return false;
  }
  if (crashes >= SHRINK_CRASH_LIMIT) return false;
  store.set(PENDING_KEY, JSON.stringify([...pending, photoId].slice(-20)));
  return true;
}

/** Clears the note once shrinking finished (or failed without crashing). */
export function endShrink(store: ShrinkStore, photoId: string): void {
  store.set(PENDING_KEY, JSON.stringify(readList(store, PENDING_KEY).filter((id) => id !== photoId)));
}

function browserStore(): ShrinkStore | null {
  try {
    const ls = window.localStorage;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch {
    return null;
  }
}

/** Returns a smaller JPEG copy of the photo, or the original when that is better or impossible. */
export async function compressPhotoForUpload(file: File, photoId?: string): Promise<File> {
  if (typeof document === "undefined" || !shouldCompress(file)) return file;
  const store = photoId ? browserStore() : null;
  if (store && photoId && !beginShrink(store, photoId)) return file;
  try {
    const small = await shrinkPhoto(file, UPLOAD_MAX_PX, UPLOAD_JPEG_QUALITY);
    if (!small || !keepCompressed(file.size, small.size)) return file;
    return new File([small], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  } finally {
    if (store && photoId) endShrink(store, photoId);
  }
}
