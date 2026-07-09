import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import {
  listIntegrations,
  setIntegrationConnected,
  rotateGodaddyWebhookToken,
  type IntegrationRow,
  type IntegrationProvider,
} from "@/lib/integrations.functions";
import {
  getQboAuthUrl,
  getQboStatus,
  disconnectQbo,
  listQboSyncErrors,
  syncInvoiceToQbo,
} from "@/lib/qbo.functions";
import { getVenmoSettings, saveVenmoSettings } from "@/lib/venmo.functions";
import { sendTestLeadWebhook } from "@/lib/leads.functions";
import {
  getTurnoStatus,
  connectTurno,
  rotateTurnoSecret,
  updateTurnoTiming,
  disconnectTurno,
  listIntegrationErrors,
  resolveIntegrationError,
} from "@/lib/turno.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Copy, Check, Link2, Building2, CreditCard, Wallet, Globe, Home, AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  component: IntegrationsPage,
  validateSearch: (s: Record<string, unknown>) => ({ qbo: typeof s.qbo === "string" ? s.qbo : undefined }),
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const META: Record<IntegrationProvider, { name: string; icon: typeof Building2; description: string; phase: string }> = {
  quickbooks: { name: "QuickBooks Online", icon: Building2, description: "Sync clients, invoices, and payments to your QBO books.", phase: "Available now" },
  stripe: { name: "Stripe", icon: CreditCard, description: "Accept card and ACH payments on invoices.", phase: "Phase 2" },
  venmo: { name: "Venmo", icon: Wallet, description: "Send Venmo payment requests via pay-link deep links on invoices.", phase: "Available now" },
  godaddy: { name: "GoDaddy website", icon: Globe, description: "Capture leads from your website contact form.", phase: "Available now" },
  turno: { name: "Turno", icon: Home, description: "Auto-schedule Airbnb turnovers when Turno sends a reservation webhook.", phase: "Available now" },
};

function IntegrationsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listIntegrations);
  const toggleFn = useServerFn(setIntegrationConnected);
  const search = useSearch({ from: "/_authenticated/settings/integrations" });

  useEffect(() => {
    if (!search.qbo) return;
    if (search.qbo === "connected") toast.success("QuickBooks connected");
    else if (search.qbo.startsWith("error:")) toast.error(`QuickBooks: ${search.qbo.slice(6).replaceAll("_", " ")}`);
    // clear the query param without a full reload
    const url = new URL(window.location.href);
    url.searchParams.delete("qbo");
    window.history.replaceState({}, "", url.toString());
    qc.invalidateQueries({ queryKey: ["qbo-status"] });
    qc.invalidateQueries({ queryKey: ["qbo-errors"] });
  }, [search.qbo, qc]);

  const { data: integrations = [] } = useQuery<IntegrationRow[]>({
    queryKey: ["integrations"],
    queryFn: () => listFn(),
  });

  const byProvider = new Map(integrations.map((i) => [i.provider, i]));
  const providers: IntegrationProvider[] = ["quickbooks", "stripe", "venmo", "godaddy", "turno"];

  const toggle = async (provider: IntegrationProvider, connected: boolean) => {
    try {
      await toggleFn({ data: { provider, connected } });
      toast.success(connected ? "Connected" : "Disconnected");
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect Atlas to your other business tools" />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-4">
        {providers.map((p) => {
          const row = byProvider.get(p);
          const meta = META[p];
          const Icon = meta.icon;
          const isQbo = p === "quickbooks";
          return (
            <div key={p} className="bg-card rounded-xl ring-1 ring-black/5 p-6">
              <div className="flex items-start gap-4">
                <div className="size-10 rounded-lg bg-clay-100 grid place-items-center shrink-0">
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium">{meta.name}</h3>
                    {!isQbo && (row?.is_connected ? (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 text-green-800 font-medium">Connected</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-clay-200 text-muted-foreground font-medium">Not connected</span>
                    ))}
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{meta.phase}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{meta.description}</p>

                  {isQbo && <QuickBooksSection />}
                  {p === "venmo" && <VenmoSection onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })} />}
                  {p === "godaddy" && row && (
                    <GodaddySection row={row} onChanged={() => qc.invalidateQueries({ queryKey: ["integrations"] })} />
                  )}
                  {p === "turno" && <TurnoSection />}
                </div>
                <div className="shrink-0">
                  {isQbo || p === "godaddy" || p === "venmo" || p === "turno" ? null : row?.is_connected ? (
                    <Button variant="outline" onClick={() => toggle(p, false)}>Disconnect</Button>
                  ) : (
                    <Button
                      onClick={() => toggle(p, true)}
                      className="bg-brand text-brand-foreground hover:opacity-90"
                    >Connect</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function QuickBooksSection() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getQboStatus);
  const authFn = useServerFn(getQboAuthUrl);
  const disconnectFn = useServerFn(disconnectQbo);
  const errorsFn = useServerFn(listQboSyncErrors);
  const syncFn = useServerFn(syncInvoiceToQbo);

  const { data: status } = useQuery({ queryKey: ["qbo-status"], queryFn: () => statusFn() });
  const { data: errors = [] } = useQuery({ queryKey: ["qbo-errors"], queryFn: () => errorsFn() });
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await authFn({ data: { origin: window.location.origin } });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect QuickBooks? Atlas will stop syncing new invoices.")) return;
    setBusy(true);
    try {
      await disconnectFn();
      toast.success("QuickBooks disconnected");
      qc.invalidateQueries({ queryKey: ["qbo-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const retry = async (id: string) => {
    try {
      await syncFn({ data: { invoice_id: id } });
      toast.success("Synced to QBO");
      qc.invalidateQueries({ queryKey: ["qbo-errors"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="p-4 rounded-lg bg-clay-50 ring-1 ring-black/5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {status?.connected ? (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 text-green-800 font-medium">Connected</span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-clay-200 text-muted-foreground font-medium">Not connected</span>
          )}
          {status?.environment && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-clay-200 text-muted-foreground font-medium">
              {status.environment}
            </span>
          )}
        </div>
        {status?.connected ? (
          <>
            <div className="text-sm">
              <div><span className="text-muted-foreground">Company:</span> {status.company_name ?? "—"}</div>
              <div className="font-mono text-xs text-muted-foreground">Realm ID: {status.realm_id}</div>
            </div>
            <Button variant="outline" onClick={disconnect} disabled={busy}>Disconnect</Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Connect Atlas to your Wash Rinse Repeat QuickBooks company. New invoices will sync automatically when sent.
            </p>
            <Button onClick={connect} disabled={busy} className="bg-brand text-brand-foreground hover:opacity-90">
              <Link2 className="size-4 mr-1.5" /> Connect QuickBooks
            </Button>
          </>
        )}
      </div>

      {errors.length > 0 && (
        <div className="p-4 rounded-lg bg-destructive/5 ring-1 ring-destructive/20 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <p className="text-sm font-medium text-destructive">
              {errors.length} invoice{errors.length === 1 ? "" : "s"} failed to sync
            </p>
          </div>
          <ul className="space-y-2">
            {errors.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{e.number} · {e.client_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.error}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => retry(e.id)}>
                  <RefreshCw className="size-3 mr-1" /> Retry
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GodaddySection({ row, onChanged }: { row: IntegrationRow; onChanged: () => void }) {
  const rotateFn = useServerFn(rotateGodaddyWebhookToken);
  const toggleFn = useServerFn(setIntegrationConnected);
  const testFn = useServerFn(sendTestLeadWebhook);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = row.webhook_token
    ? `${origin}/api/public/hooks/lead/${(row as any).tenant_id ?? ""}?token=${row.webhook_token}`
    : null;

  const [computedUrl, setComputedUrl] = useState<string | null>(webhookUrl);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await rotateFn();
      const url = `${origin}/api/public/hooks/lead/${r.tenant_id}?token=${r.token}`;
      setComputedUrl(url);
      if (!row.is_connected) await toggleFn({ data: { provider: "godaddy", connected: true } });
      toast.success("Webhook URL generated");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!computedUrl) return;
    await navigator.clipboard.writeText(computedUrl);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const disconnect = async () => {
    await toggleFn({ data: { provider: "godaddy", connected: false } });
    setComputedUrl(null);
    onChanged();
  };

  const test = async () => {
    setTesting(true);
    try {
      await testFn({ data: { origin } });
      toast.success("Test lead sent — check the Leads page");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally { setTesting(false); }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="p-4 rounded-lg bg-clay-50 ring-1 ring-black/5 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website lead capture</p>
          <p className="text-xs text-muted-foreground mt-1">
            Paste this webhook URL into your GoDaddy website's contact form.
            Every submission becomes a lead under <em>Leads</em> and a prospective client under <em>Clients</em>.
          </p>
        </div>
        {computedUrl ? (
          <>
            <div className="flex gap-2">
              <input readOnly value={computedUrl} className="flex-1 font-mono text-xs px-3 py-2 rounded-lg bg-background border border-input" />
              <Button variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={test} disabled={testing} className="bg-brand text-brand-foreground hover:opacity-90">
                {testing ? "Testing…" : "Test Webhook"}
              </Button>
              <Button variant="outline" onClick={generate} disabled={busy}>Rotate URL</Button>
              <Button variant="ghost" onClick={disconnect}>Disable</Button>
            </div>
            <div className="text-xs text-muted-foreground pt-2 border-t border-border/40">
              <p className="font-medium text-foreground mb-2">How to hook this up in GoDaddy</p>
              <ol className="list-decimal ml-5 space-y-1">
                <li>Edit your GoDaddy form (Contact / Quote / Booking).</li>
                <li>Under <em>After submission</em>, choose <em>Send to webhook</em> (or use Zapier/Make with a Webhook POST action if your plan doesn't include webhooks).</li>
                <li>Paste the URL above and set the method to <code>POST</code>.</li>
                <li>Save, publish, and submit a test entry. Expected form fields: <code>name</code>, <code>email</code>, <code>phone</code>, <code>service</code>, <code>message</code>.</li>
              </ol>
            </div>
          </>
        ) : (
          <Button onClick={generate} disabled={busy} className="bg-brand text-brand-foreground hover:opacity-90">
            <Link2 className="size-4 mr-1.5" /> Generate webhook URL
          </Button>
        )}
      </div>
    </div>
  );
}


function VenmoSection({ onChanged }: { onChanged: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getVenmoSettings);
  const saveFn = useServerFn(saveVenmoSettings);
  const toggleFn = useServerFn(setIntegrationConnected);

  const { data } = useQuery({ queryKey: ["venmo-settings"], queryFn: () => getFn() });
  const [handle, setHandle] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setHandle(data.handle ?? "");
      setTestMode(data.test_mode);
      setInitialized(true);
    }
  }, [data, initialized]);

  const save = async () => {
    const clean = handle.trim().replace(/^@/, "");
    if (!clean) { toast.error("Enter your Venmo handle"); return; }
    setBusy(true);
    try {
      await saveFn({ data: { handle: clean, test_mode: testMode } });
      toast.success("Venmo settings saved");
      qc.invalidateQueries({ queryKey: ["venmo-settings"] });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Venmo? Pay-link buttons on invoices will stop working.")) return;
    setBusy(true);
    try {
      await toggleFn({ data: { provider: "venmo", connected: false } });
      toast.success("Venmo disconnected");
      qc.invalidateQueries({ queryKey: ["venmo-settings"] });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 p-4 rounded-lg bg-clay-50 ring-1 ring-black/5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {data?.is_connected ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 text-green-800 font-medium">Connected</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-clay-200 text-muted-foreground font-medium">Not connected</span>
        )}
        {data?.test_mode && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Test mode</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Venmo's Business API is closed to most integrators, so Atlas uses Venmo pay-link deep links: a
        <code className="mx-1 px-1 rounded bg-clay-200 text-[11px]">venmo.com/&lt;handle&gt;</code>
        URL that opens the Venmo app pre-filled with the invoice amount and number. You mark payments as received manually from the invoice.
      </p>
      <div>
        <Label className="text-xs">Your Venmo handle</Label>
        <div className="flex gap-2 mt-1">
          <div className="flex-1 flex items-center rounded-lg border border-input bg-background px-3">
            <span className="text-muted-foreground text-sm">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="WashRinseRepeat"
              className="flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={testMode}
          onChange={(e) => setTestMode(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <span>Test mode — prefix notes with <code className="px-1 rounded bg-clay-200 text-[11px]">[TEST]</code> and skip real payment tracking</span>
      </label>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="bg-brand text-brand-foreground hover:opacity-90">
          {data?.is_connected ? "Save" : "Connect Venmo"}
        </Button>
        {data?.is_connected && (
          <Button variant="outline" onClick={disconnect} disabled={busy}>Disconnect</Button>
        )}
      </div>
    </div>
  );
}

function TurnoSection() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getTurnoStatus);
  const connectFn = useServerFn(connectTurno);
  const rotateFn = useServerFn(rotateTurnoSecret);
  const timingFn = useServerFn(updateTurnoTiming);
  const disconnectFn = useServerFn(disconnectTurno);
  const errorsFn = useServerFn(listIntegrationErrors);
  const resolveFn = useServerFn(resolveIntegrationError);

  const { data: status } = useQuery({ queryKey: ["turno-status"], queryFn: () => statusFn() });
  const { data: allErrors = [] } = useQuery({ queryKey: ["integration-errors"], queryFn: () => errorsFn() });
  const turnoErrors = allErrors.filter((e) => e.source === "turno");

  const [busy, setBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [grace, setGrace] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = status?.tenant_id ? `${origin}/api/public/hooks/turno/${status.tenant_id}` : "";

  const connect = async () => {
    setBusy(true);
    try {
      await connectFn();
      toast.success("Turno webhook enabled — copy the URL and secret into Turno");
      qc.invalidateQueries({ queryKey: ["turno-status"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const rotate = async () => {
    if (!confirm("Rotate the webhook secret? Turno webhooks using the old secret will start failing until you update Turno.")) return;
    setBusy(true);
    try {
      await rotateFn();
      toast.success("New secret generated — update Turno with the new value");
      qc.invalidateQueries({ queryKey: ["turno-status"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Turno? Incoming webhooks will be rejected until you reconnect.")) return;
    setBusy(true);
    try {
      await disconnectFn();
      toast.success("Turno disconnected");
      qc.invalidateQueries({ queryKey: ["turno-status"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const saveTiming = async () => {
    const g = grace ?? status?.grace_hours ?? 2;
    const d = duration ?? status?.duration_hours ?? 3;
    try {
      await timingFn({ data: { grace_hours: g, duration_hours: d } });
      toast.success("Timing saved");
      qc.invalidateQueries({ queryKey: ["turno-status"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const copyUrl = async () => { await navigator.clipboard.writeText(webhookUrl); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500); };
  const copySecret = async () => {
    if (!status?.webhook_secret) return;
    await navigator.clipboard.writeText(status.webhook_secret);
    setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 1500);
  };

  const resolve = async (id: string) => {
    try { await resolveFn({ data: { id } }); qc.invalidateQueries({ queryKey: ["integration-errors"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="p-4 rounded-lg bg-clay-50 ring-1 ring-black/5 space-y-3">
        {!status?.connected ? (
          <>
            <p className="text-xs text-muted-foreground">
              Atlas listens for Turno reservation webhooks and auto-schedules turnovers. No Turno API key required —
              you'll paste a webhook URL and secret into Turno (or a Zapier/Make step forwarding Turno events).
            </p>
            <Button onClick={connect} disabled={busy} className="bg-brand text-brand-foreground hover:opacity-90">
              <Link2 className="size-4 mr-1.5" /> Enable Turno webhook
            </Button>
          </>
        ) : (
          <>
            <div>
              <Label className="text-xs">Webhook URL (paste into Turno)</Label>
              <div className="flex gap-2 mt-1">
                <input readOnly value={webhookUrl} className="flex-1 font-mono text-xs px-3 py-2 rounded-lg bg-background border border-input" />
                <Button variant="outline" onClick={copyUrl}>{copiedUrl ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Signing secret (paste into Turno)</Label>
              <div className="flex gap-2 mt-1">
                <input readOnly value={status.webhook_secret ?? ""} className="flex-1 font-mono text-xs px-3 py-2 rounded-lg bg-background border border-input" />
                <Button variant="outline" onClick={copySecret}>{copiedSecret ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Turno should send <code>X-Turno-Signature</code> = hex(HMAC-SHA256(body, secret)).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Grace period after checkout (hours)</Label>
                <input type="number" min={0} max={24} step={0.5}
                  defaultValue={status.grace_hours}
                  onChange={(e) => setGrace(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-input text-sm" />
              </div>
              <div>
                <Label className="text-xs">Default turnover duration (hours)</Label>
                <input type="number" min={0.5} max={24} step={0.5}
                  defaultValue={status.duration_hours}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-input text-sm" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveTiming} className="bg-brand text-brand-foreground hover:opacity-90">Save timing</Button>
              <Button variant="outline" onClick={rotate} disabled={busy}><RefreshCw className="size-3 mr-1" /> Rotate secret</Button>
              <Button variant="ghost" onClick={disconnect} disabled={busy}>Disconnect</Button>
            </div>
          </>
        )}
      </div>

      {turnoErrors.length > 0 && (
        <div className="p-4 rounded-lg bg-destructive/5 ring-1 ring-destructive/20 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <p className="text-sm font-medium text-destructive">{turnoErrors.length} Turno event{turnoErrors.length === 1 ? "" : "s"} need attention</p>
          </div>
          <ul className="space-y-2">
            {turnoErrors.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
                  <div>{e.error_message}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => resolve(e.id)}>Mark resolved</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

