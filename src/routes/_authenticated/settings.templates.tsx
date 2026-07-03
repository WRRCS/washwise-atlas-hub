import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  listQuoteTemplates, saveQuoteTemplate, deleteQuoteTemplate, duplicateQuoteTemplate,
  listEmailTemplates, saveEmailTemplate, TRIGGER_EVENTS,
  renderTemplate, COMPANY_NAME,
  type QuoteTemplate, type EmailTemplate, type TriggerEvent,
} from "@/lib/templates.functions";
import { listServiceTypes } from "@/lib/entities.functions";

export const Route = createFileRoute("/_authenticated/settings/templates")({
  component: TemplatesPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const SAMPLE_VARS: Record<string, string> = {
  client_name: "Jamie Rivera",
  date: "Saturday, July 4",
  invoice_number: "WRR-2026-042",
  amount: "$180.00",
  service_type: "Residential Cleaning",
  company_name: COMPANY_NAME,
};

const EVENT_LABELS: Record<TriggerEvent, string> = {
  booking_confirmation: "Booking confirmation",
  appointment_reminder: "Appointment reminder",
  invoice_sent: "Invoice sent",
  invoice_overdue: "Invoice overdue",
  job_completed_thankyou: "Job completed — thank you",
  review_request: "Review request",
};

function TemplatesPage() {
  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Quote layouts and client email copy"
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8">
        <Tabs defaultValue="quotes">
          <TabsList>
            <TabsTrigger value="quotes">Quote templates</TabsTrigger>
            <TabsTrigger value="emails">Email templates</TabsTrigger>
          </TabsList>
          <TabsContent value="quotes" className="mt-6"><QuotesTab /></TabsContent>
          <TabsContent value="emails" className="mt-6"><EmailsTab /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ============ QUOTES ============ */

function QuotesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listQuoteTemplates);
  const svcFn = useServerFn(listServiceTypes);
  const saveFn = useServerFn(saveQuoteTemplate);
  const delFn = useServerFn(deleteQuoteTemplate);
  const dupFn = useServerFn(duplicateQuoteTemplate);

  const tpls = useQuery<QuoteTemplate[]>({ queryKey: ["quote-templates"], queryFn: () => listFn() });
  const svcs = useQuery({ queryKey: ["service-types"], queryFn: () => svcFn() });
  const [editing, setEditing] = useState<QuoteTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const svcMap = useMemo(() => {
    const m: Record<string, string> = {};
    (svcs.data ?? []).forEach((s: any) => { m[s.id] = s.name; });
    return m;
  }, [svcs.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["quote-templates"] });

  const onDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try { await delFn({ data: { id } }); toast.success("Deleted"); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const onDup = async (id: string) => {
    try { await dupFn({ data: { id } }); toast.success("Duplicated"); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Header, body, and footer HTML per quote. Set one default per service type.</p>
        <Button className="bg-brand text-brand-foreground hover:opacity-90" onClick={() => setCreating(true)}>
          <Plus className="size-4 mr-1.5" /> New template
        </Button>
      </div>

      {tpls.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <ul className="space-y-2">
          {(tpls.data ?? []).map((t) => (
            <li key={t.id} className="bg-card p-4 rounded-xl ring-1 ring-black/5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {t.service_type_id ? (svcMap[t.service_type_id] ?? "Service") : "General"}
                  </Badge>
                  {t.is_default && <Badge className="text-xs bg-brand/10 text-brand hover:bg-brand/10">Default</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => onDup(t.id)}><Copy className="size-4" /></Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(t.id)}><Trash2 className="size-4" /></Button>
              </div>
            </li>
          ))}
          {(tpls.data ?? []).length === 0 && <p className="text-sm text-muted-foreground p-8 text-center bg-card rounded-xl ring-1 ring-black/5">No templates yet.</p>}
        </ul>
      )}

      {(creating || editing) && (
        <QuoteEditor
          initial={editing}
          services={svcs.data ?? []}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={async (form) => {
            try {
              await saveFn({ data: { id: editing?.id, ...form } });
              toast.success("Saved");
              invalidate();
              setEditing(null);
              setCreating(false);
            } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
          }}
        />
      )}
    </div>
  );
}

function QuoteEditor({ initial, services, onClose, onSave }: {
  initial: QuoteTemplate | null;
  services: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (f: { name: string; service_type_id: string | null; header_html: string; body_html: string; footer_html: string; is_default: boolean }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    service_type_id: initial?.service_type_id ?? "",
    header_html: initial?.header_html ?? "",
    body_html: initial?.body_html ?? "",
    footer_html: initial?.footer_html ?? "",
    is_default: initial?.is_default ?? false,
  });
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => ({
    header: renderTemplate(form.header_html, SAMPLE_VARS),
    body: renderTemplate(form.body_html, SAMPLE_VARS),
    footer: renderTemplate(form.footer_html, SAMPLE_VARS),
  }), [form.header_html, form.body_html, form.footer_html]);

  const scopeLabel = form.service_type_id
    ? services.find((s) => s.id === form.service_type_id)?.name ?? "this service"
    : "General";

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Name required");
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      service_type_id: form.service_type_id || null,
      header_html: form.header_html,
      body_html: form.body_html,
      footer_html: form.footer_html,
      is_default: form.is_default,
    });
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{initial ? "Edit template" : "New quote template"}</DialogTitle></DialogHeader>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Service type</Label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.service_type_id}
                onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}
              >
                <option value="">General (any service)</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Header HTML</Label>
              <Textarea rows={3} value={form.header_html} onChange={(e) => setForm({ ...form, header_html: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Body HTML</Label>
              <Textarea rows={8} value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Footer HTML</Label>
              <Textarea rows={3} value={form.footer_html} onChange={(e) => setForm({ ...form, footer_html: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
              <span>Set as default for <strong>{scopeLabel}</strong></span>
            </label>
            <p className="text-xs text-muted-foreground">
              Variables: {"{{client_name}}"}, {"{{date}}"}, {"{{invoice_number}}"}, {"{{amount}}"}, {"{{service_type}}"}, {"{{company_name}}"}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Live preview</Label>
            <div className="border rounded-lg bg-white p-6 text-sm min-h-[400px] prose prose-sm max-w-none">
              <div dangerouslySetInnerHTML={{ __html: preview.header }} />
              <div dangerouslySetInnerHTML={{ __html: preview.body }} />
              <hr className="my-4" />
              <div className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: preview.footer }} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className="bg-brand text-brand-foreground hover:opacity-90" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ EMAILS ============ */

function EmailsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmailTemplates);
  const saveFn = useServerFn(saveEmailTemplate);

  const tpls = useQuery<EmailTemplate[]>({ queryKey: ["email-templates"], queryFn: () => listFn() });

  const grouped = useMemo(() => {
    const g: Record<TriggerEvent, EmailTemplate[]> = {
      booking_confirmation: [], appointment_reminder: [], invoice_sent: [],
      invoice_overdue: [], job_completed_thankyou: [], review_request: [],
    };
    (tpls.data ?? []).forEach((t) => g[t.trigger_event].push(t));
    return g;
  }, [tpls.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["email-templates"] });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Sent to clients on key events. Toggle inactive to skip an event entirely.</p>
      {TRIGGER_EVENTS.map((ev) => (
        <section key={ev} className="space-y-2">
          <h3 className="text-sm font-medium">{EVENT_LABELS[ev]}</h3>
          {grouped[ev].length === 0 ? (
            <p className="text-xs text-muted-foreground bg-card rounded-lg ring-1 ring-black/5 p-3">No template.</p>
          ) : grouped[ev].map((t) => (
            <EmailTemplateCard key={t.id} tpl={t} onSave={async (patch) => {
              try { await saveFn({ data: { id: t.id, ...patch } }); toast.success("Saved"); invalidate(); }
              catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
            }} />
          ))}
        </section>
      ))}
    </div>
  );
}

function EmailTemplateCard({ tpl, onSave }: {
  tpl: EmailTemplate;
  onSave: (patch: { subject?: string; body_html?: string; is_active?: boolean; name?: string }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body_html);
  const [name, setName] = useState(tpl.name);
  const dirty = subject !== tpl.subject || body !== tpl.body_html || name !== tpl.name;

  const preview = useMemo(() => ({
    subject: renderTemplate(subject, SAMPLE_VARS),
    body: renderTemplate(body, SAMPLE_VARS),
  }), [subject, body]);

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5">
      <div className="flex items-center justify-between p-4 gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{tpl.name}</p>
          <p className="text-xs text-muted-foreground truncate">{tpl.subject}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={tpl.is_active} onCheckedChange={(v) => onSave({ is_active: v })} />
            <span>{tpl.is_active ? "Active" : "Off"}</span>
          </label>
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Close" : "Edit"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t p-4 grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Body HTML</Label>
              <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Variables: {"{{client_name}}"}, {"{{date}}"}, {"{{invoice_number}}"}, {"{{amount}}"}, {"{{service_type}}"}, {"{{company_name}}"}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setSubject(tpl.subject); setBody(tpl.body_html); setName(tpl.name); }}>
                Reset
              </Button>
              <Button
                size="sm" disabled={!dirty}
                className="bg-brand text-brand-foreground hover:opacity-90"
                onClick={() => onSave({ subject, body_html: body, name })}
              >Save</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preview (with sample data)</Label>
            <div className="border rounded-lg bg-white p-4 text-sm">
              <p className="font-medium mb-2 text-sm">{preview.subject}</p>
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.body }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
