import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTenants, getPlatformStats } from "@/lib/admin.functions";
import { format } from "date-fns";
import { Building2, Users, Briefcase, DollarSign, TrendingUp, CircleUser } from "lucide-react";

export const Route = createFileRoute("/_authenticated/super-admin/")({
  component: SuperAdminOverview,
});

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-medium tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function SuperAdminOverview() {
  const statsFn = useServerFn(getPlatformStats);
  const tenantsFn = useServerFn(listTenants);
  const { data: stats } = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn() });
  const { data: tenants, isLoading } = useQuery({ queryKey: ["admin-tenants"], queryFn: () => tenantsFn() });

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Building2} label="Workspaces" value={String(stats?.tenants_total ?? "—")}
          sub={stats ? `${stats.tenants_onboarded} onboarded` : undefined} />
        <Stat icon={CircleUser} label="Users" value={String(stats?.users_total ?? "—")} />
        <Stat icon={Briefcase} label="Jobs (30d)" value={String(stats?.jobs_last_30d ?? "—")}
          sub={stats ? `${stats.jobs_total} total` : undefined} />
        <Stat icon={DollarSign} label="Revenue (30d)" value={stats ? fmtCents(stats.revenue_last_30d_cents) : "—"}
          sub={stats ? `${fmtCents(stats.revenue_total_cents)} lifetime` : undefined} />
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={TrendingUp} label="Signups (30d)" value={String(stats.signups_last_30d)} />
          {Object.entries(stats.tenants_by_plan ?? {}).map(([plan, count]) => (
            <Stat key={plan} icon={Users} label={`Plan · ${plan}`} value={String(count)} />
          ))}
        </div>
      )}

      <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h2 className="text-sm font-medium">All workspaces</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-clay-100/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Workspace</th>
                  <th className="px-4 py-2 font-medium">Plan</th>
                  <th className="px-4 py-2 font-medium">Users</th>
                  <th className="px-4 py-2 font-medium">Clients</th>
                  <th className="px-4 py-2 font-medium">Jobs</th>
                  <th className="px-4 py-2 font-medium">Revenue</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {(tenants ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-border/60 hover:bg-clay-100/40">
                    <td className="px-4 py-3">
                      <Link
                        to="/super-admin/tenants/$tenantId"
                        params={{ tenantId: t.id }}
                        className="font-medium text-foreground hover:text-brand"
                      >
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{t.business_email ?? t.slug}</div>
                      {!t.onboarding_completed && (
                        <span className="inline-block mt-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Onboarding
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize">{t.plan_tier}</td>
                    <td className="px-4 py-3">{t.user_count}</td>
                    <td className="px-4 py-3">{t.client_count}</td>
                    <td className="px-4 py-3">{t.job_count}</td>
                    <td className="px-4 py-3">{fmtCents(t.total_revenue_cents)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{format(new Date(t.created_at), "MMM d, yyyy")}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.last_activity_at ? format(new Date(t.last_activity_at), "MMM d, HH:mm") : "—"}
                    </td>
                  </tr>
                ))}
                {(tenants ?? []).length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No workspaces yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
