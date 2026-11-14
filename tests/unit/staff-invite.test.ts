import { describe, expect, it } from "vitest";
import {
  accessState, buildInviteLink, classifySendOutcome, inviteResultMessage, welcomeLinkProblem,
} from "@/lib/staff-invite";
import { deliverStaffInvite } from "@/lib/staff-invite.server";

describe("invite link", () => {
  it("points at the published WRRCS welcome page with the single-use token", () => {
    const u = new URL(buildInviteLink("abc123"));
    expect(u.origin).toBe("https://wrrcs.com");
    expect(u.pathname).toBe("/welcome");
    expect(u.searchParams.get("token_hash")).toBe("abc123");
  });
});

describe("send status", () => {
  it("is 'sent' only when the email service accepts", () => {
    expect(classifySendOutcome({ ok: true, success: true })).toBe("sent");
    expect(classifySendOutcome({ ok: true, success: false })).toBe("failed");
  });
  it("is 'failed' on a definite refusal and 'unknown' when unconfirmed", () => {
    expect(classifySendOutcome({ ok: false, status: 400 })).toBe("failed");
    expect(classifySendOutcome({ ok: false, status: 429 })).toBe("failed");
    expect(classifySendOutcome({ ok: false, status: 500 })).toBe("unknown");
    expect(classifySendOutcome({ ok: false, status: null })).toBe("unknown");
  });
  it("uses the owner-facing wording", () => {
    expect(inviteResultMessage("sent", "a@b.com")).toBe("Invitation sent to a@b.com");
    expect(inviteResultMessage("failed", "a@b.com")).toBe("Invitation failed — retry");
    expect(inviteResultMessage("unknown", "a@b.com")).toBe("Send status unknown");
  });
});

describe("access state", () => {
  const base = { hasAccount: true, lastSignInAt: null, bannedUntil: null, inviteStatus: null, now: Date.parse("2026-11-14T00:00:00Z") };
  it("is Pending until they sign in, then Activated", () => {
    expect(accessState(base)).toBe("pending");
    expect(accessState({ ...base, lastSignInAt: "2026-11-13T00:00:00Z" })).toBe("activated");
  });
  it("is revoked when the invite was cancelled", () => {
    expect(accessState({ ...base, inviteStatus: "revoked" })).toBe("revoked");
    expect(accessState({ ...base, bannedUntil: "2036-11-14T00:00:00Z" })).toBe("revoked");
  });
  it("is none without an account", () => {
    expect(accessState({ ...base, hasAccount: false })).toBe("none");
  });
});

describe("welcome page problems", () => {
  it("tells a cancelled invite apart from an expired/used link", () => {
    expect(welcomeLinkProblem("User is banned")).toBe("revoked");
    expect(welcomeLinkProblem("Email link is invalid or has expired")).toBe("expired");
  });
});

function fakeAdmin(hashed: string | null) {
  const upserts: any[] = [];
  const admin: any = {
    auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: hashed } }, error: hashed ? null : { message: "nope" } }) } },
    from: () => ({ upsert: async (row: any) => { upserts.push(row); return { error: null }; } }),
  };
  return { admin, upserts };
}
const who = { profileId: "p1", tenantId: "t1", email: "New@Example.com", fullName: "Test Person", invitedBy: "o1" };

describe("deliverStaffInvite", () => {
  it("never sends a password and records 'sent' when accepted", async () => {
    const { admin, upserts } = fakeAdmin("tok");
    let payload: any;
    const r = await deliverStaffInvite(admin, who, async (p) => { payload = p; return { success: true, message_id: "m1" }; });
    expect(r.status).toBe("sent");
    expect(payload.to).toBe("new@example.com");
    expect(payload.html).toContain("Sign in to WRRCS");
    expect(payload.html).toContain("https://wrrcs.com/welcome?token_hash=tok");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("password:");
    expect(upserts[0].status).toBe("sent");
  });
  it("records 'failed' on a refusal and 'unknown' after a dropped connection", async () => {
    const a = fakeAdmin("tok");
    const failed = await deliverStaffInvite(a.admin, who, async () => { throw Object.assign(new Error("bad"), { status: 422 }); });
    expect(failed.status).toBe("failed");
    const b = fakeAdmin("tok");
    let calls = 0;
    const unknown = await deliverStaffInvite(b.admin, who, async () => { calls += 1; throw new TypeError("fetch failed"); });
    expect(unknown.status).toBe("unknown");
    expect(calls).toBe(2);
    expect(b.upserts[0].status).toBe("unknown");
  });
});
