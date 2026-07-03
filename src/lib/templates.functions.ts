import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TRIGGER_EVENTS = [
  "booking_confirmation",
  "appointment_reminder",
  "invoice_sent",
  "invoice_overdue",
  "job_completed_thankyou",
  "review_request",
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export type QuoteTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  service_type_id: string | null;
  header_html: string;
  body_html: string;
  footer_html: string;
  is_default: boolean;
  updated_at: string;
};

export type EmailTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  trigger_event: TriggerEvent;
  subject: string;
  body_html: string;
  is_active: boolean;
  updated_at: string;
};

export const COMPANY_NAME = "Wash Rinse Repeat";

export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return (text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === null || v === undefined || v === "" ? `{{${key}}}` : String(v);
  });
}

/* ================== Quote templates ================== */

export const listQuoteTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QuoteTemplate[]> => {
    const { data, error } = await context.supabase
      .from("quote_templates")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as QuoteTemplate[];
  });

export const saveQuoteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      service_type_id: z.string().uuid().nullable().optional(),
      header_html: z.string().default(""),
      body_html: z.string().default(""),
      footer_html: z.string().default(""),
      is_default: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");

    // Enforce single default per service scope
    if (data.is_default) {
      const scope = data.service_type_id ?? null;
      let q = context.supabase
        .from("quote_templates")
        .update({ is_default: false })
        .eq("tenant_id", prof.tenant_id);
      q = scope === null ? q.is("service_type_id", null) : q.eq("service_type_id", scope);
      if (data.id) q = q.neq("id", data.id);
      const { error: ce } = await q;
      if (ce) throw new Error(ce.message);
    }

    const payload = {
      tenant_id: prof.tenant_id,
      name: data.name,
      service_type_id: data.service_type_id ?? null,
      header_html: data.header_html ?? "",
      body_html: data.body_html ?? "",
      footer_html: data.footer_html ?? "",
      is_default: data.is_default ?? false,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("quote_templates").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("quote_templates").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteQuoteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("quote_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateQuoteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: src, error } = await context.supabase
      .from("quote_templates").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!src) throw new Error("Not found");
    const { data: row, error: ie } = await context.supabase
      .from("quote_templates").insert({
        tenant_id: src.tenant_id,
        name: `${src.name} (copy)`,
        service_type_id: src.service_type_id,
        header_html: src.header_html,
        body_html: src.body_html,
        footer_html: src.footer_html,
        is_default: false,
      }).select("id").single();
    if (ie) throw new Error(ie.message);
    return { id: row.id };
  });

/* ================== Email templates ================== */

export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailTemplate[]> => {
    const { data, error } = await context.supabase
      .from("email_templates")
      .select("*")
      .order("trigger_event")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailTemplate[];
  });

export const saveEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      subject: z.string().optional(),
      body_html: z.string().optional(),
      is_active: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: { name?: string; subject?: string; body_html?: string; is_active?: boolean } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.body_html !== undefined) patch.body_html = data.body_html;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    const { error } = await context.supabase
      .from("email_templates").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================== Client preferences ================== */

export const getClientPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ client_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("client_template_preferences")
      .select("*")
      .eq("client_id", data.client_id)
      .maybeSingle();
    return row ?? null;
  });

export const setClientQuotePreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      quote_template_id: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { error } = await context.supabase
      .from("client_template_preferences")
      .upsert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        quote_template_id: data.quote_template_id,
      }, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================== Resolve + render for a client/context ================== */

async function loadEmailTemplateForClient(
  supabase: any, tenantId: string, event: TriggerEvent, clientId: string | null,
): Promise<EmailTemplate | null> {
  let overrideId: string | null = null;
  if (clientId) {
    const { data: pref } = await supabase
      .from("client_template_preferences")
      .select("email_template_overrides")
      .eq("client_id", clientId)
      .maybeSingle();
    const map = (pref?.email_template_overrides ?? {}) as Record<string, string>;
    overrideId = map[event] ?? null;
  }
  if (overrideId) {
    const { data } = await supabase
      .from("email_templates").select("*").eq("id", overrideId).eq("is_active", true).maybeSingle();
    if (data) return data as EmailTemplate;
  }
  const { data } = await supabase
    .from("email_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("trigger_event", event)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as EmailTemplate) ?? null;
}

export type RenderedEmail = { subject: string; body_html: string; template_id: string; template_name: string };

export async function renderEmailForClientContext(args: {
  supabase: any;
  tenantId: string;
  event: TriggerEvent;
  clientId: string | null;
  vars: Record<string, string | number | null | undefined>;
}): Promise<RenderedEmail | null> {
  const tmpl = await loadEmailTemplateForClient(args.supabase, args.tenantId, args.event, args.clientId);
  if (!tmpl) return null;
  const vars = { company_name: COMPANY_NAME, ...args.vars };
  return {
    subject: renderTemplate(tmpl.subject, vars),
    body_html: renderTemplate(tmpl.body_html, vars),
    template_id: tmpl.id,
    template_name: tmpl.name,
  };
}

/* Preview: render an email template by id with sample or provided vars */
export const previewEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      vars: z.record(z.string(), z.string()).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: tmpl, error } = await context.supabase
      .from("email_templates").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!tmpl) throw new Error("Template not found");
    const vars = { company_name: COMPANY_NAME, ...(data.vars ?? {}) };
    return {
      subject: renderTemplate(tmpl.subject, vars),
      body_html: renderTemplate(tmpl.body_html, vars),
    };
  });

/* Send a custom email to a client using an email template */
export const sendClientEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      template_id: z.string().uuid(),
      extra_vars: z.record(z.string(), z.string()).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: client } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, email")
      .eq("id", data.client_id).maybeSingle();
    if (!client) throw new Error("Client not found");
    const { data: tmpl } = await context.supabase
      .from("email_templates").select("*").eq("id", data.template_id).maybeSingle();
    if (!tmpl) throw new Error("Template not found");

    const vars = {
      company_name: COMPANY_NAME,
      client_name: [client.first_name, client.last_name].filter(Boolean).join(" "),
      date: new Date().toLocaleDateString(),
      ...(data.extra_vars ?? {}),
    };
    const subject = renderTemplate(tmpl.subject, vars);
    const body_html = renderTemplate(tmpl.body_html, vars);

    const { error } = await context.supabase.from("notifications").insert({
      tenant_id: prof.tenant_id,
      recipient_type: "client",
      recipient_id: client.id,
      channel: "email",
      template_name: tmpl.name,
      payload: { subject, body_html, template_id: tmpl.id, to: client.email },
      scheduled_for: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
