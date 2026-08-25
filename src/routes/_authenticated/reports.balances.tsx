import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportClientBalances, type ClientBalanceRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, ReportTable, fmtDate, fmtMoney } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/balances")({
  component: BalancesReport,
});

function BalancesReport() {
  const [q, setQ] = useState("");
  const [onlyOwing, setOnlyOwing] = useState(false);
  const fetchRows = useServerFn(reportClientBalances);
  const query = useQuery<ClientBalanceRow[]>({
    queryKey: ["report-client-balances"],
    queryFn: () => fetchRows(),
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (onlyOwing && r.balance_cents <= 0) return false;
      if (!needle) return true;
      return [r.client_name, r.email, r.phone].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [all, q, onlyOwing]);

  const outstanding = rows.reduce((s, r) => s + r.balance_cents, 0);
  const late = rows.reduce((s, r) => s + r.late_balance_cents, 0);
  const paid = rows.reduce((s, r) => s + r.paid_cents, 0);

  const columns: Column<ClientBalanceRow>[] = [
    {
      key: "name", header: "Name",
      cell: (r) => <Link to="/reports/client/$clientId" params={{ clientId: r.client_id }} className="text-brand hover:underline">{r.client_name}</Link>,
      csv: (r) => r.client_name,
    },
    { key: "email", header: "Email", cell: (r) => r.email ?? "—", csv: (r) => r.email },
    { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", csv: (r) => r.phone },
    { key: "invoiced", header: "Invoiced $", align: "right", cell: (r) => fmtMoney(r.invoiced_cents), csv: (r) => (r.invoiced_cents / 100).toFixed(2) },
    { key: "paid", header: "Paid to date $", align: "right", cell: (r) => fmtMoney(r.paid_cents), csv: (r) => (r.paid_cents / 100).toFixed(2) },
    {
      key: "balance", header: "Balance $", align: "right",
      cell: (r) => <span className={r.balance_cents > 0 ? "text-destructive font-medium" : ""}>{fmtMoney(r.balance_cents)}</span>,
      csv: (r) => (r.balance_cents / 100).toFixed(2),
    },
    { key: "late", header: "Late balance $", align: "right", cell: (r) => fmtMoney(r.late_balance_cents), csv: (r) => (r.late_balance_cents / 100).toFixed(2) },
    { key: "days", header: "Payment time (days)", align: "right", cell: (r) => (r.avg_payment_days ? r.avg_payment_days.toFixed(1) : "—"), csv: (r) => r.avg_payment_days },
    { key: "last", header: "Last invoice", cell: (r) => fmtDate(r.last_invoice_date), csv: (r) => r.last_invoice_date },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="h-8 w-64" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyOwing} onChange={(e) => setOnlyOwing(e.target.checked)} />
          Only clients with a balance
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Outstanding" value={fmtMoney(outstanding)} tone={outstanding > 0 ? "bad" : undefined} />
        <Kpi label="Overdue" value={fmtMoney(late)} tone={late > 0 ? "bad" : undefined} />
        <Kpi label="Collected (lifetime)" value={fmtMoney(paid)} tone="good" />
      </div>

      <ReportTable
        title="Client balance summary"
        rows={rows}
        columns={columns}
        filename="client-balances.csv"
        loading={query.isLoading}
        empty="No clients yet."
      />
    </div>
  );
}
