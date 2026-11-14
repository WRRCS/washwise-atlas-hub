import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Hourly pay rates the caller may see: owners and managers get everyone in their business,
 * anyone else gets only their own rate. Never returns another employee's rate to an employee.
 */
export const visiblePayRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, number>> => {
    const sb = context.supabase as any;
    const { data: isMgr } = await sb.rpc("is_owner_or_manager");
    if (!isMgr) {
      const { data: me } = await sb.rpc("my_profile");
      const rate = Number((me as any)?.hourly_rate_cents ?? 0);
      return rate > 0 ? { [context.userId]: rate } : {};
    }
    const { data: tenant } = await sb.rpc("current_tenant_id");
    if (!tenant) return {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("profiles").select("id, hourly_rate_cents").eq("tenant_id", tenant);
    if (error) throw new Error(error.message);
    const out: Record<string, number> = {};
    for (const p of (data ?? []) as any[]) if (Number(p.hourly_rate_cents) > 0) out[p.id] = Number(p.hourly_rate_cents);
    return out;
  });
