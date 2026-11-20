import { describe, expect, it } from "vitest";
import { signInAccessChange } from "@/lib/staff-access";

describe("archiving a team member changes their sign-in", () => {
  it("blocks sign-in when an employee is archived", () => {
    expect(signInAccessChange({ is_active: false, is_owner: false })).toBe("block");
  });
  it("allows sign-in again when they are restored", () => {
    expect(signInAccessChange({ is_active: true, is_owner: false })).toBe("restore");
  });
  it("never locks out an owner", () => {
    expect(signInAccessChange({ is_active: false, is_owner: true })).toBe("none");
  });
  it("leaves sign-in alone when the edit is not about active status", () => {
    expect(signInAccessChange({ is_active: undefined, is_owner: false })).toBe("none");
  });
  it("restores an owner who was somehow blocked", () => {
    expect(signInAccessChange({ is_active: true, is_owner: true })).toBe("restore");
  });
});
