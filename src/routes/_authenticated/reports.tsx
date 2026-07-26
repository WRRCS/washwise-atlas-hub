import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  revenueByMonth, employeeProductivity, clientRetention, inventoryUsageDetail,
  type RevenueMonthRow, type EmployeeProductivityRow, type ClientRetentionRow, type InventoryUsageDetailRow,
} from "@/lib/reports.functions";
import { downloadCsv } from "@/lib/csv";

const searchSchema = z.object({
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/reports")({
  validateSearch: zodValidator(searchSchema),
  component: ReportsPage,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-red-600">Error: {error.message}</div></AppShell>
  ),
  notFoundComponent: () => <AppShell><div className="p-8">Not found</div></AppShell>,
});

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}
function fmtMoney(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function ReportsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reports" });
  const defaults = defaultRange();
  const from = search.from || defaults.from;
  const to = search.to || defaults.to;
  const tab = search.tab;

  const setSearch = (patch: Record<string, string | number>) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) });

  return (
    <AppShell>
      <PageHeader title="Reports" subtitle="Deeper insights into revenue, staff, clients, and supplies" />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 border-b border-border/60">
            {TABS.map((t) => (
              <Link
                key={t.key}
                to="/reports"
                search={(prev: Record<string, unknown>) => ({ ...prev, tab: t.key })}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  tab === t.key ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setSearch({ from: e.target.value })} className="h-8 w-40" />
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setSearch({ to: e.target.value })} className="h-8 w-40" />
            <Button
              size="sm" variant="outline"
              onClick={() => { const d = defaultRange(); setSearch({ from: d.from, to: d.to }); }}
            >Reset</Button>
          </div>
        </div>

        {tab === "revenue" && <RevenueTab from={from} to={to} />}
        {tab === "employees" && <EmployeesTab from={from} to={to} />}
        {tab === "retention" && (
          <RetentionTab
            atRiskDays={search.at_risk_days}
            setAtRiskDays={(n) => setSearch({ at_risk_days: n })}
          />
        )}
        {tab === "inventory" && <InventoryTab from={from} to={to} />}
      </div>
    </AppShell>
  );
}

// ---------- Revenue ----------
function RevenueTab({ from, to }: { from: string; to: string }) {
  const fetchRev = useServerFn(revenueByMonth);
  const q = useQuery<RevenueMonthRow[]>({
    queryKey: ["report-revenue", from, to],
    queryFn: () => fetchRev({ data: { from, to } }),
  });
  const rows = q.data ?? [];

  const svcTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const [k, v] of Object.entries(r.by_service_type)) m.set(k, (m.get(k) ?? 0) + Number(v));
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const totalRev = rows.reduce((s, r) => s + r.total_revenue_cents, 0);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-4">
        <Kpi label="Total revenue" value={fmtMoney(totalRev)} />
        <Kpi label="Invoices paid" value={String(rows.reduce((s, r) => s + r.invoice_count, 0))} />
        <Kpi label="Avg invoice" value={rows.length ? fmtMoney(totalRev / rows.reduce((s, r) => s + r.invoice_count, 0) || 0) : "—"} />
      </div>

      <Card
        title="Revenue over time"
        onExport={() => downloadCsv("revenue-by-month.csv", rows.map((r) => ({
          month: r.month, revenue_cents: r.total_revenue_cents, invoice_count: r.invoice_count,
          avg_invoice_cents: r.avg_invoice_cents,
        })))}
      >
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={rows.map((r) => ({ month: fmtMonth(r.month), revenue: r.total_revenue_cents / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
              <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card
          title="By service type"
          onExport={() => downloadCsv("revenue-by-service.csv", svcTotals.map((s) => ({ service: s.name, revenue_cents: s.value })))}
        >
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={svcTotals} dataKey="value" nameKey="name" outerRadius={80} label={(e) => e.name}>
                  {svcTotals.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <TopClientsCard />
      </div>
    </div>
  );
}

function TopClientsCard() {
  const fetchRet = useServerFn(clientRetention);
  const q = useQuery<ClientRetentionRow[]>({ queryKey: ["report-retention"], queryFn: () => fetchRet() });
  const top = (q.data ?? []).slice(0, 10);
  return (
    <Card
      title="Top clients (lifetime)"
      onExport={() => downloadCsv("top-clients.csv", top.map((c) => ({
        client: c.full_name, jobs: c.total_jobs_count, revenue_cents: c.lifetime_revenue_cents,
      })))}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr><th className="text-left py-1">Client</th><th className="text-right">Jobs</th><th className="text-right">Revenue</th></tr>
          </thead>
          <tbody>
            {top.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">No data.</td></tr>}
            {top.map((c) => (
              <tr key={c.client_id} className="border-t border-border/60">
                <td className="py-1.5">{c.full_name ?? "—"}</td>
                <td className="text-right tabular-nums">{c.total_jobs_count}</td>
                <td className="text-right tabular-nums font-medium">{fmtMoney(c.lifetime_revenue_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Employees ----------
type EmpSortKey = keyof EmployeeProductivityRow;

function EmployeesTab({ from, to }: { from: string; to: string }) {
  const fetchEmp = useServerFn(employeeProductivity);
  const q = useQuery<EmployeeProductivityRow[]>({
    queryKey: ["report-employees", from, to],
    queryFn: () => fetchEmp({ data: { from, to } }),
  });
  const [sort, setSort] = useState<{ key: EmpSortKey; dir: 1 | -1 }>({ key: "revenue_attributed_cents", dir: -1 });
  const rows = useMemo(() => {
    const r = [...(q.data ?? [])];
    r.sort((a, b) => {
      const av = a[sort.key] as any; const bv = b[sort.key] as any;
      if (av === bv) return 0;
      return av > bv ? sort.dir : -sort.dir;
    });
    return r;
  }, [q.data, sort]);
  const toggle = (k: EmpSortKey) => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }));

  const H = ({ k, children, right }: { k: EmpSortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`py-2 px-3 ${right ? "text-right" : "text-left"} cursor-pointer hover:text-foreground`} onClick={() => toggle(k)}>
      {children}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <Card
      title="Employee productivity"
      onExport={() => downloadCsv("employee-productivity.csv", rows.map((r) => ({
        employee: r.full_name, jobs: r.jobs_completed_count, hours: r.total_hours_worked.toFixed(2),
        avg_min: r.avg_job_duration_minutes.toFixed(1), revenue_cents: r.revenue_attributed_cents,
      })))}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground bg-clay-100/60">
            <tr>
              <H k="full_name">Employee</H>
              <H k="jobs_completed_count" right>Jobs</H>
              <H k="total_hours_worked" right>Hours</H>
              <H k="avg_job_duration_minutes" right>Avg mins/job</H>
              <H k="revenue_attributed_cents" right>Revenue</H>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No data in this range.</td></tr>}
            {rows.map((r) => (
              <tr key={r.employee_id} className="border-t border-border/60">
                <td className="py-2 px-3">{r.full_name ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.jobs_completed_count}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.total_hours_worked.toFixed(2)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.avg_job_duration_minutes.toFixed(1)}</td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">{fmtMoney(r.revenue_attributed_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Retention ----------
function RetentionTab({ atRiskDays, setAtRiskDays }: { atRiskDays: number; setAtRiskDays: (n: number) => void }) {
  const fetchRet = useServerFn(clientRetention);
  const q = useQuery<ClientRetentionRow[]>({ queryKey: ["report-retention"], queryFn: () => fetchRet() });
  const rows = q.data ?? [];

  const now = Date.now();
  const atRisk = rows.filter((r) => {
    if (!r.last_service_date || r.total_jobs_count === 0) return false;
    const days = (now - new Date(r.last_service_date).getTime()) / (86400 * 1000);
    return days >= atRiskDays;
  });

  const cohort = useMemo(() => {
    const buckets = new Map<string, { cohort: string; total: number; still_active: number }>();
    for (const r of rows) {
      if (!r.first_service_date) continue;
      const c = r.first_service_date.slice(0, 7);
      const b = buckets.get(c) ?? { cohort: c, total: 0, still_active: 0 };
      b.total += 1;
      if (r.last_service_date) {
        const days = (now - new Date(r.last_service_date).getTime()) / (86400 * 1000);
        if (days < 90) b.still_active += 1;
      }
      buckets.set(c, b);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.cohort.localeCompare(b.cohort))
      .map((b) => ({ cohort: fmtMonth(b.cohort), retention: b.total ? Math.round((b.still_active / b.total) * 100) : 0, total: b.total }));
  }, [rows, now]);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-4">
        <Kpi label="Total clients" value={String(rows.length)} />
        <Kpi label="Recurring" value={String(rows.filter((r) => r.is_recurring).length)} />
        <Kpi label={`At risk (${atRiskDays}+ days)`} value={String(atRisk.length)} accent="danger" />
      </div>

      <Card
        title="All clients (lifetime)"
        onExport={() => downloadCsv("client-retention.csv", rows.map((r) => ({
          client: r.full_name, first_service: r.first_service_date, last_service: r.last_service_date,
          jobs: r.total_jobs_count, revenue_cents: r.lifetime_revenue_cents, recurring: r.is_recurring,
          months_active: r.months_active_count,
        })))}
      >
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-clay-100/60 sticky top-0">
              <tr>
                <th className="text-left py-2 px-3">Client</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-right py-2 px-3">Jobs</th>
                <th className="text-right py-2 px-3">Months active</th>
                <th className="text-left py-2 px-3">Last service</th>
                <th className="text-right py-2 px-3">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No clients yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.client_id} className="border-t border-border/60">
                  <td className="py-2 px-3">{r.full_name ?? "—"}</td>
                  <td className="py-2 px-3">
                    {r.is_recurring ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase tracking-wider">Recurring</span>
                    ) : r.total_jobs_count > 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-clay-200 text-muted-foreground uppercase tracking-wider">One-off</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.total_jobs_count}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.months_active_count}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.last_service_date ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium">{fmtMoney(r.lifetime_revenue_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="At-risk clients"
        headerRight={
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Threshold (days)</span>
            <Input type="number" min={1} value={atRiskDays} onChange={(e) => setAtRiskDays(Number(e.target.value) || 60)} className="h-7 w-20" />
          </div>
        }
        onExport={() => downloadCsv("at-risk-clients.csv", atRisk.map((r) => ({
          client: r.full_name, last_service: r.last_service_date, jobs: r.total_jobs_count,
          revenue_cents: r.lifetime_revenue_cents,
        })))}
      >
        {atRisk.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No clients past the threshold. Nice work.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr><th className="text-left py-1 px-3">Client</th><th className="text-left px-3">Last service</th><th className="text-right px-3">Jobs</th><th className="text-right px-3">Revenue</th></tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr key={r.client_id} className="border-t border-border/60">
                    <td className="py-1.5 px-3">{r.full_name ?? "—"}</td>
                    <td className="px-3 text-muted-foreground">{r.last_service_date}</td>
                    <td className="px-3 text-right tabular-nums">{r.total_jobs_count}</td>
                    <td className="px-3 text-right tabular-nums font-medium">{fmtMoney(r.lifetime_revenue_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Cohort retention (90-day active)"
        onExport={() => downloadCsv("cohort-retention.csv", cohort.map((c) => ({ cohort: c.cohort, total: c.total, retention_pct: c.retention })))}
      >
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={cohort}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="cohort" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="retention" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ---------- Inventory ----------
function InventoryTab({ from, to }: { from: string; to: string }) {
  const fetchInv = useServerFn(inventoryUsageDetail);
  const q = useQuery<InventoryUsageDetailRow[]>({
    queryKey: ["report-inventory", from, to],
    queryFn: () => fetchInv({ data: { from, to } }),
  });
  const rows = q.data ?? [];

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.month, (m.get(r.month) ?? 0) + r.total_cost_cents);
    return Array.from(m.entries()).sort().map(([month, cost]) => ({ month: fmtMonth(month), cost_cents: cost }));
  }, [rows]);

  const topItems = useMemo(() => {
    const m = new Map<string, { name: string; cost: number; units: number }>();
    for (const r of rows) {
      const b = m.get(r.item_id) ?? { name: r.item_name, cost: 0, units: 0 };
      b.cost += r.total_cost_cents; b.units += r.units_used;
      m.set(r.item_id, b);
    }
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost).slice(0, 8);
  }, [rows]);

  // Cost per job avg — count distinct jobs in this window with job_usage in these months. Use rows.length approximation:
  const totalCost = rows.reduce((s, r) => s + r.total_cost_cents, 0);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-4">
        <Kpi label="Total supplies cost" value={fmtMoney(totalCost)} />
        <Kpi label="Line items" value={String(rows.length)} />
        <Kpi label="Months covered" value={String(monthly.length)} />
      </div>

      <Card
        title="Monthly supplies cost"
        onExport={() => downloadCsv("inventory-monthly.csv", monthly.map((m) => ({ month: m.month, cost_cents: m.cost_cents })))}
      >
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => `$${v / 100}`} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Legend />
              <Bar dataKey="cost_cents" name="Cost" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title="Top consumed items"
        onExport={() => downloadCsv("inventory-top-items.csv", topItems.map((i) => ({ item: i.name, units: i.units, cost_cents: i.cost })))}
      >
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={topItems} layout="vertical" margin={{ left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" fontSize={11} tickFormatter={(v) => `$${v / 100}`} />
              <YAxis type="category" dataKey="name" fontSize={11} width={100} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="cost" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title="Detailed breakdown"
        onExport={() => downloadCsv("inventory-usage-detail.csv", rows)}
      >
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-clay-100/60 sticky top-0">
              <tr>
                <th className="text-left py-2 px-3">Month</th>
                <th className="text-left px-3">Item</th>
                <th className="text-right px-3">Units</th>
                <th className="text-right px-3">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No usage in this range.</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1.5 px-3">{fmtMonth(r.month)}</td>
                  <td className="px-3">{r.item_name} <span className="text-muted-foreground">({r.item_unit})</span></td>
                  <td className="px-3 text-right tabular-nums">{r.units_used.toFixed(2)}</td>
                  <td className="px-3 text-right tabular-nums font-medium">{fmtMoney(r.total_cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- shared ----------
function Kpi({ label, value, accent }: { label: string; value: string; accent?: "danger" }) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-black/5 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-medium mt-1 tabular-nums ${accent === "danger" ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}

function Card({ title, children, onExport, headerRight }: {
  title: string; children: React.ReactNode; onExport?: () => void; headerRight?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onExport && (
            <Button size="sm" variant="outline" onClick={onExport}>
              <Download className="size-3.5 mr-1" /> CSV
            </Button>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
