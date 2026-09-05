import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsLayout,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-red-600">Error: {error.message}</div></AppShell>
  ),
  notFoundComponent: () => <AppShell><div className="p-8">Not found</div></AppShell>,
});

const TABS = [
  { to: "/reports", label: "Overview", exact: true },
  { to: "/reports/weekly", label: "Weekly overview" },
  { to: "/reports/sales", label: "Sales summary" },
  { to: "/reports/transactions", label: "Transactions" },
  { to: "/reports/invoices", label: "Invoices" },
  { to: "/reports/balances", label: "Client balances" },
  { to: "/reports/clients", label: "Client accounts" },
  { to: "/reports/timesheets", label: "Timesheets" },
  { to: "/reports/communications", label: "Communications" },
] as const;

function ReportsLayout() {
  return (
    <AppShell>
      <PageHeader title="Reports" subtitle="Owner reporting — revenue, billing, clients, and history" />
      <div className="border-b border-border/60 bg-card/60">
        <nav className="max-w-7xl mx-auto w-full px-6 md:px-8 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              activeOptions={{ exact: "exact" in t ? t.exact : false }}
              className="whitespace-nowrap px-3 py-3 text-sm text-muted-foreground border-b-2 border-transparent hover:text-foreground"
              activeProps={{ className: "!text-foreground !border-brand font-medium" }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </AppShell>
  );
}
