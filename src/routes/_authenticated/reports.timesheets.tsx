import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportTimesheets, type TimesheetRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, RangeBar, ReportTable, fmtDate, useDateRange } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/timesheets")({
  component: TimesheetsReport,
});

function fmtTime(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function TimesheetsReport() {
  const { from, to, setRange } = useDateRange(1);
  const [q, setQ] = useState("");
  const fetchRows = useServerFn(reportTimesheets);
  const query = useQuery<TimesheetRow[]>({
    queryKey: ["report-timesheets", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) => [r.full_name, r.job_label, r.note].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [all, q]);

  const byPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.full_name ?? "Unknown", (m.get(r.full_name ?? "Unknown") ?? 0) + r.hours);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const total = rows.reduce((s, r) => s + r.hours, 0);

  const columns: Column<TimesheetRow>[] = [
    { key: "name", header: "Name", cell: (r) => r.full_name ?? "Unknown", csv: (r) => r.full_name },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.work_date), csv: (r) => r.work_date },
    { key: "start", header: "Start time", cell: (r) => fmtTime(r.started_at), csv: (r) => r.started_at },
    { key: "end", header: "End time", cell: (r) => fmtTime(r.ended_at), csv: (r) => r.ended_at },
    { key: "hours", header: "Hours", align: "right", cell: (r) => r.hours.toFixed(2), csv: (r) => r.hours },
    { key: "job", header: "Working on", cell: (r) => r.job_label ?? "General", csv: (r) => r.job_label },
    { key: "note", header: "Note", cell: (r) => r.note ?? "—", csv: (r) => r.note },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <RangeBar from={from} to={to} onChange={(p) => setRange((prev) => ({ ...prev, ...p }))}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee or job…" className="h-8 w-64" />
      </RangeBar>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Total hours" value={total.toFixed(2)} />
        <Kpi label="People with time" value={String(byPerson.length)} />
        <Kpi label="Entries" value={String(rows.length)} />
      </div>

      {byPerson.length ? (
        <section className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">Overview</h2>
          <ul className="divide-y divide-border/40 text-sm">
            {byPerson.map(([name, hours]) => (
              <li key={name} className="flex justify-between py-1.5">
                <span>{name}</span>
                <span className="tabular-nums">{hours.toFixed(2)} hours</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReportTable
        title="Timesheets"
        rows={rows}
        columns={columns}
        filename={`timesheets-${from}-to-${to}.csv`}
        loading={query.isLoading}
      />
    </div>
  );
}
