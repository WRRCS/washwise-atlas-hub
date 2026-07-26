import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Return the current viewer's role + employee_permissions flags.
 * Owners implicitly get both flags. Server-side is the source of truth —
 * clients must not decide these from cached role state alone.
 */
export const myPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isOwnerRaw } = await context.supabase.rpc("is_owner");
    const isOwner = !!isOwnerRaw;
    if (isOwner) {
      return {
        isOwner: true,
        canViewEmployeeContacts: true,
        canViewPricing: true,
      };
    }
    const { data: perm } = await context.supabase
      .from("employee_permissions")
      .select("can_view_employee_contacts, can_view_pricing")
      .eq("employee_id", context.userId)
      .maybeSingle();
    return {
      isOwner: false,
      canViewEmployeeContacts: !!perm?.can_view_employee_contacts,
      canViewPricing: !!perm?.can_view_pricing,
    };
  });

export type TeamMember = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  role: string;
};

/**
 * Team roster within the caller's tenant. Contact info (email/phone) is
 * only returned when the caller is an owner or has can_view_employee_contacts.
 * Enforced server-side so the client cannot bypass by inspecting rows.
 */
export const listTeamRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isOwnerRaw } = await context.supabase.rpc("is_owner");
    const isOwner = !!isOwnerRaw;

    let canViewContacts = isOwner;
    if (!canViewContacts) {
      const { data: perm } = await context.supabase
        .from("employee_permissions")
        .select("can_view_employee_contacts")
        .eq("employee_id", context.userId)
        .maybeSingle();
      canViewContacts = !!perm?.can_view_employee_contacts;
    }

    const [{ data: profs, error }, { data: roles }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id, full_name, email, phone, avatar_url, is_active")
        .order("full_name"),
      context.supabase.from("user_roles").select("user_id, role"),
    ]);
    if (error) throw new Error(error.message);

    const roleMap = new Map<string, string>();
    (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role));

    return (profs ?? [])
      .filter((p) => p.is_active !== false)
      .map<TeamMember>((p) => ({
        id: p.id,
        full_name: p.full_name,
        avatar_url: (p as { avatar_url?: string | null }).avatar_url ?? null,
        email: canViewContacts ? p.email : null,
        phone: canViewContacts ? (p as { phone?: string | null }).phone ?? null : null,
        role: roleMap.get(p.id) ?? "employee",
      }));
  });

export type TeamThread = {
  peer_id: string | null; // null = "Everyone" broadcast
  peer_name: string | null;
  last_body: string;
  last_at: string;
  unread: number;
};

/**
 * List conversation threads: one per peer + a single "Everyone" broadcast
 * thread (recipient_id IS NULL).
 */
export const listTeamThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const { data, error } = await context.supabase
      .from("team_messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const threads = new Map<string, TeamThread & { _peerId: string | null }>();
    for (const m of data ?? []) {
      const peerId: string | null =
        m.recipient_id === null
          ? null
          : m.sender_id === uid
            ? m.recipient_id
            : m.sender_id;
      const key = peerId ?? "__broadcast__";
      const existing = threads.get(key);
      const unreadBump =
        m.recipient_id === uid && !m.read_at
          ? 1
          : peerId === null && m.sender_id !== uid && !m.read_at
            ? 1
            : 0;
      if (!existing) {
        threads.set(key, {
          _peerId: peerId,
          peer_id: peerId,
          peer_name: null,
          last_body: m.body,
          last_at: m.created_at,
          unread: unreadBump,
        });
      } else {
        existing.unread += unreadBump;
      }
    }

    const peerIds = [...threads.values()]
      .map((t) => t._peerId)
      .filter((x): x is string => !!x);
    if (peerIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", peerIds);
      const nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
      for (const t of threads.values()) {
        if (t._peerId) t.peer_name = nameMap.get(t._peerId) ?? null;
      }
    }

    return [...threads.values()]
      .map(({ _peerId, ...rest }) => rest)
      .sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
  });

export type TeamMessageRow = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  recipient_id: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
};

/**
 * Return the messages for a specific thread. peer_id === null loads the
 * broadcast ("Everyone") thread.
 */
export const listTeamMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ peer_id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    let query = context.supabase
      .from("team_messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .order("created_at", { ascending: true })
      .limit(500);

    if (data.peer_id === null) {
      query = query.is("recipient_id", null);
    } else {
      // Direct thread: (me→peer) OR (peer→me)
      query = query
        .not("recipient_id", "is", null)
        .or(
          `and(sender_id.eq.${uid},recipient_id.eq.${data.peer_id}),and(sender_id.eq.${data.peer_id},recipient_id.eq.${uid})`,
        );
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const senderIds = [...new Set((rows ?? []).map((r) => r.sender_id))];
    const { data: profs } = senderIds.length
      ? await context.supabase.from("profiles").select("id, full_name").in("id", senderIds)
      : { data: [] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));

    // Mark unread messages that target me (direct) or the broadcast as read.
    const unreadIds = (rows ?? [])
      .filter(
        (r) =>
          !r.read_at &&
          ((data.peer_id === null && r.sender_id !== uid) ||
            (data.peer_id !== null && r.recipient_id === uid)),
      )
      .map((r) => r.id);
    if (unreadIds.length) {
      await context.supabase
        .from("team_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
    }

    return (rows ?? []).map<TeamMessageRow>((r) => ({
      id: r.id,
      sender_id: r.sender_id,
      sender_name: nameMap.get(r.sender_id) ?? null,
      recipient_id: r.recipient_id,
      body: r.body,
      created_at: r.created_at,
      read_at: r.read_at,
    }));
  });

export const sendTeamMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      recipient_id: z.string().uuid().nullable(),
      body: z.string().trim().min(1).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof, error: pErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr || !prof?.tenant_id) throw new Error("Could not resolve tenant");

    const { error } = await context.supabase.from("team_messages").insert({
      tenant_id: prof.tenant_id,
      sender_id: context.userId,
      recipient_id: data.recipient_id,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
