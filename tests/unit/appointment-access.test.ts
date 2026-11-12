import { describe, expect, it } from "vitest";
import { canOpenAppointment } from "@/lib/appointment-access";

const alina = "a1";
const romeo = "r1";

describe("canOpenAppointment", () => {
  it("lets an employee open their own appointment", () => {
    expect(canOpenAppointment({ viewerId: alina, isReviewer: false, assigneeIds: [alina] })).toBe(true);
  });
  it("blocks an employee from opening another employee's appointment", () => {
    expect(canOpenAppointment({ viewerId: alina, isReviewer: false, assigneeIds: [romeo], assignedTo: romeo })).toBe(false);
  });
  it("blocks an employee from opening a teammate's row of a shared appointment", () => {
    expect(canOpenAppointment({ viewerId: alina, isReviewer: false, assigneeIds: [alina, romeo], rowEmployeeId: romeo })).toBe(false);
  });
  it("blocks a signed-out viewer", () => {
    expect(canOpenAppointment({ viewerId: null, isReviewer: false, assigneeIds: [alina] })).toBe(false);
  });
  it("lets owners and managers open any appointment", () => {
    expect(canOpenAppointment({ viewerId: "owner", isReviewer: true, assigneeIds: [romeo], rowEmployeeId: romeo })).toBe(true);
  });
});
