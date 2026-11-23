// Pure rules for team app invitations (no server or browser imports), shared
// by the invite server code, the Employees screen, the /welcome page and tests.

/** Where emailed sign-in links land: the published WRRCS app. */
export const STAFF_APP_URL = "https://wrrcs.com";
/** Page employees land on after the one-tap link signs them in. */
export const STAFF_HOME_PATH = "/my-jobs";

export type InviteSendStatus = "sent" | "failed" | "unknown";
export type InviteRecordStatus = InviteSendStatus | "revoked";
export type AccessState = "activated" | "pending" | "revoked" | "none";

/** An unused invite link keeps working this long after it is emailed. */
export const INVITE_LINK_TTL_HOURS = 24;

/**
 * Link in the welcome email. It opens our own /welcome page, which exchanges
 * the private invite code for a sign-in in the browser — so a mail scanner
 * that merely fetches the link cannot use it up before the employee taps it.
 */
export function buildInviteLink(inviteCode: string, base: string = STAFF_APP_URL) {
  const u = new URL("/welcome", base);
  u.searchParams.set("invite", inviteCode);
  return u.toString();
}

export type InviteLinkState = "usable" | "expired" | "used" | "revoked";

/**
 * Whether an emailed invite link can still sign someone in: within 24 hours of
 * being sent, not cancelled, and nobody has signed in to that account since.
 */
export function inviteLinkState(input: {
  issuedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  banned: boolean;
  active: boolean;
  lastSignInAt: string | null;
  now?: number;
}): InviteLinkState {
  if (input.revoked || input.banned || !input.active) return "revoked";
  const now = input.now ?? Date.now();
  if (!input.issuedAt || !input.expiresAt || now > Date.parse(input.expiresAt)) return "expired";
  if (input.lastSignInAt && Date.parse(input.lastSignInAt) >= Date.parse(input.issuedAt)) return "used";
  return "usable";
}

/**
 * Owner-facing reason an invite didn't go out. Never echoes raw provider
 * bodies (which can be "{}" or contain internals).
 */
export function inviteFailureReason(
  step: "account" | "link" | "email",
  err: { message?: string | null; status?: number | null; code?: string | null } | null | undefined,
): string {
  const code = err?.code ?? null;
  const status = typeof err?.status === "number" ? err.status : null;
  if (step === "email") {
    if (code === "recipient_suppressed") return "This address has unsubscribed or bounced before, so the email service blocked it. Ask them for another email.";
    if (code === "domain_not_verified") return "The sending email domain isn't verified yet, so nothing was sent.";
    if (code === "emails_disabled") return "App emails are turned off for this project, so nothing was sent.";
    if (status === 429) return "Too many emails were sent in the last hour. Wait a minute and retry.";
    if (status !== null && status >= 400 && status < 500) return `The email service refused the message (error ${status}). Nothing was sent.`;
    return "The email service didn't confirm the send. Check the Access column before retrying.";
  }
  const what = step === "account" ? "create their sign-in account" : "create their sign-in link";
  return `The sign-in service couldn't ${what}${status ? ` (error ${status})` : ""}. Nothing was emailed — it's safe to retry.`;
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

/**
 * Plain-words message for a sign-in service error. Its replies can be empty
 * ("{}") or raw JSON when the service has a problem; never show those.
 */
export function signInServiceError(
  action: string,
  err: { message?: string | null; status?: number | null } | null | undefined,
): string {
  const msg = (err?.message ?? "").trim();
  const status = typeof err?.status === "number" && err.status > 0 ? err.status : null;
  if (!msg || /^[{[]/.test(msg)) {
    return `The sign-in service couldn't ${action}${status ? ` (error ${status})` : ""}. Nothing was changed — please try again.`;
  }
  return msg;
}
