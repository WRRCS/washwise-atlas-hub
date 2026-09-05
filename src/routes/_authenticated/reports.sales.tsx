import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { reportSalesSummary, type SalesSummaryRow } from "@/lib/owner-reports.functions";
import { ArchiveButton, ArchiveNotice, Column, Kpi, RangeBar, ReportTable, fmtDate, fmtMoney, useArchiveGate, useDateRange } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/sales")({
  component: SalesSummaryReport,
});

function SalesSummaryReport() {
  const { from, to, setRange } = useDateRange(0.25); // ~1 week back
  const gate = useArchiveGate(from);
  const fetchRows = useServerFn(reportSalesSummary);
  const query = useQuery<SalesSummaryRow[]>({
    queryKey: ["report-sales-summary", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
    enabled: gate.allowed,
  });

  const rows = useMemo(() => [...(query.data ?? [])].reverse(), [query.data]); // table newest first
  const chartRows = query.data ?? [];

  const totalSales = rows.reduce((s, r) => s + r.sales_cents, 0);
  const totalLabor = rows.reduce((s, r) => s + r.labor_cost_cents, 0);
  const laborPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0;

  const columns: Column<SalesSummaryRow>[] = [
    { key: "day", header: "Date", cell: (r) => fmtDate(r.day), csv: (r) => r.day },
    {
      key: "jobs", header: "Jobs completed", align: "right",
      cell: (r) => r.jobs_completed_count, csv: (r) => r.jobs_completed_count,
    },
    {
      key: "sales", header: "Sales", align: "right",
      cell: (r) => <span className="font-medium">{fmtMoney(r.sales_cents)}</span>,
      csv: (r) => (r.sales_cents / 100).toFixed(2),
    },
    {
      key: "hours", header: "Labor hours", align: "right",
      cell: (r) => r.labor_hours.toFixed(2), csv: (r) => Number(r.labor_hours.toFixed(2)),
    },
    {
      key: "labor", header: "Labor cost", align: "right",
      cell: (r) => <span className="font-medium">{fmtMoney(r.labor_cost_cents)}</span>,
      csv: (r) => (r.labor_cost_cents / 100).toFixed(2),
    },
    {
      key: "pct", header: "Labor as % of sales", align: "right",
      cell: (r) => (
        <span className={r.labor_pct_of_sales > 50 ? "text-destructive font-medium" : ""}>
          {r.labor_pct_of_sales.toFixed(2)}%
        </span>
      ),
      csv: (r) => Number(r.labor_pct_of_sales.toFixed(2)),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <RangeBar from={from} to={to} onChange={(p) => setRange((prev) => ({ ...prev, ...p }))}>
        <ArchiveButton archive={gate.archive} onToggle={() => gate.setArchive(!gate.archive)} />
      </RangeBar>

      {gate.isArchived && !gate.archive ? (
        <ArchiveNotice onEnable={() => gate.setArchive(true)} />
      ) : (
      <>
      {gate.isArchived ? <p className="text-xs text-muted-foreground">Viewing archived data (older than 6 months).</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Sales" value={fmtMoney(totalSales)} tone="good" />
        <Kpi label="Labor cost" value={fmtMoney(totalLabor)} />
        <Kpi label="Labor % of sales" value={`${laborPct.toFixed(2)}%`} tone={laborPct > 50 ? "bad" : undefined} />
      </div>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">Sales vs Labor</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart
              data={chartRows.map((r) => ({
                day: new Date(`${r.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "2-digit", day: "2-digit" }),
                Sales: r.sales_cents / 100,
                Labor: r.labor_cost_cents / 100,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
              <Legend />
              <Bar dataKey="Sales" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Labor" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <ReportTable
        title="Daily summary"
        rows={rows}
        columns={columns}
        filename={`sales-summary-${from}-to-${to}.csv`}
        loading={query.isLoading}
        empty="No completed jobs or clocked time in this range."
        footer={
          <div className="flex justify-end gap-6 tabular-nums">
            <span className="text-muted-foreground">Totals:</span>
            <span className="font-medium">{fmtMoney(totalSales)} sales</span>
            <span className="font-medium">{fmtMoney(totalLabor)} labor</span>
            <span className={laborPct > 50 ? "text-destructive font-medium" : "font-medium"}>
              {laborPct.toFixed(2)}%
            </span>
          </div>
        }
      />
      </>
      )}
    </div>
  );
}
