// QuickBooks Online API helpers — server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";

export function qboEnv() {
  const env = cleanEnv(process.env.QBO_ENVIRONMENT ?? "sandbox").toLowerCase();
  return env === "production" ? "production" : "sandbox";
}

export function qboApiBase() {
  return qboEnv() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function qboClientId() {
  const v = cleanEnv(process.env.QBO_CLIENT_ID);
  if (!v) throw new Error("QBO_CLIENT_ID is not configured");
  return v;
}
export function qboClientSecret() {
  const v = cleanEnv(process.env.QBO_CLIENT_SECRET);
  if (!v) throw new Error("QBO_CLIENT_SECRET is not configured");
  return v;
}
export function qboRedirectUri() {
  const v = cleanEnv(process.env.QBO_REDIRECT_URI);
  if (!v) throw new Error("QBO_REDIRECT_URI is not configured");
  return v;
}

export function qboCallbackUri(origin: string) {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  const isAllowed =
    hostname === "localhost" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovableproject.com");
  if (!isAllowed) return qboRedirectUri();
  return `${url.origin}/api/public/qbo/callback`;
}

function cleanEnv(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

// --- state signing ---
function b64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(sig);
}
export async function signState(tenantId: string, redirectUri?: string) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const redirectPart = redirectUri ? `.${b64url(new TextEncoder().encode(redirectUri))}` : "";
  const payload = `${tenantId}.${nonce}${redirectPart}`;
  const sig = await hmac(qboClientSecret(), payload);
  return `${payload}.${sig}`;
}
export async function verifyState(state: string): Promise<{ tenantId: string; redirectUri?: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const sig = parts.at(-1)!;
  const payload = parts.slice(0, -1).join(".");
  const [tenantId] = parts;
  const expected = await hmac(qboClientSecret(), payload);
  if (expected !== sig) return null;
  let redirectUri: string | undefined;
  if (parts.length === 4) {
    redirectUri = decodeB64urlText(parts[2]);
  }
  return { tenantId, redirectUri };
}

function decodeB64urlText(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildAuthUrl(state: string, redirectUri = qboRedirectUri()) {
  const params = new URLSearchParams({
    client_id: qboClientId(),
    scope: SCOPE,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

type TokenResp = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResp> {
  const basic = btoa(`${qboClientId()}:${qboClientSecret()}`);
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${basic}`,
    },
    body,
  });
  if (!r.ok) throw new Error(`QBO token error ${r.status}: ${await r.text()}`);
  return r.json() as Promise<TokenResp>;
}

export function exchangeCode(code: string, redirectUri = qboRedirectUri()) {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }));
}
export function refreshTokens(refreshToken: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function revokeToken(token: string) {
  const basic = btoa(`${qboClientId()}:${qboClientSecret()}`);
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Basic ${basic}`,
    },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

// ---- Admin supabase client (server-only) ----
export function admin(): SupabaseClient<Database> {
  return supabaseAdmin as SupabaseClient<Database>;
}

type IntegRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  external_account_id: string | null;
  settings: any;
  is_connected: boolean;
};

async function getIntegration(supabase: SupabaseClient<Database>, tenantId: string): Promise<IntegRow | null> {
  const { data } = await supabase.from("integrations")
    .select("id, access_token, refresh_token, external_account_id, settings, is_connected")
    .eq("tenant_id", tenantId).eq("provider", "quickbooks").maybeSingle();
  return (data as IntegRow | null) ?? null;
}

async function getAccessToken(supabase: SupabaseClient<Database>, tenantId: string): Promise<{ token: string; realmId: string }> {
  const row = await getIntegration(supabase, tenantId);
  if (!row?.is_connected || !row.refresh_token || !row.external_account_id) {
    throw new Error("QuickBooks is not connected");
  }
  const settings = (row.settings ?? {}) as { access_expires_at?: number };
  const now = Math.floor(Date.now() / 1000);
  if (row.access_token && settings.access_expires_at && settings.access_expires_at - 60 > now) {
    return { token: row.access_token, realmId: row.external_account_id };
  }
  const t = await refreshTokens(row.refresh_token);
  const newSettings = { ...(row.settings ?? {}), access_expires_at: now + t.expires_in };
  await supabase.from("integrations").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    settings: newSettings,
  }).eq("id", row.id);
  return { token: t.access_token, realmId: row.external_account_id };
}

async function qboFetch<T>(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { token, realmId } = await getAccessToken(supabase, tenantId);
  const url = `${qboApiBase()}/v3/company/${realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=70`;
  const r = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`QBO ${r.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- Sync helpers ----

type ClientRow = { id: string; qbo_customer_id: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; billing_address: string | null };

async function ensureCustomer(supabase: SupabaseClient<Database>, tenantId: string, clientId: string): Promise<string> {
  const { data: c } = await supabase.from("clients")
    .select("id, qbo_customer_id, first_name, last_name, email, phone, billing_address")
    .eq("id", clientId).maybeSingle();
  const client = c as ClientRow | null;
  if (!client) throw new Error("Client not found");
  if (client.qbo_customer_id) return client.qbo_customer_id;

  const displayName = [client.first_name, client.last_name].filter(Boolean).join(" ") || client.email || "Customer";
  const body: any = {
    DisplayName: displayName,
    GivenName: client.first_name ?? undefined,
    FamilyName: client.last_name ?? undefined,
    PrimaryEmailAddr: client.email ? { Address: client.email } : undefined,
    PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
  };

  const resp = await qboFetch<{ Customer: { Id: string } }>(
    supabase, tenantId, "/customer",
    { method: "POST", body: JSON.stringify(body) },
  );
  const qboId = resp.Customer.Id;
  await supabase.from("clients").update({ qbo_customer_id: qboId }).eq("id", clientId);
  return qboId;
}

export async function pushInvoiceToQbo(invoiceId: string): Promise<{ qboId: string }> {
  const supabase = admin();
  const { data: inv } = await supabase.from("invoices")
    .select("id, tenant_id, client_id, number, total_cents, issue_date, due_date, qbo_id")
    .eq("id", invoiceId).maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  if (inv.qbo_id) return { qboId: inv.qbo_id };

  const { data: items } = await supabase.from("invoice_line_items")
    .select("description, quantity, unit_price_cents, line_total_cents, service_date, sort_order")
    .eq("invoice_id", invoiceId).order("sort_order").order("service_date");

  const customerId = await ensureCustomer(supabase, inv.tenant_id, inv.client_id);

  const lines = (items ?? []).map((li) => ({
    DetailType: "SalesItemLineDetail",
    Amount: (li.line_total_cents ?? 0) / 100,
    Description: li.description ?? undefined,
    SalesItemLineDetail: {
      Qty: li.quantity ?? 1,
      UnitPrice: (li.unit_price_cents ?? 0) / 100,
      // Use a generic Services item (Id 1 typically exists in sandbox; QBO will pick default if omitted).
    },
  }));
  if (lines.length === 0) {
    lines.push({
      DetailType: "SalesItemLineDetail",
      Amount: (inv.total_cents ?? 0) / 100,
      Description: `Invoice ${inv.number}`,
      SalesItemLineDetail: { Qty: 1, UnitPrice: (inv.total_cents ?? 0) / 100 },
    });
  }

  const body: any = {
    CustomerRef: { value: customerId },
    DocNumber: inv.number,
    TxnDate: inv.issue_date,
    DueDate: inv.due_date ?? undefined,
    Line: lines,
  };

  const resp = await qboFetch<{ Invoice: { Id: string } }>(
    supabase, inv.tenant_id, "/invoice",
    { method: "POST", body: JSON.stringify(body) },
  );
  const qboId = resp.Invoice.Id;
  await supabase.from("invoices").update({
    qbo_id: qboId,
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_error: null,
  }).eq("id", invoiceId);
  return { qboId };
}

// Fire-and-forget wrapper; records the error to the invoice on failure.
export async function trySyncInvoice(invoiceId: string): Promise<void> {
  const supabase = admin();
  // Skip if QBO not connected for this tenant
  const { data: inv } = await supabase.from("invoices").select("tenant_id, qbo_id").eq("id", invoiceId).maybeSingle();
  if (!inv || inv.qbo_id) return;
  const row = await getIntegration(supabase, inv.tenant_id);
  if (!row?.is_connected) return;

  try {
    await pushInvoiceToQbo(invoiceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("invoices").update({
      qbo_sync_error: msg.slice(0, 500),
    }).eq("id", invoiceId);
  }
}
