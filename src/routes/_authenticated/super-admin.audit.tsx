import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAuditLog } from "@/lib/admin.functions";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/super-admin/audit")({
  component: AuditLogPage,
});

function AuditLogPage() {
  const fn = useServerFn(getAuditLog);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => fn({ data: { limit: 200 } }),
  });

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 text-sm font-medium">Platform audit log</div>
      {isLoading ? (
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-clay-100/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="px-4 py-2">
                    <div>{r.actor?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.actor?.email}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2">
                    {r.tenant ? (
                      <Link to="/super-admin/tenants/$tenantId" params={{ tenantId: r.target_tenant_id }} className="text-brand hover:underline">
                        {r.tenant.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground max-w-md truncate">
                    {Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : "—"}
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No audit entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
