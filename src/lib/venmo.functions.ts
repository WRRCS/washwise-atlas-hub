import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VenmoSettings = {
  is_connected: boolean;
  handle: string | null;
  test_mode: boolean;
  api_mode: "pay_link";
};

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

function buildPayLink(handle: string, amountCents: number, note: string, testMode: boolean): string {
  const h = normalizeHandle(handle);
  const amount = (amountCents / 100).toFixed(2);
  const noteText = testMode ? `[TEST] ${note}` : note;
  const params = new URLSearchParams({ txn: "pay", amount, note: noteText });
  return `https://venmo.com/${encodeURIComponent(h)}?${params.toString()}`;
}

async function getTenant(context: { supabase: any; userId: string }): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof) throw new Error("No profile");
  return prof.tenant_id;
}

export const getVenmoSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VenmoSettings> => {
    const tenantId = await getTenant(context);
    const { data, error } = await context.supabase
      .from("integrations")
      .select("is_connected, settings")
      .eq("tenant_id", tenantId).eq("provider", "venmo").maybeSingle();
    if (error) throw new Error(error.message);
    const s = (data?.settings as { handle?: string; test_mode?: boolean } | null) ?? {};
    return {
      is_connected: !!data?.is_connected,
      handle: s.handle ?? null,
      test_mode: !!s.test_mode,
      api_mode: "pay_link",
    };
  });

export const saveVenmoSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      handle: z.string().min(1).max(60),
      test_mode: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const handle = normalizeHandle(data.handle);
    if (!/^[a-zA-Z0-9._-]+$/.test(handle)) throw new Error("Invalid Venmo handle");
    const { error } = await context.supabase
      .from("integrations")
      .update({
        is_connected: true,
        connected_at: new Date().toISOString(),
        settings: { handle, test_mode: !!data.test_mode },
      })
      .eq("tenant_id", tenantId).eq("provider", "venmo");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateVenmoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ invoice_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ link: string; amount_cents: number; handle: string; test_mode: boolean }> => {
    const tenantId = await getTenant(context);
    const { data: integ, error: ie } = await context.supabase
      .from("integrations")
      .select("is_connected, settings")
      .eq("tenant_id", tenantId).eq("provider", "venmo").maybeSingle();
    if (ie) throw new Error(ie.message);
    const s = (integ?.settings as { handle?: string; test_mode?: boolean } | null) ?? {};
    if (!integ?.is_connected || !s.handle) {
      throw new Error("Venmo is not configured. Add your Venmo handle in Settings → Integrations.");
    }
    const { data: inv, error: ge } = await context.supabase
      .from("invoices")
      .select("id, number, total_cents, amount_cents, status")
      .eq("id", data.invoice_id).maybeSingle();
    if (ge) throw new Error(ge.message);
    if (!inv) throw new Error("Invoice not found");
    const amount = inv.total_cents ?? inv.amount_cents ?? 0;
    if (amount <= 0) throw new Error("Invoice has no amount");
    const link = buildPayLink(s.handle, amount, `Invoice ${inv.number ?? ""}`.trim(), !!s.test_mode);
    return { link, amount_cents: amount, handle: normalizeHandle(s.handle), test_mode: !!s.test_mode };
  });

export const markVenmoPaymentReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      note: z.string().max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { data: inv, error: ge } = await context.supabase
      .from("invoices")
      .select("id, tenant_id, total_cents, amount_cents, status")
      .eq("id", data.invoice_id).maybeSingle();
    if (ge) throw new Error(ge.message);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "paid") throw new Error("Invoice already paid");
    const amount = inv.total_cents ?? inv.amount_cents ?? 0;
    const { error } = await context.supabase.from("payments").insert({
      tenant_id: tenantId,
      invoice_id: inv.id,
      provider: "venmo",
      amount_cents: amount,
      surcharge_cents: 0,
      net_to_business_cents: amount,
      status: "succeeded",
      processed_at: new Date().toISOString(),
      note: data.note ? `Venmo — ${data.note}` : "Venmo",
      recorded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
