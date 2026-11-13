import { describe, expect, it } from "vitest";
import { buildClientSchedules, scheduleSendStatus } from "../../src/lib/client-schedule";

const tz = "America/Los_Angeles";
const job = (over: Record<string, unknown> = {}) => ({
  client_id: "c1", status: "scheduled",
  scheduled_start: "2026-11-18T18:00:00Z", scheduled_end: "2026-11-18T20:00:00Z",
  service_name: "Standard clean", service_location_label: "Main house", ...over,
});

describe("send schedule to clients", () => {
  it("shows the cleaning's overall time in business time, one line per cleaning", () => {
    const s = buildClientSchedules([job()], tz).get("c1")!;
    expect(s.lines).toEqual(["Wed, Nov 18 · 10am–12pm · Standard clean · Main house"]);
  });

  it("leaves canceled cleanings out", () => {
    const s = buildClientSchedules([job(), job({ status: "canceled", scheduled_start: "2026-11-19T18:00:00Z", scheduled_end: "2026-11-19T19:00:00Z" })], tz);
    expect(s.get("c1")!.lines).toHaveLength(1);
  });

  it("a client who already got this exact schedule is not sent it again", () => {
    const fp = buildClientSchedules([job()], tz).get("c1")!.fingerprint;
    expect(scheduleSendStatus(fp, fp, Date.parse("2026-11-17T00:00:00Z"))).toBe("sent");
  });

  it("a time change after sending marks the client as changed", () => {
    const sentFp = buildClientSchedules([job()], tz).get("c1")!.fingerprint;
    const nowFp = buildClientSchedules([job({ scheduled_end: "2026-11-18T21:00:00Z" })], tz).get("c1")!.fingerprint;
    expect(scheduleSendStatus(nowFp, sentFp, Date.parse("2026-11-17T00:00:00Z"))).toBe("changed");
    expect(scheduleSendStatus(nowFp, null)).toBe("new");
  });

  it("a cleaning passing by itself doesn't count as a change", () => {
    const two = [job(), job({ scheduled_start: "2026-11-20T18:00:00Z", scheduled_end: "2026-11-20T20:00:00Z" })];
    const sentFp = buildClientSchedules(two, tz).get("c1")!.fingerprint;
    const laterFp = buildClientSchedules([two[1]], tz).get("c1")!.fingerprint;
    expect(scheduleSendStatus(laterFp, sentFp, Date.parse("2026-11-19T00:00:00Z"))).toBe("sent");
  });

  it("canceling a cleaning after sending marks the client as changed", () => {
    const two = [job(), job({ scheduled_start: "2026-11-20T18:00:00Z", scheduled_end: "2026-11-20T20:00:00Z" })];
    const sentFp = buildClientSchedules(two, tz).get("c1")!.fingerprint;
    const nowFp = buildClientSchedules([two[0]], tz).get("c1")!.fingerprint;
    expect(scheduleSendStatus(nowFp, sentFp, Date.parse("2026-11-17T00:00:00Z"))).toBe("changed");
  });
});
