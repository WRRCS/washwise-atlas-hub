import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClientProperty = {
  id: string;
  client_id: string;
  label: string;
  address: string;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  property_type: string | null;
  service_frequency: string | null;
};

export const listClientProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { client_id: string }) => input)
  .handler(async ({ data, context }): Promise<ClientProperty[]> => {
    const { data: rows, error } = await context.supabase
      .from("client_properties")
      .select("id, client_id, label, address, notes, is_primary, is_active, property_type, service_frequency")
      .eq("client_id", data.client_id)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("label");
    if (error) throw new Error(error.message);
    return (rows ?? []) as ClientProperty[];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(400),
  notes: z.string().trim().max(1000).optional(),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
  property_type: z.string().trim().max(60).optional(),
  service_frequency: z.string().trim().max(60).optional(),
});

export const upsertClientProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");

    if (data.is_primary) {
      await context.supabase
        .from("client_properties")
        .update({ is_primary: false })
        .eq("client_id", data.client_id);
    }

    if (data.id) {
      const { error } = await context.supabase
        .from("client_properties")
        .update({
          label: data.label,
          address: data.address,
          notes: data.notes ?? null,
          is_primary: data.is_primary ?? false,
          is_active: data.is_active ?? true,
          property_type: data.property_type ?? null,
          service_frequency: data.service_frequency ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("client_properties")
      .insert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        label: data.label,
        address: data.address,
        notes: data.notes ?? null,
        is_primary: data.is_primary ?? false,
        is_active: data.is_active ?? true,
        property_type: data.property_type ?? null,
        service_frequency: data.service_frequency ?? null,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteClientProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_properties")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
