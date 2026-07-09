import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTenantDetail, toggleTenantActive } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, PauseCircle, PlayCircle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/super-admin/tenants/$tenantId")({
  component: TenantDetailPage,
});

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  const qc = useQueryClient();
  const detailFn = useServerFn(getTenantDetail);
  const toggleFn = useServerFn(toggleTenantActive);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-tenant", tenantId],
    queryFn: () => detailFn({ data: { tenantId } }),
  });

  const toggle = useMutation({
    mutationFn: (active: boolean) => toggleFn({ data: { tenantId, active } }),
    onSuccess: (_res, active) => {
      toast.success(active ? "Activation logged" : "Suspension logged");
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (error) return <div className="text-destructive">{(error as Error).message}</div>;
  if (!data) return <div>Not found</div>;

  const { tenant, users, stats, recent_activity } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/super-admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All workspaces
        </Link>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => toggle.mutate(false)} disabled={toggle.isPending}>
            <PauseCircle className="size-4 mr-1" /> Log suspend
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggle.mutate(true)} disabled={toggle.isPending}>
            <PlayCircle className="size-4 mr-1" /> Log activate
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6">
        <h1 className="text-xl font-medium tracking-tight">{tenant.name}</h1>
        <div className="text-sm text-muted-foreground mt-1">
          {tenant.business_email ?? "—"} · Plan <span className="capitalize font-medium text-foreground">{tenant.plan_tier}</span>
          {" · "}Created {format(new Date(tenant.created_at), "MMM d, yyyy")}
        </div>
        {!tenant.onboarding_completed && (
          <div className="mt-3 text-xs px-2 py-1 inline-block rounded bg-amber-100 text-amber-800">Onboarding not completed</div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Clients", stats.clients],
          ["Jobs", `${stats.jobs_completed} / ${stats.jobs}`],
          ["Invoices", stats.invoices],
          ["Employees", stats.employees],
          ["Services", stats.service_types],
          ["Paid revenue", fmtCents(stats.paid_revenue_cents)],
          ["Outstanding", fmtCents(stats.outstanding_cents)],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-card rounded-xl ring-1 ring-black/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-lg font-medium mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl ring-1 ring-black/5">
          <div className="px-5 py-3 border-b border-border/60 text-sm font-medium">Users ({users.length})</div>
          <div className="divide-y divide-border/60">
            {users.map((u) => (
              <div key={u.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{u.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </div>
                <span className="text-xs capitalize px-2 py-0.5 rounded bg-clay-200/60">{u.role ?? "—"}</span>
              </div>
            ))}
            {users.length === 0 && <div className="px-5 py-6 text-sm text-muted-foreground">No users.</div>}
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5">
          <div className="px-5 py-3 border-b border-border/60 text-sm font-medium">Recent activity</div>
          <div className="divide-y divide-border/60 max-h-96 overflow-auto">
            {recent_activity.map((a: any) => (
              <div key={a.id} className="px-5 py-3">
                <div className="text-sm">{a.description}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })} · {a.action_type}
                </div>
              </div>
            ))}
            {recent_activity.length === 0 && <div className="px-5 py-6 text-sm text-muted-foreground">No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
