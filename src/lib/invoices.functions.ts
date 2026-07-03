import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled" | "void";

const SURCHARGE_RATE = 0.03;
const SURCHARGE_FIXED = 30; // 30 cents

function calcSurcharge(subtotal: number) {
  if (subtotal <= 0) return 0;
  return Math.round(subtotal * SURCHARGE_RATE) + SURCHARGE_FIXED;
}

// ============= List / Filter =============

export const listInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      status: z.string().optional(),
      client_id: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).partial().parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("invoices")
      .select("id, number, status, subtotal_cents, surcharge_cents, total_cents, amount_cents, currency, issue_date, due_date, sent_at, paid_at, card_surcharge, cleanings_count, job_id, client:clients(id, first_name, last_name)")
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status as never);
    if (data.client_id) q = q.eq("client_id", data.client_id);
    if (data.from) q = q.gte("issue_date", data.from);
    if (data.to) q = q.lte("issue_date", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============= Detail =============

export const getInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [{ data: inv, error }, { data: items, error: ie }] = await Promise.all([
      context.supabase
        .from("invoices")
        .select("id, number, status, subtotal_cents, surcharge_cents, total_cents, amount_cents, currency, issue_date, due_date, sent_at, paid_at, card_surcharge, cleanings_count, bundle_month, job_id, client_id, client:clients(id, first_name, last_name, email, phone, billing_address, service_address)")
        .eq("id", data.id)
        .maybeSingle(),
      context.supabase
        .from("invoice_line_items")
        .select("id, description, quantity, unit_price_cents, line_total_cents, service_date, sort_order")
        .eq("invoice_id", data.id)
        .order("sort_order")
        .order("service_date"),
    ]);
    if (error) throw new Error(error.message);
    if (ie) throw new Error(ie.message);
    if (!inv) return null;
    return { ...inv, line_items: items ?? [] };
  });

// ============= Toggle card surcharge =============

export const setCardSurcharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inv, error: ge } = await context.supabase
      .from("invoices")
      .select("subtotal_cents")
      .eq("id", data.id)
      .maybeSingle();
    if (ge) throw new Error(ge.message);
    if (!inv) throw new Error("Invoice not found");
    const surcharge = data.enabled ? calcSurcharge(inv.subtotal_cents) : 0;
    const total = inv.subtotal_cents + surcharge;
    const { error } = await context.supabase
      .from("invoices")
      .update({
        card_surcharge: data.enabled,
        surcharge_cents: surcharge,
        total_cents: total,
        amount_cents: total,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, surcharge_cents: surcharge, total_cents: total };
  });

// ============= Send =============

export const sendInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Mark paid / cancel =============

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "cancelled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Monthly bundle =============

export const createMonthlyBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");

    const [year, month] = data.month.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    // Find completed jobs for client in the given month without an invoice yet
    const { data: jobs, error: je } = await context.supabase
      .from("jobs")
      .select("id, scheduled_start, price_cents, service_type:service_types(name)")
      .eq("client_id", data.client_id)
      .eq("status", "completed")
      .gte("scheduled_start", start.toISOString())
      .lt("scheduled_start", end.toISOString())
      .order("scheduled_start");
    if (je) throw new Error(je.message);
    if (!jobs || jobs.length === 0) throw new Error("No completed jobs found in that month.");

    // Filter out those already invoiced
    const jobIds = jobs.map((j) => j.id);
    const { data: existing } = await context.supabase
      .from("invoices").select("job_id").in("job_id", jobIds);
    const invoiced = new Set((existing ?? []).map((e) => e.job_id));
    const eligible = jobs.filter((j) => !invoiced.has(j.id));
    if (eligible.length === 0) throw new Error("All completed jobs in that month are already invoiced.");

    // Delete auto-invoices for those jobs so we can bundle them (they were draft only)
    // Actually: keep them intact but skip. To bundle, we cancel prior drafts for these jobs.
    const draftIds = (existing ?? []).filter((e) => jobIds.includes(e.job_id as string)).map((e) => e.job_id!);
    if (draftIds.length) {
      await context.supabase
        .from("invoices")
        .delete()
        .in("job_id", draftIds)
        .eq("status", "draft");
    }
    const toBundle = jobs; // include all jobs in the month once drafts cleared

    // Next invoice number
    const { data: numData, error: ne } = await context.supabase.rpc("next_invoice_number", { _tenant: prof.tenant_id });
    if (ne) throw new Error(ne.message);
    const number = numData as string;

    const subtotal = toBundle.reduce((sum, j) => sum + (j.price_cents ?? 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: invoice, error: ie } = await context.supabase
      .from("invoices")
      .insert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        job_id: null,
        number,
        status: "draft",
        currency: "usd",
        subtotal_cents: subtotal,
        surcharge_cents: 0,
        total_cents: subtotal,
        amount_cents: subtotal,
        issue_date: today,
        due_date: due,
        cleanings_count: toBundle.length,
        bundle_month: `${data.month}-01`,
      })
      .select("id").single();
    if (ie) throw new Error(ie.message);

    const items = toBundle.map((j, i) => {
      const d = new Date(j.scheduled_start);
      const label = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
      const svc = (j.service_type as { name?: string } | null)?.name ?? "Cleaning";
      return {
        invoice_id: invoice.id,
        tenant_id: prof.tenant_id,
        description: `${svc} — ${label}`,
        quantity: 1,
        unit_price_cents: j.price_cents,
        line_total_cents: j.price_cents,
        service_date: j.scheduled_start.slice(0, 10),
        sort_order: i,
      };
    });
    const { error: lie } = await context.supabase.from("invoice_line_items").insert(items);
    if (lie) throw new Error(lie.message);

    return { id: invoice.id, number, count: toBundle.length };
  });

// Completed jobs count for the client in a given month (for the bundle UI preview)
export const previewMonthlyBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      month: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [year, month] = data.month.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const end = new Date(Date.UTC(year, month, 1)).toISOString();
    const { data: jobs, error } = await context.supabase
      .from("jobs")
      .select("id, scheduled_start, price_cents, service_type:service_types(name)")
      .eq("client_id", data.client_id)
      .eq("status", "completed")
      .gte("scheduled_start", start)
      .lt("scheduled_start", end)
      .order("scheduled_start");
    if (error) throw new Error(error.message);
    return jobs ?? [];
  });
