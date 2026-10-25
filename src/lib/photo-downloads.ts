export type DownloadPhoto = { id: string; storage_path: string; url: string | null; uploaded_by: string | null; uploader_name: string | null };
export type PhotoExportContext = { date: string; property: string };
export type PreparedPhoto = { blob: Blob; filename: string; photoId: string };
export function uniquePhotoReferences(photos: DownloadPhoto[]) {
  const ids = new Set<string>(), paths = new Set<string>();
  return photos.filter(p => {
    if (ids.has(p.id) || (p.storage_path && paths.has(p.storage_path))) return false;
    ids.add(p.id); if (p.storage_path) paths.add(p.storage_path);
    return true;
  });
}
export function safePhotoName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "Unknown";
}
export function photoFilename(p: DownloadPhoto, context: PhotoExportContext, extension: string) {
  return `${safePhotoName(context.date)}_${safePhotoName(context.property)}_${safePhotoName(p.uploader_name ?? "Legacy-unattributed")}_${safePhotoName(p.id)}.${extension}`;
}
/** ZIP name uses the property and appointment date, e.g. "Fern-Rental_2026-10-19_photos.zip". */
export function zipFilename(context: PhotoExportContext, cleanerName?: string) {
  const cleaner = cleanerName ? `_${safePhotoName(cleanerName)}` : "";
  return `${safePhotoName(context.property)}_${safePhotoName(context.date)}${cleaner}_photos.zip`;
}
export function imageFormat(bytes: Uint8Array): { extension: string; type: string } | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: "jpg", type: "image/jpeg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return { extension: "png", type: "image/png" };
  const text = new TextDecoder().decode(bytes.slice(0, 32));
  if (/^GIF8[79]a/.test(text)) return { extension: "gif", type: "image/gif" };
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return { extension: "webp", type: "image/webp" };
  if (text.slice(4, 8) === "ftyp" && /hei[cf]|hevc|hevx|mif1|msf1/.test(text)) return { extension: "heic", type: "image/heic" };
  if (text.slice(4, 8) === "ftyp" && /avif|avis/.test(text)) return { extension: "avif", type: "image/avif" };
  if ((bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42) || (bytes[0] === 77 && bytes[1] === 77 && bytes[3] === 42)) return { extension: "tiff", type: "image/tiff" };
  if (text.startsWith("BM")) return { extension: "bmp", type: "image/bmp" };
  return null;
}

async function jpegForTurno(blob: Blob, extension: string) {
  if (extension === "heic") {
    const { default: convert } = await import("heic2any");
    const result = await convert({ blob, toType: "image/jpeg", quality: 0.95 });
    const first = Array.isArray(result) ? result[0] : result;
    if (!first) throw new Error("Could not convert this image to JPEG");
    return first;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image conversion unavailable");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("JPEG conversion failed")), "image/jpeg", 0.95));
  } finally { URL.revokeObjectURL(url); }
}

export async function preparePhotoExport(photos: DownloadPhoto[], context: PhotoExportContext, options: {
  jpeg?: boolean;
  onProgress?: (done: number, total: number) => void;
  fetchPhoto?: (photo: DownloadPhoto) => Promise<Blob>;
}) {
  if (!photos.length) throw new Error("No photos selected");
  photos = uniquePhotoReferences(photos);
  const failures: string[] = [];
  const failedPhotos: DownloadPhoto[] = [];
  let cursor = 0, done = 0;
  const files: PreparedPhoto[] = [];
  const fingerprints = new Map<string, string>();
  const fetchPhoto = options.fetchPhoto ?? (async (photo: DownloadPhoto) => {
    if (!photo.url) throw new Error("No image URL available");
    const response = await fetch(photo.url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Image request failed (${response.status})`);
    return response.blob();
  });
  options.onProgress?.(0, photos.length);
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, async () => {
    while (cursor < photos.length) {
      const p = photos[cursor++];
      try {
        const raw = await fetchPhoto(p);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await raw.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
        fingerprints.set(p.id, hash);
        const format = imageFormat(new Uint8Array(await raw.slice(0, 32).arrayBuffer()));
        if (!format) throw new Error("Stored file is not a supported image");
        let blob = raw.slice(0, raw.size, format.type), extension = format.extension;
        if ((options.jpeg && extension !== "jpg") || !["jpg", "png"].includes(extension)) {
          blob = await jpegForTurno(blob, extension); extension = "jpg";
        }
        files.push({ blob, filename: photoFilename(p, context, extension), photoId: p.id });
      } catch (error) {
        failedPhotos.push(p);
        failures.push(`${photoFilename(p, context, "image")}: ${error instanceof Error ? error.message : "Download failed"}`);
      } finally { options.onProgress?.(++done, photos.length); }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }));
  // Keep the original photo order so filenames line up with the app.
  const order = new Map(photos.map((p, i) => [p.id, i]));
  files.sort((a, b) => (order.get(a.photoId) ?? 0) - (order.get(b.photoId) ?? 0));
  if (!files.length) throw new Error(`No photos could be downloaded. ${failures.join("; ")}`);
  const hashes = new Set<string>();
  const unique = files.filter(f => {
    const hash = fingerprints.get(f.photoId);
    if (!hash || hashes.has(hash)) return false;
    hashes.add(hash); return true;
  });
  return { files: unique, failures, failedPhotos, included: unique.length };
}

/** One ZIP with every image at the top level (no subfolders) so they can be selected together. */
export async function buildPhotoZip(files: { blob: Blob; filename: string }[]) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  const hashes = new Set<string>();
  for (const f of files) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await f.blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    let name = f.filename, n = 2;
    while (used.has(name)) name = f.filename.replace(/(\.[^.]+)$/, `-${n++}$1`);
    used.add(name);
    zip.file(name, f.blob, { binary: true });
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/zip" });
  return blob;
}

/** Triggers exactly one browser download for the given file. */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function deliverPhotoFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e instanceof DOMException && e.name === "AbortError") return; }
  }
  triggerDownload(blob, filename);
}
