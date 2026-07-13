import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, ExternalLink, X, Zap, AlertCircle, FileText } from "lucide-react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getBillingSummary, createSubscriptionCheckout, openBillingPortal,
  changePlan, cancelSubscription, resumeSubscription, previewPlanChange,
  type BillingSummary, type PlanChangePreview,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/settings/billing")({
  component: BillingPage,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-destructive">{error.message}</div></AppShell>
  ),
});

function fmtPct(used: number, cap: number | null): number {
  if (cap == null || cap === 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function UsageBar({ label, used, cap, unit }: { label: string; used: number; cap: number | null; unit?: string }) {
  const pct = fmtPct(used, cap);
  const over = cap != null && used >= cap;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">
          {used.toLocaleString()}{unit ?? ""} <span className="text-muted-foreground">
            / {cap == null ? "∞" : `${cap.toLocaleString()}${unit ?? ""}`}
          </span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-clay-200/60 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-brand"}`}
          style={{ width: cap == null ? "8%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

const LIMIT_LABELS: Record<string, string> = {
  employees: "employees",
  active_clients: "active clients",
  monthly_jobs: "jobs this month",
};

function PlanCard({
  plan, current, direction, blocking, onSelect, disabled,
}: {
  plan: NonNullable<BillingSummary["limits"]>;
  current: boolean;
  direction: "upgrade" | "downgrade" | "same";
  blocking: PlanChangePreview["blocking"] | null;
  onSelect: () => void;
  disabled: boolean;
}) {
  const features = plan.features ?? {};
  const label = current
    ? "Current plan"
    : direction === "upgrade" ? "Upgrade" : direction === "downgrade" ? "Downgrade" : "Choose plan";
  const blocked = !current && (blocking?.length ?? 0) > 0;

  return (
    <div className={`rounded-xl p-6 flex flex-col gap-4 ring-1 ${
      current ? "ring-brand bg-brand/[0.02]" : "ring-black/5 bg-card"
    }`}>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium">{plan.display_name}</h3>
          {current && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand text-brand-foreground">Current</span>
          )}
        </div>
        <p className="mt-1 text-2xl font-medium tracking-tight">
          ${(plan.price_cents_monthly / 100).toFixed(0)}
          <span className="text-sm font-normal text-muted-foreground">/mo</span>
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2"><Check className="size-4 text-brand" />
          {plan.max_monthly_jobs == null ? "Unlimited jobs" : `${plan.max_monthly_jobs} jobs/month`}
        </li>
        <li className="flex items-center gap-2"><Check className="size-4 text-brand" />
          {plan.max_active_clients == null ? "Unlimited clients" : `${plan.max_active_clients} active clients`}
        </li>
        <li className="flex items-center gap-2"><Check className="size-4 text-brand" />
          {plan.max_employees == null ? "Unlimited employees" : `${plan.max_employees} employees`}
        </li>
        <li className="flex items-center gap-2">
          {features.ai_assistant ? <Check className="size-4 text-brand" /> : <X className="size-4 text-muted-foreground" />}
          AI assistant
        </li>
        <li className="flex items-center gap-2">
          {features.integrations ? <Check className="size-4 text-brand" /> : <X className="size-4 text-muted-foreground" />}
          Integrations
        </li>
        <li className="flex items-center gap-2">
          {features.priority_support ? <Check className="size-4 text-brand" /> : <X className="size-4 text-muted-foreground" />}
          Priority support
        </li>
      </ul>

      {blocked && blocking && (
        <div className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 flex gap-2">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Reduce usage to downgrade:</div>
            <ul className="mt-0.5 space-y-0.5">
              {blocking.map((b) => (
                <li key={b.limit}>
                  {b.current} {LIMIT_LABELS[b.limit] ?? b.limit} · {plan.display_name} allows {b.allowed}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-auto pt-2">
        <Button
          variant={current ? "outline" : "default"}
          className="w-full"
          onClick={onSelect}
          disabled={disabled || current || blocked}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

function fmtCurrency(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function BillingPage() {
  const qc = useQueryClient();
  const env = getStripeEnvironment();
  const summaryFn = useServerFn(getBillingSummary);
  const checkoutFn = useServerFn(createSubscriptionCheckout);
  const portalFn = useServerFn(openBillingPortal);
  const changePlanFn = useServerFn(changePlan);
  const cancelFn = useServerFn(cancelSubscription);
  const resumeFn = useServerFn(resumeSubscription);
  const previewFn = useServerFn(previewPlanChange);

  const { data, isLoading, error } = useQuery({
    queryKey: ["billing-summary", env],
    queryFn: () => summaryFn({ data: { environment: env } }),
  });

  const previews = useQuery({
    queryKey: ["plan-change-previews", data?.plan_tier],
    enabled: !!data,
    queryFn: async () => {
      const tiers: Array<"starter" | "growth" | "scale"> = ["starter", "growth", "scale"];
      const out: Record<string, PlanChangePreview> = {};
      for (const t of tiers) {
        if (t === data?.plan_tier) continue;
        try {
          out[t] = await previewFn({ data: { plan_tier: t } });
        } catch {
          // ignore
        }
      }
      return out;
    },
  });

  const [checkoutPlan, setCheckoutPlan] = useState<"starter" | "growth" | "scale" | null>(null);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    if (!checkoutPlan) throw new Error("No plan selected");
    const res = await checkoutFn({
      data: {
        plan_tier: checkoutPlan,
        return_url: `${window.location.origin}/settings/billing?checkout=complete`,
        environment: env,
      },
    });
    if ("error" in res) throw new Error(res.error);
    if (!res.clientSecret) throw new Error("Could not start checkout");
    return res.clientSecret;
  }, [checkoutFn, checkoutPlan, env]);

  const openPortal = useMutation({
    mutationFn: async () => {
      const res = await portalFn({
        data: {
          return_url: `${window.location.origin}/settings/billing`,
          environment: env,
        },
      });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doChangePlan = useMutation({
    mutationFn: async (tier: "starter" | "growth" | "scale") => {
      const res = await changePlanFn({ data: { plan_tier: tier, environment: env } });
      if ("error" in res) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Plan updated. Proration will appear on your next invoice.");
      qc.invalidateQueries({ queryKey: ["billing-summary"] });
      qc.invalidateQueries({ queryKey: ["plan-change-previews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doCancel = useMutation({
    mutationFn: async () => {
      const res = await cancelFn({ data: { environment: env } });
      if ("error" in res) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Subscription will cancel at period end.");
      qc.invalidateQueries({ queryKey: ["billing-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doResume = useMutation({
    mutationFn: async () => {
      const res = await resumeFn({ data: { environment: env } });
      if ("error" in res) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Subscription resumed.");
      qc.invalidateQueries({ queryKey: ["billing-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const planOrder = useMemo(() => ({ starter: 0, growth: 1, scale: 2 } as Record<string, number>), []);

  if (isLoading) {
    return <AppShell><PageHeader title="Billing" /><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
  }
  if (error || !data) {
    return <AppShell><PageHeader title="Billing" /><div className="p-8 text-destructive">{(error as Error)?.message ?? "Failed to load"}</div></AppShell>;
  }

  const { plan_tier, limits, usage, subscription, invoices, all_plans } = data;
  const sub = subscription;
  const hasActive = !!sub && ["active", "trialing", "past_due"].includes(sub.status);

  const statusLabel = sub
    ? sub.cancel_at_period_end
      ? `Cancels ${sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "at period end"}`
      : sub.status === "past_due" ? "Payment past due"
      : sub.status === "trialing" ? "Trial"
      : sub.status === "active" ? "Active"
      : sub.status
    : "No active subscription";

  return (
    <AppShell>
      <PageHeader
        title="Billing & plan"
        subtitle={`You are on the ${limits?.display_name ?? plan_tier} plan · ${statusLabel}`}
        action={hasActive ? (
          <Button variant="outline" size="sm" onClick={() => openPortal.mutate()} disabled={openPortal.isPending}>
            <ExternalLink className="size-4 mr-1.5" /> Manage payment method
          </Button>
        ) : null}
      />

      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">
        {sub?.status === "past_due" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            <strong>Payment past due.</strong> Stripe is retrying automatically — update your card to avoid service interruption.
          </div>
        )}

        {sub?.cancel_at_period_end && (
          <div className="bg-clay-100 border border-border rounded-lg p-4 text-sm flex items-center justify-between">
            <span>
              Your subscription is scheduled to cancel on{" "}
              <strong>{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "period end"}</strong>.
            </span>
            <Button size="sm" variant="outline" onClick={() => doResume.mutate()} disabled={doResume.isPending}>
              Resume subscription
            </Button>
          </div>
        )}

        {limits && (
          <section className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-brand" />
              <h2 className="text-sm font-medium">This month's usage</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <UsageBar label="Jobs" used={usage.monthly_jobs} cap={limits.max_monthly_jobs} />
              <UsageBar label="Active clients" used={usage.active_clients} cap={limits.max_active_clients} />
              <UsageBar label="Employees" used={usage.employees} cap={limits.max_employees} />
              <UsageBar label="AI tokens" used={usage.ai_tokens_used_month} cap={limits.ai_tokens_monthly} />
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium mb-4">Plans</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {(all_plans ?? []).filter(Boolean).map((p) => {
              const tier = p!.plan_tier as "starter" | "growth" | "scale";
              const current = tier === plan_tier;
              const direction: "upgrade" | "downgrade" | "same" =
                current ? "same"
                : planOrder[tier] > planOrder[plan_tier] ? "upgrade"
                : "downgrade";
              const blocking = previews.data?.[tier]?.blocking ?? null;
              return (
                <PlanCard
                  key={tier}
                  plan={p!}
                  current={current}
                  direction={direction}
                  blocking={blocking}
                  disabled={doChangePlan.isPending}
                  onSelect={() => {
                    if (hasActive) {
                      if (confirm(direction === "upgrade"
                        ? `Upgrade to ${p!.display_name}? You'll be charged a prorated amount immediately.`
                        : `Switch to ${p!.display_name}? A credit for unused time will be applied.`
                      )) {
                        doChangePlan.mutate(tier);
                      }
                    } else {
                      setCheckoutPlan(tier);
                    }
                  }}
                />
              );
            })}
          </div>

          {hasActive && !sub!.cancel_at_period_end && (
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (confirm("Cancel subscription at the end of the current period? You'll keep access until then.")) {
                    doCancel.mutate();
                  }
                }}
                className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-4"
                disabled={doCancel.isPending}
              >
                Cancel subscription
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Upgrades and downgrades take effect immediately; unused time is credited or charged as proration on your next invoice.
          </p>
        </section>

        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Recent invoices</h2>
          </div>
          {invoices && invoices.length > 0 ? (
            <div className="divide-y divide-border/60">
              {invoices.map((inv) => (
                <div key={inv.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="tabular-nums">{fmtCurrency(inv.amount_paid_cents || inv.amount_due_cents || 0, inv.currency)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()} · {inv.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {inv.hosted_invoice_url && (
                      <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="underline">View</a>
                    )}
                    {inv.invoice_pdf && (
                      <a href={inv.invoice_pdf} target="_blank" rel="noreferrer" className="underline">PDF</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No invoices yet. Renewal receipts will appear here.</p>
          )}
        </section>
      </div>

      {checkoutPlan && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={() => setCheckoutPlan(null)}>
          <div className="bg-card rounded-xl max-w-2xl w-full mt-16 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h3 className="font-medium">Subscribe · {all_plans?.find((p) => p?.plan_tier === checkoutPlan)?.display_name}</h3>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setCheckoutPlan(null)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4">
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
