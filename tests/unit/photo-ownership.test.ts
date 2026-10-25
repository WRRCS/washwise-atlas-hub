import { describe, expect, it } from "vitest";
import { ownsPhotoUpload, photoUploadPrefix, photoQueryKey, photoReadScope } from "../../src/lib/photo-ownership";

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

describe("appointment cleaner photo scope", () => {
  it("keeps Romeo's manager section separate from Dalton and the combined view", () => {
    expect(photoReadScope("Zoe", true, "Romeo")).toBe("Romeo");
    expect(photoReadScope("Zoe", true, "Dalton")).toBe("Dalton");
    expect(photoReadScope("Zoe", true, undefined, true)).toBeUndefined();
    expect(photoQueryKey("BBWSD-today", "Zoe", "Romeo")).not.toEqual(photoQueryKey("BBWSD-today", "Zoe", "Dalton"));
  });
  it("never lets Romeo request Dalton's collection, even with combined requested", () => {
    expect(photoReadScope("Romeo", false, undefined, true)).toBe("Romeo");
    expect(() => photoReadScope("Romeo", false, "Dalton")).toThrow("own photos");
  });
  it("isolates identities and recurring appointment occurrences", () => {
    expect(photoQueryKey("BBWSD-today", "Dalton")).not.toEqual(photoQueryKey("BBWSD-today", "Romeo"));
    expect(photoQueryKey("BBWSD-today", "Dalton")).not.toEqual(photoQueryKey("BBWSD-next", "Dalton"));
    expect(photoQueryKey("BBWSD-today", "Zoe", undefined, true)).not.toEqual(photoQueryKey("BBWSD-today", "Zoe"));
  });
});