import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getClient, updateClient, deleteClient, myCapabilities,
  upsertPropertySpec,
  addClientNote, deleteClientNote, setClientNoteVisibility,
  createPhotoUploadUrl, registerClientPhoto, deleteClientPhoto,
} from "@/lib/entities.functions";
import { listClientProperties, upsertClientProperty, deleteClientProperty, type ClientProperty } from "@/lib/client-properties.functions";
import { getClientSummary, listClientJobs } from "@/lib/client-page.functions";
import { listInvoices } from "@/lib/invoices.functions";
import { listQuoteTemplates, listEmailTemplates, getClientPreference, setClientQuotePreference, sendClientEmail, renderTemplate, COMPANY_NAME } from "@/lib/templates.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ChevronDown, ChevronRight, FileText, Lock, Mail, MapPin, MessageSquare, Plus, Star, Trash2, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  component: ClientDetail,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function money(cents: number | null | undefined) {
  return `$${(((cents ?? 0)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ClientDetail() {
  const { clientId } = useParams({ from: "/_authenticated/clients/$clientId" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchFn = useServerFn(getClient);
  const delFn = useServerFn(deleteClient);
  const capsFn = useServerFn(myCapabilities);

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchFn({ data: { id: clientId } }),
  });
  const capsQ = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const isManagement = !!(capsQ.data?.isOwner || capsQ.data?.canManage);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!client) return <div className="p-8">Client not found.</div>;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client", clientId] });
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";

  const onDelete = async () => {
    if (!confirm(`Delete ${name}? This removes their notes, photos, and property specs.`)) return;
    try {
      await delFn({ data: { id: clientId } });
      toast.success("Client deleted");
      qc.invalidateQueries({ queryKey: ["clients"] });
      navigate({ to: "/clients" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title={name}
        subtitle={client.is_active ? "Current client" : "Previous client"}
        action={
          <div className="flex gap-2">
            <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-2">
              <ArrowLeft className="size-4" /> Back
            </Link>
            {client.phone && (
              <Link
                to="/messages"
                search={{ clientId: client.id, phone: client.phone, name }}
                className="inline-flex items-center gap-1.5 text-sm border border-input rounded-lg px-3 py-2 hover:bg-clay-100"
              >
                <MessageSquare className="size-4" /> Message client
              </Link>
            )}
            {isManagement && (
              <Button variant="outline" onClick={onDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="size-4 mr-1.5" /> Delete
              </Button>
            )}
          </div>
        }
      />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-6">
        <Tabs defaultValue="overview">
          <TabsList className="sticky top-0 z-10">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-4">
            <OverviewTab client={client} clientId={clientId} isManagement={isManagement} onSaved={invalidate} />
          </TabsContent>
          <TabsContent value="properties" className="mt-6">
            <PropertiesTab clientId={clientId} spec={client.spec} onSpecSaved={invalidate} />
          </TabsContent>
          <TabsContent value="jobs" className="mt-6">
            <JobsTab clientId={clientId} />
          </TabsContent>
          <TabsContent value="invoices" className="mt-6">
            <InvoicesTab clientId={clientId} />
          </TabsContent>
          <TabsContent value="notes" className="mt-6">
            <NotesTab clientId={clientId} notes={client.notes} onChanged={invalidate} isManagement={isManagement} />
          </TabsContent>
          <TabsContent value="documents" className="mt-6">
            <DocumentsTab clientId={clientId} photos={client.photos} onChanged={invalidate} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ---------------- Overview ---------------- */

type ClientRecord = {
  id: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null;
  billing_address: string | null; service_address: string | null;
  is_active: boolean; created_at?: string;
  client_sop?: string | null;
  spec?: Spec;
  notes: Array<{ id: string; note: string; created_at: string; author: string | null; visibility?: string | null; property_id?: string | null; job_id?: string | null }>;
  photos: Array<{ id: string; storage_path: string; caption: string | null; uploaded_at: string; url: string | null }>;
};

function OverviewTab({ client, clientId, isManagement, onSaved }: {
  client: ClientRecord; clientId: string; isManagement: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const summaryFn = useServerFn(getClientSummary);
  const { data: summary } = useQuery({
    queryKey: ["client-summary", clientId],
    queryFn: () => summaryFn({ data: { client_id: clientId } }),
  });
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";

  if (editing) {
    return <ProfileForm client={client} onSaved={() => { setEditing(false); onSaved(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active properties" value={summary ? String(summary.active_properties) : "—"} />
        <StatCard
          label="Next service"
          value={summary?.next_job ? format(new Date(summary.next_job.scheduled_start), "MMM d") : "None scheduled"}
          hint={summary?.next_job?.property ?? summary?.next_job?.service ?? undefined}
        />
        <StatCard
          label="Most recent service"
          value={summary?.last_job ? format(new Date(summary.last_job.scheduled_start), "MMM d") : "—"}
          hint={summary?.last_job?.property ?? summary?.last_job?.service ?? undefined}
        />
        <StatCard
          label="Outstanding balance"
          value={summary ? money(summary.outstanding_cents) : "—"}
          hint={summary ? `${summary.open_invoices} open invoice${summary.open_invoices === 1 ? "" : "s"}` : undefined}
        />
      </div>

      <div className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Client information</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit client</Button>
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Info label="Client name" value={name} />
          <Info label="Status" value={client.is_active ? "Current" : "Previous client"} />
          <Info label="Service address" value={client.service_address} />
          <Info label="Client since" value={client.created_at ? format(new Date(client.created_at), "PP") : null} />
        </dl>
      </div>

      <div className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-4 border-l-4 border-brand">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-brand" />
          <h3 className="text-sm font-medium">Private client information</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Management only</span>
        </div>
        {isManagement ? (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Info label="Email" value={client.email} />
            <Info label="Phone" value={client.phone} />
            <Info label="Billing address" value={client.billing_address} />
            <Info label="Preferred contact" value={client.email ? "Email" : client.phone ? "Phone" : null} />
            <div className="md:col-span-2">
              <Info label="Internal SOP / access notes" value={client.client_sop ?? client.spec?.access_notes ?? null} />
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Contact details and private notes for this client are restricted to management.
          </p>
        )}
      </div>

      <div className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-3">
        <h3 className="text-sm font-medium">Recent requests</h3>
        {!summary?.requests.length ? (
          <p className="text-sm text-muted-foreground">No requests from this client yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {summary.requests.map((r) => (
              <li key={r.id} className="py-2.5 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate">{r.notes || "Service request"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.requested_date ? `Requested for ${format(new Date(r.requested_date), "PP")} · ` : ""}
                    {format(new Date(r.created_at), "PP")}
                  </p>
                </div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isManagement && <ClientTemplatesCard client={client} />}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card p-4 rounded-xl ring-1 ring-black/5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
      {hint && <p className="text-xs text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || "—"}</dd>
    </div>
  );
}

/* ---------------- Edit client ---------------- */

function ProfileForm({ client, onSaved, onCancel }: {
  client: ClientRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const update = useServerFn(updateClient);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: client.first_name ?? "",
    last_name: client.last_name ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    billing_address: client.billing_address ?? "",
    service_address: client.service_address ?? "",
    is_active: client.is_active,
    client_sop: client.client_sop ?? "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim()) return toast.error("First name required");
    setSaving(true);
    try {
      await update({
        data: {
          id: client.id,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          billing_address: form.billing_address.trim() || undefined,
          service_address: form.service_address.trim() || undefined,
          is_active: form.is_active,
          client_sop: form.client_sop.trim(),
        },
      });
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldRow label="First name *"><Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required /></FieldRow>
        <FieldRow label="Last name"><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></FieldRow>
        <FieldRow label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FieldRow>
        <FieldRow label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FieldRow>
      </div>
      <FieldRow label="Service address"><Textarea rows={2} value={form.service_address} onChange={(e) => setForm({ ...form, service_address: e.target.value })} /></FieldRow>
      <FieldRow label="Billing address"><Textarea rows={2} value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></FieldRow>
      <div>
        <FieldRow label="Client-specific SOP (staff-only, shown on job view)">
          <Textarea
            rows={4}
            value={form.client_sop}
            onChange={(e) => setForm({ ...form, client_sop: e.target.value })}
            placeholder="e.g. Microfiber cloths only, no bleach products. Feed the cat before leaving."
          />
        </FieldRow>
        <p className="text-[11px] text-muted-foreground mt-1">
          Never shown to the client in the portal. Displayed to assigned staff on the job detail view.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        Current client
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------- Property specs ---------------- */

type Spec = {
  square_footage: number | null; bedrooms: number | null; bathrooms: number | null;
  key_location: string | null; access_notes: string | null; pets: string | null;
  parking_notes: string | null; special_instructions: string | null;
} | null;

function SpecsForm({ clientId, spec, onSaved }: { clientId: string; spec: Spec; onSaved: () => void }) {
  const upsert = useServerFn(upsertPropertySpec);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    square_footage: spec?.square_footage?.toString() ?? "",
    bedrooms: spec?.bedrooms?.toString() ?? "",
    bathrooms: spec?.bathrooms?.toString() ?? "",
    key_location: spec?.key_location ?? "",
    access_notes: spec?.access_notes ?? "",
    pets: spec?.pets ?? "",
    parking_notes: spec?.parking_notes ?? "",
    special_instructions: spec?.special_instructions ?? "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await upsert({
        data: {
          client_id: clientId,
          square_footage: form.square_footage ? Number(form.square_footage) : null,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
          key_location: form.key_location || undefined,
          access_notes: form.access_notes || undefined,
          pets: form.pets || undefined,
          parking_notes: form.parking_notes || undefined,
          special_instructions: form.special_instructions || undefined,
        },
      });
      toast.success("Specs saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <FieldRow label="Sq. ft."><Input type="number" min={0} value={form.square_footage} onChange={(e) => setForm({ ...form, square_footage: e.target.value })} /></FieldRow>
        <FieldRow label="Bedrooms"><Input type="number" min={0} value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></FieldRow>
        <FieldRow label="Bathrooms"><Input type="number" step="0.5" min={0} value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></FieldRow>
      </div>
      <FieldRow label="Door / key access"><Input value={form.key_location} onChange={(e) => setForm({ ...form, key_location: e.target.value })} /></FieldRow>
      <FieldRow label="Access notes"><Textarea rows={2} value={form.access_notes} onChange={(e) => setForm({ ...form, access_notes: e.target.value })} /></FieldRow>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldRow label="Pets"><Input value={form.pets} onChange={(e) => setForm({ ...form, pets: e.target.value })} /></FieldRow>
        <FieldRow label="Parking instructions"><Input value={form.parking_notes} onChange={(e) => setForm({ ...form, parking_notes: e.target.value })} /></FieldRow>
      </div>
      <FieldRow label="Cleaning instructions / rooms included or excluded">
        <Textarea rows={4} value={form.special_instructions} onChange={(e) => setForm({ ...form, special_instructions: e.target.value })} />
      </FieldRow>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
          {saving ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------- Notes ---------------- */

const VIS_LABEL: Record<string, string> = {
  management: "Management only",
  team: "Team access",
  client: "Client visible",
};

function NotesTab({ clientId, notes, onChanged, isManagement }: {
  clientId: string;
  notes: ClientRecord["notes"];
  onChanged: () => void;
  isManagement: boolean;
}) {
  const add = useServerFn(addClientNote);
  const del = useServerFn(deleteClientNote);
  const setVis = useServerFn(setClientNoteVisibility);
  const listProps = useServerFn(listClientProperties);
  const listJobsFn = useServerFn(listClientJobs);
  const { data: props = [] } = useQuery({
    queryKey: ["client-properties", clientId],
    queryFn: () => listProps({ data: { client_id: clientId } }),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["client-jobs", clientId],
    queryFn: () => listJobsFn({ data: { client_id: clientId } }),
  });
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"management" | "team" | "client">("management");
  const [attach, setAttach] = useState("");
  const [saving, setSaving] = useState(false);

  const visible = isManagement ? notes : notes.filter((n) => (n.visibility ?? "management") !== "management");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      const property_id = attach.startsWith("p:") ? attach.slice(2) : null;
      const job_id = attach.startsWith("j:") ? attach.slice(2) : null;
      await add({ data: { client_id: clientId, note: text.trim(), visibility, property_id, job_id } });
      setText("");
      setAttach("");
      setVisibility("management");
      toast.success("Note added");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    try {
      await del({ data: { id } });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const changeVis = async (id: string, v: string) => {
    try {
      await setVis({ data: { id, visibility: v as "management" | "team" | "client" } });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const label = (n: ClientRecord["notes"][number]) => {
    if (n.property_id) return props.find((p) => p.id === n.property_id)?.label ?? "Property";
    if (n.job_id) {
      const j = jobs.find((x) => x.id === n.job_id);
      return j ? `${format(new Date(j.scheduled_start), "PP")} job` : "Job";
    }
    return "Whole client";
  };

  return (
    <div className="space-y-4">
      {isManagement && (
        <form onSubmit={submit} className="bg-card p-4 rounded-xl ring-1 ring-black/5 space-y-3">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note about this client…" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldRow label="Applies to">
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={attach} onChange={(e) => setAttach(e.target.value)}>
                <option value="">Entire client</option>
                <optgroup label="Property">
                  {props.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.label}</option>)}
                </optgroup>
                <optgroup label="Job">
                  {jobs.slice(0, 25).map((j) => (
                    <option key={j.id} value={`j:${j.id}`}>
                      {format(new Date(j.scheduled_start), "PP")} · {j.service?.name ?? "Job"}
                    </option>
                  ))}
                </optgroup>
              </select>
            </FieldRow>
            <FieldRow label="Who can see this">
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={visibility} onChange={(e) => setVisibility(e.target.value as never)}>
                <option value="management">Internal — management only</option>
                <option value="team">Team access</option>
                <option value="client">Client visible</option>
              </select>
            </FieldRow>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={saving || !text.trim()} className="bg-brand text-brand-foreground hover:opacity-90">
              {saving ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>
      )}

      {visible.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl ring-1 ring-black/5">No notes yet.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <li key={n.id} className="bg-card p-4 rounded-xl ring-1 ring-black/5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-clay-100 text-muted-foreground">{label(n)}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                  <Lock className="size-3" /> {VIS_LABEL[n.visibility ?? "management"]}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{n.note}</p>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{n.author ?? "Unknown"} · {format(new Date(n.created_at), "PP p")}</span>
                {isManagement && (
                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={n.visibility ?? "management"}
                      onChange={(e) => changeVis(n.id, e.target.value)}
                    >
                      <option value="management">Management only</option>
                      <option value="team">Team access</option>
                      <option value="client">Client visible</option>
                    </select>
                    <button onClick={() => remove(n.id)} className="text-destructive hover:underline">Delete</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Jobs ---------------- */

function JobsTab({ clientId }: { clientId: string }) {
  const listFn = useServerFn(listClientJobs);
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["client-jobs", clientId],
    queryFn: () => listFn({ data: { client_id: clientId } }),
  });
  const [filter, setFilter] = useState<"upcoming" | "completed" | "cancelled" | "all">("upcoming");

  const rows = useMemo(() => {
    const now = Date.now();
    return jobs.filter((j) => {
      const cancelled = ["canceled", "cancelled"].includes(String(j.status));
      if (filter === "cancelled") return cancelled;
      if (cancelled) return filter === "all";
      if (filter === "completed") return j.status === "completed" || new Date(j.scheduled_start).getTime() < now;
      if (filter === "upcoming") return j.status !== "completed" && new Date(j.scheduled_start).getTime() >= now;
      return true;
    });
  }, [jobs, filter]);

  const duration = (j: (typeof jobs)[number]) => {
    const mins = (new Date(j.scheduled_end).getTime() - new Date(j.scheduled_start).getTime()) / 60000;
    return `${Math.round(mins)} min`;
  };
  const actual = (j: (typeof jobs)[number]) => {
    if (!j.actual_start || !j.actual_end) return "—";
    const mins = (new Date(j.actual_end).getTime() - new Date(j.actual_start).getTime()) / 60000;
    return `${Math.round(mins)} min`;
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg ring-1 ring-black/5 bg-card p-1 text-sm">
        {([["upcoming", "Upcoming"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-md transition-colors ${filter === v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No jobs in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-clay-100/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Property</th>
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Team</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Scheduled</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Actual</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-t border-border/60 hover:bg-clay-100/40">
                  <td className="px-4 py-3">
                    <Link to="/jobs/$jobId" params={{ jobId: j.id }} className="font-medium hover:text-brand">
                      {format(new Date(j.scheduled_start), "PP p")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{j.property?.label ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{j.service?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {j.assignees.map((a) => a.full_name).filter(Boolean).join(", ") || "Unassigned"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{duration(j)}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{actual(j)}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{String(j.status).replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------------- Invoices ---------------- */

function InvoicesTab({ clientId }: { clientId: string }) {
  const listFn = useServerFn(listInvoices);
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["client-invoices", clientId],
    queryFn: () => listFn({ data: { client_id: clientId } }),
  });

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
      {isLoading ? (
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">No invoices for this client yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-clay-100/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Invoice</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Due</th>
              <th className="text-left px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv: any) => {
              const total = inv.total_cents ?? inv.amount_cents ?? 0;
              const settled = ["paid", "void", "cancelled"].includes(String(inv.status));
              return (
                <tr key={inv.id} className="border-t border-border/60 hover:bg-clay-100/40">
                  <td className="px-4 py-3">
                    <Link to="/invoices/$invoiceId" params={{ invoiceId: inv.id }} className="font-medium hover:text-brand">
                      {inv.number ?? "Draft"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.issue_date ? format(new Date(inv.issue_date), "PP") : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{inv.due_date ? format(new Date(inv.due_date), "PP") : "—"}</td>
                  <td className="px-4 py-3">{money(total)}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{inv.status}</td>
                  <td className="px-4 py-3">{settled ? money(0) : money(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Documents ---------------- */

function DocumentsTab({ clientId, photos, onChanged }: {
  clientId: string;
  photos: ClientRecord["photos"];
  onChanged: () => void;
}) {
  const getUrl = useServerFn(createPhotoUploadUrl);
  const register = useServerFn(registerClientPhoto);
  const del = useServerFn(deleteClientPhoto);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { path, token } = await getUrl({
        data: { client_id: clientId, file_name: file.name, content_type: file.type },
      });
      const { error } = await supabase.storage.from("client-photos").uploadToSignedUrl(path, token, file, {
        contentType: file.type,
      });
      if (error) throw error;
      await register({ data: { client_id: clientId, storage_path: path, caption: caption || undefined } });
      setCaption("");
      toast.success("File uploaded");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this file?")) return;
    try {
      await del({ data: { id } });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card p-4 rounded-xl ring-1 ring-black/5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4" /> Client documents & photos</div>
        <p className="text-xs text-muted-foreground">
          Agreements, checklists, property documents and photos. Image uploads are stored now; other file types will attach here as document storage expands.
        </p>
        <FieldRow label="Label (optional)">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Service agreement, key photo, checklist…" />
        </FieldRow>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90">
            <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload file"}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl ring-1 ring-black/5">No documents yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map((p) => (
            <div key={p.id} className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden group">
              {p.url ? (
                <img src={p.url} alt={p.caption ?? "Client document"} className="w-full aspect-square object-cover" />
              ) : (
                <div className="aspect-square bg-clay-100 grid place-items-center text-xs text-muted-foreground">No preview</div>
              )}
              <div className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs truncate">{p.caption ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">{format(new Date(p.uploaded_at), "PP")}</p>
                </div>
                <button onClick={() => remove(p.id)} className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Delete file">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/* ---------------- Templates & email ---------------- */

function ClientTemplatesCard({ client }: { client: { id: string; first_name: string | null; last_name: string | null; email: string | null } }) {
  const qc = useQueryClient();
  const listQuotes = useServerFn(listQuoteTemplates);
  const listEmails = useServerFn(listEmailTemplates);
  const getPref = useServerFn(getClientPreference);
  const setPref = useServerFn(setClientQuotePreference);
  const sendFn = useServerFn(sendClientEmail);

  const { data: quotes } = useQuery({ queryKey: ["quote-templates"], queryFn: () => listQuotes() });
  const { data: emails } = useQuery({ queryKey: ["email-templates"], queryFn: () => listEmails() });
  const { data: pref } = useQuery({ queryKey: ["client-pref", client.id], queryFn: () => getPref({ data: { client_id: client.id } }) });

  const [selectedEmail, setSelectedEmail] = useState<string>("");
  const active = (emails ?? []).filter((e) => e.is_active);
  const chosen = active.find((e) => e.id === selectedEmail);
  const clientName = [client.first_name, client.last_name].filter(Boolean).join(" ") || "there";
  const preview = chosen ? {
    subject: renderTemplate(chosen.subject, { client_name: clientName, company_name: COMPANY_NAME, date: new Date().toLocaleDateString() }),
    body: renderTemplate(chosen.body_html, { client_name: clientName, company_name: COMPANY_NAME, date: new Date().toLocaleDateString() }),
  } : null;

  const onPref = async (val: string) => {
    try {
      await setPref({ data: { client_id: client.id, quote_template_id: val || null } });
      toast.success("Preference saved");
      qc.invalidateQueries({ queryKey: ["client-pref", client.id] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const onSend = async () => {
    if (!selectedEmail) return toast.error("Pick a template");
    if (!client.email) return toast.error("Client has no email on file");
    try {
      await sendFn({ data: { client_id: client.id, template_id: selectedEmail } });
      toast.success("Email queued");
      setSelectedEmail("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-5">
      <div>
        <h3 className="text-sm font-medium mb-2">Preferred quote template</h3>
        <select
          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={pref?.quote_template_id ?? ""}
          onChange={(e) => onPref(e.target.value)}
        >
          <option value="">Use default for the service type</option>
          {(quotes ?? []).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Mail className="size-4" /> Send a custom email</h3>
        <select
          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mb-3"
          value={selectedEmail}
          onChange={(e) => setSelectedEmail(e.target.value)}
        >
          <option value="">Pick a template…</option>
          {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {preview && (
          <div className="border rounded-lg bg-white p-3 mb-3 text-sm">
            <p className="font-medium mb-2">{preview.subject}</p>
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.body }} />
          </div>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={onSend} disabled={!selectedEmail} className="bg-brand text-brand-foreground hover:opacity-90">
            Send to {client.email ?? "client"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Properties ---------------- */

function PropertiesTab({ clientId, spec, onSpecSaved }: { clientId: string; spec: Spec; onSpecSaved: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listClientProperties);
  const upsertFn = useServerFn(upsertClientProperty);
  const deleteFn = useServerFn(deleteClientProperty);
  const jobsFn = useServerFn(listClientJobs);
  const { data: props = [], isLoading } = useQuery({
    queryKey: ["client-properties", clientId],
    queryFn: () => listFn({ data: { client_id: clientId } }),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["client-jobs", clientId],
    queryFn: () => jobsFn({ data: { client_id: clientId } }),
  });
  const [editing, setEditing] = useState<ClientProperty | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const empty = { label: "", address: "", notes: "", is_primary: false, property_type: "", service_frequency: "" };
  const [form, setForm] = useState(empty);

  const startAdd = () => { setForm(empty); setEditing(null); setAdding(true); };
  const startEdit = (p: ClientProperty) => {
    setEditing(p);
    setForm({
      label: p.label, address: p.address, notes: p.notes ?? "", is_primary: p.is_primary,
      property_type: p.property_type ?? "", service_frequency: p.service_frequency ?? "",
    });
    setAdding(true);
  };
  const cancel = () => { setAdding(false); setEditing(null); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-properties", clientId] });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim() || !form.address.trim()) {
      toast.error("Name and address are required");
      return;
    }
    try {
      await upsertFn({
        data: {
          id: editing?.id,
          client_id: clientId,
          label: form.label.trim(),
          address: form.address.trim(),
          notes: form.notes.trim() || undefined,
          is_primary: form.is_primary,
          property_type: form.property_type.trim() || undefined,
          service_frequency: form.service_frequency.trim() || undefined,
        },
      });
      toast.success(editing ? "Property updated" : "Property added");
      invalidate();
      cancel();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const remove = async (p: ClientProperty) => {
    if (!confirm(`Delete property "${p.label}"?`)) return;
    try {
      await deleteFn({ data: { id: p.id } });
      toast.success("Property deleted");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const nextFor = (propertyId: string) => {
    const now = Date.now();
    return [...jobs]
      .filter((j) => j.property?.id === propertyId && new Date(j.scheduled_start).getTime() >= now)
      .sort((a, b) => +new Date(a.scheduled_start) - +new Date(b.scheduled_start))[0];
  };
  const historyFor = (propertyId: string) =>
    jobs.filter((j) => j.property?.id === propertyId && new Date(j.scheduled_start).getTime() < Date.now()).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Properties / locations</h3>
          <p className="text-xs text-muted-foreground">Every property below belongs to this same client record.</p>
        </div>
        {!adding && (
          <Button size="sm" onClick={startAdd} className="bg-brand text-brand-foreground hover:opacity-90">
            <Plus className="size-4 mr-1.5" /> Add property/location
          </Button>
        )}
      </div>

      {adding && (
        <form onSubmit={save} className="bg-card p-4 rounded-xl ring-1 ring-black/5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldRow label="Property name *">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Petticote, Beach Bum, Home…" />
            </FieldRow>
            <FieldRow label="Property type">
              <Input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="Residence, Airbnb, Office…" />
            </FieldRow>
            <FieldRow label="Service frequency">
              <Input value={form.service_frequency} onChange={(e) => setForm({ ...form, service_frequency: e.target.value })} placeholder="Weekly, bi-weekly, monthly…" />
            </FieldRow>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
                Primary location
              </label>
            </div>
          </div>
          <FieldRow label="Service address *">
            <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </FieldRow>
          <FieldRow label="Property notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Door code, parking, rooms excluded…" />
          </FieldRow>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cancel}>Cancel</Button>
            <Button type="submit" size="sm" className="bg-brand text-brand-foreground hover:opacity-90">
              {editing ? "Save" : "Add property"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : props.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl ring-1 ring-black/5">
          No properties yet. Add one to schedule jobs at a specific address.
        </div>
      ) : (
        <div className="bg-card rounded-xl ring-1 ring-black/5 divide-y divide-border/60">
          {props.map((p) => {
            const open = openId === p.id;
            const next = nextFor(p.id);
            return (
              <div key={p.id}>
                <div className="p-4 flex items-start justify-between gap-3">
                  <button className="flex items-start gap-3 min-w-0 text-left" onClick={() => setOpenId(open ? null : p.id)}>
                    {open ? <ChevronDown className="size-4 mt-0.5 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 mt-0.5 text-muted-foreground shrink-0" />}
                    <MapPin className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.label}</span>
                        {p.property_type && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.property_type}</span>}
                        {p.is_primary && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand">
                            <Star className="size-3" /> Primary
                          </span>
                        )}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.is_active ? "Active" : "Inactive"}</span>
                      </div>
                      <div className="text-sm text-muted-foreground truncate">{p.address}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.service_frequency ? `${p.service_frequency} · ` : ""}
                        {next ? `Next service ${format(new Date(next.scheduled_start), "PP p")}` : "No upcoming service"}
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEdit(p)}>Edit</Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => remove(p)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="px-4 pb-5 space-y-5 bg-clay-100/30">
                    {p.notes && (
                      <div className="text-sm">
                        <p className="text-xs text-muted-foreground mb-1">Property notes</p>
                        <p className="whitespace-pre-wrap">{p.notes}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Access, parking & cleaning instructions</p>
                      <SpecsForm clientId={clientId} spec={spec} onSaved={onSpecSaved} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Recent service history</p>
                      {historyFor(p.id).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No completed visits yet.</p>
                      ) : (
                        <ul className="text-sm space-y-1">
                          {historyFor(p.id).map((j) => (
                            <li key={j.id}>
                              <Link to="/jobs/$jobId" params={{ jobId: j.id }} className="hover:text-brand">
                                {format(new Date(j.scheduled_start), "PP")} · {j.service?.name ?? "Service"} · {String(j.status)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
