import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBusinessProfile, updateBusinessProfile, type BusinessProfile } from "@/lib/business-profile.functions";
import { getTenantGpsSettings, updateTenantGpsSettings, purgeExpiredGps } from "@/lib/time.functions";

export const Route = createFileRoute("/_authenticated/settings/business")({
  component: BusinessSettingsPage,
});

const TZS = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Berlin",
  "Asia/Singapore", "Australia/Sydney", "UTC",
];

type FormState = Partial<BusinessProfile>;

function BusinessSettingsPage() {
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getBusinessProfile);
  const saveProfile = useServerFn(updateBusinessProfile);
  const fetchGps = useServerFn(getTenantGpsSettings);
  const saveGps = useServerFn(updateTenantGpsSettings);
  const purge = useServerFn(purgeExpiredGps);

  const profileQ = useQuery({ queryKey: ["business-profile"], queryFn: () => fetchProfile() });
  const gpsQ = useQuery({ queryKey: ["tenant-gps-settings"], queryFn: () => fetchGps() });

  const [form, setForm] = useState<FormState>({});
  useEffect(() => { if (profileQ.data) setForm(profileQ.data); }, [profileQ.data]);

  const [track, setTrack] = useState(false);
  const [days, setDays] = useState(90);
  useEffect(() => { if (gpsQ.data) { setTrack(gpsQ.data.track_gps); setDays(gpsQ.data.gps_retention_days); } }, [gpsQ.data]);

  const patch = (fields: Partial<BusinessProfile>) => setForm((f) => ({ ...f, ...fields }));

  const saveProfileMut = useMutation({
    mutationFn: async () => {
      const p = form;
      await saveProfile({
        data: {
          name: p.name ?? undefined,
          legal_name: p.legal_name ?? null,
          business_email: p.business_email ?? null,
          business_phone: p.business_phone ?? null,
          address: p.address ?? null,
          website: p.website ?? null,
          timezone: p.timezone ?? null,
          logo_url: p.logo_url ?? null,
          primary_color: p.primary_color ?? null,
          invoice_prefix: p.invoice_prefix ?? null,
          invoice_footer: p.invoice_footer ?? null,
          payment_terms_days: p.payment_terms_days ?? null,
          late_fee_percent: p.late_fee_percent ?? null,
          reminder_lead_hours: p.reminder_lead_hours ?? undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Business profile saved");
      qc.invalidateQueries({ queryKey: ["business-profile"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const saveGpsMut = useMutation({
    mutationFn: () => saveGps({ data: { track_gps: track, gps_retention_days: days } }),
    onSuccess: () => {
      toast.success("GPS settings saved");
      qc.invalidateQueries({ queryKey: ["tenant-gps-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const runPurge = useMutation({
    mutationFn: () => purge(),
    onSuccess: (r: any) => toast.success(`Purged ${r?.purged ?? 0} old GPS records`),
    onError: (e: any) => toast.error(e?.message ?? "Failed to purge"),
  });

  if (profileQ.isLoading) {
    return <AppShell><PageHeader title="Business profile" /><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
  }

  return (
    <AppShell>
      <PageHeader title="Business profile" subtitle="Company-wide identity, branding, invoicing, and privacy" />
      <div className="max-w-3xl w-full mx-auto px-6 md:px-8 py-6 space-y-6">

        {/* Identity */}
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
          <h2 className="text-base font-medium">Identity</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Business name">
              <Input value={form.name ?? ""} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Legal name">
              <Input value={form.legal_name ?? ""} onChange={(e) => patch({ legal_name: e.target.value })} />
            </Field>
            <Field label="Business email">
              <Input type="email" value={form.business_email ?? ""} onChange={(e) => patch({ business_email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.business_phone ?? ""} onChange={(e) => patch({ business_phone: e.target.value })} />
            </Field>
            <Field label="Website" className="md:col-span-2">
              <Input placeholder="https://" value={form.website ?? ""} onChange={(e) => patch({ website: e.target.value })} />
            </Field>
            <Field label="Address" className="md:col-span-2">
              <Input value={form.address ?? ""} onChange={(e) => patch({ address: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <select
                value={form.timezone ?? "America/New_York"}
                onChange={(e) => patch({ timezone: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-clay-50"
              >
                {TZS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
        </section>

        {/* Branding */}
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
          <h2 className="text-base font-medium">Branding</h2>
          <div className="grid md:grid-cols-2 gap-4 items-end">
            <Field label="Logo URL">
              <Input placeholder="https://…/logo.png" value={form.logo_url ?? ""} onChange={(e) => patch({ logo_url: e.target.value })} />
            </Field>
            <Field label="Primary color">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.primary_color ?? "#0b6e4f"}
                  onChange={(e) => patch({ primary_color: e.target.value })}
                  className="size-10 rounded border border-border cursor-pointer"
                />
                <Input value={form.primary_color ?? ""} onChange={(e) => patch({ primary_color: e.target.value })} />
              </div>
            </Field>
            {form.logo_url && (
              <div className="md:col-span-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span>Preview:</span>
                <img src={form.logo_url} alt="Logo preview" className="h-10 w-auto rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
          </div>
        </section>

        {/* Invoicing */}
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
          <h2 className="text-base font-medium">Invoicing defaults</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Invoice number prefix">
              <Input placeholder="WRR" value={form.invoice_prefix ?? ""} onChange={(e) => patch({ invoice_prefix: e.target.value })} />
            </Field>
            <Field label="Payment terms (days)">
              <Input
                type="number" min={0} max={365}
                value={form.payment_terms_days ?? 14}
                onChange={(e) => patch({ payment_terms_days: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Late fee (%)">
              <Input
                type="number" step="0.01" min={0} max={100}
                value={form.late_fee_percent ?? 0}
                onChange={(e) => patch({ late_fee_percent: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Footer text" className="md:col-span-2">
              <textarea
                rows={2}
                value={form.invoice_footer ?? ""}
                onChange={(e) => patch({ invoice_footer: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-clay-50"
                placeholder="Thanks for your business!"
              />
            </Field>
          </div>
        </section>

        {/* Client notifications */}
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
          <h2 className="text-base font-medium">Client notifications</h2>
          <Field label="Appointment reminder lead time (hours)">
            <Input
              type="number" min={0} max={168}
              value={form.reminder_lead_hours ?? 24}
              onChange={(e) => patch({ reminder_lead_hours: Number(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              How far in advance clients get an SMS reminder before their appointment.
            </p>
          </Field>
        </section>

        <div className="flex justify-end">
          <Button onClick={() => saveProfileMut.mutate()} disabled={saveProfileMut.isPending}>
            {saveProfileMut.isPending ? "Saving…" : "Save business profile"}
          </Button>
        </div>

        {/* GPS section preserved */}
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
          <h2 className="text-base font-medium">Employee GPS tracking</h2>
          <p className="text-sm text-muted-foreground">
            When enabled, employees are asked for their device location the moment they tap Clock In or Clock Out.
            Location is <strong>never</strong> collected in the background.
          </p>
          <label className="flex items-center gap-3 py-2 border-t border-border/60">
            <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="size-4" />
            <span className="text-sm font-medium">Track employee GPS on clock-in/out</span>
          </label>
          <Field label="GPS data retention (days)">
            <Input
              type="number" min={1} max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 90)}
              className="w-32"
            />
          </Field>
          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={() => runPurge.mutate()}
              disabled={runPurge.isPending}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 disabled:opacity-50"
            >
              {runPurge.isPending ? "Purging…" : "Purge expired GPS data now"}
            </button>
            <Button onClick={() => saveGpsMut.mutate()} disabled={saveGpsMut.isPending} size="sm">
              {saveGpsMut.isPending ? "Saving…" : "Save GPS settings"}
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
