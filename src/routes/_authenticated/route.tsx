import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { DunningBanner } from "@/components/DunningBanner";
import { useQuery } from "@tanstack/react-query";

const BILLING_PATH = "/settings/billing";
const ONBOARDING_PATH = "/onboarding";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
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
    if (isSuperAdmin || !profile?.tenant_id) return { user: data.user };

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
    const { data: gate } = await supabase.rpc("get_my_subscription_gate");
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

    return { user: data.user };
  },
  component: RouteComponent,
});

function useSubscriptionStatus() {
  return useQuery({
    queryKey: ["subscription-status-banner"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_my_subscription_gate");
      return data as { subscription_status?: string; subscription_status_changed_at?: string } | null;
    },
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
      <AppShell>
        <Outlet />
      </AppShell>
    </>
  );
}
