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
      .select("id, recipient_type, recipient_id, channel, template_name, scheduled_for, sent_at, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationRow[];
  });
