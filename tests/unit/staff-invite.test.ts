import { describe, expect, it } from "vitest";
import {
  INVITE_LINK_TTL_HOURS, accessState, buildInviteLink, classifySendOutcome, inviteFailureReason,
  inviteLinkState, inviteResultMessage, signInServiceError, welcomeLinkProblem,
} from "@/lib/staff-invite";
import { deliverStaffInvite } from "@/lib/staff-invite.server";

describe("invite link", () => {
  it("points at the published WRRCS welcome page with the invite code", () => {
    const u = new URL(buildInviteLink("abc123"));
    expect(u.origin).toBe("https://wrrcs.com");
    expect(u.pathname).toBe("/welcome");
    expect(u.searchParams.get("invite")).toBe("abc123");
  });
});

describe("invite link lifetime", () => {
  const issued = "2026-11-23T08:00:00Z";
  const base = {
    issuedAt: issued,
    expiresAt: new Date(Date.parse(issued) + INVITE_LINK_TTL_HOURS * 3600_000).toISOString(),
    revoked: false, banned: false, active: true, lastSignInAt: null,
  };
  it("lasts 24 hours", () => {
    expect(INVITE_LINK_TTL_HOURS).toBe(24);
    expect(inviteLinkState({ ...base, now: Date.parse("2026-11-24T07:59:00Z") })).toBe("usable");
    expect(inviteLinkState({ ...base, now: Date.parse("2026-11-24T08:01:00Z") })).toBe("expired");
  });
  it("stops working once they have signed in after it was sent", () => {
    const now = Date.parse("2026-11-23T09:00:00Z");
    expect(inviteLinkState({ ...base, lastSignInAt: "2026-11-23T08:30:00Z", now })).toBe("used");
    expect(inviteLinkState({ ...base, lastSignInAt: "2026-11-20T08:30:00Z", now })).toBe("usable");
  });
  it("is dead when cancelled or the person is archived", () => {
    const now = Date.parse("2026-11-23T09:00:00Z");
    expect(inviteLinkState({ ...base, revoked: true, now })).toBe("revoked");
    expect(inviteLinkState({ ...base, active: false, now })).toBe("revoked");
  });
});

describe("sign-in service errors elsewhere (archive, revoke, delete, view as)", () => {
  it("replaces empty or raw replies with plain words", () => {
    expect(signInServiceError("block sign-in", { message: "{}", status: 500 })).toBe(
      "The sign-in service couldn't block sign-in (error 500). Nothing was changed — please try again.",
    );
    expect(signInServiceError("block sign-in", { message: "", status: 0 })).not.toContain("error 0");
  });
  it("keeps readable messages", () => {
    expect(signInServiceError("block sign-in", { message: "User not found", status: 404 })).toBe("User not found");
  });
});

describe("invite failure wording", () => {
  it("never shows a raw '{}' from the sign-in service", () => {
    const msg = inviteFailureReason("account", { message: "{}", status: 500 });
    expect(msg).not.toContain("{}");
    expect(msg).toContain("error 500");
  });
  it("names specific email refusals", () => {
    expect(inviteFailureReason("email", { code: "recipient_suppressed", status: 403 })).toMatch(/unsubscribed or bounced/);
    expect(inviteFailureReason("email", { status: 429 })).toMatch(/Wait a minute/);
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

function fakeAdmin(saveError: { message: string } | null = null) {
  const upserts: any[] = [];
  const updates: any[] = [];
  const admin: any = {
    from: () => ({
      upsert: async (row: any) => { upserts.push(row); return { error: saveError }; },
      update: (row: any) => ({ eq: async () => { updates.push(row); return { error: null }; } }),
    }),
  };
  return { admin, upserts, updates };
}
const who = { profileId: "p1", tenantId: "t1", email: "New@Example.com", fullName: "Test Person", invitedBy: "o1" };

describe("deliverStaffInvite", () => {
  it("never sends a password, links a 24-hour code and records 'sent' when accepted", async () => {
    const { admin, upserts, updates } = fakeAdmin();
    let payload: any;
    const r = await deliverStaffInvite(admin, who, async (p) => { payload = p; return { success: true, message_id: "m1" }; });
    expect(r.status).toBe("sent");
    expect(payload.to).toBe("new@example.com");
    expect(payload.html).toContain("Sign in to WRRCS");
    expect(payload.html).toContain("https://wrrcs.com/welcome?invite=");
    expect(payload.html).toContain("24 hours");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("password:");
    const saved = upserts[0];
    const code = new URL(payload.text.match(/https:\/\/\S+/)[0]).searchParams.get("invite")!;
    expect(saved.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.token_hash).not.toContain(code);
    expect(Date.parse(saved.token_expires_at) - Date.parse(saved.token_issued_at)).toBe(24 * 3600_000);
    expect(updates[0].status).toBe("sent");
  });
  it("records 'failed' on a refusal and 'unknown' after a dropped connection", async () => {
    const a = fakeAdmin();
    const failed = await deliverStaffInvite(a.admin, who, async () => { throw Object.assign(new Error("bad"), { status: 422 }); });
    expect(failed.status).toBe("failed");
    expect(a.updates[0].token_hash).toBeNull();
    const b = fakeAdmin();
    let calls = 0;
    const unknown = await deliverStaffInvite(b.admin, who, async () => { calls += 1; throw new TypeError("fetch failed"); });
    expect(unknown.status).toBe("unknown");
    expect(calls).toBe(2);
    expect(b.updates[0].status).toBe("unknown");
  });
  it("sends nothing when the link can't be saved", async () => {
    const { admin } = fakeAdmin({ message: "db down" });
    let sent = false;
    const r = await deliverStaffInvite(admin, who, async () => { sent = true; return { success: true }; });
    expect(r.status).toBe("failed");
    expect(sent).toBe(false);
    expect(r.error).not.toContain("db down");
  });
});
