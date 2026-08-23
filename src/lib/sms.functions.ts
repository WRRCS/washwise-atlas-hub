import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendViaTwilio } from "@/lib/sms.server";
import { normalizePhoneE164 } from "@/lib/phone";

export type SmsMessageRow = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  status: string;
  twilio_sid: string | null;
  sent_by: string | null;
  read_at: string | null;
  created_at: string;
};

export type ConversationRow = {
  key: string; // client_id if matched, otherwise the counterparty phone number
  client_id: string | null;
  client_name: string | null;
  counterparty_number: string;
  last_message: string;
  last_message_at: string;
  last_direction: "inbound" | "outbound";
  unread_count: number;
};

async function getTenantAndNumber(
  context: any,
): Promise<{ tenantId: string; twilioNumber: string | null }> {
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.tenant_id) throw new Error("No tenant");
  const { data: cfg } = await context.supabase
    .from("voice_agent_config")
    .select("twilio_phone_number")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();
  return { tenantId: profile.tenant_id as string, twilioNumber: cfg?.twilio_phone_number ?? null };
}

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

// ============= List conversations (left pane) =============

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationRow[]> => {
    const { tenantId } = await getTenantAndNumber(context);
    const { data: rows, error } = await (context.supabase as any)
      .from("sms_messages")
      .select(
        "id, client_id, direction, from_number, to_number, body, read_at, created_at, client:clients(first_name, last_name)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const byKey = new Map<string, ConversationRow>();
    for (const r of (rows ?? []) as any[]) {
      const key = r.client_id ?? (r.direction === "inbound" ? r.from_number : r.to_number);
      const counterparty = r.direction === "inbound" ? r.from_number : r.to_number;
      const existing = byKey.get(key);
      if (!existing) {
        const name = r.client
          ? [r.client.first_name, r.client.last_name].filter(Boolean).join(" ")
          : null;
        byKey.set(key, {
          key,
          client_id: r.client_id,
          client_name: name || null,
          counterparty_number: counterparty,
          last_message: r.body,
          last_message_at: r.created_at,
          last_direction: r.direction,
          unread_count: r.direction === "inbound" && !r.read_at ? 1 : 0,
        });
      } else if (r.direction === "inbound" && !r.read_at) {
        existing.unread_count += 1;
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      b.last_message_at.localeCompare(a.last_message_at),
    );
  });

export const getUnreadCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { tenantId } = await getTenantAndNumber(context);
    const { count, error } = await (context.supabase as any)
      .from("sms_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "inbound")
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

// ============= Thread (right pane) =============

const threadSchema = z
  .object({
    client_id: z.string().uuid().nullable().optional(),
    counterparty_number: z.string().nullable().optional(),
  })
  .refine(
    (v) => !!v.client_id || !!v.counterparty_number,
    "client_id or counterparty_number required",
  );

export const getThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => threadSchema.parse(input))
  .handler(async ({ data, context }): Promise<SmsMessageRow[]> => {
    const { tenantId } = await getTenantAndNumber(context);
    let q = (context.supabase as any)
      .from("sms_messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (data.client_id) {
      q = q.eq("client_id", data.client_id);
    } else if (data.counterparty_number) {
      q = q
        .is("client_id", null)
        .or(`from_number.eq.${data.counterparty_number},to_number.eq.${data.counterparty_number}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as SmsMessageRow[];
  });

export const markThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => threadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId } = await getTenantAndNumber(context);
    let q = (context.supabase as any)
      .from("sms_messages")
      .update({ read_at: new Date().toISOString() } as never)
      .eq("tenant_id", tenantId)
      .eq("direction", "inbound")
      .is("read_at", null);
    if (data.client_id) {
      q = q.eq("client_id", data.client_id);
    } else if (data.counterparty_number) {
      q = q.is("client_id", null).eq("from_number", data.counterparty_number);
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Send (outbound reply) =============

const sendSchema = z
  .object({
    client_id: z.string().uuid().nullable().optional(),
    to_number: z.string().min(3).nullable().optional(),
    body: z.string().min(1).max(1600),
  })
  .refine((v) => !!v.client_id || !!v.to_number, "client_id or to_number required");

export const sendSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId, twilioNumber } = await getTenantAndNumber(context);
    if (!twilioNumber)
      throw new Error("No business SMS number configured. Set it under Settings → Voice AI.");

    let destinationRaw: string | null = data.to_number ?? null;
    const clientId: string | null = data.client_id ?? null;
    if (clientId) {
      // Machinery read: the number is used to address the SMS and is never
      // returned to the caller, so it goes through the admin client (client
      // phone numbers are not readable by staff without CPNI access).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("phone")
        .eq("id", clientId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!client?.phone) throw new Error("This client has no phone number on file.");
      destinationRaw = client.phone;
    }

    const to = normalizePhoneE164(destinationRaw);
    if (!to) throw new Error("Invalid destination phone number.");
    const from = normalizePhoneE164(twilioNumber);
    if (!from) throw new Error("Invalid business phone number configured.");

    const base = origin();
    const statusCallbackUrl = base ? `${base}/api/public/twilio/sms/${tenantId}/status` : undefined;

    const sid = await sendViaTwilio({ to, from, body: data.body, statusCallbackUrl });

    const { error: insertError } = await (context.supabase as any).from("sms_messages").insert({
      tenant_id: tenantId,
      client_id: clientId,
      direction: "outbound",
      from_number: from,
      to_number: to,
      body: data.body,
      status: "sent",
      twilio_sid: sid,
      sent_by: context.userId,
    } as never);
    if (insertError) throw new Error(insertError.message);

    return { ok: true };
  });
