import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  is_active: boolean;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  recipient_type: "client" | "employee" | "owner";
  recipient_id: string;
  channel: "sms" | "email";
  template_name: string;
  scheduled_for: string;
  sent_at: string | null;
  status: "pending" | "sent" | "failed";
  error: string | null;
  created_at: string;
};

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationTemplate[]> => {
    const { data, error } = await context.supabase
      .from("notification_templates")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationTemplate[];
  });

export const updateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      subject: z.string().nullable().optional(),
      body: z.string().min(1).optional(),
      is_active: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: { subject?: string | null; body?: string; is_active?: boolean } = {};
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.body !== undefined) patch.body = data.body;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    const { error } = await context.supabase
      .from("notification_templates")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getReminderLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) return { reminder_lead_hours: 24 };
    const { data } = await context.supabase
      .from("tenants")
      .select("reminder_lead_hours")
      .eq("id", prof.tenant_id)
      .maybeSingle();
    return { reminder_lead_hours: (data as any)?.reminder_lead_hours ?? 24 };
  });

export const setReminderLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ hours: z.number().int().min(1).max(168) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("No profile");
    const { error } = await context.supabase
      .from("tenants")
      .update({ reminder_lead_hours: data.hours })
      .eq("id", prof.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRecentNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationRow[]> => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, recipient_type, recipient_id, channel, template_name, scheduled_for, sent_at, status, error, created_at, recalled_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationRow[];
  });

export type OutgoingEmail = {
  id: string;
  template_name: string;
  recipient_type: "client" | "employee" | "owner";
  scheduled_for: string;
  client_name: string | null;
};

/** Client emails still inside the 10-minute hold window — recallable. */
export const listRecallableEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutgoingEmail[]> => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, template_name, recipient_type, recipient_id, scheduled_for")
      .eq("channel", "email")
      .eq("status", "pending")
      .is("recalled_at", null)
      .order("scheduled_for", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      id: string; template_name: string; recipient_type: OutgoingEmail["recipient_type"];
      recipient_id: string; scheduled_for: string;
    }>;

    const clientIds = [...new Set(rows.filter((r) => r.recipient_type === "client").map((r) => r.recipient_id))];
    const names = new Map<string, string>();
    if (clientIds.length) {
      const { data: clients } = await context.supabase
        .from("clients")
        .select("id, first_name, last_name")
        .in("id", clientIds);
      for (const c of clients ?? []) {
        names.set(c.id as string, [c.first_name, c.last_name].filter(Boolean).join(" "));
      }
    }

    return rows.map((r) => ({
      id: r.id,
      template_name: r.template_name,
      recipient_type: r.recipient_type,
      scheduled_for: r.scheduled_for,
      client_name: r.recipient_type === "client" ? names.get(r.recipient_id) ?? null : null,
    }));
  });

/** Stop a queued email from going out. Only works while it is still pending. */
export const recallEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    const { data: row, error } = await context.supabase
      .from("notifications")
      .update({ recalled_at: new Date().toISOString(), recalled_by: context.userId, status: "failed", error: "Recalled by staff" })
      .eq("id", data.id)
      .eq("status", "pending")
      .is("recalled_at", null)
      .select("id")
      .maybeSingle();
    if (error) return { error: error.message };
    if (!row) return { error: "This email has already gone out and can't be recalled." };
    return { ok: true };
  });
