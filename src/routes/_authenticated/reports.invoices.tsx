import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportInvoices, type InvoiceReportRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, RangeBar, ReportTable, fmtDate, fmtMoney, useDateRange } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/invoices")({
  component: InvoicesReport,
});

const STATUSES = ["all", "draft", "sent", "overdue", "paid", "cancelled"] as const;

function InvoicesReport() {
  const { from, to, setRange } = useDateRange(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const fetchRows = useServerFn(reportInvoices);
  const query = useQuery<InvoiceReportRow[]>({
    queryKey: ["report-invoices", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!needle) return true;
      return [r.client_name, r.number, r.client_email, r.client_phone].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [all, q, status]);

  const issued = rows.reduce((s, r) => s + r.total_cents, 0);
  const collected = rows.reduce((s, r) => s + r.paid_cents, 0);
  const cpniHidden = all.length > 0 && all.every((r) => r.client_email === null);

  const columns: Column<InvoiceReportRow>[] = [
    {
      key: "num", header: "Invoice #",
      cell: (r) => <Link to="/invoices/$invoiceId" params={{ invoiceId: r.id }} className="text-brand hover:underline">{r.number ?? "—"}</Link>,
      csv: (r) => r.number,
    },
    {
      key: "client", header: "Client",
      cell: (r) => r.client_id
        ? <Link to="/reports/client/$clientId" params={{ clientId: r.client_id }} className="hover:underline">{r.client_name}</Link>
        : (r.client_name ?? "—"),
      csv: (r) => r.client_name,
    },
    { key: "email", header: "Client email", cell: (r) => r.client_email ?? "—", csv: (r) => r.client_email },
    { key: "phone", header: "Client phone", cell: (r) => r.client_phone ?? "—", csv: (r) => r.client_phone },
    { key: "status", header: "Status", cell: (r) => <StatusChip status={r.status} />, csv: (r) => r.status },
    { key: "total", header: "Total $", align: "right", cell: (r) => fmtMoney(r.total_cents), csv: (r) => (r.total_cents / 100).toFixed(2) },
    { key: "paid", header: "Paid $", align: "right", cell: (r) => fmtMoney(r.paid_cents), csv: (r) => (r.paid_cents / 100).toFixed(2) },
    { key: "issued", header: "Issued", cell: (r) => fmtDate(r.issue_date), csv: (r) => r.issue_date },
    { key: "due", header: "Due", cell: (r) => fmtDate(r.due_date), csv: (r) => r.due_date },
    { key: "billing", header: "Billing address", cell: (r) => r.billing_address ?? "—", csv: (r) => r.billing_address },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <RangeBar from={from} to={to} onChange={(p) => setRange((prev) => ({ ...prev, ...p }))}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or invoice #…" className="h-8 w-56" />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
      </RangeBar>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Invoices issued" value={fmtMoney(issued)} />
        <Kpi label="Payments collected" value={fmtMoney(collected)} tone="good" />
        <Kpi label="Outstanding" value={fmtMoney(issued - collected)} tone={issued - collected > 0 ? "bad" : undefined} />
      </div>

      {cpniHidden ? (
        <p className="text-xs text-muted-foreground">
          Client contact details are hidden — they require owner access or the client-CPNI permission.
        </p>
      ) : null}

      <ReportTable
        title="Invoices"
        rows={rows}
        columns={columns}
        filename={`invoices-${from}-to-${to}.csv`}
        loading={query.isLoading}
      />
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "paid" ? "bg-emerald-100 text-emerald-700"
    : status === "overdue" ? "bg-red-100 text-red-700"
    : status === "sent" ? "bg-amber-100 text-amber-700"
    : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${tone}`}>{status}</span>;
}
