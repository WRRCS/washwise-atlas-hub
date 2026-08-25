import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { reportClientAccount, type ClientAccount } from "@/lib/owner-reports.functions";
import { Kpi, fmtDate, fmtMoney } from "@/components/report-ui";

export const Route = createFileRoute("/_authenticated/reports/client/$clientId")({
  component: ClientAccountPage,
});

const TABS = ["Appointments", "Billing", "SOP & access", "Communications"] as const;

function ClientAccountPage() {
  const { clientId } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Appointments");
  const fetchAccount = useServerFn(reportClientAccount);
  const { data, isLoading, error } = useQuery<ClientAccount>({
    queryKey: ["report-client-account", clientId],
    queryFn: () => fetchAccount({ data: { client_id: clientId } }),
  });

  if (isLoading) return <div className="max-w-7xl mx-auto px-6 py-10 text-muted-foreground">Loading client account…</div>;
  if (error) return <div className="max-w-7xl mx-auto px-6 py-10 text-destructive">{(error as Error).message}</div>;
  if (!data) return <div className="max-w-7xl mx-auto px-6 py-10">Client not found.</div>;

  const c = data.client;

  return (
    <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Link to="/reports/clients" className="text-xs text-muted-foreground hover:underline">← All client accounts</Link>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {c.service_address ?? "No service address"} · client since {fmtDate(c.created_at)}
          </p>
        </div>
        <div className="ml-auto rounded-lg border border-border/60 bg-card p-3 text-sm">
          {c.cpni_visible ? (
            <div className="space-y-0.5">
              <div>{c.email ?? "No email"}</div>
              <div>{c.phone ?? "No phone"}</div>
              <div className="text-muted-foreground">{c.billing_address ?? "No billing address"}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">Contact details restricted to owners</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Jobs" value={String(data.totals.jobs_count)} />
        <Kpi label="Invoiced" value={fmtMoney(data.totals.invoiced_cents)} />
        <Kpi label="Paid" value={fmtMoney(data.totals.paid_cents)} tone="good" />
        <Kpi label="Outstanding" value={fmtMoney(data.totals.outstanding_cents)} tone={data.totals.outstanding_cents > 0 ? "bad" : undefined} />
      </div>

      <div className="flex gap-1 border-b border-border/60">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Appointments" && (
        <Card title="Appointment history">
          <List
            rows={data.jobs}
            empty="No appointments yet."
            render={(j) => (
              <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }} className="flex flex-wrap items-center gap-3 py-2 hover:bg-muted/40 px-1 rounded">
                <span className="w-40 text-sm">{fmtDate(j.scheduled_start)}</span>
                <span className="flex-1 text-sm">{j.service_name ?? "Service"}</span>
                <span className="text-xs text-muted-foreground">{j.crew || "Unassigned"}</span>
                <span className="text-xs capitalize rounded-full bg-muted px-2 py-0.5">{j.status}</span>
                <span className="w-24 text-right text-sm tabular-nums">{fmtMoney(j.price_cents)}</span>
              </Link>
            )}
          />
        </Card>
      )}

      {tab === "Billing" && (
        <div className="space-y-5">
          <Card title="Invoices">
            <List
              rows={data.invoices}
              empty="No invoices yet."
              render={(i) => (
                <Link key={i.id} to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="flex flex-wrap items-center gap-3 py-2 hover:bg-muted/40 px-1 rounded">
                  <span className="w-32 text-sm font-medium">{i.number ?? "—"}</span>
                  <span className="w-32 text-sm">{fmtDate(i.issue_date)}</span>
                  <span className="flex-1 text-xs capitalize rounded-full bg-muted px-2 py-0.5 inline-block max-w-max">{i.status}</span>
                  <span className="text-xs text-muted-foreground">Due {fmtDate(i.due_date)}</span>
                  <span className="w-24 text-right text-sm tabular-nums">{fmtMoney(i.total_cents)}</span>
                </Link>
              )}
            />
          </Card>
          <Card title="Payments">
            <List
              rows={data.payments}
              empty="No payments recorded."
              render={(p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 py-2 px-1">
                  <span className="w-32 text-sm">{fmtDate(p.processed_at)}</span>
                  <span className="w-28 text-sm capitalize">{p.provider}</span>
                  <span className="flex-1 text-sm text-muted-foreground">{p.invoice_number ?? ""} {p.note ?? ""}</span>
                  <span className="text-xs capitalize">{p.status}</span>
                  <span className="w-24 text-right text-sm tabular-nums">{fmtMoney(p.amount_cents)}</span>
                </div>
              )}
            />
          </Card>
        </div>
      )}

      {tab === "SOP & access" && (
        <div className="space-y-5">
          <Card title="Client SOP">
            {data.sop ? (
              <pre className="whitespace-pre-wrap text-sm font-sans">{data.sop}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No SOP recorded for this client.</p>
            )}
          </Card>
          <Card title="Properties">
            <List
              rows={data.properties}
              empty="No properties on file."
              render={(p) => (
                <div key={p.id} className="py-2 px-1">
                  <div className="text-sm font-medium">{p.label || "Property"} {p.is_primary ? <span className="text-xs text-muted-foreground">(primary)</span> : null}</div>
                  <div className="text-sm text-muted-foreground">{p.address ?? "—"}</div>
                  {p.notes ? <div className="text-xs text-muted-foreground mt-0.5">{p.notes}</div> : null}
                </div>
              )}
            />
          </Card>
          <Card title="Notes">
            <List
              rows={data.notes}
              empty="No notes."
              render={(n) => (
                <div key={n.id} className="py-2 px-1">
                  <div className="text-xs text-muted-foreground">{fmtDate(n.created_at)}</div>
                  <div className="text-sm">{n.note}</div>
                </div>
              )}
            />
          </Card>
        </div>
      )}

      {tab === "Communications" && (
        <Card title="Communication history">
          <List
            rows={data.communications}
            empty="No communications logged."
            render={(m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 py-2 px-1">
                <span className="w-32 text-sm">{fmtDate(m.at)}</span>
                <span className="w-20 text-sm capitalize">{m.channel}</span>
                <span className="w-20 text-xs capitalize text-muted-foreground">{m.direction}</span>
                <span className="flex-1 text-sm">{m.subject ?? "—"}</span>
                <span className="text-xs capitalize text-muted-foreground">{m.status ?? ""}</span>
              </div>
            )}
          />
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="border-b border-border/60 px-4 py-3 text-sm font-semibold">{title}</header>
      <div className="px-4 py-2">{children}</div>
    </section>
  );
}

function List<T>({ rows, render, empty }: { rows: T[]; render: (row: T, i: number) => React.ReactNode; empty: string }) {
  if (!rows?.length) return <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
  return <div className="divide-y divide-border/40">{rows.map((r, i) => render(r, i))}</div>;
}
