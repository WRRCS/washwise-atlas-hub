import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.rpc("admin_list_tenants");
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      plan_tier: string;
      onboarding_completed: boolean;
      business_email: string | null;
      created_at: string;
      user_count: number;
      client_count: number;
      job_count: number;
      paid_invoice_count: number;
      total_revenue_cents: number;
      last_activity_at: string | null;
    }>;
  });

export const getPlatformStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.rpc("admin_platform_stats");
    if (error) throw new Error(error.message);
    return data as {
      tenants_total: number;
      tenants_onboarded: number;
      tenants_by_plan: Record<string, number>;
      users_total: number;
      jobs_total: number;
      jobs_last_30d: number;
      revenue_total_cents: number;
      revenue_last_30d_cents: number;
      signups_last_30d: number;
    };
  });

export const getTenantDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { data: res, error } = await context.supabase.rpc("admin_get_tenant", {
      _tenant: data.tenantId,
    });
    if (error) throw new Error(error.message);
    return res as {
      tenant: Record<string, any>;
      users: Array<{ id: string; full_name: string | null; email: string | null; role: string | null }>;
      stats: {
        clients: number; jobs: number; jobs_completed: number; invoices: number;
        paid_revenue_cents: number; outstanding_cents: number;
        employees: number; service_types: number;
      };
      recent_activity: Array<Record<string, any>>;
    };
  });

export const getAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("platform_audit_log")
      .select("id, actor_id, action, target_tenant_id, target_entity_type, target_entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id).filter(Boolean)));
    const tenantIds = Array.from(new Set((rows ?? []).map((r: any) => r.target_tenant_id).filter(Boolean)));
    const [actors, tenants] = await Promise.all([
      actorIds.length
        ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
            .from("profiles").select("id, full_name, email").in("id", actorIds)
        : Promise.resolve({ data: [] }),
      tenantIds.length
        ? context.supabase.from("tenants").select("id, name").in("id", tenantIds)
        : Promise.resolve({ data: [] }),
    ]);
    const actorMap = new Map((actors.data ?? []).map((a: any) => [a.id, a]));
    const tenantMap = new Map((tenants.data ?? []).map((t: any) => [t.id, t]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      actor: actorMap.get(r.actor_id) ?? null,
      tenant: tenantMap.get(r.target_tenant_id) ?? null,
    }));
  });

export const toggleTenantActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tenantId: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.rpc("log_platform_action", {
      _action: data.active ? "activate_tenant" : "suspend_tenant",
      _tenant: data.tenantId,
      _entity_type: "tenant",
      _entity_id: data.tenantId,
      _metadata: { active: data.active },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const amISuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (error) return false;
    return Boolean(data);
  });
