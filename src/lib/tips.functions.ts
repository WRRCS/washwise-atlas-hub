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
  client_id: string | null;
  client_name: string | null;
  clean_date: string | null;
  received_date: string | null;
  paid: boolean;
  paid_out_date: string | null;
};

/** Owners/managers get every tip; employees only their own (enforced by RLS). */
export const listTips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }): Promise<TipRow[]> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("tips")
      .select("id, amount_cents, created_at, source, note, employee_id, job_id, employee:profiles!tips_employee_id_fkey(full_name), invoice:invoices(number), job:jobs(scheduled_start, client:clients(first_name, last_name)), client_id, clean_date, received_date, paid, paid_out_date, client:clients(first_name, last_name)")
      .gte("received_date", data.from.slice(0, 10))
      .lt("received_date", data.to.slice(0, 10))
      .order("received_date", { ascending: false })
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
      client_id: r.client_id ?? null,
      client_name: (() => { const c = r.client ?? r.job?.client; return c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : null; })(),
      clean_date: r.clean_date ?? null,
      received_date: r.received_date ?? null,
      paid: !!r.paid,
      paid_out_date: r.paid_out_date ?? null,
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
      client_id: z.string().uuid().optional(),
      clean_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
      client_id: data.client_id ?? null,
      clean_date: data.clean_date ?? null,
      ...(data.received_date ? { received_date: data.received_date } : {}),
    }));
    const { error } = await (context.supabase as any).from("tips").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Owner/manager: edit a tip's amount, cleaner, client, clean date and note. */
export const updateTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      amount_cents: z.number().int().positive(),
      employee_id: z.string().uuid().nullable(),
      client_id: z.string().uuid().nullable(),
      clean_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      note: z.string().max(300).nullable(),
      paid: z.boolean().optional(),
      paid_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("is_owner_or_manager" as any);
    if (!ok) throw new Error("Only owners and managers can edit tips");
    const { id, ...patch } = data;
    const { data: rows, error } = await (context.supabase as any).from("tips").update(patch).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Tip not found or not allowed");
    return { ok: true };
  });

export const canManageTips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_owner_or_manager" as any);
    return { isManager: !!data };
  });

/** Owner/manager: mark a tip paid out (or not) with the payout date. */
export const setTipPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), paid: z.boolean(), paid_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("is_owner_or_manager" as any);
    if (!ok) throw new Error("Only owners and managers can mark tips paid");
    const { id, ...patch } = data;
    const { data: rows, error } = await (context.supabase as any).from("tips").update(patch).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Tip not found or not allowed");
    return { ok: true };
  });
