import { describe, expect, it } from "vitest";
import { groupStuckPhotos, stuckPhotoEmail, STUCK_PHOTO_GRACE_MS } from "@/lib/stuck-photo-alerts";
import { photoUploadStem } from "@/lib/photo-ownership";

describe("photos that didn't finish saving", () => {
  it("waits an hour so the phone can retry first", () => {
    expect(STUCK_PHOTO_GRACE_MS).toBe(60 * 60 * 1000);
  });
  it("sends one email per cleaner per cleaning", () => {
    const g = groupStuckPhotos([
      { name: "t/job1/ashley/a-p-1-image.jpg", created_at: "2026-11-22T17:00:00Z" },
      { name: "t/job1/ashley/a-p-2-image.jpg", created_at: "2026-11-22T17:01:00Z" },
      { name: "t/job1/zoe/b-p-3-image.jpg", created_at: "2026-11-22T17:02:00Z" },
      { name: "t/job2/ashley/c-p-4-image.jpg", created_at: "2026-11-22T18:00:00Z" },
    ]);
    expect(g.map((x) => [x.jobId, x.uploaderId, x.objects.length])).toEqual([["job1", "ashley", 2], ["job1", "zoe", 1], ["job2", "ashley", 1]]);
  });
  it("names the cleaner and the cleaning", () => {
    const m = stuckPhotoEmail({ cleanerName: "Ashley", clientName: "Diane Hollands", propertyName: "Petticote", scheduledStart: "2026-11-22T18:00:00Z", jobId: "j", uploaderId: "u", storedAt: ["2026-11-22T19:00:00Z", "2026-11-22T19:05:00Z"] });
    expect(m.subject).toBe("2 photos didn't finish saving — Ashley at Petticote — WRRCS");
    expect(m.text).toContain("Client: Diane Hollands");
    expect(m.text).toContain("Cleaning: Sun, Nov 22, 10:00 AM");
  });
  it("a resent photo gets the same file name start", () => {
    expect(photoUploadStem("asg", "abc123")).toBe(photoUploadStem("asg", "abc123"));
    expect(photoUploadStem(null, "abc123")).toBe("staff-p-abc123");
  });
});
