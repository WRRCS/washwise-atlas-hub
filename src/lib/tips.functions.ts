import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TipRow = {
  id: string;
  amount_cents: number;
  created_at: string;
  source: string;
  note: string | null;
  employee_id: string | null;
  employee_name: string | null;
  invoice_number: string | null;
  job_id: string | null;
  job_start: string | null;
};

/** Owners/managers get every tip; employees only their own (enforced by RLS). */
export const listTips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }): Promise<TipRow[]> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("tips")
      .select("id, amount_cents, created_at, source, note, employee_id, job_id, employee:profiles!tips_employee_id_fkey(full_name), invoice:invoices(number), job:jobs(scheduled_start)")
      .gte("created_at", data.from)
      .lt("created_at", data.to)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      amount_cents: r.amount_cents,
      created_at: r.created_at,
      source: r.source,
      note: r.note,
      employee_id: r.employee_id,
      employee_name: r.employee?.full_name ?? null,
      invoice_number: r.invoice?.number ?? null,
      job_id: r.job_id,
      job_start: r.job?.scheduled_start ?? null,
    }));
  });

/** Owner/manager: give an unassigned tip to a cleaner. */
export const assignTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), employee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("tips")
      .update({ employee_id: data.employee_id, note: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Owner/manager: record a cash tip by hand, split evenly across the chosen cleaners. */
export const addManualTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      amount_cents: z.number().int().positive(),
      employee_ids: z.array(z.string().uuid()).min(1),
      note: z.string().max(300).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof?.tenant_id) throw new Error("No workspace");
    const n = data.employee_ids.length;
    const share = Math.floor(data.amount_cents / n);
    const rem = data.amount_cents - share * n;
    const rows = data.employee_ids.map((eid, i) => ({
      tenant_id: prof.tenant_id,
      employee_id: eid,
      amount_cents: share + (i < rem ? 1 : 0),
      source: "manual",
      note: data.note ?? null,
    }));
    const { error } = await (context.supabase as any).from("tips").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const canManageTips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_owner_or_manager" as any);
    return { isManager: !!data };
  });
