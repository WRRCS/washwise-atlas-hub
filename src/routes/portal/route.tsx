import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { logout } from "@/lib/portal.functions";
import { Calendar, LogOut, MessageSquare, Receipt } from "lucide-react";

export const Route = createFileRoute("/portal")({
  ssr: false,
  beforeLoad: () => {
    if (typeof window !== "undefined" && !localStorage.getItem("portal_session")) {
      throw redirect({ to: "/portal-login" });
    }
  },
  component: PortalLayout,
});

const NAV = [
  { to: "/portal", label: "Appointments", icon: Calendar },
  { to: "/portal/messages", label: "Messages", icon: MessageSquare },
  { to: "/portal/billing", label: "Billing", icon: Receipt },
] as const;

function PortalLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const logoutFn = useServerFn(logout);
  const [clientName] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("portal_client_name") : null));

  const signOut = async () => {
    const token = localStorage.getItem("portal_session");
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_client_name");
    if (token) {
      try { await logoutFn({ data: { session_token: token } }); } catch { /* already signing out */ }
    }
    navigate({ to: "/portal-login", replace: true });
  };

  return (
    <div className="min-h-screen bg-clay-50">
      <header className="bg-clay-100 border-b border-border/60 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Wash Rinse Repeat Cleaning</p>
          <p className="text-sm font-medium">{clientName ? `Hi, ${clientName}` : "Client portal"}</p>
        </div>
        <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
          <LogOut className="size-3.5" /> Sign out
        </button>
      </header>

      <nav className="bg-clay-100 border-b border-border/60 px-4 flex gap-1">
        {NAV.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
                active ? "border-brand text-brand font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" /> {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="max-w-2xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
