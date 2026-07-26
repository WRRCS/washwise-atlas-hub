import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { sha256Hex, randomToken, requirePortalSession, PORTAL_LOGIN_TOKEN_TTL_MS, PORTAL_SESSION_TTL_MS } from "@/lib/portal-auth.server";
import { sendEmail } from "@/lib/email.server";
import { sendViaTwilio } from "@/lib/sms.server";
import { normalizePhoneE164 } from "@/lib/phone";

function origin(): string | null {
  try {
    const req = getRequest();
    if (!req) return null;
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

// ============= Login: request + verify magic link =============

export const requestPortalLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: z.string().trim().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id, tenant_id, first_name, email")
      .ilike("email", email);

    const base = origin();
    for (const client of clients ?? []) {
      const token = randomToken();
      const hash = await sha256Hex(token);
      await (supabaseAdmin as any).from("client_portal_tokens").insert({
        tenant_id: (client as any).tenant_id,
        client_id: (client as any).id,
        token_hash: hash,
        expires_at: new Date(Date.now() + PORTAL_LOGIN_TOKEN_TTL_MS).toISOString(),
      } as never);
      const link = `${base ?? ""}/portal-verify?token=${token}`;
      await sendEmail({
        to: (client as any).email,
        subject: "Your Wash Rinse Repeat Cleaning portal link",
        html: `<p>Hi ${(client as any).first_name ?? "there"},</p><p>Tap below to sign in to your client portal. This link expires in 30 minutes and can only be used once.</p><p><a href="${link}">Sign in to your portal</a></p>`,
        text: `Sign in to your portal: ${link} (expires in 30 minutes)`,
      });
    }

    // Always return the same message, whether or not the email matched a
    // client, so the response can't be used to probe which emails are clients.
    return { ok: true, message: "If that email is on file, a login link is on its way." };
  });

export const verifyPortalLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256Hex(data.token);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("client_portal_tokens")
      .select("id, tenant_id, client_id, expires_at, used_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.used_at || new Date(row.expires_at as string) < new Date()) {
      throw new Error("This login link is invalid or has expired. Please request a new one.");
    }
    await (supabaseAdmin as any).from("client_portal_tokens").update({ used_at: new Date().toISOString() } as never).eq("id", row.id);

    const sessionToken = randomToken();
    const sessionHash = await sha256Hex(sessionToken);
    await (supabaseAdmin as any).from("client_portal_sessions").insert({
      tenant_id: row.tenant_id,
      client_id: row.client_id,
      session_token_hash: sessionHash,
      expires_at: new Date(Date.now() + PORTAL_SESSION_TTL_MS).toISOString(),
    } as never);

    const { data: client } = await supabaseAdmin.from("clients").select("first_name, last_name").eq("id", row.client_id as string).maybeSingle();
    return {
      session_token: sessionToken,
      client_name: [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "there",
    };
  });

// ============= Appointments =============

export type PortalAppointment = {
  id: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  service_name: string | null;
  service_address: string | null;
  cleaner_first_names: string[];
};

export const listMyAppointments = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ session_token: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PortalAppointment[]> => {
    const { clientId } = await requirePortalSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, status, scheduled_start, scheduled_end, client:clients(service_address), service:service_types(name)")
      .eq("client_id", clientId)
      .order("scheduled_start", { ascending: true });
    if (error) throw new Error(error.message);

    const jobIds = (jobs ?? []).map((j: any) => j.id);
    const cleanerMap = new Map<string, string[]>();
    if (jobIds.length) {
      const { data: links } = await supabaseAdmin
        .from("job_employees")
        .select("job_id, profile:profiles!job_employees_employee_id_fkey(full_name)")
        .in("job_id", jobIds);
      for (const l of (links ?? []) as any[]) {
        const firstName = (l.profile?.full_name as string | null)?.split(/\s+/)[0] ?? null;
        if (!firstName) continue;
        const list = cleanerMap.get(l.job_id) ?? [];
        list.push(firstName);
        cleanerMap.set(l.job_id, list);
      }
    }

    return (jobs ?? []).map((j: any) => ({
      id: j.id,
      status: j.status,
      scheduled_start: j.scheduled_start,
      scheduled_end: j.scheduled_end,
      service_name: j.service?.name ?? null,
      service_address: j.client?.service_address ?? null,
      cleaner_first_names: cleanerMap.get(j.id) ?? [],
    }));
  });

// ============= Special requests =============

export const submitClientRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      session_token: z.string(),
      job_id: z.string().uuid().nullable().optional(),
      body: z.string().trim().min(1).max(1000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { tenantId, clientId } = await requirePortalSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("client_requests").insert({
      tenant_id: tenantId,
      client_id: clientId,
      job_id: data.job_id ?? null,
      body: data.body,
      status: "pending",
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Messaging (shares the staff SMS inbox, channel="portal") =============

async function notifyManagersOfPortalMessage(opts: { tenantId: string; clientName: string; body: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tenant } = await supabaseAdmin.from("tenants").select("business_email, name").eq("id", opts.tenantId).maybeSingle();
  const toEmail = (tenant as any)?.business_email || "info@washrinserepeatcleaning.com";
  await sendEmail({
    to: toEmail,
    subject: `New client portal message from ${opts.clientName}`,
    html: `<p><strong>${opts.clientName}</strong> sent a message through the client portal:</p><blockquote>${opts.body}</blockquote>`,
    text: `${opts.clientName} sent a portal message: ${opts.body}`,
  });

  const { data: cfg } = await supabaseAdmin.from("voice_agent_config").select("twilio_phone_number").eq("tenant_id", opts.tenantId).maybeSingle();
  const fromNumber = normalizePhoneE164((cfg as any)?.twilio_phone_number ?? null);
  if (!fromNumber) return; // no tenant SMS number configured — email above still went out

  const { data: ownerRoles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("tenant_id", opts.tenantId)
    .eq("role", "owner");
  const ownerIds = (ownerRoles ?? []).map((r: any) => r.user_id);
  const numbers = new Set<string>();
  if (ownerIds.length) {
    const { data: owners } = await supabaseAdmin.from("profiles").select("phone").in("id", ownerIds);
    for (const o of (owners ?? []) as any[]) {
      const n = normalizePhoneE164(o.phone ?? null);
      if (n) numbers.add(n);
    }
  }
  const preview = opts.body.length > 100 ? `${opts.body.slice(0, 100)}…` : opts.body;
  for (const to of numbers) {
    try {
      await sendViaTwilio({ to, from: fromNumber, body: `New portal message from ${opts.clientName}: ${preview}` });
    } catch (err) {
      console.error("[portal] failed to text manager", to, err);
    }
  }
}

export const sendPortalMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ session_token: z.string(), body: z.string().trim().min(1).max(1600) }).parse(input))
  .handler(async ({ data }) => {
    const { tenantId, clientId } = await requirePortalSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin.from("clients").select("first_name, last_name").eq("id", clientId).maybeSingle();
    const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "A client";

    const { error } = await (supabaseAdmin as any).from("sms_messages").insert({
      tenant_id: tenantId,
      client_id: clientId,
      direction: "inbound",
      channel: "portal",
      from_number: null,
      to_number: null,
      body: data.body,
      status: "received",
    } as never);
    if (error) throw new Error(error.message);

    await notifyManagersOfPortalMessage({ tenantId, clientName, body: data.body });
    return { ok: true };
  });

export type PortalMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
};

export const listMyMessages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ session_token: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PortalMessage[]> => {
    const { clientId } = await requirePortalSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("sms_messages")
      .select("id, direction, body, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as PortalMessage[];
  });

// ============= Billing =============

export type PortalInvoice = {
  id: string;
  number: string;
  status: string;
  total_cents: number;
  currency: string;
  due_date: string | null;
  issue_date: string | null;
};

export const listMyInvoices = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ session_token: z.string() }).parse(input))
  .handler(async ({ data }): Promise<PortalInvoice[]> => {
    const { clientId } = await requirePortalSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("invoices")
      .select("id, number, status, total_cents, currency, due_date, issue_date")
      .eq("client_id", clientId)
      .order("issue_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as PortalInvoice[];
  });

export const logout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ session_token: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256Hex(data.session_token);
    await (supabaseAdmin as any).from("client_portal_sessions").delete().eq("session_token_hash", hash);
    return { ok: true };
  });
