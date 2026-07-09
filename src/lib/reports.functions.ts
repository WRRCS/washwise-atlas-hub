import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RevenueMonthRow = {
  month: string;
  total_revenue_cents: number;
  invoice_count: number;
  avg_invoice_cents: number;
  by_service_type: Record<string, number>;
};

export const revenueByMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<RevenueMonthRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_revenue_by_month", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      month: r.month,
      total_revenue_cents: Number(r.total_revenue_cents),
      invoice_count: Number(r.invoice_count),
      avg_invoice_cents: Number(r.avg_invoice_cents),
      by_service_type: r.by_service_type ?? {},
    }));
  });

export type EmployeeProductivityRow = {
  employee_id: string;
  full_name: string | null;
  jobs_completed_count: number;
  total_hours_worked: number;
  avg_job_duration_minutes: number;
  revenue_attributed_cents: number;
};

export const employeeProductivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<EmployeeProductivityRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_employee_productivity", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      employee_id: r.employee_id,
      full_name: r.full_name,
      jobs_completed_count: Number(r.jobs_completed_count),
      total_hours_worked: Number(r.total_hours_worked),
      avg_job_duration_minutes: Number(r.avg_job_duration_minutes),
      revenue_attributed_cents: Number(r.revenue_attributed_cents),
    }));
  });

export type ClientRetentionRow = {
  client_id: string;
  full_name: string | null;
  first_service_date: string | null;
  last_service_date: string | null;
  total_jobs_count: number;
  lifetime_revenue_cents: number;
  is_recurring: boolean;
  months_active_count: number;
};

export const clientRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientRetentionRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_client_retention");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      total_jobs_count: Number(r.total_jobs_count),
      lifetime_revenue_cents: Number(r.lifetime_revenue_cents),
      months_active_count: Number(r.months_active_count),
    }));
  });

export type InventoryUsageDetailRow = {
  month: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  units_used: number;
  total_cost_cents: number;
};

export const inventoryUsageDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<InventoryUsageDetailRow[]> => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_inventory_usage_detail", {
      _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      month: r.month,
      item_id: r.item_id,
      item_name: r.item_name,
      item_unit: r.item_unit,
      units_used: Number(r.units_used),
      total_cost_cents: Number(r.total_cost_cents),
    }));
  });
