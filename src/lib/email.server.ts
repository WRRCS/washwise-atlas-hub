// Server-only: transactional email via Resend's REST API. Never imported by
// client components — only from *.functions.ts server handlers.
//
// Requires a RESEND_API_KEY environment variable (same treatment as the
// TWILIO_* keys) — without it, sends are logged and skipped rather than
// throwing, so a missing key never takes down the calling request.

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    opts.from ||
    process.env.EMAIL_FROM ||
    "Wash Rinse Repeat Cleaning <no-reply@washrinserepeatcleaning.com>";

  if (!apiKey) {
    console.error(
      `[email] RESEND_API_KEY not configured — skipped "${opts.subject}" to ${opts.to}`,
    );
    return { ok: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] send failed (${res.status}):`, body);
    return { ok: false };
  }
  return { ok: true };
}
