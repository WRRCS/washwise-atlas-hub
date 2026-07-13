import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BusinessProfile = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  business_email: string | null;
  business_phone: string | null;
  business_address: string | null;
  website: string | null;
  timezone: string | null;
  logo_url: string | null;
  primary_color: string | null;
  invoice_prefix: string | null;
  invoice_footer: string | null;
  payment_terms_days: number | null;
  late_fee_percent: number | null;
  reminder_lead_hours: number | null;
};

export const getBusinessProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BusinessProfile> => {
    const { data: profile } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!profile?.tenant_id) throw new Error("No workspace");
    const { data, error } = await context.supabase
      .from("tenants")
      .select(
        "id,name,legal_name,slug,business_email,business_phone,business_address,website,timezone,logo_url,primary_color,invoice_prefix,invoice_footer,payment_terms_days,late_fee_percent,reminder_lead_hours",
      )
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "Workspace not found");
    return data as BusinessProfile;
  });

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legal_name: z.string().trim().max(200).nullable().optional(),
  business_email: z.string().trim().email().max(200).nullable().optional(),
  business_phone: z.string().trim().max(50).nullable().optional(),
  business_address: z.string().trim().max(500).nullable().optional(),
  website: z.string().trim().url().max(300).nullable().optional().or(z.literal("")),
  timezone: z.string().trim().max(80).nullable().optional(),
  logo_url: z.string().trim().url().max(500).nullable().optional().or(z.literal("")),
  primary_color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  invoice_prefix: z.string().trim().max(20).nullable().optional(),
  invoice_footer: z.string().trim().max(1000).nullable().optional(),
  payment_terms_days: z.number().int().min(0).max(365).nullable().optional(),
  late_fee_percent: z.number().min(0).max(100).nullable().optional(),
  reminder_lead_hours: z.number().int().min(0).max(168).nullable().optional(),
});

export const updateBusinessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => patchSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: isOwner } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "owner",
    });
    if (!isOwner) throw new Error("Only the workspace owner can update business profile.");
    const { data: profile } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!profile?.tenant_id) throw new Error("No workspace");

    // normalize empty strings to null for nullable fields
    const patch: Record<string, unknown> = { ...data };
    for (const key of ["website", "logo_url", "legal_name", "business_email", "business_phone", "business_address", "invoice_prefix", "invoice_footer"]) {
      if (patch[key] === "") patch[key] = null;
    }

    const { error } = await context.supabase
      .from("tenants")
      .update(patch)
      .eq("id", profile.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
