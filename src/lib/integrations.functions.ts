import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IntegrationProvider = "stripe" | "venmo" | "godaddy" | "turno";

export type IntegrationRow = {
  id: string;
  provider: IntegrationProvider;
  is_connected: boolean;
  connected_at: string | null;
  external_account_id: string | null;
  webhook_token: string | null;
  updated_at: string;
};

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationRow[]> => {
    const { data, error } = await context.supabase
      .from("integrations")
      .select("id, provider, is_connected, connected_at, external_account_id, settings, updated_at")
      .order("provider");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      provider: r.provider,
      is_connected: r.is_connected,
      connected_at: r.connected_at,
      external_account_id: r.external_account_id,
      webhook_token: (r.settings as { webhook_token?: string } | null)?.webhook_token ?? null,
      updated_at: r.updated_at,
    }));
  });

export const setIntegrationConnected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      provider: z.enum(["quickbooks", "stripe", "venmo", "godaddy", "turno"]),
      connected: z.boolean(),
      external_account_id: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const patch: {
      is_connected: boolean;
      connected_at: string | null;
      external_account_id?: string | null;
      access_token?: string | null;
      refresh_token?: string | null;
    } = {
      is_connected: data.connected,
      connected_at: data.connected ? new Date().toISOString() : null,
    };
    if (data.external_account_id !== undefined) patch.external_account_id = data.external_account_id;
    if (!data.connected) { patch.access_token = null; patch.refresh_token = null; }
    const { error } = await context.supabase
      .from("integrations")
      .update(patch)
      .eq("tenant_id", prof.tenant_id)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateGodaddyWebhookToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const token = crypto.randomUUID().replace(/-/g, "");
    const { error } = await context.supabase
      .from("integrations")
      .update({ settings: { webhook_token: token } })
      .eq("tenant_id", prof.tenant_id)
      .eq("provider", "godaddy");
    if (error) throw new Error(error.message);
    return { token, tenant_id: prof.tenant_id };
  });
