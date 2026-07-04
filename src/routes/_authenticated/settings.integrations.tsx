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
import { Button } from "@/components/ui/button";
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
  turno: { name: "Turno", icon: Home, description: "Sync Airbnb turnovers automatically from Turno.", phase: "Phase 3" },
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
                  {p === "turno" && (
                    <p className="text-xs text-muted-foreground mt-3 italic">Sync is planned for Phase 3 — no action needed today.</p>
                  )}
                </div>
                <div className="shrink-0">
                  {isQbo || p === "godaddy" || p === "venmo" ? null : row?.is_connected ? (
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
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = row.webhook_token
    ? `${origin}/api/public/hooks/lead/${(row as any).tenant_id ?? ""}?token=${row.webhook_token}`
    : null;

  // tenant_id isn't in the row; construct URL using the token endpoint. We fetch on rotate.
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

  return (
    <div className="mt-4 space-y-3">
      <div className="p-4 rounded-lg bg-clay-50 ring-1 ring-black/5 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website lead capture</p>
          <p className="text-xs text-muted-foreground mt-1">
            Paste this webhook URL into your GoDaddy website's contact form settings.
            Every submission will show up as a new client under Clients.
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
            <div className="flex gap-2">
              <Button variant="outline" onClick={generate} disabled={busy}>Rotate URL</Button>
              <Button variant="ghost" onClick={disconnect}>Disable</Button>
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">How to hook this up in GoDaddy</summary>
              <ol className="list-decimal ml-5 mt-2 space-y-1">
                <li>Edit your GoDaddy site, open the Contact section, and choose <em>Form actions → Send to webhook</em>.</li>
                <li>Paste the URL above. Expected form fields: <code>name</code>, <code>email</code>, <code>phone</code>, <code>message</code>.</li>
                <li>Publish. Submit a test entry, then check <em>Clients</em> in Atlas.</li>
              </ol>
            </details>
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
