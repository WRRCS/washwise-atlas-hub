import { describe, expect, it } from "vitest";
import { thumbDimensions, LOCAL_THUMB_MAX_PX } from "../../src/lib/local-photo-thumb";
import { strandedLeavingJob, LEAVING_STRANDED_MS } from "../../src/lib/photo-outbox";

describe("phone photo previews", () => {
  it("shrinks a 12-megapixel camera photo to a small preview, keeping its shape", () => {
    expect(thumbDimensions(4032, 3024)).toEqual({ width: LOCAL_THUMB_MAX_PX, height: 240 });
    expect(thumbDimensions(3024, 4032)).toEqual({ width: 240, height: LOCAL_THUMB_MAX_PX });
  });
  it("never enlarges a photo that is already small", () => {
    expect(thumbDimensions(200, 100)).toEqual({ width: 200, height: 100 });
  });
});

describe("photos stuck on the Leaving screen", () => {
  const viewer = "masha";
  const now = 1_000_000_000_000;
  const rec = (jobId: string, ageMs: number) => ({ scope: `${viewer}:${jobId}:leaving`, createdAt: now - ageMs });
  const none = new Set<string>();

  it("are sent once a manager clocked the cleaner out of a finished cleaning", () => {
    expect(strandedLeavingJob(rec("j1", 60_000), viewer, { openJobIds: none, finishedJobIds: new Set(["j1"]), now })).toBe("j1");
  });
  it("stay on the screen while the cleaner is still clocked in there", () => {
    expect(strandedLeavingJob(rec("j1", LEAVING_STRANDED_MS * 2), viewer, { openJobIds: new Set(["j1"]), finishedJobIds: new Set(["j1"]), now })).toBeNull();
  });
  it("are sent after being left for more than 6 hours", () => {
    expect(strandedLeavingJob(rec("j1", LEAVING_STRANDED_MS + 1), viewer, { openJobIds: none, finishedJobIds: none, now })).toBe("j1");
    expect(strandedLeavingJob(rec("j1", LEAVING_STRANDED_MS - 1), viewer, { openJobIds: none, finishedJobIds: none, now })).toBeNull();
  });
  it("never move another cleaner's photos", () => {
    expect(strandedLeavingJob({ scope: "alina:j1:leaving", createdAt: 0 }, viewer, { openJobIds: none, finishedJobIds: new Set(["j1"]), now })).toBeNull();
  });
});
