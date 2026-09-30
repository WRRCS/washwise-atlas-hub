import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { LogLeadDialog } from "@/components/log-lead-dialog";
import {
  listLeads,
  leadSourceLabel,
  type LeadRow,
  type LeadStatus,
} from "@/lib/leads.functions";
import { Inbox, Mail, Phone, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads | WRRCS.com" },
      { name: "description", content: "Prospective cleaning clients from Airbnb, phone, text, your website and referrals." },
      { property: "og:title", content: "Leads | WRRCS.com" },
      { property: "og:description", content: "Every prospect in one pipeline, from first message to booked job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{(error as Error).message}</div>,
});

const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-brand/15 text-brand" },
  contacted: { label: "Contacted", className: "bg-warning/15 text-warning" },
  qualified: { label: "Qualified", className: "bg-blue-100 text-blue-800" },
  won: { label: "Won", className: "bg-success/15 text-success" },
  lost: { label: "Lost", className: "bg-muted text-muted-foreground" },
};

type Filter = "all" | "needs_reply" | LeadStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_reply", label: "Needs a reply" },
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

function LeadsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listLeads);
  const [filter, setFilter] = useState<Filter>("all");
  const [days, setDays] = useState<number | null>(null);
  const [source, setSource] = useState<string>("all");

  const { data: leads = [], isLoading } = useQuery<LeadRow[]>({
    queryKey: ["leads", "all"],
    queryFn: () => listFn({ data: {} }),
  });

  const sources = Array.from(new Set(leads.map((l) => l.source))).sort();
  const needsReplyCount = leads.filter((l) => l.needs_reply).length;

  const filtered = leads.filter((l) => {
    if (filter === "needs_reply") return l.needs_reply;
    if (filter !== "all" && l.status !== filter) return false;
    return true;
  });
  const shown = filtered.filter((l) => {
    if (days) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      if (new Date(l.created_at).getTime() < cutoff) return false;
    }
    return source === "all" || l.source === source;
  });

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Everyone who has asked about a clean — from Airbnb, phone, text, your website or a referral"
        action={
          <LogLeadDialog onSaved={() => queryClient.invalidateQueries({ queryKey: ["leads"] })}>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90"
            >
              <UserPlus className="size-4" /> Log a lead
            </button>
          </LogLeadDialog>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filter === f.key
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border hover:bg-clay-100"
              }`}
            >
              {f.label}
              {f.key === "needs_reply" && needsReplyCount > 0 && (
                <span className="ml-1.5 rounded-full bg-brand text-brand-foreground px-1.5 text-[10px] font-medium">
                  {needsReplyCount}
                </span>
              )}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="text-xs rounded-lg border border-input bg-background px-2 py-1.5"
            >
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {leadSourceLabel(s)}
                </option>
              ))}
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
          ) : shown.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="size-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {leads.length === 0
                  ? "No leads yet. Use “Log a lead” above the moment someone calls, texts or messages you about a clean."
                  : "Nothing matches this filter."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-clay-100/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">What they want</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Received</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => navigate({ to: "/leads/$leadId", params: { leadId: l.id } })}
                    className="hover:bg-clay-100/40 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium">
                      {l.client_name}
                      {l.needs_reply && (
                        <span className="ml-2 inline-block align-middle rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                          Needs a reply
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {l.client_email && (
                        <div className="flex items-center gap-1">
                          <Mail className="size-3 shrink-0" />
                          <span className="break-all">{l.client_email}</span>
                        </div>
                      )}
                      {l.client_phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="size-3 shrink-0" />
                          {l.client_phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {l.service_interest ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {leadSourceLabel(l.source)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_META[l.status].className}`}
                      >
                        {STATUS_META[l.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {l.assigned_to_name ?? "Unassigned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Website submissions from your booking form land here automatically too — see{" "}
          <Link to="/settings/integrations" className="text-brand hover:underline">
            Settings → Integrations
          </Link>
          .
        </p>
      </div>
    </>
  );
}
