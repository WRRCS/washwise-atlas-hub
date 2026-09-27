// Server-only: Twilio Messages REST API. Never imported by client components —
// only from sms.functions.ts (createServerFn handlers).

export async function sendViaTwilio(opts: {
  to: string;
  from: string;
  body: string;
  statusCallbackUrl?: string;
}): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  }

  const params = new URLSearchParams({ To: opts.to, From: opts.from, Body: opts.body });
  if (opts.statusCallbackUrl) params.set("StatusCallback", opts.statusCallbackUrl);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
    },
  );

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
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
