/**
 * Signed photo URLs change on every list refresh, which makes the phone
 * re-download every image. Keep the first signed URLs for a photo while they
 * are still comfortably valid so already-loaded images stay cached.
 */
export type SignedPhotoUrls = { id: string; storage_path: string; url: string | null; thumb_url: string | null };
type Cached = { storage_path: string; url: string | null; thumb_url: string | null; at: number };

export const PHOTO_URL_REUSE_MS = 40 * 60 * 1000; // server signs for 60 minutes

export function reuseSignedUrls<T extends SignedPhotoUrls>(rows: T[], cache: Map<string, Cached>, now = Date.now()): T[] {
  const seen = new Set<string>();
  const out = rows.map(row => {
    seen.add(row.id);
    const hit = cache.get(row.id);
    if (hit && hit.storage_path === row.storage_path && now - hit.at < PHOTO_URL_REUSE_MS && hit.url) {
      return { ...row, url: hit.url, thumb_url: hit.thumb_url ?? row.thumb_url };
    }
    if (row.url) cache.set(row.id, { storage_path: row.storage_path, url: row.url, thumb_url: row.thumb_url, at: now });
    return row;
  });
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  return out;
}
