import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getTenantId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (!data?.tenant_id) throw new Error("No profile");
  return data.tenant_id as string;
}

export const getQboAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin: z.string().url().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenantId(context.supabase, context.userId);
    const { signState, buildAuthUrl, qboReturnOrigin, qboEnv } = await import("./qbo.server");
    const returnOrigin = data.origin ? qboReturnOrigin(data.origin) : undefined;
    const state = await signState(tenantId, returnOrigin);
    return { url: buildAuthUrl(state), env: qboEnv() };
  });

export const getQboStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("integrations")
      .select("is_connected, external_account_id, connected_at, settings")
      .eq("provider", "quickbooks").maybeSingle();
    const settings = (data?.settings ?? {}) as { company_name?: string; environment?: string };
    return {
      connected: !!data?.is_connected,
      realm_id: data?.external_account_id ?? null,
      connected_at: data?.connected_at ?? null,
      company_name: settings.company_name ?? null,
      environment: settings.environment ?? null,
    };
  });

export const disconnectQbo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await getTenantId(context.supabase, context.userId);
    const { data: row } = await context.supabase.from("integrations")
      .select("refresh_token").eq("tenant_id", tenantId).eq("provider", "quickbooks").maybeSingle();
    if (row?.refresh_token) {
      const { revokeToken } = await import("./qbo.server");
      await revokeToken(row.refresh_token);
    }
    await context.supabase.from("integrations").update({
      is_connected: false,
      access_token: null,
      refresh_token: null,
      external_account_id: null,
      connected_at: null,
    }).eq("tenant_id", tenantId).eq("provider", "quickbooks");
    return { ok: true };
  });

export const syncInvoiceToQbo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Verify the invoice belongs to the caller's tenant using the RLS-scoped client.
    const { data: owned } = await context.supabase
      .from("invoices").select("id").eq("id", data.invoice_id).maybeSingle();
    if (!owned) throw new Error("Invoice not found or access denied");

    const { pushInvoiceToQbo } = await import("./qbo.server");
    try {
      const r = await pushInvoiceToQbo(data.invoice_id);
      return { ok: true, qbo_id: r.qboId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await context.supabase.from("invoices")
        .update({ qbo_sync_error: msg.slice(0, 500) })
        .eq("id", data.invoice_id);
      throw new Error(msg);
    }
  });

export const listQboSyncErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("invoices")
      .select("id, number, qbo_sync_error, client:clients(first_name, last_name)")
      .not("qbo_sync_error", "is", null)
      .is("qbo_id", null)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []).map((r: any) => ({
      id: r.id, number: r.number, error: r.qbo_sync_error,
      client_name: [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ") || "—",
    }));
  });
