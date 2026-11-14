/**
 * Small previews for photos that are still on the phone.
 *
 * A phone camera photo is ~12 megapixels; showing it in an <img>, even a tiny
 * one, makes the browser keep the whole decoded picture (~48 MB) in memory.
 * Thirty of those crash iPhone Safari ("A problem repeatedly occurred"), and
 * because unsent photos are restored after a reload the crash repeats.
 * So previews are shrunk one photo at a time into a small JPEG and only that
 * small copy is ever displayed. The original file is uploaded untouched.
 */
export const LOCAL_THUMB_MAX_PX = 320;

/** Thumbnail dimensions that keep the aspect ratio and never enlarge. */
export function thumbDimensions(width: number, height: number, max = LOCAL_THUMB_MAX_PX): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// One full-size decode at a time keeps peak memory to a single photo.
let chain: Promise<unknown> = Promise.resolve();

async function render(blob: Blob, max: number): Promise<Blob | null> {
  const src = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  try {
    img.src = src;
    await img.decode();
    const { width, height } = thumbDimensions(img.naturalWidth, img.naturalHeight, max);
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    } finally {
      // Release the canvas backing store right away (iOS keeps it otherwise).
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    return null;
  } finally {
    img.removeAttribute("src");
    URL.revokeObjectURL(src);
  }
}

/**
 * Resolves with an object URL for a small preview, or null if the phone can't
 * read the picture. `isCancelled` lets an unmounted preview skip its turn.
 * The caller revokes the returned URL.
 */
export function makeLocalThumbnail(blob: Blob, isCancelled: () => boolean = () => false, max = LOCAL_THUMB_MAX_PX): Promise<string | null> {
  const job = chain.then(async () => {
    if (isCancelled()) return null;
    const small = await render(blob, max);
    if (!small || isCancelled()) return null;
    return URL.createObjectURL(small);
  });
  chain = job.catch(() => null);
  return job;
}
