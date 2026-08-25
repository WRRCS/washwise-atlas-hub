import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { reportCommunications, type CommunicationRow } from "@/lib/owner-reports.functions";
import { Column, Kpi, RangeBar, ReportTable, fmtDate, useDateRange } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/communications")({
  component: CommunicationsReport,
});

function CommunicationsReport() {
  const { from, to, setRange } = useDateRange(1);
  const [q, setQ] = useState("");
  const fetchRows = useServerFn(reportCommunications);
  const query = useQuery<CommunicationRow[]>({
    queryKey: ["report-communications", from, to],
    queryFn: () => fetchRows({ data: { from, to } }),
  });

  const all = query.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) => [r.client_name, r.channel, r.subject, r.status].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [all, q]);

  const count = (ch: string) => rows.filter((r) => r.channel === ch).length;
  const delivered = rows.filter((r) => r.status === "sent" || r.status === "delivered").length;

  const columns: Column<CommunicationRow>[] = [
    { key: "client", header: "Client", cell: (r) => r.client_name ?? "—", csv: (r) => r.client_name },
    { key: "channel", header: "Type", cell: (r) => <span className="capitalize">{r.channel}</span>, csv: (r) => r.channel },
    { key: "dir", header: "Direction", cell: (r) => <span className="capitalize">{r.direction}</span>, csv: (r) => r.direction },
    { key: "subject", header: "Subject / preview", cell: (r) => r.subject ?? "—", csv: (r) => r.subject },
    { key: "status", header: "Status", cell: (r) => <span className="capitalize">{r.status ?? "—"}</span>, csv: (r) => r.status },
    { key: "at", header: "Date", cell: (r) => fmtDate(r.occurred_at), csv: (r) => r.occurred_at },
  ];

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
      <RangeBar from={from} to={to} onChange={(p) => setRange((prev) => ({ ...prev, ...p }))}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or subject…" className="h-8 w-64" />
      </RangeBar>

      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Emails" value={String(count("email"))} />
        <Kpi label="Texts" value={String(count("sms"))} />
        <Kpi label="App messages" value={String(count("portal"))} />
        <Kpi label="Sent / delivered" value={String(delivered)} tone="good" />
      </div>

      <ReportTable
        title="Client communications"
        rows={rows}
        columns={columns}
        filename={`communications-${from}-to-${to}.csv`}
        loading={query.isLoading}
      />
    </div>
  );
}
