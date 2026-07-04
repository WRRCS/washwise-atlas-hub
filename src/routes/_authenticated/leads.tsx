import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listLeads, type LeadRow, type LeadStatus } from "@/lib/leads.functions";
import { Inbox, Mail, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leads")({
  component: LeadsPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-brand/15 text-brand" },
  contacted: { label: "Contacted", className: "bg-warning/15 text-warning" },
  qualified: { label: "Qualified", className: "bg-blue-100 text-blue-800" },
  won: { label: "Won", className: "bg-success/15 text-success" },
  lost: { label: "Lost", className: "bg-muted text-muted-foreground" },
};

function LeadsPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(listLeads);
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [days, setDays] = useState<number | null>(null);

  const { data: leads = [], isLoading } = useQuery<LeadRow[]>({
    queryKey: ["leads", status, days],
    queryFn: () => listFn({ data: { status: status === "all" ? null : status, days } }),
  });

  const sources = Array.from(new Set(leads.map((l) => l.source))).sort();
  const [source, setSource] = useState<string | "all">("all");
  const filtered = leads.filter((l) => source === "all" || l.source === source);

  return (
    <>
      <PageHeader title="Leads" subtitle="Website submissions and prospective clients" />
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["all","new","contacted","qualified","won","lost"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors ${
                status === s ? "border-brand bg-brand/5 text-brand" : "border-border hover:bg-clay-100"
              }`}
            >{s === "all" ? "All" : STATUS_META[s].label}</button>
          ))}
          <div className="ml-auto flex gap-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="text-xs rounded-lg border border-input bg-background px-2 py-1.5"
            >
              <option value="all">All sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={days ?? ""}
              onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
              className="text-xs rounded-lg border border-input bg-background px-2 py-1.5"
            >
              <option value="">Any date</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="size-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No leads yet. Configure your website form under <Link to="/settings/integrations" className="text-brand hover:underline">Settings → Integrations</Link>.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-clay-100/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Service interest</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Received</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => navigate({ to: "/leads/$leadId", params: { leadId: l.id } })}
                    className="hover:bg-clay-100/40 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium">{l.client_name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {l.client_email && <div className="flex items-center gap-1"><Mail className="size-3" />{l.client_email}</div>}
                      {l.client_phone && <div className="flex items-center gap-1"><Phone className="size-3" />{l.client_phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">{l.service_interest ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{l.source}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_META[l.status].className}`}>
                        {STATUS_META[l.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{l.assigned_to_name ?? "Unassigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
