import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OnboardingState = {
  tenant_id: string;
  onboarding_completed: boolean;
  plan_tier: "starter" | "growth" | "scale";
  name: string;
  business_email: string | null;
  business_phone: string | null;
  address: string | null;
  timezone: string;
  locale: string;
  business_hours: Record<string, { start: string; end: string; closed?: boolean }> | null;
  quiet_hours: { start: string; end: string } | null;
};

export type ServiceTypeOption = {
  id: string | null;
  kind: string;
  name: string;
  default_price_cents: number;
  default_duration_minutes: number;
  selected: boolean;
};

const MASTER_SERVICE_TYPES: Array<{ kind: string; name: string; price: number; duration: number }> = [
  { kind: "residential_standard", name: "Standard House Cleaning", price: 15000, duration: 120 },
  { kind: "residential_deep", name: "Deep Cleaning", price: 30000, duration: 240 },
  { kind: "move_in_out", name: "Move In / Move Out", price: 35000, duration: 300 },
  { kind: "airbnb_turnover", name: "Airbnb Turnover", price: 12000, duration: 180 },
  { kind: "post_construction", name: "Post-Construction", price: 45000, duration: 360 },
  { kind: "commercial_office", name: "Commercial Office", price: 20000, duration: 180 },
  { kind: "window_cleaning", name: "Window Cleaning", price: 15000, duration: 120 },
  { kind: "carpet_cleaning", name: "Carpet Cleaning", price: 20000, duration: 150 },
];

export const getOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingState> => {
    const { supabase, userId } = context;
    const { data: profile, error: pe } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).single();
    if (pe || !profile) throw new Error("Profile not found");

    const { data: tenant, error: te } = await supabase
      .from("tenants")
      .select("id, name, business_email, business_phone, address, timezone, locale, plan_tier, onboarding_completed, business_hours, quiet_hours")
      .eq("id", profile.tenant_id).single();
    if (te || !tenant) throw new Error("Tenant not found");

    return {
      tenant_id: tenant.id,
      onboarding_completed: tenant.onboarding_completed,
      plan_tier: (tenant.plan_tier as OnboardingState["plan_tier"]) ?? "starter",
      name: tenant.name,
      business_email: tenant.business_email,
      business_phone: tenant.business_phone,
      address: tenant.address,
      timezone: tenant.timezone,
      locale: tenant.locale,
      business_hours: tenant.business_hours as OnboardingState["business_hours"],
      quiet_hours: tenant.quiet_hours as OnboardingState["quiet_hours"],
    };
  });

export const saveBusinessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    name: z.string().trim().min(1).max(100),
    business_email: z.string().trim().email().max(255).nullable(),
    business_phone: z.string().trim().max(30).nullable(),
    address: z.string().trim().max(500).nullable(),
    timezone: z.string().trim().max(60),
    locale: z.string().trim().max(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");
    const { error } = await supabase.from("tenants").update({
      name: data.name,
      business_email: data.business_email,
      business_phone: data.business_phone,
      address: data.address,
      timezone: data.timezone,
      locale: data.locale,
    }).eq("id", profile.tenant_id);
    if (error) throw error;
    return { ok: true };
  });

export const getServiceTypeSelections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceTypeOption[]> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");

    const { data: existing } = await supabase
      .from("service_types")
      .select("id, kind, name, default_price_cents, default_duration_minutes, active")
      .eq("tenant_id", profile.tenant_id);

    const byKind = new Map((existing ?? []).map((r) => [r.kind, r]));
    return MASTER_SERVICE_TYPES.map((m) => {
      const row = byKind.get(m.kind);
      return {
        id: row?.id ?? null,
        kind: m.kind,
        name: row?.name ?? m.name,
        default_price_cents: row?.default_price_cents ?? m.price,
        default_duration_minutes: row?.default_duration_minutes ?? m.duration,
        selected: !!row?.active,
      };
    });
  });

export const saveServiceTypeSelections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    services: z.array(z.object({
      kind: z.string().max(64),
      name: z.string().trim().min(1).max(100),
      default_price_cents: z.number().int().min(0).max(100000000),
      default_duration_minutes: z.number().int().min(15).max(1440),
      selected: z.boolean(),
    })).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");
    const tid = profile.tenant_id;

    const { data: existing } = await supabase.from("service_types").select("id, kind").eq("tenant_id", tid);
    const byKind = new Map((existing ?? []).map((r) => [r.kind, r.id]));

    for (const svc of data.services) {
      const existingId = byKind.get(svc.kind);
      if (existingId) {
        const { error } = await supabase.from("service_types").update({
          name: svc.name,
          default_price_cents: svc.default_price_cents,
          default_duration_minutes: svc.default_duration_minutes,
          active: svc.selected,
        }).eq("id", existingId);
        if (error) throw error;
      } else if (svc.selected) {
        const { error } = await supabase.from("service_types").insert({
          tenant_id: tid,
          kind: svc.kind,
          name: svc.name,
          default_price_cents: svc.default_price_cents,
          default_duration_minutes: svc.default_duration_minutes,
          active: true,
        });
        if (error) throw error;
      }
    }
    return { ok: true };
  });

export const saveScheduleSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    business_hours: z.record(z.string(), z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      closed: z.boolean().optional(),
    })),
    quiet_hours: z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");
    const { error } = await supabase.from("tenants").update({
      business_hours: data.business_hours,
      quiet_hours: data.quiet_hours,
    }).eq("id", profile.tenant_id);
    if (error) throw error;
    return { ok: true };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
    if (!profile) throw new Error("Profile not found");
    const { error } = await supabase.from("tenants")
      .update({ onboarding_completed: true })
      .eq("id", profile.tenant_id);
    if (error) throw error;
    return { ok: true };
  });
