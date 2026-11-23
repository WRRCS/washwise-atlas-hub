// Server-only: turns a team member's sign-in on or off at the auth layer.
// Callers must verify the requester's permission first and pass the privileged
// client loaded inside their own handler.
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any, any, any>;

// Ten years, matching invite revocation: long enough that nobody mistakes it
// for a temporary pause, short enough to stay a future date everywhere.
const BLOCKED = "87600h";
const NOT_BLOCKED = "none";

/**
 * Block or allow sign-in for one account. A blocked account cannot start a new
 * session with a password, a one-tap link, or a token refresh, so an archived
 * person cannot get back into the app.
 *
 * Roster-only people have no sign-in account at all: there is nothing to block,
 * so the archive still succeeds instead of erroring on a missing account.
 */
export async function setStaffSignInAllowed(
  admin: Admin,
  input: { userId: string; allowed: boolean },
): Promise<{ hadAccount: boolean }> {
  const { data, error } = await admin.auth.admin.getUserById(input.userId);
  if (!data?.user) {
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
    return { hadAccount: false };
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(input.userId, {
    ban_duration: input.allowed ? NOT_BLOCKED : BLOCKED,
  } as any);
  if (updateError) throw new Error(updateError.message);
  return { hadAccount: true };
}

/**
 * Record that a person's one-tap link is dead, so the Employees page tells the
 * truth about it. Only touches an existing invite row for this account.
 */
export async function markStaffInviteRevoked(
  admin: Admin,
  input: { userId: string },
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("staff_invites")
    .update({ status: "revoked", revoked_at: now, last_attempt_at: now, token_hash: null, token_expires_at: null } as any)
    .eq("profile_id", input.userId);
}
