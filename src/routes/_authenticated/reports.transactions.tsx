import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportTransactions, type TransactionRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, RangeBar, ReportTable, fmtDate, fmtMoney, useDateRange } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/transactions")({
  component: TransactionsReport,
});

function TransactionsReport() {
  const { from, to, setRange } = useDateRange(1);
  const [q, setQ] = useState("");
  const fetchRows = useServerFn(reportTransactions);
  const query = useQuery<TransactionRow[]>({
    queryKey: ["report-transactions", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) =>
      [r.client_name, r.invoice_number, r.method, r.status].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [query.data, q]);

  const paid = rows.filter((r) => r.kind === "payment").reduce((s, r) => s + Math.abs(r.amount_cents), 0);
  const invoiced = rows.filter((r) => r.kind === "invoice").reduce((s, r) => s + r.amount_cents, 0);

  const columns: Column<TransactionRow>[] = [
    { key: "client", header: "Client", cell: (r) => r.client_name ?? "—", csv: (r) => r.client_name },
    { key: "date", header: "Date", cell: (r) => fmtDate(r.occurred_on), csv: (r) => r.occurred_on },
    { key: "type", header: "Type", cell: (r) => (r.kind === "payment" ? "Payment" : "Invoice"), csv: (r) => r.kind },
    {
      key: "amount", header: "Total $", align: "right",
      cell: (r) => <span className={r.amount_cents < 0 ? "text-emerald-600" : ""}>{fmtMoney(r.amount_cents)}</span>,
      csv: (r) => (r.amount_cents / 100).toFixed(2),
    },
    { key: "method", header: "Method", cell: (r) => r.method ?? "—", csv: (r) => r.method },
    {
      key: "invoice", header: "Invoice",
      cell: (r) => r.invoice_id
        ? <Link to="/invoices/$invoiceId" params={{ invoiceId: r.invoice_id }} className="text-brand hover:underline">{r.invoice_number ?? "View"}</Link>
        : "—",
      csv: (r) => r.invoice_number,
    },
    { key: "status", header: "Status", cell: (r) => r.status ?? "—", csv: (r) => r.status },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <RangeBar from={from} to={to} onChange={(p) => setRange((prev) => ({ ...prev, ...p }))}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, invoice #, method…" className="h-8 w-64" />
      </RangeBar>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Invoiced" value={fmtMoney(invoiced)} />
        <Kpi label="Paid or deposited" value={fmtMoney(paid)} tone="good" />
        <Kpi label="Balance" value={fmtMoney(invoiced - paid)} tone={invoiced - paid > 0 ? "bad" : undefined} />
      </div>

      <ReportTable
        title="Transaction list"
        rows={rows}
        columns={columns}
        filename={`transactions-${from}-to-${to}.csv`}
        loading={query.isLoading}
      />
    </div>
  );
}
