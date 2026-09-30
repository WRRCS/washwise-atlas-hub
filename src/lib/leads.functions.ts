import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientContact, clientContactMap } from "@/lib/privacy";

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

/** Where a prospect came from. Staff pick one when logging a lead by hand. */
export const LEAD_SOURCES = [
  { value: "airbnb", label: "Airbnb message" },
  { value: "vrbo", label: "VRBO message" },
  { value: "phone", label: "Phone call" },
  { value: "text", label: "Text message" },
  { value: "website", label: "Website form" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number]["value"];

const SOURCE_VALUES = LEAD_SOURCES.map((s) => s.value) as [LeadSource, ...LeadSource[]];

/** Every source string the app has ever written, mapped to something readable. */
const SOURCE_LABELS: Record<string, string> = {
  airbnb: "Airbnb message",
  airbnb_vrbo: "Airbnb / VRBO message",
  vrbo: "VRBO message",
  phone: "Phone call",
  text: "Text message",
  sms: "Text message",
  website: "Website form",
  godaddy_website: "Website form",
  godaddy: "Website form",
  referral: "Referral",
  turno: "Booking site",
  other: "Other",
};

export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  const key = source.trim().toLowerCase();
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Nobody has replied to a lead once this many hours pass without contact. */
export const REPLY_STALE_HOURS = 72;

export type LeadRow = {
  id: string;
  client_id: string | null;
  source: string;
  status: LeadStatus;
  assigned_to: string | null;
  assigned_to_name: string | null;
  service_interest: string | null;
  notes: string | null;
  last_contacted_at: string | null;
  created_at: string;
  /** Contact details captured when the lead was logged (may predate a client record). */
  name: string | null;
  email: string | null;
  phone: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  needs_reply: boolean;
};

async function getTenant(context: { supabase: any; userId: string }): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof) throw new Error("No profile");
  return prof.tenant_id;
}

function fullName(c: { first_name: string | null; last_name: string | null } | null | undefined) {
  if (!c) return "Unknown";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
}

/** A lead waits on us when it's untouched, or nobody has followed up in REPLY_STALE_HOURS. */
function needsReply(
  status: string,
  lastContactedAt: string | null,
  createdAt: string,
  now = Date.now(),
): boolean {
  if (status === "new") return true;
  if (status !== "contacted") return false;
  const stamp = lastContactedAt ?? createdAt;
  return now - new Date(stamp).getTime() > REPLY_STALE_HOURS * 60 * 60 * 1000;
}

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      status: z.enum(["new","contacted","qualified","won","lost"]).nullable().optional(),
      source: z.string().nullable().optional(),
      days: z.number().int().positive().max(365).nullable().optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<LeadRow[]> => {
    let q = context.supabase
      .from("leads")
      .select("id, client_id, source, status, assigned_to, service_interest, notes, last_contacted_at, created_at, name, email, phone, assignee:profiles!leads_assigned_to_fkey(full_name), client:clients(id, first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    if (data.source) q = q.eq("source", data.source);
    if (data.days) {
      const from = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
      q = q.gte("created_at", from);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const contacts = await clientContactMap(
      context.supabase,
      (rows ?? []).map((r: any) => r.client_id),
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      client_id: r.client_id,
      source: r.source,
      status: r.status,
      assigned_to: r.assigned_to,
      assigned_to_name: r.assignee?.full_name ?? null,
      service_interest: r.service_interest,
      notes: r.notes,
      last_contacted_at: r.last_contacted_at,
      created_at: r.created_at,
      name: r.name ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      client_name: r.client ? fullName(r.client) : (r.name ?? "Unknown"),
      client_email: contacts.get(r.client_id)?.email ?? r.email ?? null,
      client_phone: contacts.get(r.client_id)?.phone ?? r.phone ?? null,
      needs_reply: needsReply(r.status, r.last_contacted_at, r.created_at),
    }));
  });

export const countNewLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { count, error } = await context.supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export type NeedsReplyRow = {
  id: string;
  name: string;
  source: string;
  phone: string | null;
  email: string | null;
  service_interest: string | null;
  waiting_since: string;
  hours_waiting: number;
};

/** Leads that are still waiting on a response, longest wait first. */
export const listNeedsReply = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NeedsReplyRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("leads")
      .select("id, name, email, phone, source, status, service_interest, last_contacted_at, created_at, client:clients(first_name, last_name)")
      .in("status", ["new", "contacted"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (rows ?? [])
      .filter((r: any) => needsReply(r.status, r.last_contacted_at, r.created_at, now))
      .map((r: any) => {
        const waitingSince = (r.status === "new" ? null : r.last_contacted_at) ?? r.created_at;
        return {
          id: r.id,
          name: r.client ? fullName(r.client) : (r.name ?? "Unknown"),
          source: r.source,
          phone: r.phone ?? null,
          email: r.email ?? null,
          service_interest: r.service_interest ?? null,
          waiting_since: waitingSince,
          hours_waiting: Math.max(0, Math.round((now - new Date(waitingSince).getTime()) / 3_600_000)),
        };
      })
      .sort((a, b) => b.hours_waiting - a.hours_waiting);
  });

export const getLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("leads")
      .select("id, tenant_id, client_id, source, status, assigned_to, service_interest, notes, payload, last_contacted_at, created_at, updated_at, name, email, phone, assignee:profiles!leads_assigned_to_fkey(full_name), client:clients(id, first_name, last_name, service_address)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Lead not found");
    const contact = row.client_id
      ? await clientContact(context.supabase, row.client_id)
      : { email: null, phone: null, billing_address: null };
    const client = row.client
      ? { ...(row.client as { id: string; first_name: string | null; last_name: string | null; service_address: string | null }), email: contact.email ?? row.email ?? null, phone: contact.phone ?? row.phone ?? null, billing_address: contact.billing_address }
      : null;
    return { ...row, client };
  });

export const updateLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["new","contacted","qualified","won","lost"]),
      note: z.string().max(1000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "contacted" || data.status === "qualified") {
      patch.last_contacted_at = new Date().toISOString();
    }
    if (data.note && data.note.trim()) {
      // Append to existing notes with a timestamp.
      const { data: existing } = await context.supabase
        .from("leads").select("notes").eq("id", data.id).maybeSingle();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const entry = `[${stamp}] ${data.status}: ${data.note.trim()}`;
      patch.notes = existing?.notes ? `${existing.notes}\n\n${entry}` : entry;
    }
    const { error } = await context.supabase.from("leads").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      assigned_to: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({ assigned_to: data.assigned_to })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Log a prospect from anywhere: a call, a text, an Airbnb message, a referral. */
export const createLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().trim().min(1, "Name is required").max(200),
      phone: z.string().trim().max(60).nullable().optional(),
      email: z.string().trim().max(255).nullable().optional(),
      source: z.enum(SOURCE_VALUES).default("other"),
      service_interest: z.string().trim().max(200).nullable().optional(),
      address: z.string().trim().max(300).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      throw new Error("That email address doesn't look right.");
    }
    const tenantId = await getTenant(context);
    const { data: row, error } = await context.supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        source: data.source,
        status: "new",
        service_interest: data.service_interest || null,
        notes: data.notes || null,
        payload: data.address ? { address: data.address } : {},
      } as never)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Could not save that lead. Try again.");
    return { ok: true, id: row.id };
  });

export const convertLeadToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { data: lead, error: ge } = await context.supabase
      .from("leads")
      .select("id, tenant_id, client_id, payload, notes, service_interest, name, email, phone")
      .eq("id", data.id).maybeSingle();
    if (ge) throw new Error(ge.message);
    if (!lead) throw new Error("Lead not found");

    let clientId = lead.client_id as string | null;
    // If no linked client (hand-logged lead), create one now.
    if (!clientId) {
      const p = (lead.payload as Record<string, unknown> | null) ?? {};
      const rawName = String(lead.name ?? p.name ?? p.full_name ?? "").trim();
      const [first, ...rest] = rawName.split(/\s+/);
      const email = lead.email ?? (p.email ? String(p.email) : null);
      const phone = lead.phone ?? (p.phone ? String(p.phone) : null);
      const { data: c, error: ce } = await context.supabase.from("clients").insert({
        tenant_id: tenantId,
        first_name: first || null,
        last_name: rest.join(" ") || null,
        email,
        phone,
        notes: lead.notes ?? null,
      } as never).select("id").maybeSingle();
      if (ce) throw new Error(ce.message);
      clientId = c?.id ?? null;
    }

    const { error: ue } = await context.supabase
      .from("leads")
      .update({ status: "won", client_id: clientId })
      .eq("id", data.id);
    if (ue) throw new Error(ue.message);
    return { ok: true, client_id: clientId };
  });

export const sendTestLeadWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { data: integ } = await context.supabase
      .from("integrations")
      .select("settings, is_connected")
      .eq("tenant_id", tenantId).eq("provider", "godaddy").maybeSingle();
    const token = (integ?.settings as { webhook_token?: string } | null)?.webhook_token;
    if (!token) throw new Error("Generate the webhook URL first.");
    if (!integ?.is_connected) throw new Error("Enable the GoDaddy integration first.");

    const url = `${data.origin}/api/public/hooks/lead/${tenantId}?token=${token}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Lead",
        email: "test@example.com",
        phone: "(555) 555-0100",
        service: "House Cleaning",
        message: "This is a test submission from WRRCS.com.",
        source: "godaddy_website",
        _test: "true",
      }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Webhook returned ${resp.status}: ${text.slice(0, 200)}`);
    return { ok: true };
  });
