import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("id, name, email, phone, notes, properties(count)")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().min(1), email: z.string().email().optional().or(z.literal("")), phone: z.string().optional(), notes: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("clients")
      .insert({ tenant_id: prof.tenant_id, name: data.name, email: data.email || null, phone: data.phone || null, notes: data.notes || null })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, nickname, address_line1, address_line2, city, state, postal_code, access_notes, bedrooms, bathrooms, square_feet, client:clients(id,name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      nickname: z.string().optional(),
      address_line1: z.string().min(1),
      address_line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
      access_notes: z.string().optional(),
      bedrooms: z.coerce.number().int().optional(),
      bathrooms: z.coerce.number().optional(),
      square_feet: z.coerce.number().int().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("properties")
      .insert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        nickname: data.nickname || null,
        address_line1: data.address_line1,
        address_line2: data.address_line2 || null,
        city: data.city || null,
        state: data.state || null,
        postal_code: data.postal_code || null,
        access_notes: data.access_notes || null,
        bedrooms: data.bedrooms ?? null,
        bathrooms: data.bathrooms ?? null,
        square_feet: data.square_feet ?? null,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listServiceTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("service_types")
      .select("id, kind, name, default_duration_minutes, default_price_cents")
      .eq("active", true)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: profs }, { data: roles }] = await Promise.all([
      context.supabase.from("profiles").select("id, full_name, email, phone").order("full_name"),
      context.supabase.from("user_roles").select("user_id, role"),
    ]);
    const rolesMap = new Map<string, string>();
    (roles ?? []).forEach((r) => rolesMap.set(r.user_id, r.role));
    return (profs ?? []).map((p) => ({ ...p, role: rolesMap.get(p.id) ?? "employee" }));
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(["owner", "employee"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("is_owner");
    if (!isOwner) throw new Error("Forbidden");
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    // remove other role variants first
    await context.supabase.from("user_roles").delete().eq("user_id", data.user_id).eq("tenant_id", prof.tenant_id);
    const { error } = await context.supabase.from("user_roles").insert({
      user_id: data.user_id, tenant_id: prof.tenant_id, role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("invoices")
      .select("id, number, status, amount_cents, currency, sent_at, paid_at, due_at, pay_link, client:clients(id,name), job:jobs(id)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
