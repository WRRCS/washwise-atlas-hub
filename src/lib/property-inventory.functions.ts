import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INVENTORY_LEVELS, validateInventoryEntry, type InventoryKind, type InventoryLevel } from "@/lib/inventory";

export type JobInventoryRow = {
  id: string;
  name: string;
  name_uk: string | null;
  kind: InventoryKind;
  unit: string | null;
  unit_uk: string | null;
  level: InventoryLevel | null;
  quantity: number | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

/** Inventory list for the appointment's property, with what was recorded on this visit. */
export const getJobInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<JobInventoryRow[]> => {
    const sb = context.supabase;
    const { data: job, error } = await sb.from("jobs").select("id, property_id").eq("id", data.job_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job?.property_id) return [];
    const { data: items, error: itemsError } = await sb
      .from("property_inventory_items")
      .select("id, name, name_uk, kind, unit, unit_uk, position")
      .eq("property_id", job.property_id)
      .eq("is_active", true)
      .order("position");
    if (itemsError) throw new Error(itemsError.message);
    if (!items?.length) return [];
    const { data: checks, error: checksError } = await sb
      .from("job_inventory_checks")
      .select("item_id, level, quantity, updated_by, updated_at")
      .eq("job_id", data.job_id);
    if (checksError) throw new Error(checksError.message);
    const ids = Array.from(new Set((checks ?? []).map((c) => c.updated_by).filter((v): v is string => !!v)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: dir } = await sb.rpc("staff_directory" as never);
      for (const p of ((dir ?? []) as { id: string; full_name: string | null }[])) if (ids.includes(p.id)) names.set(p.id, p.full_name ?? "");
    }
    const byItem = new Map((checks ?? []).map((c) => [c.item_id, c]));
    return items.map((i) => {
      const c = byItem.get(i.id);
      return {
        id: i.id,
        name: i.name,
        name_uk: i.name_uk,
        kind: i.kind as InventoryKind,
        unit: i.unit,
        unit_uk: i.unit_uk,
        level: (c?.level ?? null) as InventoryLevel | null,
        quantity: c?.quantity ?? null,
        updated_by_name: c?.updated_by ? names.get(c.updated_by) || null : null,
        updated_at: c?.updated_at ?? null,
      };
    });
  });

/** Assigned cleaners and owners/managers save one item; the database re-checks assignment and item type. */
export const saveJobInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      item_id: z.string().uuid(),
      kind: z.enum(["level", "count"]),
      level: z.enum(INVENTORY_LEVELS).nullable(),
      quantity: z.number().int().min(0).max(9999).nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!validateInventoryEntry(data.kind, { level: data.level, quantity: data.quantity })) throw new Error("That value doesn't fit this item");
    const { error } = await context.supabase.rpc("save_job_inventory" as never, {
      _job: data.job_id, _item: data.item_id, _level: data.level, _quantity: data.quantity,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
