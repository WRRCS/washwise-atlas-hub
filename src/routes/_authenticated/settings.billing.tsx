import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, ExternalLink, X, Zap } from "lucide-react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getBillingSummary, createSubscriptionCheckout, openBillingPortal,
  type BillingSummary,
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

function PlanCard({
  plan, current, onSelect, disabled,
}: {
  plan: NonNullable<BillingSummary["limits"]>;
  current: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const features = plan.features ?? {};
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
          Integrations (Turno, GoDaddy, etc.)
        </li>
        <li className="flex items-center gap-2">
          {features.priority_support ? <Check className="size-4 text-brand" /> : <X className="size-4 text-muted-foreground" />}
          Priority support
        </li>
      </ul>
      <div className="mt-auto pt-2">
        <Button
          variant={current ? "outline" : "default"}
          className="w-full"
          onClick={onSelect}
          disabled={disabled || current}
        >
          {current ? "Current plan" : "Choose plan"}
        </Button>
      </div>
    </div>
  );
}

function BillingPage() {
  const summaryFn = useServerFn(getBillingSummary);
  const checkoutFn = useServerFn(createSubscriptionCheckout);
  const portalFn = useServerFn(openBillingPortal);

  const { data, isLoading, error } = useQuery({
    queryKey: ["billing-summary"],
    queryFn: () => summaryFn(),
  });

  const [checkoutPlan, setCheckoutPlan] = useState<"starter" | "growth" | "scale" | null>(null);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    if (!checkoutPlan) throw new Error("No plan selected");
    const res = await checkoutFn({
      data: {
        plan_tier: checkoutPlan,
        return_url: `${window.location.origin}/settings/billing?checkout=complete`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in res) throw new Error(res.error);
    if (!res.clientSecret) throw new Error("Could not start checkout");
    return res.clientSecret;
  }, [checkoutFn, checkoutPlan]);

  const openPortal = useMutation({
    mutationFn: async () => {
      const res = await portalFn({
        data: {
          return_url: `${window.location.origin}/settings/billing`,
          environment: getStripeEnvironment(),
        },
      });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <AppShell><PageHeader title="Billing" /><div className="p-8 text-muted-foreground">Loading…</div></AppShell>;
  }
  if (error || !data) {
    return <AppShell><PageHeader title="Billing" /><div className="p-8 text-destructive">{(error as Error)?.message ?? "Failed to load"}</div></AppShell>;
  }

  const { plan_tier, limits, usage, subscription, all_plans } = data;
  const sub = subscription;
  const statusLabel = sub
    ? sub.cancel_at_period_end
      ? `Cancels ${sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "at period end"}`
      : sub.status === "past_due"
        ? "Payment past due"
        : sub.status === "trialing"
          ? "Trial"
          : sub.status === "active"
            ? "Active"
            : sub.status
    : "No active subscription";

  return (
    <AppShell>
      <PageHeader
        title="Billing & plan"
        subtitle={`You are on the ${limits?.display_name ?? plan_tier} plan · ${statusLabel}`}
        action={sub ? (
          <Button variant="outline" size="sm" onClick={() => openPortal.mutate()} disabled={openPortal.isPending}>
            <ExternalLink className="size-4 mr-1.5" /> Manage billing
          </Button>
        ) : null}
      />

      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">
        {sub?.status === "past_due" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            <strong>Payment past due.</strong> We're retrying automatically — update your card in the billing portal to avoid service interruption.
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
            {(all_plans ?? []).filter(Boolean).map((p) => (
              <PlanCard
                key={p!.plan_tier}
                plan={p!}
                current={p!.plan_tier === plan_tier}
                disabled={false}
                onSelect={() => setCheckoutPlan(p!.plan_tier as any)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Payments are processed securely. You can cancel or change plans anytime from the billing portal.
          </p>
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
