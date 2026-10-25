import { describe, expect, it } from "vitest";
import { ownsPhotoUpload, photoUploadPrefix } from "../../src/lib/photo-ownership";

describe("cleaner upload ownership", () => {
  const path = `${photoUploadPrefix("tenant", "occurrence-1", "Barbra")}image.jpg`;
  it("binds the photo to Barbra, not Dalton", () => {
    expect(ownsPhotoUpload(path, "tenant", "occurrence-1", "Barbra")).toBe(true);
    expect(ownsPhotoUpload(path, "tenant", "occurrence-1", "Dalton")).toBe(false);
  });
  it("rejects copying ownership to another appointment occurrence", () => {
    expect(ownsPhotoUpload(path, "tenant", "occurrence-2", "Barbra")).toBe(false);
  });
  it("rejects legacy unbound paths instead of guessing the cleaner", () => {
    expect(ownsPhotoUpload("tenant/occurrence-1/image.jpg", "tenant", "occurrence-1", "Barbra")).toBe(false);
  });
  it("rejects nested paths and another tenant", () => {
    expect(ownsPhotoUpload(`${path}/nested`, "tenant", "occurrence-1", "Barbra")).toBe(false);
    expect(ownsPhotoUpload(path, "other", "occurrence-1", "Barbra")).toBe(false);
  });
});