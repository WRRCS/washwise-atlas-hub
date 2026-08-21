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
      client_sop: z.string().trim().max(4000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      first_name: data.first_name,
      last_name: data.last_name || null,
      email: data.email || null,
      phone: data.phone || null,
      billing_address: data.billing_address || null,
      service_address: data.service_address || null,
      is_active: data.is_active ?? true,
      ...(data.client_sop !== undefined ? { client_sop: data.client_sop || null } : {}),
    };
    const { error } = await context.supabase.from("clients").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setClientColor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      color: z.union([z.string().trim().regex(/^#[0-9a-fA-F]{6}$/), z.null()]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update({ color: data.color })
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
      .select("id, first_name, last_name, email, phone, service_address, billing_address, is_active, created_at, client_sop")
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
    const [{ data: profs }, { data: roles }, { data: isOwner }, { data: canViewWages }] = await Promise.all([
      context.supabase.from("profiles").select("id, full_name, email, phone, is_active, hourly_rate_cents").order("full_name"),
      context.supabase.from("user_roles").select("user_id, role"),
      context.supabase.rpc("is_owner"),
      context.supabase.rpc("has_employee_permission", { _flag: "can_view_wages" }),
    ]);
    const rolesMap = new Map<string, string>();
    (roles ?? []).forEach((r) => rolesMap.set(r.user_id, r.role));
    const showWages = !!isOwner || !!canViewWages;
    const list = (profs ?? []).map((p) => ({
      ...p,
      hourly_rate_cents: showWages ? p.hourly_rate_cents : 0,
      role: rolesMap.get(p.id) ?? "employee",
    }));

    const { data: isStaff } = await context.supabase.rpc("is_owner_or_manager");
    if (!isStaff) return list.map((p) => ({ ...p, last_sign_in_at: null as string | null }));
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const signMap = new Map<string, string | null>();
      (users?.users ?? []).forEach((u) => signMap.set(u.id, u.last_sign_in_at ?? null));
      return list.map((p) => ({ ...p, last_sign_in_at: signMap.get(p.id) ?? null }));
    } catch {
      return list.map((p) => ({ ...p, last_sign_in_at: null as string | null }));
    }
  });

export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      email: z.string().trim().email(),
      full_name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional(),
      redirect_to: z.string().url().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_employee_permission", { _flag: "can_manage_clients_employees" });
    if (!allowed) throw new Error("You don't have permission to invite employees");

    // Resolve the inviter's tenant so we can attach the new user to it
    // (the auth trigger only knows about the default tenant).
    const { data: inviterProfile, error: profErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profErr || !inviterProfile?.tenant_id) throw new Error("Could not resolve your tenant");
    const tenantId = inviterProfile.tenant_id as string;

    // Pre-check employee cap for a friendlier error than a raw trigger throw.
    const [{ data: tenantRow }, { count: currentEmployees }] = await Promise.all([
      context.supabase.from("tenants").select("plan_tier").eq("id", tenantId).maybeSingle(),
      context.supabase
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("role", "employee"),
    ]);
    if (tenantRow?.plan_tier) {
      const { data: planRow } = await context.supabase
        .from("plan_limits")
        .select("max_employees,display_name")
        .eq("plan_tier", tenantRow.plan_tier)
        .maybeSingle();
      const cap = planRow?.max_employees ?? null;
      if (cap != null && (currentEmployees ?? 0) >= cap) {
        throw new Error(
          `Employee limit reached (${currentEmployees}/${cap} on the ${planRow?.display_name ?? tenantRow.plan_tier} plan). Upgrade to invite more employees.`,
        );
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let userId: string | undefined;
    const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name },
      redirectTo: data.redirect_to,
    });
    if (error) {
      const alreadyExists = /already been registered|already registered|email_exists/i.test(error.message);
      if (!alreadyExists) throw new Error(error.message);
      // Find the existing auth user and (re)attach them to this tenant, then
      // send a sign-in link instead of a fresh invite.
      const target = data.email.toLowerCase();
      let page = 1;
      while (!userId && page <= 20) {
        const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) throw new Error(listErr.message);
        const match = (list?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === target);
        if (match) userId = match.id;
        if (!list || (list.users?.length ?? 0) < 200) break;
        page += 1;
      }
      if (!userId) throw new Error("That email is already registered, but the account could not be found.");

      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("tenant_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (existingRole?.tenant_id && existingRole.tenant_id !== tenantId) {
        throw new Error("That email already belongs to another workspace.");
      }

      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: data.email,
        options: { redirectTo: data.redirect_to },
      });
    } else {
      userId = created.user?.id;
    }
    if (!userId) return { ok: true };


    // The auth trigger placed the new user in the default tenant via the
    // legacy path. Re-parent the profile to the inviter's tenant and move
    // the user_roles row to the correct tenant with the employee role.
    await supabaseAdmin.from("profiles").update({
      tenant_id: tenantId,
      full_name: data.full_name,
      phone: data.phone || null,
    }).eq("id", userId);

    // Delete any auto-created role row(s) and insert a clean employee row
    // on the correct tenant. The employee-limit trigger runs on this INSERT.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, tenant_id: tenantId, role: "employee" });
    if (roleErr) {
      // Roll back the invite if the limit trigger (or anything else) rejects.
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleErr.message);
    }

    return { ok: true };
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      phone: z.string().trim().max(40).optional(),
      is_active: z.boolean().optional(),
      full_name: z.string().trim().max(120).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_employee_permission", { _flag: "can_manage_clients_employees" });
    if (!allowed) throw new Error("You don't have permission to edit employees");
    const patch: { phone?: string | null; is_active?: boolean; full_name?: string | null } = {};
    if (data.phone !== undefined) patch.phone = data.phone || null;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    const { error } = await context.supabase.from("profiles").update(patch).eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const impersonateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), redirect_to: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("is_owner");
    if (!isOwner) throw new Error("Only owners can impersonate");

    // Caller's own tenant — the impersonation target must belong to it.
    const { data: me } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.tenant_id) throw new Error("No profile");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("email, tenant_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!prof || prof.tenant_id !== me.tenant_id) throw new Error("User not found in your business");
    if (!prof.email) throw new Error("Employee has no email");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: prof.email,
      options: { redirectTo: data.redirect_to },
    });
    if (error) throw new Error(error.message);
    return { url: link.properties?.action_link ?? null };
  });


export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(["owner", "manager", "employee"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Only owners can promote to owner. Managers with can_manage_clients_employees
    // can toggle between employee and manager.
    const { data: isOwner } = await context.supabase.rpc("is_owner");
    if (data.role === "owner" && !isOwner) throw new Error("Only owners can grant the owner role");
    if (!isOwner) {
      const { data: allowed } = await context.supabase.rpc("has_employee_permission", { _flag: "can_manage_clients_employees" });
      if (!allowed) throw new Error("You don't have permission to change roles");
    }
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    await context.supabase.from("user_roles").delete().eq("user_id", data.user_id).eq("tenant_id", prof.tenant_id);
    const { error } = await context.supabase.from("user_roles").insert({
      user_id: data.user_id, tenant_id: prof.tenant_id, role: data.role,
    });
    if (error) throw new Error(error.message);
    if (data.role === "manager") {
      await context.supabase.from("employee_permissions").upsert(
        {
          tenant_id: prof.tenant_id,
          employee_id: data.user_id,
          can_view_employee_contacts: true,
          can_view_pricing: false,
          can_view_client_cpni: false,
          can_schedule: true,
          can_manage_clients_employees: true,
        } as any,
        { onConflict: "tenant_id,employee_id" },
      );
    }
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

// ============= Employee permissions =============

export const amIOwner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_owner");
    return { isOwner: !!data };
  });

export const myCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [
      { data: isOwner },
      { data: isStaff },
      { data: canManage },
      { data: canSchedule },
      { data: canViewCpni },
      { data: canViewPricing },
      { data: canViewWages },
      { data: canViewContacts },
    ] = await Promise.all([
      context.supabase.rpc("is_owner"),
      context.supabase.rpc("is_owner_or_manager"),
      context.supabase.rpc("has_employee_permission", { _flag: "can_manage_clients_employees" }),
      context.supabase.rpc("has_employee_permission", { _flag: "can_schedule" }),
      context.supabase.rpc("has_employee_permission", { _flag: "can_view_client_cpni" }),
      context.supabase.rpc("has_employee_permission", { _flag: "can_view_pricing" }),
      context.supabase.rpc("has_employee_permission", { _flag: "can_view_wages" }),
      context.supabase.rpc("has_employee_permission", { _flag: "can_view_employee_contacts" }),
    ]);
    return {
      isOwner: !!isOwner,
      isStaff: !!isStaff,
      canManage: !!canManage,
      canSchedule: !!canSchedule,
      canViewCpni: !!canViewCpni,
      canViewPricing: !!canViewPricing,
      canViewWages: !!canViewWages,
      canViewContacts: !!canViewContacts,
    };
  });


export const listEmployeePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_owner_or_manager");
    if (!isStaff) return [] as Array<{
      employee_id: string;
      can_view_employee_contacts: boolean;
      can_view_pricing: boolean;
      can_view_client_cpni: boolean;
      can_schedule: boolean;
      can_manage_clients_employees: boolean;
      can_view_wages: boolean;
    }>;
    const { data, error } = await context.supabase
      .from("employee_permissions")
      .select("employee_id, can_view_employee_contacts, can_view_pricing, can_view_client_cpni, can_schedule, can_manage_clients_employees, can_view_wages");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setEmployeePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      employee_id: z.string().uuid(),
      can_view_employee_contacts: z.boolean(),
      can_view_pricing: z.boolean(),
      can_view_client_cpni: z.boolean(),
      can_schedule: z.boolean(),
      can_manage_clients_employees: z.boolean(),
      can_view_wages: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Only owners can change permissions (specifically, granting can_view_wages).
    // This ensures wages stay owner-controlled.
    const { data: isOwner } = await context.supabase.rpc("is_owner");
    if (!isOwner) throw new Error("Only owners can change permissions");
    const { data: prof, error: pErr } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (pErr || !prof?.tenant_id) throw new Error("Could not resolve tenant");
    const { error } = await context.supabase
      .from("employee_permissions")
      .upsert(
        {
          tenant_id: prof.tenant_id,
          employee_id: data.employee_id,
          can_view_employee_contacts: data.can_view_employee_contacts,
          can_view_pricing: data.can_view_pricing,
          can_view_client_cpni: data.can_view_client_cpni,
          can_schedule: data.can_schedule,
          can_manage_clients_employees: data.can_manage_clients_employees,
          can_view_wages: data.can_view_wages,
        } as any,
        { onConflict: "tenant_id,employee_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
