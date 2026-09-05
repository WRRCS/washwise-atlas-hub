import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { ChevronLeft, ChevronRight, Archive, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { reportSalesSummary, type SalesSummaryRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, ReportTable, fmtDate, fmtMoney, isoDate } from "@/components/report-ui";
import { downloadCsv } from "@/lib/csv";

const searchSchema = z.object({
  period: fallback(z.enum(["week", "month"]), "week").default("week"),
  anchor: fallback(z.string(), "").default(""),
  archive: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/reports/weekly")({
  validateSearch: zodValidator(searchSchema),
  component: WeeklyOverview,
});

// ---------- period math ----------
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}
function endOfWeek(d: Date) {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return x;
}
function startOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  return x;
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
}
function shift(d: Date, period: "week" | "month", dir: -1 | 1) {
  const x = new Date(d);
  if (period === "week") x.setDate(x.getDate() + dir * 7);
  else x.setMonth(x.getMonth() + dir);
  return x;
}
function monthsAgo(n: number) {
  const x = new Date();
  x.setHours(12, 0, 0, 0);
  x.setMonth(x.getMonth() - n);
  return x;
}

function WeeklyOverview() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reports/weekly" });
  const period = search.period;
  const anchor = useMemo(
    () => (search.anchor ? new Date(`${search.anchor}T12:00:00`) : new Date()),
    [search.anchor],
  );
  const setSearch = (patch: Record<string, unknown>) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) });

  const start = period === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
  const end = period === "week" ? endOfWeek(anchor) : endOfMonth(anchor);
  const from = isoDate(start);
  const to = isoDate(end);

  const cutoff = monthsAgo(6);
  const isArchived = end < cutoff;
  const allowed = !isArchived || search.archive;

  const fetchRows = useServerFn(reportSalesSummary);
  const query = useQuery<SalesSummaryRow[]>({
    queryKey: ["report-overview", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
    enabled: allowed,
  });

  const daily = query.data ?? [];

  // Monthly view consolidates the range into one row per month.
  const rows = useMemo(() => {
    if (period === "week") return [...daily].reverse();
    const m = new Map<string, SalesSummaryRow>();
    for (const r of daily) {
      const key = r.day.slice(0, 7);
      const b = m.get(key) ?? {
        day: key, sales_cents: 0, labor_cost_cents: 0, labor_hours: 0,
        labor_pct_of_sales: 0, jobs_completed_count: 0,
      };
      b.sales_cents += r.sales_cents;
      b.labor_cost_cents += r.labor_cost_cents;
      b.labor_hours += r.labor_hours;
      b.jobs_completed_count += r.jobs_completed_count;
      m.set(key, b);
    }
    return Array.from(m.values()).map((b) => ({
      ...b,
      labor_pct_of_sales: b.sales_cents > 0 ? (b.labor_cost_cents / b.sales_cents) * 100 : 0,
    }));
  }, [daily, period]);

  const totalSales = daily.reduce((s, r) => s + r.sales_cents, 0);
  const totalLabor = daily.reduce((s, r) => s + r.labor_cost_cents, 0);
  const totalHours = daily.reduce((s, r) => s + r.labor_hours, 0);
  const totalJobs = daily.reduce((s, r) => s + r.jobs_completed_count, 0);
  const laborPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0;
  const avgTicket = totalJobs > 0 ? totalSales / totalJobs : 0;

  const label =
    period === "week"
      ? `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : start.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const columns: Column<SalesSummaryRow>[] = [
    {
      key: "day",
      header: period === "week" ? "Date" : "Month",
      cell: (r) => (period === "week" ? fmtDate(r.day) : new Date(`${r.day}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })),
      csv: (r) => r.day,
    },
    { key: "jobs", header: "Jobs completed", align: "right", cell: (r) => r.jobs_completed_count, csv: (r) => r.jobs_completed_count },
    {
      key: "sales", header: "Sales", align: "right",
      cell: (r) => <span className="font-medium">{fmtMoney(r.sales_cents)}</span>,
      csv: (r) => (r.sales_cents / 100).toFixed(2),
    },
    { key: "hours", header: "Labor hours", align: "right", cell: (r) => r.labor_hours.toFixed(2), csv: (r) => Number(r.labor_hours.toFixed(2)) },
    {
      key: "labor", header: "Labor cost", align: "right",
      cell: (r) => <span className="font-medium">{fmtMoney(r.labor_cost_cents)}</span>,
      csv: (r) => (r.labor_cost_cents / 100).toFixed(2),
    },
    {
      key: "pct", header: "Labor % of sales", align: "right",
      cell: (r) => (
        <span className={r.labor_pct_of_sales > 50 ? "text-destructive font-medium" : ""}>
          {r.labor_pct_of_sales.toFixed(2)}%
        </span>
      ),
      csv: (r) => Number(r.labor_pct_of_sales.toFixed(2)),
    },
  ];

  const exportSummary = () =>
    downloadCsv(`overview-summary-${from}-to-${to}.csv`, [{
      period_start: from, period_end: to, view: period,
      jobs_completed: totalJobs,
      sales: (totalSales / 100).toFixed(2),
      labor_hours: totalHours.toFixed(2),
      labor_cost: (totalLabor / 100).toFixed(2),
      labor_pct_of_sales: laborPct.toFixed(2),
      avg_per_job: (avgTicket / 100).toFixed(2),
    }]);

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={search.archive ? "default" : "outline"}
          size="sm"
          onClick={() => setSearch({ archive: !search.archive })}
        >
          <Archive className="size-4 mr-1.5" />
          {search.archive ? "Archive retrieval on" : "Archive retrieval"}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous period"
            onClick={() => setSearch({ anchor: isoDate(shift(anchor, period, -1)) })}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-52 text-center text-sm font-medium tabular-nums">{label}</div>
          <Button variant="outline" size="icon" aria-label="Next period"
            onClick={() => setSearch({ anchor: isoDate(shift(anchor, period, 1)) })}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSearch({ anchor: "" })}>Today</Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {period === "week" ? "Weekly" : "Monthly"}
                <ChevronRight className="size-3.5 ml-1 rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSearch({ period: "week" })}>Weekly overview</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSearch({ period: "month" })}>Monthly overview</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={exportSummary}>
            <Download className="size-4 mr-1.5" /> Download
          </Button>
        </div>
      </div>

      {isArchived && !search.archive ? (
        <div className="rounded-xl border border-border/60 bg-card p-8 text-center space-y-3">
          <Archive className="size-6 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This period is older than 6 months and has been archived. Turn on Archive retrieval to view it.
          </p>
          <Button size="sm" onClick={() => setSearch({ archive: true })}>Retrieve from archive</Button>
        </div>
      ) : (
        <>
          {isArchived && (
            <p className="text-xs text-muted-foreground">Viewing archived data (older than 6 months).</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Sales" value={fmtMoney(totalSales)} tone="good" />
            <Kpi label="Labor cost" value={fmtMoney(totalLabor)} />
            <Kpi label="Labor % of sales" value={`${laborPct.toFixed(2)}%`} tone={laborPct > 50 ? "bad" : undefined} />
            <Kpi label="Jobs completed" value={String(totalJobs)} />
            <Kpi label="Avg per job" value={fmtMoney(avgTicket)} />
          </div>

          <section className="rounded-xl border border-border/60 bg-card p-4">
            <h2 className="text-sm font-semibold mb-3">Sales vs Labor</h2>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart
                  data={daily.map((r) => ({
                    day: new Date(`${r.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: period === "week" ? "short" : undefined, month: "2-digit", day: "2-digit" }),
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
            title={period === "week" ? "Daily breakdown" : "Monthly consolidated"}
            rows={rows}
            columns={columns}
            filename={`overview-${period}-${from}-to-${to}.csv`}
            loading={query.isLoading}
            empty="No completed jobs or clocked time in this period."
            footer={
              <div className="flex justify-end gap-6 tabular-nums">
                <span className="text-muted-foreground">Totals:</span>
                <span className="font-medium">{fmtMoney(totalSales)} sales</span>
                <span className="font-medium">{totalHours.toFixed(2)} hrs</span>
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

// keep unused import guard
export const _unused = useState;
