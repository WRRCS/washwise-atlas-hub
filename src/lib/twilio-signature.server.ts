// Server-only: Twilio request validation.
// https://www.twilio.com/docs/usage/security#validating-requests
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Rebuilds the public URL Twilio signed. Behind the edge proxy the incoming
 * request URL can be http://; Twilio always signs the https:// public URL.
 */
function publicUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  url.protocol = `${forwardedProto?.split(",")[0]?.trim() || "https"}:`;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) url.host = forwardedHost.split(",")[0]!.trim();
  return url.toString();
}

function expectedSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/**
 * Verifies the X-Twilio-Signature header for a form-encoded Twilio webhook.
 * Fails closed: without TWILIO_AUTH_TOKEN configured, no request is trusted.
 */
export function verifyTwilioSignature(request: Request, form: FormData): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;

  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const expected = expectedSignature(authToken, publicUrl(request), params);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
