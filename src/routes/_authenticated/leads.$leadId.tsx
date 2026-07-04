import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getLead, updateLeadStatus, convertLeadToClient, type LeadStatus } from "@/lib/leads.functions";
import { ArrowLeft, Check, UserCheck, Phone, Mail, MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leads/$leadId")({
  component: LeadDetailPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-brand/15 text-brand" },
  contacted: { label: "Contacted", className: "bg-warning/15 text-warning" },
  qualified: { label: "Qualified", className: "bg-blue-100 text-blue-800" },
  won: { label: "Won", className: "bg-success/15 text-success" },
  lost: { label: "Lost", className: "bg-muted text-muted-foreground" },
};

function fullName(c: { first_name: string | null; last_name: string | null } | null | undefined) {
  if (!c) return "Unknown";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getFn = useServerFn(getLead);
  const updateFn = useServerFn(updateLeadStatus);
  const convertFn = useServerFn(convertLeadToClient);

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => getFn({ data: { id: leadId } }),
  });

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const applyStatus = async (status: LeadStatus) => {
    setBusy(true);
    try {
      await updateFn({ data: { id: leadId, status, note: note || undefined } });
      toast.success(`Marked ${status}`);
      setNote("");
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["new-leads-count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const convert = async () => {
    setBusy(true);
    try {
      const r = await convertFn({ data: { id: leadId } });
      toast.success("Converted to client");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["new-leads-count"] });
      if (r.client_id) {
        navigate({ to: "/clients/$clientId", params: { clientId: r.client_id } });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!lead) return <div className="p-8 text-sm text-muted-foreground">Lead not found.</div>;

  const client = lead.client as any;
  const status = lead.status as LeadStatus;
  const payload = (lead.payload as Record<string, unknown> | null) ?? {};
  const timeline: { label: string; content: string }[] = [];
  if (lead.notes) {
    for (const entry of String(lead.notes).split(/\n\n+/)) {
      timeline.push({ label: "Note", content: entry });
    }
  }

  return (
    <>
      <PageHeader
        title={fullName(client)}
        subtitle={`Lead from ${lead.source} · ${STATUS_META[status].label}`}
        action={
          <Link to="/leads" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="size-4" /> Back
          </Link>
        }
      />
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-6">
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Contact</p>
            <p className="font-medium">{fullName(client)}</p>
            {client?.email && <p className="text-sm text-muted-foreground flex items-center gap-2"><Mail className="size-3.5" />{client.email}</p>}
            {client?.phone && <p className="text-sm text-muted-foreground flex items-center gap-2"><Phone className="size-3.5" />{client.phone}</p>}
            {client?.service_address && <p className="text-sm text-muted-foreground flex items-start gap-2"><MapPin className="size-3.5 mt-0.5" />{client.service_address}</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Received</p>
            <p className="text-sm">{format(new Date(lead.created_at), "PPp")}</p>
            {lead.service_interest && (<>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-3">Service interest</p>
              <p className="text-sm">{lead.service_interest}</p>
            </>)}
            {lead.last_contacted_at && (<>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-3">Last contacted</p>
              <p className="text-sm">{format(new Date(lead.last_contacted_at), "PPp")}</p>
            </>)}
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Update status</h3>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_META[status].className}`}>
              {STATUS_META[status].label}
            </span>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note about this interaction…"
            rows={2}
            maxLength={1000}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || status === "contacted"} onClick={() => applyStatus("contacted")}>Contacted</Button>
            <Button variant="outline" disabled={busy || status === "qualified"} onClick={() => applyStatus("qualified")}>Qualified</Button>
            <Button variant="outline" disabled={busy || status === "lost"} onClick={() => applyStatus("lost")}>Lost</Button>
            <div className="flex-1" />
            {status !== "won" && (
              <Button onClick={convert} disabled={busy} className="bg-brand text-brand-foreground hover:opacity-90">
                <UserCheck className="size-4 mr-1.5" /> Convert to Client
              </Button>
            )}
            {status === "won" && lead.client_id && (
              <Button asChild variant="outline">
                <Link to="/clients/$clientId" params={{ clientId: lead.client_id }}>
                  <Check className="size-4 mr-1.5" /> View Client
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-3">
          <h3 className="text-sm font-semibold">Timeline</h3>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">{format(new Date(lead.created_at), "MMM d, p")}</span>
              <span>Lead received from {lead.source}</span>
            </li>
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-xs text-muted-foreground w-24 shrink-0">{t.label}</span>
                <span className="whitespace-pre-wrap">{t.content}</span>
              </li>
            ))}
          </ol>
        </div>

        {Object.keys(payload).length > 0 && (
          <details className="bg-card rounded-xl ring-1 ring-black/5 p-6">
            <summary className="text-sm font-semibold cursor-pointer">Raw submission</summary>
            <pre className="mt-3 text-xs text-muted-foreground overflow-x-auto">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </>
  );
}
