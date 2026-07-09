import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/app-shell";
import { amISuperAdmin } from "@/lib/admin.functions";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/super-admin")({
  component: SuperAdminLayout,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-destructive">{error.message}</div></AppShell>
  ),
  notFoundComponent: () => <AppShell><div className="p-8">Not found</div></AppShell>,
});

function SuperAdminLayout() {
  const check = useServerFn(amISuperAdmin);
  const { data, isLoading } = useQuery({ queryKey: ["am-super-admin"], queryFn: () => check() });

  if (isLoading) {
    return <AppShell><div className="p-8 text-muted-foreground">Checking permissions…</div></AppShell>;
  }
  if (!data) {
    return (
      <AppShell>
        <div className="p-12 max-w-lg mx-auto text-center">
          <Shield className="size-10 mx-auto text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium mb-1">Restricted</h2>
          <p className="text-sm text-muted-foreground">You need a super-admin role to view the platform console.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Platform console"
        subtitle="Cross-tenant visibility · every view is audited"
        action={
          <nav className="flex gap-1 text-sm">
            <Link
              to="/super-admin"
              activeOptions={{ exact: true }}
              className="px-3 py-1.5 rounded-md text-muted-foreground [&.active]:bg-clay-200/60 [&.active]:text-foreground"
            >Overview</Link>
            <Link
              to="/super-admin/audit"
              className="px-3 py-1.5 rounded-md text-muted-foreground [&.active]:bg-clay-200/60 [&.active]:text-foreground"
            >Audit log</Link>
          </nav>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8">
        <Outlet />
      </div>
    </AppShell>
  );
}
