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
