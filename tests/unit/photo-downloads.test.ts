import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPhotoZip, imageFormat, photoFilename, preparePhotoExport, zipFilename, type DownloadPhoto } from "../../src/lib/photo-downloads";

const photos: DownloadPhoto[] = [
  { id: "photo-1", storage_path: "a/1", url: "signed-1", uploaded_by: "cleaner-a", uploader_name: "Cleaner A" },
  { id: "photo-2", storage_path: "a/2", url: "signed-2", uploaded_by: "cleaner-a", uploader_name: "Cleaner A" },
  { id: "photo-3", storage_path: "b/3", url: "signed-3", uploaded_by: "cleaner-b", uploader_name: "Cleaner B" },
];
const context = { date: "2026-10-19", property: "Fern / Rental" };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const fetchPhoto = async () => new Blob([bytes], { type: "application/octet-stream" });
describe("Turno photo exports", () => {
  it("keeps original image bytes and accurate content type for single downloads", async () => {
    const result = await preparePhotoExport([photos[0]], context, { fetchPhoto });
    expect(result.files[0].blob.type).toBe("image/png");
    expect(new Uint8Array(await result.files[0].blob.arrayBuffer())).toEqual(bytes);
    expect(result.files[0].filename).toBe("2026-10-19_Fern-Rental_Cleaner-A_photo-1.png");
  });
  it("contains exactly the selected images", async () => {
    const { files } = await preparePhotoExport([photos[0], photos[2]], context, { fetchPhoto });
    expect(files).toHaveLength(2);
    expect(files.some(n => n.filename.includes("photo-2"))).toBe(false);
  });
  it("keeps individual cleaner downloads separate", async () => {
    const { files } = await preparePhotoExport(photos.filter(p => p.uploaded_by === "cleaner-a"), context, { fetchPhoto });
    expect(files).toHaveLength(2);
    expect(files.every(n => n.filename.includes("Cleaner-A"))).toBe(true);
  });
  it("keeps every cleaner's photos as PNG files", async () => {
    const result = await preparePhotoExport(photos, context, { fetchPhoto });
    expect(result.files).toHaveLength(3);
    expect(result.files.every(f => f.filename.endsWith(".png") && f.blob.type === "image/png")).toBe(true);
    expect(result.files.filter(f => f.filename.includes("Cleaner-A"))).toHaveLength(2);
    expect(result.files.filter(f => f.filename.includes("Cleaner-B"))).toHaveLength(1);
  });
  it("identifies failed photos while keeping successful individual images", async () => {
    const result = await preparePhotoExport(photos, context, { fetchPhoto: async p => { if (p.id === "photo-2") throw new Error("expired"); return fetchPhoto(); } });
    expect(result.files).toHaveLength(2);
    expect(result.failures[0]).toContain("photo-2");
    expect(result.files.every(f => f.filename.endsWith(".png"))).toBe(true);
  });
  it("rejects webpages masquerading as image files", async () => {
    expect(imageFormat(new TextEncoder().encode("<!DOCTYPE html>"))).toBeNull();
    await expect(preparePhotoExport([photos[0]], context, { fetchPhoto: async () => new Blob(["<html>sign in</html>"]) })).rejects.toThrow("No photos could be downloaded");
  });
  it("packages 40 photos into one flat ZIP of valid images with cleaner names", async () => {
    const many: DownloadPhoto[] = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, storage_path: `x/${i}`, url: "u", uploaded_by: i % 2 ? "b" : "a", uploader_name: i % 2 ? "Cleaner B" : "Cleaner A" }));
    const { files, failures } = await preparePhotoExport(many, context, { fetchPhoto });
    expect(failures).toHaveLength(0);
    const zip = await JSZip.loadAsync(await (await buildPhotoZip(files)).arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(40);
    expect(names.every(n => !n.includes("/") && n.endsWith(".png") && /Cleaner-[AB]/.test(n))).toBe(true);
    const first = await zip.file(names[0])!.async("uint8array");
    expect(imageFormat(first)?.type).toBe("image/png");
  });
  it("names the ZIP after the property and appointment date", () => {
    expect(zipFilename(context)).toBe("Fern-Rental_2026-10-19_photos.zip");
  });
  it("reports which photos are missing so they can be retried", async () => {
    const result = await preparePhotoExport(photos, context, { fetchPhoto: async p => { if (p.id === "photo-3") throw new Error("expired"); return fetchPhoto(); } });
    expect(result.failedPhotos.map(p => p.id)).toEqual(["photo-3"]);
  });
  it("sanitizes path characters without losing unique photo identity", () => {
    expect(photoFilename(photos[0], { date: "2026-10-19", property: "../../Fern\\Unit:2" }, "jpg")).toBe("2026-10-19_Fern-Unit-2_Cleaner-A_photo-1.jpg");
  });
});