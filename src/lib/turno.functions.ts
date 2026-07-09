import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TurnoStatus = {
  connected: boolean;
  webhook_url: string | null;
  webhook_secret: string | null;
  grace_hours: number;
  duration_hours: number;
  tenant_id: string;
};

type TurnoSettings = {
  webhook_secret?: string;
  grace_hours?: number;
  duration_hours?: number;
};

const DEFAULT_GRACE = 2;
const DEFAULT_DURATION = 3;

async function myTenantId(context: { supabase: any; userId: string }): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof?.tenant_id) throw new Error("No profile");
  return prof.tenant_id as string;
}

async function ensureRow(supabase: any, tenantId: string) {
  const { data: existing } = await supabase
    .from("integrations")
    .select("id, settings, is_connected")
    .eq("tenant_id", tenantId).eq("provider", "turno").maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabase
    .from("integrations")
    .insert({ tenant_id: tenantId, provider: "turno", is_connected: false, settings: {} })
    .select("id, settings, is_connected")
    .single();
  if (error) throw new Error(error.message);
  return created;
}

export const getTurnoStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TurnoStatus> => {
    const tenantId = await myTenantId(context);
    const row = await ensureRow(context.supabase, tenantId);
    const s: TurnoSettings = (row.settings ?? {}) as TurnoSettings;
    return {
      connected: !!row.is_connected,
      webhook_url: null, // computed client-side using window.location.origin
      webhook_secret: s.webhook_secret ?? null,
      grace_hours: s.grace_hours ?? DEFAULT_GRACE,
      duration_hours: s.duration_hours ?? DEFAULT_DURATION,
      tenant_id: tenantId,
    };
  });

export const connectTurno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TurnoStatus> => {
    const tenantId = await myTenantId(context);
    const row = await ensureRow(context.supabase, tenantId);
    const current: TurnoSettings = (row.settings ?? {}) as TurnoSettings;
    const secret = current.webhook_secret ?? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const settings: TurnoSettings = {
      webhook_secret: secret,
      grace_hours: current.grace_hours ?? DEFAULT_GRACE,
      duration_hours: current.duration_hours ?? DEFAULT_DURATION,
    };
    const { error } = await context.supabase
      .from("integrations")
      .update({ is_connected: true, connected_at: new Date().toISOString(), settings })
      .eq("tenant_id", tenantId).eq("provider", "turno");
    if (error) throw new Error(error.message);
    return {
      connected: true,
      webhook_url: null,
      webhook_secret: secret,
      grace_hours: settings.grace_hours!,
      duration_hours: settings.duration_hours!,
      tenant_id: tenantId,
    };
  });

export const rotateTurnoSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ webhook_secret: string }> => {
    const tenantId = await myTenantId(context);
    const row = await ensureRow(context.supabase, tenantId);
    const current: TurnoSettings = (row.settings ?? {}) as TurnoSettings;
    const secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const settings: TurnoSettings = { ...current, webhook_secret: secret };
    const { error } = await context.supabase
      .from("integrations")
      .update({ settings, is_connected: true, connected_at: row.is_connected ? undefined : new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("provider", "turno");
    if (error) throw new Error(error.message);
    return { webhook_secret: secret };
  });

export const updateTurnoTiming = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      grace_hours: z.number().min(0).max(24),
      duration_hours: z.number().min(0.5).max(24),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await myTenantId(context);
    const row = await ensureRow(context.supabase, tenantId);
    const current: TurnoSettings = (row.settings ?? {}) as TurnoSettings;
    const { error } = await context.supabase
      .from("integrations")
      .update({ settings: { ...current, grace_hours: data.grace_hours, duration_hours: data.duration_hours } })
      .eq("tenant_id", tenantId).eq("provider", "turno");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectTurno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await myTenantId(context);
    const { error } = await context.supabase
      .from("integrations")
      .update({ is_connected: false, connected_at: null, settings: {} })
      .eq("tenant_id", tenantId).eq("provider", "turno");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type IntegrationErrorRow = {
  id: string;
  source: string;
  error_message: string;
  inbound_payload: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
};

export const listIntegrationErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationErrorRow[]> => {
    const { data, error } = await context.supabase
      .from("integration_errors")
      .select("id, source, error_message, inbound_payload, resolved, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as IntegrationErrorRow[];
  });

export const resolveIntegrationError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("integration_errors")
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
