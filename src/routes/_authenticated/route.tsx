import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { PhotoOutboxSender } from "@/components/photo-outbox-sender";
import { DunningBanner } from "@/components/DunningBanner";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";

const BILLING_PATH = "/settings/billing";
const ONBOARDING_PATH = "/onboarding";

// A passed account check is reused briefly so moving between pages doesn't wait on
// five network requests every tap. Only "allowed" results are reused; onboarding and
// billing redirects are always rechecked, and data access is still enforced server-side.
const GATE_REUSE_MS = 5 * 60 * 1000;
let passedGate: { userId: string; at: number; user: User } | null = null;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    if (!sessionUser) {
      passedGate = null;
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    if (
      passedGate && passedGate.userId === sessionUser.id &&
      Date.now() - passedGate.at < GATE_REUSE_MS &&
      !location.pathname.startsWith(ONBOARDING_PATH)
    ) {
      return { user: passedGate.user };
    }
    passedGate = null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }

    if (location.pathname.startsWith(ONBOARDING_PATH)) {
      return { user: data.user };
    }

    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("tenant_id").eq("id", data.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    ]);
    const isSuperAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
    if (isSuperAdmin || !profile?.tenant_id) {
      passedGate = { userId: data.user.id, at: Date.now(), user: data.user };
      return { user: data.user };
    }

    // Onboarding gate
    const { data: tenant } = await supabase
      .from("tenants")
      .select("onboarding_completed")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (tenant && !tenant.onboarding_completed) {
      throw redirect({ to: ONBOARDING_PATH });
    }

    // Subscription gate — canonical from RPC (grace_days lives server-side)
    const { data: gate, error: gateError } = await supabase.rpc("get_my_subscription_gate");
    if (gateError) {
      // Never leave a billing problem invisible: log it loudly instead of
      // silently treating the account as in good standing.
      console.error("Subscription gate check failed", gateError);
    }
    const status = (gate as any)?.subscription_status as string | undefined;
    const changedAtStr = (gate as any)?.subscription_status_changed_at as string | undefined;
    const graceDays = (gate as any)?.grace_days ?? 7;
    if (
      (status === "past_due" || status === "canceled" || status === "unpaid") &&
      !location.pathname.startsWith(BILLING_PATH)
    ) {
      const changedAt = changedAtStr ? new Date(changedAtStr).getTime() : Date.now();
      const ageMs = Date.now() - changedAt;
      if (ageMs > graceDays * 24 * 60 * 60 * 1000) {
        throw redirect({ to: BILLING_PATH });
      }
    }

    passedGate = { userId: data.user.id, at: Date.now(), user: data.user };
    return { user: data.user };
  },
  component: RouteComponent,
});

function useSubscriptionStatus() {
  return useQuery({
    queryKey: ["subscription-status-banner"],
    queryFn: async () => {
      // Signed-out/expired sessions hit the RPC as `anon`, which is denied by
      // design — skip the call instead of logging a permission error.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return null;
      const { data, error } = await supabase.rpc("get_my_subscription_gate");
      if (error) {
        console.error("Subscription status check failed", error);
        throw error;
      }
      return data as { subscription_status?: string; subscription_status_changed_at?: string } | null;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function RouteComponent() {
  const isOnboarding = typeof window !== "undefined" && window.location.pathname.startsWith(ONBOARDING_PATH);
  const { data: gate } = useSubscriptionStatus();

  if (isOnboarding) {
    return <Outlet />;
  }
  return (
    <>
      <DunningBanner status={gate?.subscription_status ?? null} />
      <PhotoOutboxSender />
      <AppShell>
        <Outlet />
      </AppShell>
    </>
  );
}
