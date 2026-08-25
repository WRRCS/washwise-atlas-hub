import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportClientDirectory, type ClientDirectoryRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, ReportTable, fmtDate, fmtMoney } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/clients")({
  component: ClientDirectoryReport,
});

function ClientDirectoryReport() {
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const fetchRows = useServerFn(reportClientDirectory);
  const query = useQuery<ClientDirectoryRow[]>({
    queryKey: ["report-client-directory"],
    queryFn: () => fetchRows(),
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (activeOnly && r.is_active === false) return false;
      if (!needle) return true;
      const hay = [
        r.client_name, r.email, r.phone, r.service_address, r.billing_address,
        ...(r.properties ?? []).flatMap((p) => [p.label, p.address]),
      ];
      return hay.some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [all, q, activeOnly]);

  const columns: Column<ClientDirectoryRow>[] = [
    {
      key: "name", header: "Client",
      cell: (r) => (
        <Link to="/reports/account/$clientId" params={{ clientId: r.client_id }} className="text-brand hover:underline font-medium">
          {r.client_name}
        </Link>
      ),
      csv: (r) => r.client_name,
    },
    { key: "email", header: "Email", cell: (r) => r.email ?? "—", csv: (r) => r.email },
    { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", csv: (r) => r.phone },
    { key: "service", header: "Service address", cell: (r) => r.service_address ?? "—", csv: (r) => r.service_address },
    {
      key: "props", header: "Properties",
      cell: (r) => (r.properties?.length ? r.properties.map((p) => p.label || p.address).join(", ") : "—"),
      csv: (r) => (r.properties ?? []).map((p) => `${p.label ?? ""}: ${p.address ?? ""}`).join(" | "),
    },
    { key: "jobs", header: "Jobs", align: "right", cell: (r) => r.jobs_count, csv: (r) => r.jobs_count },
    { key: "last", header: "Last job", cell: (r) => fmtDate(r.last_job_at), csv: (r) => r.last_job_at },
    { key: "rev", header: "Lifetime paid", align: "right", cell: (r) => fmtMoney(r.lifetime_revenue_cents), csv: (r) => (r.lifetime_revenue_cents / 100).toFixed(2) },
    { key: "sop", header: "SOP", cell: (r) => (r.has_sop ? "Yes" : "—"), csv: (r) => (r.has_sop ? "yes" : "no") },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone, address, property…"
          className="h-8 w-80"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Clients" value={String(rows.length)} />
        <Kpi label="Jobs on file" value={String(rows.reduce((s, r) => s + r.jobs_count, 0))} />
        <Kpi label="Lifetime collected" value={fmtMoney(rows.reduce((s, r) => s + r.lifetime_revenue_cents, 0))} tone="good" />
      </div>

      <ReportTable
        title="Client contact info"
        rows={rows}
        columns={columns}
        filename="client-directory.csv"
        loading={query.isLoading}
        empty="No clients match that search."
      />
    </div>
  );
}
