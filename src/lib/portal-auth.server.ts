// Server-only helpers for the client portal's passwordless auth. Clients never
// get a Supabase user account — a magic-link token is exchanged for a session
// token, both stored only as SHA-256 hashes (Web Crypto, not Node crypto, so
// this runs fine on the Cloudflare Workers target).

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export const PORTAL_LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes to click the emailed link
export const PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days signed in

export type PortalSession = { tenantId: string; clientId: string };

export async function requirePortalSession(sessionToken: string | null | undefined): Promise<PortalSession> {
  if (!sessionToken) throw new Error("Not signed in. Please request a new login link.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const hash = await sha256Hex(sessionToken);
  const { data: session, error } = await (supabaseAdmin as any)
    .from("client_portal_sessions")
    .select("tenant_id, client_id, expires_at")
    .eq("session_token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session || new Date(session.expires_at as string) < new Date()) {
    throw new Error("Your session expired. Please request a new login link.");
  }
  await (supabaseAdmin as any)
    .from("client_portal_sessions")
    .update({ last_seen_at: new Date().toISOString() } as never)
    .eq("session_token_hash", hash);
  return { tenantId: session.tenant_id as string, clientId: session.client_id as string };
}
