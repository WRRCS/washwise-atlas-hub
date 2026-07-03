import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InventoryStatus = "OK" | "LOW" | "OUT";

export type InventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity_on_hand: number;
  reorder_threshold: number;
  cost_per_unit_cents: number;
  vendor_name: string | null;
  vendor_sku: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
  status: InventoryStatus;
};

export type InventoryTransaction = {
  id: string;
  item_id: string;
  change_amount: number;
  reason: "restock" | "job_usage" | "manual_adjustment" | "waste";
  job_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  actor_name: string | null;
};

function computeStatus(qty: number, threshold: number): InventoryStatus {
  if (qty <= 0) return "OUT";
  if (qty <= threshold) return "LOW";
  return "OK";
}

async function tenantId(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof) throw new Error("No profile");
  return prof.tenant_id as string;
}

// -------- List --------

export const listInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InventoryItem[]> => {
    const { data, error } = await context.supabase
      .from("inventory_items")
      .select("id,name,sku,unit,quantity_on_hand,reorder_threshold,cost_per_unit_cents,vendor_name,vendor_sku,notes,is_active,updated_at")
      .eq("is_active", true)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      quantity_on_hand: Number(r.quantity_on_hand),
      reorder_threshold: Number(r.reorder_threshold),
      status: computeStatus(Number(r.quantity_on_hand), Number(r.reorder_threshold)),
    }));
  });

// Only items with status OUT or LOW (for dashboard)
export const listLowInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InventoryItem[]> => {
    const { data, error } = await context.supabase
      .from("inventory_items")
      .select("id,name,sku,unit,quantity_on_hand,reorder_threshold,cost_per_unit_cents,vendor_name,vendor_sku,notes,is_active,updated_at")
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      quantity_on_hand: Number(r.quantity_on_hand),
      reorder_threshold: Number(r.reorder_threshold),
      status: computeStatus(Number(r.quantity_on_hand), Number(r.reorder_threshold)),
    }));
    return rows
      .filter((r) => r.status !== "OK")
      .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand);
  });

// -------- Item CRUD --------

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional().nullable(),
  unit: z.string().trim().min(1).max(40),
  quantity_on_hand: z.coerce.number().min(0).optional(),
  reorder_threshold: z.coerce.number().min(0).default(0),
  cost_per_unit_cents: z.coerce.number().int().min(0).default(0),
  vendor_name: z.string().trim().max(200).optional().nullable(),
  vendor_sku: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const createInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => itemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { data: row, error } = await context.supabase
      .from("inventory_items")
      .insert({
        tenant_id: tid,
        name: data.name,
        sku: data.sku || null,
        unit: data.unit,
        quantity_on_hand: data.quantity_on_hand ?? 0,
        reorder_threshold: data.reorder_threshold ?? 0,
        cost_per_unit_cents: data.cost_per_unit_cents ?? 0,
        vendor_name: data.vendor_name || null,
        vendor_sku: data.vendor_sku || null,
        notes: data.notes || null,
        is_active: data.is_active ?? true,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: (row as any).id as string };
  });

const updateSchema = itemSchema.partial().extend({ id: z.string().uuid() });

export const updateInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    const { error } = await (context.supabase.from("inventory_items") as any).update(clean).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Soft delete via is_active
    const { error } = await context.supabase
      .from("inventory_items").update({ is_active: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Transactions --------

const txSchema = z.object({
  item_id: z.string().uuid(),
  change_amount: z.coerce.number().refine((n) => n !== 0, "Change must be non-zero"),
  reason: z.enum(["restock", "job_usage", "manual_adjustment", "waste"]),
  job_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const logInventoryTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => txSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { error } = await context.supabase.from("inventory_transactions").insert({
      tenant_id: tid,
      item_id: data.item_id,
      change_amount: data.change_amount,
      reason: data.reason,
      job_id: data.job_id ?? null,
      notes: data.notes ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listItemTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InventoryTransaction[]> => {
    const { data: rows, error } = await context.supabase
      .from("inventory_transactions")
      .select("id,item_id,change_amount,reason,job_id,notes,created_by,created_at")
      .eq("item_id", data.item_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.created_by).filter(Boolean)));
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id,full_name").in("id", ids);
      for (const p of profs ?? []) nameMap.set((p as any).id, (p as any).full_name);
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      change_amount: Number(r.change_amount),
      actor_name: r.created_by ? nameMap.get(r.created_by) ?? null : null,
    }));
  });
