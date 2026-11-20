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

/** Returns a smaller JPEG copy of the photo, or the original when that is better or impossible. */
export async function compressPhotoForUpload(file: File): Promise<File> {
  if (typeof document === "undefined" || !shouldCompress(file)) return file;
  try {
    const small = await shrinkPhoto(file, UPLOAD_MAX_PX, UPLOAD_JPEG_QUALITY);
    if (!small || !keepCompressed(file.size, small.size)) return file;
    return new File([small], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  }
}
