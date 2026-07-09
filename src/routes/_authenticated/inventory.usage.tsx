import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell, PageHeader } from "@/components/app-shell";
import { InventoryTabs } from "@/components/inventory-tabs";
import { inventoryUsageByMonth } from "@/lib/inventory.functions";

const usageQO = queryOptions({ queryKey: ["inventory-usage"], queryFn: () => inventoryUsageByMonth() });

export const Route = createFileRoute("/_authenticated/inventory/usage")({
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQO),
  component: UsagePage,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-red-600">Error: {error.message}</div></AppShell>
  ),
  notFoundComponent: () => <AppShell><div className="p-8">Not found</div></AppShell>,
});

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function UsagePage() {
  const { data: rows } = useSuspenseQuery(usageQO);
  const total = rows.reduce((s, r) => s + r.total_cost_cents, 0);

  return (
    <AppShell>
      <PageHeader title="Inventory" subtitle="Supplies consumed by completed jobs, by month" />
      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-8 space-y-4">
        <InventoryTabs current="usage" />
        <div className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
            <div className="font-medium">Inventory usage — last 12 months</div>
            <div className="text-sm text-muted-foreground">
              Total: <span className="font-medium text-foreground tabular-nums">${(total / 100).toFixed(2)}</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-clay-100/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Month</th>
                <th className="text-right px-3 py-2">Line items</th>
                <th className="text-right px-3 py-2">Units used</th>
                <th className="text-right px-4 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">No usage recorded yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.month} className="border-t border-border/60">
                  <td className="px-4 py-3">{fmtMonth(r.month)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{r.line_count}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.total_units.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">${(r.total_cost_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Cost uses each item's current cost-per-unit. Prompt 22 will expand this into a full report.
        </p>
      </div>
    </AppShell>
  );
}
