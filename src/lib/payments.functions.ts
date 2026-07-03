import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PaymentRow = {
  id: string;
  invoice_id: string;
  provider: "venmo" | "card" | "ach" | "manual";
  amount_cents: number;
  surcharge_cents: number;
  net_to_business_cents: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  processed_at: string | null;
  note: string | null;
  created_at: string;
};

export const listInvoicePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoice_id: string }) => input)
  .handler(async ({ data, context }): Promise<PaymentRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("payments")
      .select("id, invoice_id, provider, amount_cents, surcharge_cents, net_to_business_cents, status, processed_at, note, created_at")
      .eq("invoice_id", data.invoice_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as PaymentRow[];
  });

export const recordManualPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      method: z.enum(["cash", "check", "other"]).default("cash"),
      note: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: inv, error: invErr } = await context.supabase
      .from("invoices")
      .select("id, tenant_id, total_cents, status")
      .eq("id", data.invoice_id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "paid") throw new Error("Invoice already paid");

    const total = inv.total_cents ?? 0;
    const noteText = [data.method === "cash" ? "Cash" : data.method === "check" ? "Check" : "Manual", data.note].filter(Boolean).join(" — ");
    const { error } = await context.supabase.from("payments").insert({
      tenant_id: prof.tenant_id,
      invoice_id: inv.id,
      provider: "manual",
      amount_cents: total,
      surcharge_cents: 0,
      net_to_business_cents: total,
      status: "succeeded",
      processed_at: new Date().toISOString(),
      note: noteText || null,
      recorded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
