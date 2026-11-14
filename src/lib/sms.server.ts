// Server-only: Twilio Messages REST API. Never imported by client components —
// only from sms.functions.ts (createServerFn handlers).

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

/** True when this app can send texts (Twilio connected through Lovable, or legacy account keys). */
export function twilioConfigured() {
  return !!(process.env.LOVABLE_API_KEY && process.env.TWILIO_API_KEY) || !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** The business texting number: the one saved in Settings, else the first number on the Twilio account. */
export async function businessTextNumber(saved: string | null | undefined): Promise<string | null> {
  if (saved?.trim()) return saved.trim();
  const lovableKey = process.env.LOVABLE_API_KEY, twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) return null;
  const res = await fetch(`${GATEWAY_URL}/IncomingPhoneNumbers.json?PageSize=1`, {
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": twilioKey },
  });
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => ({}));
  return json?.incoming_phone_numbers?.[0]?.phone_number ?? null;
}

export async function sendViaTwilio(opts: {
  to: string;
  from: string;
  body: string;
  statusCallbackUrl?: string;
}): Promise<string> {
  const params = new URLSearchParams({ To: opts.to, From: opts.from, Body: opts.body });
  if (opts.statusCallbackUrl) params.set("StatusCallback", opts.statusCallbackUrl);

  const lovableKey = process.env.LOVABLE_API_KEY, twilioKey = process.env.TWILIO_API_KEY;
  const accountSid = process.env.TWILIO_ACCOUNT_SID, authToken = process.env.TWILIO_AUTH_TOKEN;
  let res: Response;
  if (lovableKey && twilioKey) {
    res = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": twilioKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } else if (accountSid && authToken) {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
      body: params.toString(),
    });
  } else {
    throw new Error("Texting isn't set up yet (Twilio is not connected).");
  }

  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* keep raw text */ }
  if (!res.ok) {
    console.error(`Twilio send failed [${res.status}]: ${text}`);
    throw new Error(json?.message || `Twilio send failed (${res.status})`);
  }
  return json.sid as string;
}

/** Text a client from the business number and log it. Caller must already be authorized. */
export async function sendClientSms(context: any, clientId: string, body: string): Promise<void> {
  const { normalizePhoneE164 } = await import("@/lib/phone");
  const { data: profile } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!profile?.tenant_id) throw new Error("No tenant");
  const tenantId = profile.tenant_id as string;
  const { data: cfg } = await context.supabase.from("voice_agent_config").select("twilio_phone_number").eq("tenant_id", tenantId).maybeSingle();
  const from = normalizePhoneE164(cfg?.twilio_phone_number ?? null);
  if (!from) throw new Error("No business text number set up yet (Settings → Voice AI).");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: client } = await supabaseAdmin.from("clients").select("phone").eq("id", clientId).eq("tenant_id", tenantId).maybeSingle();
  const to = normalizePhoneE164((client as any)?.phone ?? null);
  if (!to) throw new Error("This client has no phone number on file.");
  const sid = await sendViaTwilio({ to, from, body });
  await context.supabase.from("sms_messages").insert({
    tenant_id: tenantId, client_id: clientId, direction: "outbound", from_number: from, to_number: to,
    body, status: "sent", twilio_sid: sid, sent_by: context.userId,
  } as never);
}
