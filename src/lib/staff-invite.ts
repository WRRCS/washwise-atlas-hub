// Pure rules for team app invitations (no server or browser imports), shared
// by the invite server code, the Employees screen, the /welcome page and tests.

/** Where emailed sign-in links land: the published WRRCS app. */
export const STAFF_APP_URL = "https://wrrcs.com";
/** Page employees land on after the one-tap link signs them in. */
export const STAFF_HOME_PATH = "/my-jobs";

export type InviteSendStatus = "sent" | "failed" | "unknown";
export type InviteRecordStatus = InviteSendStatus | "revoked";
export type AccessState = "activated" | "pending" | "revoked" | "none";

/**
 * Link in the welcome email. It opens our own /welcome page, which redeems the
 * single-use token in the browser — so a mail scanner that merely fetches the
 * link cannot use it up before the employee taps it.
 */
export function buildInviteLink(hashedToken: string, base: string = STAFF_APP_URL) {
  const u = new URL("/welcome", base);
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", "magiclink");
  return u.toString();
}

/**
 * Turn the email service's reply into what the owner is told.
 * "sent" only when the service accepted the request; a definite refusal is
 * "failed"; anything we cannot confirm (network drop, server error) is "unknown".
 */
export function classifySendOutcome(
  outcome: { ok: true; success: boolean } | { ok: false; status?: number | null },
): InviteSendStatus {
  if (outcome.ok) return outcome.success ? "sent" : "failed";
  const s = outcome.status;
  if (typeof s === "number" && s >= 400 && s < 500 && s !== 408) return "failed";
  return "unknown";
}

/** Pending / Activated / Revoked / no app, from the sign-in account and the last invite. */
export function accessState(input: {
  hasAccount: boolean;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  inviteStatus: InviteRecordStatus | null;
  now?: number;
}): AccessState {
  if (!input.hasAccount) return "none";
  const banned = !!input.bannedUntil && Date.parse(input.bannedUntil) > (input.now ?? Date.now());
  if (banned || input.inviteStatus === "revoked") return "revoked";
  if (input.lastSignInAt) return "activated";
  return "pending";
}

/** What the /welcome page tells someone whose link didn't work. */
export function welcomeLinkProblem(message: string | null | undefined): "revoked" | "expired" {
  return message && /banned|revoked/i.test(message) ? "revoked" : "expired";
}

export function inviteResultMessage(status: InviteSendStatus, email: string) {
  if (status === "sent") return `Invitation sent to ${email}`;
  if (status === "failed") return "Invitation failed — retry";
  return "Send status unknown";
}
