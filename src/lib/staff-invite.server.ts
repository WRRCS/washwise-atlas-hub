// Server-only: creates/links an employee's sign-in account and emails the
// one-tap WRRCS welcome link. Callers must verify the inviter's permission
// first and pass the privileged client loaded inside their handler.
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  INVITE_LINK_TTL_HOURS,
  buildInviteLink,
  classifySendOutcome,
  inviteFailureReason,
  inviteLinkState,
  signInServiceError,
  type InviteLinkState,
  type InviteSendStatus,
} from "@/lib/staff-invite";

type Admin = SupabaseClient<any, any, any>;

export class InviteError extends Error {}

async function findAuthUserByEmail(admin: Admin, email: string): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("[staff-invite] listUsers failed", error.status, error.message);
      throw new InviteError(inviteFailureReason("account", error as any));
    }
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (match) return match;
    if (users.length < 200) return null;
  }
  return null;
}

/**
 * Make sure this person has exactly one team record and one passwordless
 * sign-in account, linked by the same id. Existing people are reused (never
 * duplicated, never renamed, never demoted); brand-new people get the
 * employee role only.
 */
export async function ensureStaffAccount(
  admin: Admin,
  input: { tenantId: string; invitedBy: string; email: string; fullName: string; phone?: string | null; profileId?: string },
): Promise<{ id: string; fullName: string }> {
  const email = input.email.trim().toLowerCase();
  const { data: tenantProfiles, error: tpErr } = await admin
    .from("profiles").select("id, full_name, email, phone").eq("tenant_id", input.tenantId);
  if (tpErr) throw new Error(tpErr.message);
  const profiles = (tenantProfiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }>;
  const byEmail = profiles.find((p) => (p.email ?? "").toLowerCase() === email) ?? null;
  let authUser = await findAuthUserByEmail(admin, email);

  // A never-confirmed, never-used account that nobody invited (for example a
  // self sign-up attempt with this email) has no team record or role. Remove
  // it so the invite creates a clean passwordless account instead of
  // confirming one whose password someone else chose.
  if (authUser && !authUser.email_confirmed_at && !authUser.last_sign_in_at) {
    const [{ data: orphanProfile }, { data: orphanRoles }] = await Promise.all([
      admin.from("profiles").select("id").eq("id", authUser.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", authUser.id),
    ]);
    if (!orphanProfile && (orphanRoles ?? []).length === 0) {
      const { error: delErr } = await admin.auth.admin.deleteUser(authUser.id);
      if (delErr) throw new InviteError(inviteFailureReason("account", delErr as any));
      authUser = null;
    }
  }

  let targetId: string | undefined;
  if (authUser) {
    const [{ data: authProfile }, { data: roles }] = await Promise.all([
      admin.from("profiles").select("tenant_id").eq("id", authUser.id).maybeSingle(),
      admin.from("user_roles").select("role, tenant_id").eq("user_id", authUser.id),
    ]);
    const otherTenant = (authProfile && authProfile.tenant_id !== input.tenantId)
      || (roles ?? []).some((r: any) => r.tenant_id !== input.tenantId);
    if (otherTenant) throw new InviteError("That email already belongs to another business's account.");
    if ((roles ?? []).some((r: any) => r.role === "owner")) {
      throw new InviteError("That email is an owner account — owners already have full access.");
    }
    if (input.profileId && input.profileId !== authUser.id) {
      const holder = profiles.find((p) => p.id === authUser.id)?.full_name ?? "another team member";
      throw new InviteError(`That email already signs in as ${holder}. Use the Invite button on their row instead.`);
    }
    targetId = authUser.id;
  } else if (input.profileId) {
    const p = profiles.find((x) => x.id === input.profileId);
    if (!p) throw new InviteError("Employee not found in your business");
    if (byEmail && byEmail.id !== p.id) {
      throw new InviteError(`That email is already on ${byEmail.full_name ?? "another team member"}'s record.`);
    }
    targetId = p.id;
  } else if (byEmail) {
    targetId = byEmail.id;
  }

  const existingProfile = targetId ? profiles.find((p) => p.id === targetId) ?? null : null;

  // A team record with its own sign-in under a different email must not be
  // given a second account.
  if (!authUser && targetId) {
    const { data: other } = await admin.auth.admin.getUserById(targetId);
    if (other?.user) {
      throw new InviteError("This team member already signs in with a different email. Update their email before inviting.");
    }
  }

  // Brand-new people count toward the plan's employee limit.
  if (!existingProfile && !authUser) {
    const [{ data: tenantRow }, { count }] = await Promise.all([
      admin.from("tenants").select("plan_tier").eq("id", input.tenantId).maybeSingle(),
      admin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).eq("role", "employee"),
    ]);
    if (tenantRow?.plan_tier) {
      const { data: plan } = await admin.from("plan_limits").select("max_employees, display_name").eq("plan_tier", tenantRow.plan_tier).maybeSingle();
      const cap = (plan as any)?.max_employees ?? null;
      if (cap != null && (count ?? 0) >= cap) {
        throw new InviteError(`Employee limit reached (${count}/${cap} on the ${(plan as any)?.display_name ?? tenantRow.plan_tier} plan).`);
      }
    }
  }

  // Invitation-only sign-in: the database only accepts allowlisted emails.
  const { error: allowErr } = await admin
    .from("allowed_signins")
    .upsert({ email, tenant_id: input.tenantId, invited_by: input.invitedBy }, { onConflict: "email" });
  if (allowErr) throw new Error(allowErr.message);

  let id = targetId;
  let createdAccount = false;
  if (!authUser) {
    // No password at all: sign-in is only ever the emailed one-tap link.
    const { data: created, error } = await admin.auth.admin.createUser({
      ...(targetId ? { id: targetId } : {}),
      email,
      email_confirm: true,
      user_metadata: { full_name: existingProfile?.full_name ?? input.fullName },
    } as any);
    if (error || !created?.user) {
      if (error && /already been registered|email_exists/i.test(error.message)) {
        throw new InviteError("That email was just registered by another request. Wait a moment and try again.");
      }
      console.error("[staff-invite] createUser failed", error?.name, error?.status, error?.message);
      throw new InviteError(inviteFailureReason("account", error as any));
    }
    id = created.user.id;
    createdAccount = true;
  } else {
    // Reuse the existing account untouched, except re-allowing sign-in after a
    // revoked invite and confirming an email that was never confirmed.
    const patch: Record<string, unknown> = {};
    if (authUser.banned_until && Date.parse(authUser.banned_until) > Date.now()) patch.ban_duration = "none";
    if (!authUser.email_confirmed_at) {
      // Linked to a team record but never confirmed: confirm it and replace
      // any password set before the invite, so only the emailed link works.
      patch.email_confirm = true;
      patch.password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    }
    if (Object.keys(patch).length) {
      const { error } = await admin.auth.admin.updateUserById(authUser.id, patch as any);
      if (error) {
        console.error("[staff-invite] updateUser failed", error.status, error.message);
        throw new InviteError(inviteFailureReason("account", error as any));
      }
    }
  }
  if (!id) throw new Error("Could not create the sign-in account");

  // Team record: new people get the typed name/phone; existing people keep
  // their name and only gain a phone/email that was missing or corrected.
  const profilePatch: Record<string, unknown> = { tenant_id: input.tenantId, email };
  if (!existingProfile) profilePatch.full_name = input.fullName;
  if (input.phone && !existingProfile?.phone) profilePatch.phone = input.phone;
  await admin.from("profiles").update(profilePatch).eq("id", id);

  // Exactly one role row in this business; invites only ever add "employee".
  const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", id).eq("tenant_id", input.tenantId);
  if (!roleRows || roleRows.length === 0) {
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: id, tenant_id: input.tenantId, role: "employee" });
    if (roleErr) {
      if (createdAccount) {
        await admin.auth.admin.deleteUser(id);
        if (!existingProfile) await admin.from("profiles").delete().eq("id", id);
      }
      throw new InviteError(roleErr.message);
    }
  }

  const fullName = existingProfile?.full_name ?? input.fullName;
  return { id, fullName };
}

export type DeliverResult = { status: InviteSendStatus; email: string; employee_id: string; error?: string };

function welcomeEmail(firstName: string, url: string) {
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:520px">
      <h1 style="font-size:20px;margin:0 0 16px">Welcome to WRRCS, ${firstName}!</h1>
      <p>You've been added to the Wash Rinse Repeat Cleaning team app. Tap the button on your phone to open your jobs — no password or code needed.</p>
      <p style="margin:28px 0"><a href="${url}" style="background:#0e8fc0;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Sign in to WRRCS</a></p>
      <p style="color:#64748b;font-size:12px">This link works for ${INVITE_LINK_TTL_HOURS} hours, until you use it to sign in. If it stops working, open wrrcs.com/welcome and choose "Email me a new sign-in link", or ask your manager to resend the invite.</p>
    </div>`;
  const text = [
    `Welcome to WRRCS, ${firstName}!`,
    "",
    "Open this link on your phone to sign in — no password needed:",
    url,
    "",
    `The link works for ${INVITE_LINK_TTL_HOURS} hours, until you use it to sign in. If it stops working, open wrrcs.com/welcome and choose "Email me a new sign-in link".`,
  ].join("\n");
  return { html, text };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Email a fresh invite link (this replaces any earlier pending link) that
 * stays valid for 24 hours until used. Records the outcome so the Employees
 * screen can show it.
 */
export async function deliverStaffInvite(
  admin: Admin,
  input: { profileId: string; tenantId: string; email: string; fullName: string | null; invitedBy: string },
  send: (payload: any, options: any) => Promise<{ success: boolean; message_id?: string }>,
): Promise<DeliverResult> {
  const email = input.email.toLowerCase();
  const code = newInviteCode();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + INVITE_LINK_TTL_HOURS * 3600_000);

  // Save the (hashed) code before emailing, so the link works the moment it arrives.
  const { error: saveErr } = await admin.from("staff_invites").upsert({
    profile_id: input.profileId,
    tenant_id: input.tenantId,
    email,
    status: "unknown",
    last_attempt_at: issuedAt.toISOString(),
    sent_at: null,
    message_id: null,
    error: null,
    invited_by: input.invitedBy,
    revoked_at: null,
    token_hash: await sha256Hex(code),
    token_issued_at: issuedAt.toISOString(),
    token_expires_at: expiresAt.toISOString(),
  } as any, { onConflict: "profile_id" });
  if (saveErr) {
    console.error("[staff-invite] could not save invite", saveErr.message);
    const msg = inviteFailureReason("link", null);
    return { status: "failed", email, employee_id: input.profileId, error: msg };
  }

  const firstName = (input.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const { html, text } = welcomeEmail(firstName, buildInviteLink(code));
  // One key per attempt: a retry after a dropped connection can't send twice.
  const idempotencyKey = `staff-invite-${input.profileId}-${crypto.randomUUID()}`;
  const payload = {
    to: email,
    from: { name: "Wash Rinse Repeat Cleaning", address: "info@washrinserepeatcleaning.com" },
    sender_domain: "notify.washrinserepeatcleaning.com",
    subject: "Welcome to WRRCS — tap to sign in",
    html,
    text,
    purpose: "transactional",
    idempotency_key: idempotencyKey,
    label: "employee_magic_link_invite",
  };
  const options = { apiKey: process.env["LOVABLE_API_KEY"]!, sendUrl: process.env["LOVABLE_SEND_URL"] };

  let status: InviteSendStatus = "unknown";
  let messageId: string | undefined;
  let errorMsg: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await send(payload, options);
      status = classifySendOutcome({ ok: true, success: !!res?.success });
      messageId = res?.message_id;
      errorMsg = status === "failed" ? "The email service did not accept the message. Nothing was sent." : undefined;
    } catch (err: any) {
      status = classifySendOutcome({ ok: false, status: typeof err?.status === "number" ? err.status : null });
      console.error("[staff-invite] send failed", err?.status, err?.code, err?.message);
      errorMsg = inviteFailureReason("email", err);
    }
    if (status !== "unknown") break;
  }
  const { error: recErr } = await admin.from("staff_invites").update({
    status,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    message_id: messageId ?? null,
    error: errorMsg ?? null,
    // A refused email leaves no working link behind.
    ...(status === "failed" ? { token_hash: null, token_expires_at: null } : {}),
  } as any).eq("profile_id", input.profileId);
  if (recErr) console.error("[staff-invite] could not record outcome", recErr.message);
  return { status, email, employee_id: input.profileId, ...(errorMsg ? { error: errorMsg } : {}) };
}

export type RedeemResult = { ok: true; tokenHash: string } | { ok: false; reason: Exclude<InviteLinkState, "usable"> };

/**
 * Exchange an emailed invite code for a fresh single-use sign-in token, which
 * the employee's browser redeems immediately. Only the code's holder gets in.
 */
export async function redeemStaffInvite(admin: Admin, code: string): Promise<RedeemResult> {
  const { data: inv } = await admin
    .from("staff_invites")
    .select("profile_id, status, revoked_at, token_issued_at, token_expires_at")
    .eq("token_hash", await sha256Hex(code))
    .maybeSingle();
  if (!inv) return { ok: false, reason: "expired" };
  const [{ data: userData }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById((inv as any).profile_id),
    admin.from("profiles").select("is_active").eq("id", (inv as any).profile_id).maybeSingle(),
  ]);
  const user = userData?.user;
  if (!user?.email) return { ok: false, reason: "expired" };
  const state = inviteLinkState({
    issuedAt: (inv as any).token_issued_at,
    expiresAt: (inv as any).token_expires_at,
    revoked: !!(inv as any).revoked_at || (inv as any).status === "revoked",
    banned: !!user.banned_until && Date.parse(user.banned_until) > Date.now(),
    active: (profile as any)?.is_active !== false,
    lastSignInAt: user.last_sign_in_at ?? null,
  });
  if (state !== "usable") return { ok: false, reason: state };
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const hashed = link?.properties?.hashed_token;
  if (error || !hashed) {
    console.error("[staff-invite] generateLink failed", error?.status, error?.message);
    return { ok: false, reason: "expired" };
  }
  return { ok: true, tokenHash: hashed };
}

/**
 * Cancel an invite that has not been used yet: the pending link is replaced
 * by one nobody receives, and the account is blocked until a new invite.
 */
export async function revokeStaffInvite(
  admin: Admin,
  input: { profileId: string; tenantId: string; email: string; invitedBy: string },
) {
  const { data } = await admin.auth.admin.getUserById(input.profileId);
  const user = data?.user;
  if (!user) throw new InviteError("This person has no pending invite.");
  if (user.last_sign_in_at) throw new InviteError("They already signed in, so there's no pending invite to revoke. Archive them to remove access.");
  await admin.auth.admin.generateLink({ type: "magiclink", email: (user.email ?? input.email).toLowerCase() });
  const { error } = await admin.auth.admin.updateUserById(user.id, { ban_duration: "87600h" } as any);
  if (error) throw new InviteError(signInServiceError("cancel the invite", error as any));
  const now = new Date().toISOString();
  await admin.from("staff_invites").upsert({
    profile_id: input.profileId, tenant_id: input.tenantId, email: input.email.toLowerCase(),
    status: "revoked", last_attempt_at: now, revoked_at: now, invited_by: input.invitedBy,
    token_hash: null, token_expires_at: null,
  } as any, { onConflict: "profile_id" });
  return { ok: true as const };
}
