import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, Trash2, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listClients } from "@/lib/entities.functions";
import { listClientProperties } from "@/lib/client-properties.functions";
import { createInvoice, updateInvoice, getInvoiceEditorDefaults } from "@/lib/invoices.functions";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import { PAYMENT_TERMS, termsLabel, dueDateFrom } from "@/lib/payment-terms";

export type EditorLine = {
  description: string;
  details: string;
  quantity: number;
  unitPriceStr: string;
  service_date: string;
};

export type InvoiceEditorInitial = {
  id?: string;
  number?: string;
  client_id: string;
  property_id: string | null;
  subject: string;
  issue_date: string;
  payment_terms_days: number;
  discount_cents: number;
  tax_rate_bp: number;
  client_message: string;
  terms_text: string;
  allow_card: boolean;
  allow_venmo: boolean;
  card_surcharge: boolean;
  line_items: EditorLine[];
};

/** Job-linked lines created automatically when a job is completed. Shown
 *  read-only in the editor; their hours stay managed from the invoice page. */
export type LockedLine = {
  description: string;
  details: string | null;
  line_total_cents: number;
  service_date: string | null;
  hours: number | null;
};

const emptyLine = (): EditorLine => ({ description: "", details: "", quantity: 1, unitPriceStr: "", service_date: "" });

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function InvoiceEditor({ initial, lockedLines = [], onCancel }: { initial?: InvoiceEditorInitial; lockedLines?: LockedLine[]; onCancel: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const clientsFn = useServerFn(listClients);
  const propsFn = useServerFn(listClientProperties);
  const defaultsFn = useServerFn(getInvoiceEditorDefaults);
  const createFn = useServerFn(createInvoice);
  const updateFn = useServerFn(updateInvoice);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const { data: defaults } = useQuery({
    queryKey: ["invoice-editor-defaults"],
    queryFn: () => defaultsFn({}),
    enabled: !initial,
  });

  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "For Services Rendered");
  const [issueDate, setIssueDate] = useState(initial?.issue_date ?? todayISO());
  const [termsDays, setTermsDays] = useState(initial?.payment_terms_days ?? 14);
  const [lines, setLines] = useState<EditorLine[]>(initial ? initial.line_items : [emptyLine()]);
  const [discountStr, setDiscountStr] = useState(initial ? (initial.discount_cents / 100).toFixed(2) : "");
  const [taxRateStr, setTaxRateStr] = useState(initial ? (initial.tax_rate_bp / 100).toString() : "");
  const [message, setMessage] = useState(initial?.client_message ?? "");
  const [terms, setTerms] = useState(initial?.terms_text ?? "");
  const [allowCard, setAllowCard] = useState(initial?.allow_card ?? true);
  const [allowVenmo, setAllowVenmo] = useState(initial?.allow_venmo ?? true);
  const [cardSurcharge, setCardSurcharge] = useState(initial?.card_surcharge ?? false);
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Apply reusable business defaults on the create form once they load.
  useEffect(() => {
    if (initial || !defaults) return;
    setTermsDays(defaults.payment_terms_days ?? 14);
    if (defaults.invoice_message_default) setMessage(defaults.invoice_message_default);
    if (defaults.invoice_terms_default) setTerms(defaults.invoice_terms_default);
  }, [defaults, initial]);

  const { data: properties = [] } = useQuery({
    queryKey: ["client-properties", clientId],
    queryFn: () => propsFn({ data: { client_id: clientId } }),
    enabled: !!clientId,
  });

  const selectedClient = clients.find((c: any) => c.id === clientId) ?? null;
  const selectedProperty = properties.find((p) => p.id === propertyId) ?? null;
  const dueDate = dueDateFrom(issueDate, termsDays);

  const discountCents = Math.round((parseFloat(discountStr) || 0) * 100);
  const taxRateBp = Math.round((parseFloat(taxRateStr) || 0) * 100);
  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        [
          ...lockedLines.map((l) => ({ quantity: 1, unit_price_cents: l.line_total_cents })),
          ...lines.map((l) => ({ quantity: l.quantity || 0, unit_price_cents: Math.round((parseFloat(l.unitPriceStr) || 0) * 100) })),
        ],
        discountCents,
        taxRateBp,
        cardSurcharge,
      ),
    [lines, lockedLines, discountCents, taxRateBp, cardSurcharge],
  );

  const setLine = (i: number, patch: Partial<EditorLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const payload = () => ({
    client_id: clientId,
    property_id: propertyId || null,
    subject: subject.trim() || "For Services Rendered",
    issue_date: issueDate,
    payment_terms_days: termsDays,
    discount_cents: discountCents,
    tax_rate_bp: taxRateBp,
    client_message: message,
    terms_text: terms,
    allow_card: allowCard,
    allow_venmo: allowVenmo,
    card_surcharge: cardSurcharge,
    line_items: lines.map((l) => ({
      description: l.description.trim(),
      details: l.details.trim() || undefined,
      quantity: l.quantity,
      unit_price_cents: Math.round((parseFloat(l.unitPriceStr) || 0) * 100),
      service_date: l.service_date || null,
    })),
    save_defaults: saveDefaults,
  });

  const save = async (thenSend: boolean) => {
    if (!clientId) { toast.error("Select a client"); return; }
    if (!lines.length && !lockedLines.length) { toast.error("Add at least one line item"); return; }
    if (lines.some((l) => !l.description.trim())) { toast.error("Each line item needs a name"); return; }
    setSaving(true);
    try {
      const data = payload();
      const id = initial?.id
        ? (await updateFn({ data: { id: initial.id, ...data } }), initial.id)
        : (await createFn({ data })).id;
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      await qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("Invoice saved");
      if (thenSend) {
        navigate({ to: "/invoices/$invoiceId", params: { invoiceId: id }, search: { send: true } });
      } else {
        navigate({ to: "/invoices/$invoiceId", params: { invoiceId: id }, search: {} });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const defaultsDiffer =
    !!defaults &&
    (message !== (defaults.invoice_message_default ?? "") || terms !== (defaults.invoice_terms_default ?? ""));

  return (
    <div className="space-y-6">
      {/* Top: subject + two-column client / meta */}
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="inv-subject">Invoice subject</Label>
          <Input id="inv-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="For Services Rendered" className="text-lg font-medium" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Bill to</Label>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setPropertyId(""); }} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select client…</option>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(" ")}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Service property</Label>
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!clientId} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">{clientId ? "Client's billing address" : "Pick a client first"}</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.address.replace(/\n/g, ", ")}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Where the work happened, if different from the billing address.</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Invoice number</Label>
                <Input value={initial?.number ?? "Assigned on save"} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-issued">Issued</Label>
                <Input id="inv-issued" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment terms</Label>
                <select value={String(termsDays)} onChange={(e) => setTermsDays(Number(e.target.value))} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  {PAYMENT_TERMS.map((t) => <option key={t.days} value={t.days}>{t.label}</option>)}
                  {!PAYMENT_TERMS.some((t) => t.days === termsDays) && <option value={termsDays}>{termsLabel(termsDays)}</option>}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input value={dueDate} readOnly disabled />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
        <h3 className="text-sm font-semibold">Products / Services</h3>
        <div className="space-y-4">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg ring-1 ring-border/60 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_90px_120px_120px_40px] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>Item</Label>
                  <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Airbnb Turnover" />
                </div>
                <div className="space-y-1.5">
                  <Label>Qty</Label>
                  <Input type="number" min={1} step={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit price ($)</Label>
                  <Input type="number" min={0} step="0.01" value={l.unitPriceStr} onChange={(e) => setLine(i, { unitPriceStr: e.target.value })} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Line total</Label>
                  <p className="h-9 flex items-center justify-end text-sm font-medium tabular-nums">
                    {money(Math.round((l.quantity || 0) * (parseFloat(l.unitPriceStr) || 0) * 100))}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove line item" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
                <Input value={l.details} onChange={(e) => setLine(i, { details: e.target.value })} placeholder="Description (optional) — shown beneath the item" />
                <div className="space-y-0">
                  <Input type="date" value={l.service_date} onChange={(e) => setLine(i, { service_date: e.target.value })} aria-label="Service date" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          <Plus className="size-4 mr-1.5" /> Add line item
        </Button>

        {/* Totals */}
        <div className="ml-auto max-w-xs space-y-1.5 text-sm pt-2 border-t border-border/40">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(totals.subtotal_cents)}</span></div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-muted-foreground">Discount ($)</span>
            <Input type="number" min={0} step="0.01" value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} className="w-28 h-8 text-right" placeholder="0.00" />
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-muted-foreground">Tax (%)</span>
            <Input type="number" min={0} max={100} step="0.01" value={taxRateStr} onChange={(e) => setTaxRateStr(e.target.value)} className="w-28 h-8 text-right" placeholder="0" />
          </div>
          {totals.tax_cents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax amount</span><span className="tabular-nums">{money(totals.tax_cents)}</span></div>}
          {cardSurcharge && <div className="flex justify-between"><span className="text-muted-foreground">Card surcharge</span><span className="tabular-nums">{money(totals.surcharge_cents)}</span></div>}
          <div className="flex justify-between font-semibold text-base pt-1 border-t border-border/40"><span>Total</span><span className="tabular-nums">{money(totals.total_cents)}</span></div>
        </div>
      </div>

      {/* Payment options — only what the existing integrations support */}
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-3">
        <h3 className="text-sm font-semibold">Payment options for this invoice</h3>
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Switch id="ed-allow-card" checked={allowCard} onCheckedChange={setAllowCard} />
            <Label htmlFor="ed-allow-card" className="text-sm">Card payment link</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ed-allow-venmo" checked={allowVenmo} onCheckedChange={setAllowVenmo} />
            <Label htmlFor="ed-allow-venmo" className="text-sm">Venmo</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ed-surcharge" checked={cardSurcharge} onCheckedChange={setCardSurcharge} disabled={!allowCard} />
            <Label htmlFor="ed-surcharge" className="text-sm">Card surcharge <span className="text-muted-foreground">(3% + $0.30)</span></Label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">These choices apply only to this invoice and don't change account-wide settings.</p>
      </div>

      {/* Message + terms */}
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-message">Client message</Label>
          <Textarea id="inv-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Thank you for your business!" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-terms">Contract / Disclaimer</Label>
          <Textarea id="inv-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, cancellation policy…" />
        </div>
        {!initial && defaultsDiffer && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={saveDefaults} onChange={(e) => setSaveDefaults(e.target.checked)} className="size-3.5" />
            Save these as the business defaults for future invoices
          </label>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          <Eye className="size-4 mr-1.5" /> Client preview
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="button" variant="outline" onClick={() => save(false)} disabled={saving}>{saving ? "…" : "Save draft"}</Button>
          <Button type="button" onClick={() => save(true)} disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
            {saving ? "…" : "Save & send"}
          </Button>
        </div>
      </div>

      <ClientPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        subject={subject}
        number={initial?.number ?? "Draft"}
        clientName={selectedClient ? [selectedClient.first_name, selectedClient.last_name].filter(Boolean).join(" ") : "—"}
        propertyAddress={selectedProperty ? `${selectedProperty.label} — ${selectedProperty.address}` : null}
        issueDate={issueDate}
        dueDate={dueDate}
        termsLabel={termsLabel(termsDays)}
        lines={lines}
        totals={totals}
        discountCents={discountCents}
        message={message}
        terms={terms}
        allowCard={allowCard}
        allowVenmo={allowVenmo}
      />
    </div>
  );
}

function ClientPreview(props: {
  open: boolean;
  onClose: () => void;
  subject: string;
  number: string;
  clientName: string;
  propertyAddress: string | null;
  issueDate: string;
  dueDate: string;
  termsLabel: string;
  lines: EditorLine[];
  totals: ReturnType<typeof computeInvoiceTotals>;
  discountCents: number;
  message: string;
  terms: string;
  allowCard: boolean;
  allowVenmo: boolean;
}) {
  const { totals } = props;
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Client preview</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          <div>
            <p className="text-lg font-semibold">Wash Rinse Repeat Cleaning</p>
            <p className="text-muted-foreground">{props.subject}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Bill to</p>
              <p className="font-medium">{props.clientName}</p>
              {props.propertyAddress && <p className="text-muted-foreground">{props.propertyAddress}</p>}
            </div>
            <div className="text-right">
              <p>Invoice {props.number}</p>
              <p className="text-muted-foreground">Issued {props.issueDate} · Due {props.dueDate} ({props.termsLabel})</p>
            </div>
          </div>
          <table className="w-full">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-1 font-medium">Item</th>
                <th className="text-right py-1 font-medium">Qty</th>
                <th className="text-right py-1 font-medium">Unit</th>
                <th className="text-right py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {props.lines.map((l, i) => (
                <tr key={i} className="border-t border-border/40 align-top">
                  <td className="py-2">
                    <p>{l.description || "—"}</p>
                    {l.details && <p className="text-xs text-muted-foreground">{l.details}</p>}
                    {l.service_date && <p className="text-xs text-muted-foreground">Service date: {l.service_date}</p>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{money(Math.round((parseFloat(l.unitPriceStr) || 0) * 100))}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{money(Math.round((l.quantity || 0) * (parseFloat(l.unitPriceStr) || 0) * 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto max-w-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(totals.subtotal_cents)}</span></div>
            {props.discountCents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{money(totals.discount_cents)}</span></div>}
            {totals.tax_cents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{money(totals.tax_cents)}</span></div>}
            {totals.surcharge_cents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Card surcharge</span><span className="tabular-nums">{money(totals.surcharge_cents)}</span></div>}
            <div className="flex justify-between font-semibold pt-1 border-t border-border/40"><span>Total due</span><span className="tabular-nums">{money(totals.total_cents)}</span></div>
          </div>
          {(props.allowCard || props.allowVenmo) && (
            <p className="text-xs text-muted-foreground">
              Pay by {[props.allowCard ? "card" : null, props.allowVenmo ? "Venmo" : null].filter(Boolean).join(" or ")} — a secure payment link is included with the invoice.
            </p>
          )}
          {props.message && <p className="whitespace-pre-wrap">{props.message}</p>}
          {props.terms && <p className="text-xs text-muted-foreground whitespace-pre-wrap border-t border-border/40 pt-2">{props.terms}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
