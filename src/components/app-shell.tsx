import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Briefcase, Calendar, Users, UserCog, Receipt, LogOut, Plus, Sparkles, ClipboardList,
} from "lucide-react";

const OWNER_NAV = [
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/calendar", label: "Schedule", icon: Calendar },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/services", label: "Services", icon: Sparkles },
  { to: "/employees", label: "Employees", icon: UserCog },
  { to: "/invoices", label: "Invoices", icon: Receipt },
] as const;

const EMPLOYEE_NAV = [
  { to: "/my-jobs", label: "My jobs", icon: ClipboardList },
  { to: "/calendar", label: "Schedule", icon: Calendar },
  { to: "/clients", label: "Clients", icon: Users },
] as const;



export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ full_name: string | null; email: string | null; role: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("id", u.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id).order("role").limit(1).maybeSingle(),
      ]);
      setProfile({
        full_name: p?.full_name ?? null,
        email: p?.email ?? u.user.email ?? null,
        role: r?.role ?? "employee",
      });
    })();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-clay-50 text-foreground selection:bg-brand/10 selection:text-brand">
      <div className="flex min-h-screen">
        <aside className="hidden md:flex w-64 border-r border-border/60 flex-col bg-clay-100 shrink-0">
          <div className="p-6">
            <div className="flex items-center gap-2.5 px-2">
              <div className="size-6 rounded bg-brand grid place-items-center">
                <div className="size-2 bg-clay-50 rounded-full" />
              </div>
              <span className="font-medium tracking-tight text-lg">Atlas</span>
            </div>
          </div>

          <nav className="flex-1 px-4 space-y-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active ? "bg-brand/5 text-brand font-medium" : "text-muted-foreground hover:bg-clay-200/50"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-border/60">
            <div className="bg-clay-200/50 rounded-lg p-3 ring-1 ring-black/5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {profile?.role === "owner" ? "Owner" : "Cleaner"}
              </p>
              <div className="flex items-center gap-3 mb-3">
                <div className="size-8 rounded-full bg-clay-200 grid place-items-center text-xs font-medium">
                  {(profile?.full_name ?? profile?.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{profile?.full_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                </div>
              </div>
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="size-3" /> Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* mobile top bar */}
        <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-clay-100 border-b border-border/60 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-5 rounded bg-brand" />
            <span className="font-medium tracking-tight">Atlas</span>
          </div>
          <button onClick={signOut} className="text-xs text-muted-foreground"><LogOut className="size-4" /></button>
        </div>
        {/* mobile bottom nav */}
        <div className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-clay-100 border-t border-border/60 flex">
          {NAV.slice(0, 5).map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={`flex-1 flex flex-col items-center py-2 text-[10px] ${active ? "text-brand" : "text-muted-foreground"}`}>
                <Icon className="size-4 mb-0.5" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <main className="flex-1 flex flex-col pt-14 md:pt-0 pb-16 md:pb-0 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="bg-clay-50 border-b border-border/60 sticky top-0 z-10 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-balance">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function BrandButton({ children, onClick, type = "button" }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 transition-opacity"
    >
      <Plus className="size-4" />
      {children}
    </button>
  );
}
