import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { imageFormat, photoFilename, preparePhotoExport, type DownloadPhoto } from "../../src/lib/photo-downloads";

const photos: DownloadPhoto[] = [
  { id: "photo-1", storage_path: "a/1", url: "signed-1", uploaded_by: "cleaner-a", uploader_name: "Cleaner A" },
  { id: "photo-2", storage_path: "a/2", url: "signed-2", uploaded_by: "cleaner-a", uploader_name: "Cleaner A" },
  { id: "photo-3", storage_path: "b/3", url: "signed-3", uploaded_by: "cleaner-b", uploader_name: "Cleaner B" },
];
const context = { date: "2026-10-19", property: "Fern / Rental" };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const fetchPhoto = async () => new Blob([bytes], { type: "application/octet-stream" });
async function entries(result: Awaited<ReturnType<typeof preparePhotoExport>>) {
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  return { zip, names: Object.keys(zip.files).filter(n => !zip.files[n].dir) };
}
describe("Turno photo exports", () => {
  it("keeps original image bytes and accurate content type for single downloads", async () => {
    const result = await preparePhotoExport([photos[0]], context, { zip: false, fetchPhoto });
    expect(result.blob.type).toBe("image/png");
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(result.filename).toBe("2026-10-19_Fern-Rental_Cleaner-A_photo-1.png");
  });
  it("contains exactly the selected images", async () => {
    const { names } = await entries(await preparePhotoExport([photos[0], photos[2]], context, { zip: true, fetchPhoto }));
    expect(names).toHaveLength(2);
    expect(names.some(n => n.includes("photo-2"))).toBe(false);
  });
  it("keeps individual cleaner downloads separate", async () => {
    const { names } = await entries(await preparePhotoExport(photos.filter(p => p.uploaded_by === "cleaner-a"), context, { zip: true, fetchPhoto }));
    expect(names).toHaveLength(2);
    expect(names.every(n => n.includes("Cleaner-A"))).toBe(true);
  });
  it("groups all cleaners by identity and preserves every image", async () => {
    const { zip, names } = await entries(await preparePhotoExport(photos, context, { zip: true, groupByCleaner: true, fetchPhoto }));
    expect(names).toHaveLength(3);
    expect(names.filter(n => n.startsWith("Cleaner-A_cleaner-a/"))).toHaveLength(2);
    expect(names.filter(n => n.startsWith("Cleaner-B_cleaner-b/"))).toHaveLength(1);
    expect(await zip.files[names[0]].async("uint8array")).toEqual(bytes);
  });
  it("labels partial ZIPs and identifies missing photos", async () => {
    const result = await preparePhotoExport(photos, context, { zip: true, fetchPhoto: async p => { if (p.id === "photo-2") throw new Error("expired"); return fetchPhoto(); } });
    const { zip, names } = await entries(result);
    expect(result.filename).toContain("_INCOMPLETE.zip");
    expect(names.filter(n => n.endsWith(".png"))).toHaveLength(2);
    expect(await zip.files["INCOMPLETE-download.txt"].async("string")).toContain("photo-2");
  });
  it("rejects webpages masquerading as image files", async () => {
    expect(imageFormat(new TextEncoder().encode("<!DOCTYPE html>"))).toBeNull();
    await expect(preparePhotoExport([photos[0]], context, { zip: false, fetchPhoto: async () => new Blob(["<html>sign in</html>"]) })).rejects.toThrow("No photos could be downloaded");
  });
  it("sanitizes path characters without losing unique photo identity", () => {
    expect(photoFilename(photos[0], { date: "2026-10-19", property: "../../Fern\\Unit:2" }, "jpg")).toBe("2026-10-19_Fern-Unit-2_Cleaner-A_photo-1.jpg");
  });
});