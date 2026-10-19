import { describe, expect, it } from "vitest";
import { imageFormat, photoFilename, preparePhotoExport, type DownloadPhoto } from "../../src/lib/photo-downloads";

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
  it("returns every cleaner's photos as separate PNG files, never an archive", async () => {
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
  it("sanitizes path characters without losing unique photo identity", () => {
    expect(photoFilename(photos[0], { date: "2026-10-19", property: "../../Fern\\Unit:2" }, "jpg")).toBe("2026-10-19_Fern-Unit-2_Cleaner-A_photo-1.jpg");
  });
});