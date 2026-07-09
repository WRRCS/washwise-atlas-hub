import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

const GRACE_DAYS = 7;
const BILLING_PATH = "/settings/billing";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }

    if (location.pathname.startsWith("/onboarding")) {
      return { user: data.user };
    }

    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("tenant_id").eq("id", data.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    ]);
    const isSuperAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
    if (isSuperAdmin || !profile?.tenant_id) return { user: data.user };

    const { data: tenant } = await supabase
      .from("tenants")
      .select("onboarding_completed,subscription_status,subscription_status_changed_at")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    if (tenant && !tenant.onboarding_completed) {
      throw redirect({ to: "/onboarding" });
    }

    // 7-day grace period, then lock everything except the billing page.
    const status = tenant?.subscription_status;
    if ((status === "past_due" || status === "canceled" || status === "unpaid") &&
        !location.pathname.startsWith(BILLING_PATH)) {
      const changedAt = tenant?.subscription_status_changed_at
        ? new Date(tenant.subscription_status_changed_at).getTime()
        : Date.now();
      const ageMs = Date.now() - changedAt;
      const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > graceMs) {
        throw redirect({ to: BILLING_PATH });
      }
    }

    return { user: data.user };
  },
  component: RouteComponent,
});

function RouteComponent() {
  // Onboarding wizard uses its own full-screen layout, not AppShell.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/onboarding")) {
    return <Outlet />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}



