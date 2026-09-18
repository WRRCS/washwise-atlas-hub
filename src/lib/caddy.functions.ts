import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CaddyTemplateItem = {
  id: string;
  name: string;
  unit: string;
  default_qty: number;
  sort_order: number;
};

export type CaddyItem = {
  id: string;
  employee_id: string;
  template_item_id: string | null;
  name: string;
  unit: string;
  qty: number;
  sort_order: number;
  notes: string | null;
};

export type CaddyEmployee = {
  id: string;
  full_name: string;
  items: CaddyItem[];
};

export type CaddyOverview = {
  isManager: boolean;
  myId: string;
  template: CaddyTemplateItem[];
  employees: CaddyEmployee[];
};

async function tenantId(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof) throw new Error("No profile");
  return (prof as any).tenant_id as string;
}

async function isManager(context: any): Promise<boolean> {
  const { data } = await context.supabase.rpc("is_owner_or_manager");
  return Boolean(data);
}

async function assertCanEdit(context: any, employeeId: string) {
  if (employeeId === context.userId) return;
  if (await isManager(context)) return;
  throw new Error("Not allowed");
}

export const getCaddyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaddyOverview> => {
    const manager = await isManager(context);

    const [{ data: tmpl }, { data: items }, { data: staff }] = await Promise.all([
      context.supabase
        .from("caddy_template_items")
        .select("id,name,unit,default_qty,sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      context.supabase
        .from("employee_caddy_items")
        .select("id,employee_id,template_item_id,name,unit,qty,sort_order,notes")
        .order("sort_order")
        .order("name"),
      context.supabase.rpc("staff_directory"),
    ]);

    const template: CaddyTemplateItem[] = (tmpl ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      default_qty: Number(r.default_qty),
      sort_order: r.sort_order,
    }));

    const byEmployee = new Map<string, CaddyItem[]>();
    for (const r of (items ?? []) as any[]) {
      const row: CaddyItem = {
        id: r.id,
        employee_id: r.employee_id,
        template_item_id: r.template_item_id,
        name: r.name,
        unit: r.unit,
        qty: Number(r.qty),
        sort_order: r.sort_order,
        notes: r.notes,
      };
      const list = byEmployee.get(row.employee_id) ?? [];
      list.push(row);
      byEmployee.set(row.employee_id, list);
    }

    const allStaff = ((staff ?? []) as any[])
      .filter((p) => p.is_active !== false)
      .map((p) => ({ id: p.id as string, full_name: (p.full_name as string) || "Team member" }));

    const visible = manager ? allStaff : allStaff.filter((p) => p.id === context.userId);
    const employees: CaddyEmployee[] = visible.map((p) => ({
      ...p,
      items: byEmployee.get(p.id) ?? [],
    }));

    return { isManager: manager, myId: context.userId, template, employees };
  });

// -------- Employee caddy items --------

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  employee_id: z.string().uuid(),
  template_item_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40).default("each"),
  qty: z.coerce.number().min(0).max(100000),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const saveCaddyItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanEdit(context, data.employee_id);
    if (data.id) {
      const { error } = await (context.supabase.from("employee_caddy_items") as any)
        .update({
          name: data.name,
          unit: data.unit,
          qty: data.qty,
          notes: data.notes ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const tid = await tenantId(context);
    const { data: row, error } = await (context.supabase.from("employee_caddy_items") as any)
      .insert({
        tenant_id: tid,
        employee_id: data.employee_id,
        template_item_id: data.template_item_id ?? null,
        name: data.name,
        unit: data.unit,
        qty: data.qty,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as any).id as string };
  });

export const setCaddyQty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), qty: z.coerce.number().min(0).max(100000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("employee_caddy_items") as any)
      .update({ qty: data.qty })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCaddyItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("employee_caddy_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Fill an employee's caddy with any standard items they are missing.
export const stockCaddyFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ employee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCanEdit(context, data.employee_id);
    const tid = await tenantId(context);
    const [{ data: tmpl }, { data: existing }] = await Promise.all([
      context.supabase
        .from("caddy_template_items")
        .select("id,name,unit,default_qty,sort_order")
        .eq("is_active", true),
      context.supabase
        .from("employee_caddy_items")
        .select("template_item_id,name")
        .eq("employee_id", data.employee_id),
    ]);
    const haveIds = new Set(((existing ?? []) as any[]).map((r) => r.template_item_id).filter(Boolean));
    const haveNames = new Set(((existing ?? []) as any[]).map((r) => String(r.name).toLowerCase()));
    const rows = ((tmpl ?? []) as any[])
      .filter((t) => !haveIds.has(t.id) && !haveNames.has(String(t.name).toLowerCase()))
      .map((t) => ({
        tenant_id: tid,
        employee_id: data.employee_id,
        template_item_id: t.id,
        name: t.name,
        unit: t.unit,
        qty: Number(t.default_qty),
        sort_order: t.sort_order,
      }));
    if (rows.length === 0) return { added: 0 };
    const { error } = await (context.supabase.from("employee_caddy_items") as any).insert(rows);
    if (error) throw new Error(error.message);
    return { added: rows.length };
  });

// -------- Standard caddy list (owners/managers) --------

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40).default("each"),
  default_qty: z.coerce.number().min(0).max(100000),
  sort_order: z.coerce.number().int().min(0).max(100000).optional(),
});

export const saveCaddyTemplateItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => templateSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isManager(context))) throw new Error("Not allowed");
    if (data.id) {
      const { error } = await (context.supabase.from("caddy_template_items") as any)
        .update({
          name: data.name,
          unit: data.unit,
          default_qty: data.default_qty,
          ...(data.sort_order === undefined ? {} : { sort_order: data.sort_order }),
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const tid = await tenantId(context);
    const { data: row, error } = await (context.supabase.from("caddy_template_items") as any)
      .insert({
        tenant_id: tid,
        name: data.name,
        unit: data.unit,
        default_qty: data.default_qty,
        sort_order: data.sort_order ?? 999,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as any).id as string };
  });

export const deleteCaddyTemplateItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!(await isManager(context))) throw new Error("Not allowed");
    const { error } = await (context.supabase.from("caddy_template_items") as any)
      .update({ is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
