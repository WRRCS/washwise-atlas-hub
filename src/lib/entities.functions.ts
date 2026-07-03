import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============= Clients =============

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, email, phone, service_address, billing_address, is_active")
      .order("first_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const clientSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional().default(""),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
  billing_address: z.string().trim().max(300).optional(),
  service_address: z.string().trim().max(300).optional(),
  is_active: z.boolean().optional(),
  // property_specs (optional, filled on creation)
  square_footage: z.coerce.number().int().nonnegative().optional().nullable(),
  bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
  bathrooms: z.coerce.number().nonnegative().optional().nullable(),
  key_location: z.string().trim().max(200).optional(),
  access_notes: z.string().trim().max(500).optional(),
  pets: z.string().trim().max(200).optional(),
  parking_notes: z.string().trim().max(200).optional(),
  special_instructions: z.string().trim().max(1000).optional(),
});

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => clientSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");

    const { data: row, error } = await context.supabase
      .from("clients")
      .insert({
        tenant_id: prof.tenant_id,
        first_name: data.first_name,
        last_name: data.last_name || null,
        email: data.email || null,
        phone: data.phone || null,
        billing_address: data.billing_address || null,
        service_address: data.service_address || null,
        is_active: data.is_active ?? true,
      })
      .select("id").single();
    if (error) throw new Error(error.message);

    const hasSpec =
      data.square_footage != null ||
      data.bedrooms != null ||
      data.bathrooms != null ||
      data.key_location || data.access_notes || data.pets || data.parking_notes || data.special_instructions;
    if (hasSpec) {
      const { error: se } = await context.supabase
        .from("property_specs")
        .insert({
          tenant_id: prof.tenant_id,
          client_id: row.id,
          square_footage: data.square_footage ?? null,
          bedrooms: data.bedrooms ?? null,
          bathrooms: data.bathrooms ?? null,
          key_location: data.key_location || null,
          access_notes: data.access_notes || null,
          pets: data.pets || null,
          parking_notes: data.parking_notes || null,
          special_instructions: data.special_instructions || null,
        });
      if (se) throw new Error(se.message);
    }
    return row;
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      first_name: z.string().trim().min(1).max(80),
      last_name: z.string().trim().max(80).optional().default(""),
      email: z.union([z.string().trim().email(), z.literal("")]).optional(),
      phone: z.string().trim().max(40).optional(),
      billing_address: z.string().trim().max(300).optional(),
      service_address: z.string().trim().max(300).optional(),
      is_active: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update({
        first_name: data.first_name,
        last_name: data.last_name || null,
        email: data.email || null,
        phone: data.phone || null,
        billing_address: data.billing_address || null,
        service_address: data.service_address || null,
        is_active: data.is_active ?? true,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("clients").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: client, error } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, email, phone, service_address, billing_address, is_active, created_at")
      .eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return null;
    const [{ data: spec }, { data: notes }, { data: photos }] = await Promise.all([
      context.supabase.from("property_specs").select("*").eq("client_id", data.id).maybeSingle(),
      context.supabase.from("client_notes").select("id, note, created_at, created_by").eq("client_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("client_photos").select("id, storage_path, caption, uploaded_at").eq("client_id", data.id).order("uploaded_at", { ascending: false }),
    ]);
    const authorIds = Array.from(new Set((notes ?? []).map((n) => n.created_by).filter((v): v is string => !!v)));
    const authorsMap = new Map<string, string | null>();
    if (authorIds.length) {
      const { data: profs } = await context.supabase.from("profiles").select("id, full_name").in("id", authorIds);
      (profs ?? []).forEach((p) => authorsMap.set(p.id, p.full_name));
    }
    // Sign photo URLs
    const signed = await Promise.all(
      (photos ?? []).map(async (p) => {
        const { data: s } = await context.supabase.storage.from("client-photos").createSignedUrl(p.storage_path, 3600);
        return { ...p, url: s?.signedUrl ?? null };
      }),
    );
    return {
      ...client,
      spec: spec ?? null,
      notes: (notes ?? []).map((n) => ({ ...n, author: authorsMap.get(n.created_by ?? "") ?? null })),
      photos: signed,
    };
  });

// ============= Property specs =============

export const upsertPropertySpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      square_footage: z.coerce.number().int().nonnegative().optional().nullable(),
      bedrooms: z.coerce.number().int().nonnegative().optional().nullable(),
      bathrooms: z.coerce.number().nonnegative().optional().nullable(),
      key_location: z.string().trim().max(200).optional(),
      access_notes: z.string().trim().max(500).optional(),
      pets: z.string().trim().max(200).optional(),
      parking_notes: z.string().trim().max(200).optional(),
      special_instructions: z.string().trim().max(1000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { error } = await context.supabase
      .from("property_specs")
      .upsert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        square_footage: data.square_footage ?? null,
        bedrooms: data.bedrooms ?? null,
        bathrooms: data.bathrooms ?? null,
        key_location: data.key_location || null,
        access_notes: data.access_notes || null,
        pets: data.pets || null,
        parking_notes: data.parking_notes || null,
        special_instructions: data.special_instructions || null,
      }, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Notes =============

export const addClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid(), note: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("client_notes")
      .insert({ tenant_id: prof.tenant_id, client_id: data.client_id, note: data.note, created_by: context.userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("client_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Photos =============

export const createPhotoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      file_name: z.string().trim().min(1).max(200),
      content_type: z.string().trim().max(100).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const safe = data.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${prof.tenant_id}/${data.client_id}/${Date.now()}-${safe}`;
    const { data: signed, error } = await context.supabase.storage
      .from("client-photos")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const registerClientPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      storage_path: z.string().min(1),
      caption: z.string().trim().max(300).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("client_photos")
      .insert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        storage_path: data.storage_path,
        caption: data.caption || null,
        uploaded_by: context.userId,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteClientPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: photo } = await context.supabase.from("client_photos").select("storage_path").eq("id", data.id).maybeSingle();
    if (photo?.storage_path) {
      await context.supabase.storage.from("client-photos").remove([photo.storage_path]);
    }
    const { error } = await context.supabase.from("client_photos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Other =============

export const listServiceTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("service_types")
      .select("id, kind, name, default_duration_minutes, default_price_cents, description, color, active")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const serviceTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  default_duration_minutes: z.coerce.number().int().positive().max(24 * 60),
  default_price_cents: z.coerce.number().int().nonnegative(),
  description: z.string().trim().max(500).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
});

export const createServiceType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => serviceTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("service_types")
      .insert({
        tenant_id: prof.tenant_id,
        kind: data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) as never,
        name: data.name,
        default_duration_minutes: data.default_duration_minutes,
        default_price_cents: data.default_price_cents,
        description: data.description || null,
        color: data.color,
        active: true,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateServiceType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => serviceTypeSchema.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("service_types")
      .update({
        name: data.name,
        default_duration_minutes: data.default_duration_minutes,
        default_price_cents: data.default_price_cents,
        description: data.description || null,
        color: data.color,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteServiceType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("service_types").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .select("id, number, status, amount_cents, currency, sent_at, paid_at, due_at, pay_link, client:clients(id, first_name, last_name), job:jobs(id)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
