// Server-only: web-push sender. Import only from *.functions.ts handlers or
// server routes; never from client components.
import webpush from "web-push";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || "mailto:info@washrinserepeatcleaning.com";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Sends a push to a single subscription. Returns:
 *  - "sent" on 2xx
 *  - "gone" when the subscription is expired/unsubscribed (404/410)
 *  - throws for other errors
 */
export async function sendWebPush(
  target: PushTarget,
  payload: PushPayload,
): Promise<"sent" | "gone"> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 },
    );
    return "sent";
  } catch (e: any) {
    const status = e?.statusCode;
    if (status === 404 || status === 410) return "gone";
    throw e;
  }
}
