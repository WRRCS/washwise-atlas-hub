import JSZip from "jszip";

export type DownloadPhoto = { id: string; storage_path: string; url: string | null; uploaded_by: string | null; uploader_name: string | null };
export type PhotoExportContext = { date: string; property: string };
export function safePhotoName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "Unknown";
}
export function photoFilename(p: DownloadPhoto, context: PhotoExportContext, extension: string) {
  return `${safePhotoName(context.date)}_${safePhotoName(context.property)}_${safePhotoName(p.uploader_name ?? "Legacy-unattributed")}_${safePhotoName(p.id)}.${extension}`;
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
    const result = await convert({ blob, toType: "image/jpeg", quality: 1 });
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
    ctx.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("JPEG conversion failed")), "image/jpeg", 1));
  } finally { URL.revokeObjectURL(url); }
}

export async function preparePhotoExport(photos: DownloadPhoto[], context: PhotoExportContext, options: {
  zip: boolean; groupByCleaner?: boolean; jpeg?: boolean;
  onProgress?: (done: number, total: number) => void;
  fetchPhoto?: (photo: DownloadPhoto) => Promise<Blob>;
}) {
  if (!photos.length) throw new Error("No photos selected");
  const archive = new JSZip();
  const failures: string[] = [];
  let cursor = 0, done = 0, included = 0;
  let single: { blob: Blob; filename: string } | undefined;
  const fetchPhoto = options.fetchPhoto ?? (async (photo: DownloadPhoto) => {
    if (!photo.url) throw new Error("No image URL available");
    const response = await fetch(photo.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Image request failed (${response.status})`);
    return response.blob();
  });
  await Promise.all(Array.from({ length: Math.min(3, photos.length) }, async () => {
    while (cursor < photos.length) {
      const p = photos[cursor++];
      try {
        const raw = await fetchPhoto(p);
        const format = imageFormat(new Uint8Array(await raw.slice(0, 32).arrayBuffer()));
        if (!format) throw new Error("Stored file is not a supported image");
        let blob = raw.slice(0, raw.size, format.type), extension = format.extension;
        if ((options.jpeg && extension !== "jpg") || !["jpg", "png"].includes(extension)) {
          blob = await jpegForTurno(blob, extension); extension = "jpg";
        }
        const filename = photoFilename(p, context, extension);
        const folder = `${safePhotoName(p.uploader_name ?? "Legacy-unattributed")}_${safePhotoName(p.uploaded_by ?? "unknown")}`;
        if (options.zip) archive.file(options.groupByCleaner ? `${folder}/${filename}` : filename, await blob.arrayBuffer());
        else single = { blob, filename };
        included++;
      } catch (error) {
        failures.push(`${photoFilename(p, context, "image")}: ${error instanceof Error ? error.message : "Download failed"}`);
      } finally { options.onProgress?.(++done, photos.length); }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }));
  if (!included) throw new Error(`No photos could be downloaded. ${failures.join("; ")}`);
  if (!options.zip && single) return { ...single, failures, included };
  if (failures.length) archive.file("INCOMPLETE-download.txt", `Missing photos (${failures.length}):\n${failures.join("\n")}`);
  const blob = await archive.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  return { blob, filename: `${safePhotoName(context.date)}_${safePhotoName(context.property)}_${options.groupByCleaner ? "all-cleaners" : "photos"}${failures.length ? "_INCOMPLETE" : ""}.zip`, failures, included };
}

export async function deliverPhotoFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e instanceof DOMException && e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}