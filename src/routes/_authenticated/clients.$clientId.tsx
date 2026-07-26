import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getClient, updateClient, deleteClient,
  upsertPropertySpec,
  addClientNote, deleteClientNote,
  createPhotoUploadUrl, registerClientPhoto, deleteClientPhoto,
} from "@/lib/entities.functions";
import { listQuoteTemplates, listEmailTemplates, getClientPreference, setClientQuotePreference, sendClientEmail, renderTemplate, COMPANY_NAME } from "@/lib/templates.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Mail, MessageSquare, Trash2, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  component: ClientDetail,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function ClientDetail() {
  const { clientId } = useParams({ from: "/_authenticated/clients/$clientId" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchFn = useServerFn(getClient);
  const delFn = useServerFn(deleteClient);

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchFn({ data: { id: clientId } }),
  });

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
        subtitle={client.email ?? client.phone ?? "—"}
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
            <Button variant="outline" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="size-4 mr-1.5" /> Delete
            </Button>
          </div>
        }
      />
      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6">
        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="specs">Property Specs</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-6 space-y-4">
            <ProfileTab client={client} onSaved={invalidate} />
            <ClientTemplatesCard client={client} />
          </TabsContent>
          <TabsContent value="specs" className="mt-6">
            <SpecsTab clientId={clientId} spec={client.spec} onSaved={invalidate} />
          </TabsContent>
          <TabsContent value="notes" className="mt-6">
            <NotesTab clientId={clientId} notes={client.notes} onChanged={invalidate} />
          </TabsContent>
          <TabsContent value="photos" className="mt-6">
            <PhotosTab clientId={clientId} photos={client.photos} onChanged={invalidate} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ---------------- Profile ---------------- */

function ProfileTab({ client, onSaved }: {
  client: {
    id: string; first_name: string | null; last_name: string | null;
    email: string | null; phone: string | null;
    billing_address: string | null; service_address: string | null;
    is_active: boolean;
  };
  onSaved: () => void;
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
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        Active
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------- Specs ---------------- */

type Spec = {
  square_footage: number | null; bedrooms: number | null; bathrooms: number | null;
  key_location: string | null; access_notes: string | null; pets: string | null;
  parking_notes: string | null; special_instructions: string | null;
} | null;

function SpecsTab({ clientId, spec, onSaved }: { clientId: string; spec: Spec; onSaved: () => void }) {
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
    <form onSubmit={submit} className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <FieldRow label="Sq. ft."><Input type="number" min={0} value={form.square_footage} onChange={(e) => setForm({ ...form, square_footage: e.target.value })} /></FieldRow>
        <FieldRow label="Bedrooms"><Input type="number" min={0} value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></FieldRow>
        <FieldRow label="Bathrooms"><Input type="number" step="0.5" min={0} value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></FieldRow>
      </div>
      <FieldRow label="Key location"><Input value={form.key_location} onChange={(e) => setForm({ ...form, key_location: e.target.value })} /></FieldRow>
      <FieldRow label="Access notes"><Textarea rows={2} value={form.access_notes} onChange={(e) => setForm({ ...form, access_notes: e.target.value })} /></FieldRow>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldRow label="Pets"><Input value={form.pets} onChange={(e) => setForm({ ...form, pets: e.target.value })} /></FieldRow>
        <FieldRow label="Parking"><Input value={form.parking_notes} onChange={(e) => setForm({ ...form, parking_notes: e.target.value })} /></FieldRow>
      </div>
      <FieldRow label="Special instructions"><Textarea rows={4} value={form.special_instructions} onChange={(e) => setForm({ ...form, special_instructions: e.target.value })} /></FieldRow>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
          {saving ? "Saving…" : "Save specs"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------- Notes ---------------- */

function NotesTab({ clientId, notes, onChanged }: {
  clientId: string;
  notes: Array<{ id: string; note: string; created_at: string; author: string | null }>;
  onChanged: () => void;
}) {
  const add = useServerFn(addClientNote);
  const del = useServerFn(deleteClientNote);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await add({ data: { client_id: clientId, note: text.trim() } });
      setText("");
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

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="bg-card p-4 rounded-xl ring-1 ring-black/5 space-y-2">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note about this client…" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !text.trim()} className="bg-brand text-brand-foreground hover:opacity-90">
            {saving ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl ring-1 ring-black/5">No notes yet.</div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="bg-card p-4 rounded-xl ring-1 ring-black/5">
              <p className="text-sm whitespace-pre-wrap">{n.note}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{n.author ?? "Unknown"} · {format(new Date(n.created_at), "PP p")}</span>
                <button onClick={() => remove(n.id)} className="text-destructive hover:underline">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Photos ---------------- */

function PhotosTab({ clientId, photos, onChanged }: {
  clientId: string;
  photos: Array<{ id: string; storage_path: string; caption: string | null; uploaded_at: string; url: string | null }>;
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
      toast.success("Photo uploaded");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this photo?")) return;
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
        <FieldRow label="Caption (optional)">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Kitchen before, key hiding spot, etc." />
        </FieldRow>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90">
            <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload photo"}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl ring-1 ring-black/5">No photos yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map((p) => (
            <div key={p.id} className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden group">
              {p.url ? (
                <img src={p.url} alt={p.caption ?? ""} className="w-full aspect-square object-cover" />
              ) : (
                <div className="aspect-square bg-clay-100 grid place-items-center text-xs text-muted-foreground">No preview</div>
              )}
              <div className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs truncate">{p.caption ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">{format(new Date(p.uploaded_at), "PP")}</p>
                </div>
                <button onClick={() => remove(p.id)} className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
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
