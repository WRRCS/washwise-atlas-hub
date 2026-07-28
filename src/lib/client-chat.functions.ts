import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClientChatConversation = {
  client_id: string;
  client_name: string;
  last_message: string;
  last_sender: "client" | "business";
  last_message_at: string;
  unread_count: number;
};

export type ClientChatMessage = {
  id: string;
  client_id: string;
  sender_type: "client" | "business";
  sender_user_id: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
  sender_name: string | null;
};

/** Owner OR manager with can_manage_clients_employees. Also returned by the DB helper. */
export const amIClientChatCapable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Simplest path: attempt a harmless SELECT COUNT via RLS; if it succeeds we're capable.
    // But we need a boolean regardless of rows existing. Use role + permission lookup.
    const uid = context.userId;
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    if (roleSet.has("owner") || roleSet.has("super_admin")) return { capable: true };
    if (!roleSet.has("manager")) return { capable: false };
    const { data: perm } = await context.supabase
      .from("employee_permissions")
      .select("can_manage_clients_employees")
      .eq("employee_id", uid)
      .maybeSingle();
    return { capable: Boolean(perm?.can_manage_clients_employees) };
  });

export const listClientChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientChatConversation[]> => {
    const { data: msgs, error } = await context.supabase
      .from("client_messages")
      .select("id, client_id, sender_type, body, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = msgs ?? [];
    if (!rows.length) return [];

    const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id)));
    const { data: clients } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name")
      .in("id", clientIds);
    const nameMap = new Map<string, string>();
    for (const c of clients ?? []) {
      nameMap.set(
        (c as any).id,
        [(c as any).first_name, (c as any).last_name].filter(Boolean).join(" ") || "Client",
      );
    }

    const byClient = new Map<string, { latest: any; unread: number }>();
    for (const m of rows) {
      const cur = byClient.get((m as any).client_id);
      const unreadHit = (m as any).sender_type === "client" && !(m as any).read_at ? 1 : 0;
      if (!cur) {
        byClient.set((m as any).client_id, { latest: m, unread: unreadHit });
      } else {
        cur.unread += unreadHit;
        // rows are ordered desc, so first occurrence is latest — keep it
      }
    }

    return Array.from(byClient.entries()).map(([client_id, v]) => ({
      client_id,
      client_name: nameMap.get(client_id) ?? "Client",
      last_message: (v.latest as any).body,
      last_sender: (v.latest as any).sender_type,
      last_message_at: (v.latest as any).created_at,
      unread_count: v.unread,
    }));
  });

export const getClientChatUnread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("client_messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_type", "client")
      .is("read_at", null);
    return { count: count ?? 0 };
  });

export const getClientChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { client_id: string }) =>
    z.object({ client_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ClientChatMessage[]> => {
    const { data: msgs, error } = await context.supabase
      .from("client_messages")
      .select("id, client_id, sender_type, sender_user_id, body, created_at, read_at")
      .eq("client_id", data.client_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = msgs ?? [];
    const senderIds = Array.from(
      new Set(rows.map((m: any) => m.sender_user_id).filter(Boolean)),
    ) as string[];
    const nameMap = new Map<string, string>();
    if (senderIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", senderIds);
      for (const p of profs ?? [])
        nameMap.set((p as any).id, (p as any).full_name ?? "Staff");
    }
    return rows.map((m: any) => ({
      ...m,
      sender_name: m.sender_user_id ? nameMap.get(m.sender_user_id) ?? "Staff" : null,
    }));
  });

export const markClientChatRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { client_id: string }) =>
    z.object({ client_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase
      .from("client_messages")
      .update({ read_at: nowIso })
      .eq("client_id", data.client_id)
      .eq("sender_type", "client")
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendClientChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { client_id: string; body: string }) =>
    z.object({ client_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("client_messages")
      .insert({
        tenant_id: (prof as any).tenant_id,
        client_id: data.client_id,
        sender_type: "business",
        sender_user_id: context.userId,
        body: data.body,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as any).id };
  });
