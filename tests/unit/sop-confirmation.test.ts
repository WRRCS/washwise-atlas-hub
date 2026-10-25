import { describe, expect, it } from "vitest";
import { ownSopConfirmation } from "../../src/lib/sop-confirmation";
const rows = [{ job_id: "visit-one", employee_id: "cleaner-one", confirmed_at: "2026-10-25T03:00:00Z" }];
describe("separate SOP acknowledgments", () => {
  it("reads only the confirming cleaner's acknowledgment", () => {
    expect(ownSopConfirmation(rows, "visit-one", "cleaner-one")).toBe("2026-10-25T03:00:00Z");
    expect(ownSopConfirmation(rows, "visit-one", "cleaner-two")).toBeNull();
  });
  it("does not carry acknowledgment into another appointment occurrence", () => {
    expect(ownSopConfirmation(rows, "visit-two", "cleaner-one")).toBeNull();
  });
});