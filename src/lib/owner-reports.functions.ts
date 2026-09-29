import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type TransactionRow = {
  kind: "invoice" | "payment";
  occurred_on: string;
  client_id: string | null;
  client_name: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  job_id: string | null;
  method: string | null;
  amount_cents: number;
  status: string | null;
};

export const reportTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<TransactionRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_transactions", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({ ...r, amount_cents: Number(r.amount_cents) }));
  });

export type InvoiceReportRow = {
  id: string;
  number: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  billing_address: string | null;
  status: string;
  subtotal_cents: number;
  total_cents: number;
  paid_cents: number;
  issue_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  job_id: string | null;
};

export const reportInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<InvoiceReportRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_invoices", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      subtotal_cents: Number(r.subtotal_cents),
      total_cents: Number(r.total_cents),
      paid_cents: Number(r.paid_cents),
    }));
  });

export type ClientBalanceRow = {
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string | null;
  invoiced_cents: number;
  paid_cents: number;
  balance_cents: number;
  late_balance_cents: number;
  invoice_count: number;
  last_invoice_date: string | null;
  last_paid_at: string | null;
  avg_payment_days: number;
};

export const reportClientBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientBalanceRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_client_balances");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      invoiced_cents: Number(r.invoiced_cents),
      paid_cents: Number(r.paid_cents),
      balance_cents: Number(r.balance_cents),
      late_balance_cents: Number(r.late_balance_cents),
      invoice_count: Number(r.invoice_count),
      avg_payment_days: Number(r.avg_payment_days),
    }));
  });

export type ClientDirectoryRow = {
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  client_name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  service_address: string | null;
  is_active: boolean | null;
  is_airbnb_host: boolean | null;
  created_at: string;
  properties: { id: string; label: string | null; address: string | null; is_primary: boolean }[];
  jobs_count: number;
  last_job_at: string | null;
  lifetime_revenue_cents: number;
  has_sop: boolean;
};

export const reportClientDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientDirectoryRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_client_directory");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      properties: r.properties ?? [],
      jobs_count: Number(r.jobs_count),
      lifetime_revenue_cents: Number(r.lifetime_revenue_cents),
    }));
  });

export type TimesheetRow = {
  entry_id: string;
  user_id: string | null;
  full_name: string | null;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  hours: number;
  job_id: string | null;
  job_label: string | null;
  note: string | null;
};

export type SalesSummaryRow = {
  day: string;
  sales_cents: number;
  labor_cost_cents: number;
  labor_hours: number;
  labor_pct_of_sales: number;
  jobs_completed_count: number;
};

export const reportSalesSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<SalesSummaryRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_sales_summary", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      day: r.day,
      sales_cents: Number(r.sales_cents),
      labor_cost_cents: Number(r.labor_cost_cents),
      labor_hours: Number(r.labor_hours),
      labor_pct_of_sales: Number(r.labor_pct_of_sales),
      jobs_completed_count: Number(r.jobs_completed_count),
    }));
  });

export const reportTimesheets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<TimesheetRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_timesheets", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({ ...r, hours: Number(r.hours) }));
  });

export type CommunicationRow = {
  sent_on: string | null;
  client_id: string | null;
  client_name: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  status: string | null;
};

export const reportCommunications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<CommunicationRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("report_client_communications", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as CommunicationRow[];
  });

export type ClientAccount = {
  client: {
    id: string;
    name: string;
    service_address: string | null;
    is_active: boolean | null;
    is_airbnb_host: boolean | null;
    created_at: string;
    email: string | null;
    phone: string | null;
    billing_address: string | null;
    cpni_visible: boolean;
  };
  sop: string | null;
  specs: Record<string, any> | null;
  properties: { id: string; label: string | null; address: string | null; notes: string | null; is_primary: boolean }[];
  notes: { id: string; note: string; created_at: string }[];
  jobs: {
    id: string; status: string; scheduled_start: string; scheduled_end: string | null;
    actual_start: string | null; actual_end: string | null;
    service_name: string | null; price_cents: number | null; crew: string;
  }[];
  invoices: {
    id: string; number: string | null; status: string; total_cents: number;
    issue_date: string | null; due_date: string | null; paid_at: string | null;
  }[];
  payments: {
    id: string; provider: string; amount_cents: number; status: string;
    processed_at: string | null; note: string | null; invoice_number: string | null;
  }[];
  communications: { at: string; channel: string; direction: string; subject: string | null; status: string | null }[];
  totals: { invoiced_cents: number; paid_cents: number; outstanding_cents: number; jobs_count: number };
};

export const reportClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ client_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ClientAccount> => {
    const { data: row, error } = await (context.supabase as any).rpc("report_client_account", {
      _client_id: data.client_id,
    });
    if (error) throw new Error(error.message);
    return row as ClientAccount;
  });

export type PayrollRow = {
  employee_id: string;
  full_name: string;
  hours: number;
  hourly_rate_cents: number | null;
  gross_cents: number;
  tips_cents: number;
};

/** Owner/manager-only pay-period summary: hours × rate plus tips per person. */
export const reportPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<PayrollRow[]> => {
    const sb = context.supabase as any;
    const [{ data: isOwner }, { data: isMgr }] = await Promise.all([
      sb.rpc("has_role", { _user_id: context.userId, _role: "owner" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "manager" }),
    ]);
    if (!isOwner && !isMgr) throw new Error("Only owners and managers can view payroll.");

    const { data: rows, error } = await sb.rpc("report_timesheets", { _from: data.from, _to: data.to });
    if (error) throw new Error(error.message);
    const hours = new Map<string, number>();
    for (const r of rows ?? []) {
      if (!r.user_id) continue;
      hours.set(r.user_id, (hours.get(r.user_id) ?? 0) + Number(r.hours || 0));
    }

    const toEnd = new Date(new Date(data.to + "T00:00:00Z").getTime() + 86400000).toISOString();
    const { data: tips } = await sb
      .from("tips")
      .select("employee_id, amount_cents")
      .gte("created_at", data.from + "T00:00:00Z")
      .lt("created_at", toEnd);
    const tipMap = new Map<string, number>();
    for (const t of tips ?? []) {
      if (!t.employee_id) continue;
      tipMap.set(t.employee_id, (tipMap.get(t.employee_id) ?? 0) + (t.amount_cents ?? 0));
    }

    const ids = [...new Set([...hours.keys(), ...tipMap.keys()])];
    if (!ids.length) return [];
    const { data: profs } = await sb.from("profiles").select("id, full_name, hourly_rate_cents").in("id", ids);
    const pm = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));
    return ids
      .map((id) => {
        const p = pm.get(id);
        const h = Math.round((hours.get(id) ?? 0) * 100) / 100;
        const rate = p?.hourly_rate_cents ?? null;
        return {
          employee_id: id,
          full_name: p?.full_name ?? "Unknown",
          hours: h,
          hourly_rate_cents: rate,
          gross_cents: rate ? Math.round(h * rate) : 0,
          tips_cents: tipMap.get(id) ?? 0,
        };
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  });
