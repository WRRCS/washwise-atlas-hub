import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    // Onboarding gate: if the tenant hasn't finished onboarding, force the wizard.
    if (!location.pathname.startsWith("/onboarding")) {
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", data.user.id).maybeSingle();
      if (profile?.tenant_id) {
        const { data: tenant } = await supabase
          .from("tenants").select("onboarding_completed").eq("id", profile.tenant_id).maybeSingle();
        if (tenant && !tenant.onboarding_completed) {
          throw redirect({ to: "/onboarding" });
        }
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



