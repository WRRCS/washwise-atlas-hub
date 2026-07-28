import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Briefcase, Calendar, Users, UserCog, Receipt, LogOut, Plus, Sparkles, ClipboardList, Bell, Plug, LayoutDashboard, BookOpen, Package, FileText, Inbox, Building2, BarChart3, Bot, Shield, CreditCard, MessageSquare, Users2, CalendarClock, ClipboardCheck,
} from "lucide-react";
import { AtlasChat } from "@/components/atlas-chat";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUnreadCount } from "@/lib/sms.functions";
import { amIClientChatCapable, getClientChatUnread } from "@/lib/client-chat.functions";
import wrrcLogo from "@/assets/wrrc-logo.png.asset.json";

const OWNER_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/calendar", label: "Schedule", icon: Calendar },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/client-chat", label: "Client chat", icon: MessageSquare },
  { to: "/leads", label: "Leads", icon: Inbox },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/services", label: "Services", icon: Sparkles },
  { to: "/sops", label: "SOPs", icon: BookOpen },
  { to: "/employees", label: "Employees", icon: UserCog },
  { to: "/team", label: "Team", icon: Users2 },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/requests", label: "Requests", icon: ClipboardCheck },
  { to: "/settings/business", label: "Business profile", icon: Building2 },
  { to: "/settings/templates", label: "Templates", icon: FileText },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/integrations", label: "Integrations", icon: Plug },
  { to: "/settings/ai", label: "AI Assistant", icon: Bot },
  { to: "/settings/billing", label: "Billing & plan", icon: CreditCard },
] as const;

// Employees intentionally do NOT see /messages (client SMS inbox) or
// /clients (full CRM). "Team" replaces those with an internal-only roster
// and teammate messaging.
const EMPLOYEE_NAV = [
  { to: "/my-jobs", label: "My jobs", icon: ClipboardList },
  { to: "/calendar", label: "Schedule", icon: Calendar },
  { to: "/team", label: "Team", icon: Users2 },
  { to: "/time-off", label: "Time off & swaps", icon: CalendarClock },
] as const;

const SUPER_ADMIN_NAV_ITEM = { to: "/super-admin", label: "Platform console", icon: Shield } as const;

const AppShellNestingContext = createContext(false);

export function AppShell({ children }: { children: ReactNode }) {
  const alreadyInsideShell = useContext(AppShellNestingContext);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ full_name: string | null; email: string | null; role: string; isSuperAdmin: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: p }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("id", u.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      const roleSet = new Set((roles ?? []).map((r: any) => r.role));
      const primary = roleSet.has("owner") ? "owner" : roleSet.has("employee") ? "employee" : "employee";
      setProfile({
        full_name: p?.full_name ?? null,
        email: p?.email ?? u.user.email ?? null,
        role: primary,
        isSuperAdmin: roleSet.has("super_admin"),
      });
    })();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const unreadFn = useServerFn(getUnreadCount);
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["sms-unread-count"],
    queryFn: () => unreadFn(),
    enabled: !!profile,
    refetchInterval: 20_000,
  });

  const capableFn = useServerFn(amIClientChatCapable);
  const { data: capable } = useQuery({
    queryKey: ["client-chat-capable"],
    queryFn: () => capableFn(),
    enabled: !!profile,
  });
  const clientChatCapable = !!capable?.capable;

  const clientChatUnreadFn = useServerFn(getClientChatUnread);
  const { data: clientChatUnread } = useQuery({
    queryKey: ["client-chat-unread"],
    queryFn: () => clientChatUnreadFn(),
    enabled: clientChatCapable,
    refetchInterval: 20_000,
  });
  const clientChatUnreadCount = clientChatUnread?.count ?? 0;

  const primaryNav = (() => {
    if (profile?.role === "employee") {
      const base = [...EMPLOYEE_NAV] as Array<{ to: string; label: string; icon: any }>;
      if (clientChatCapable) {
        base.splice(2, 0, { to: "/client-chat", label: "Client chat", icon: MessageSquare });
      }
      return base;
    }
    // owner: OWNER_NAV already includes /client-chat
    return OWNER_NAV as ReadonlyArray<{ to: string; label: string; icon: any }>;
  })();

  if (alreadyInsideShell) {
    return <>{children}</>;
  }

  return (
    <AppShellNestingContext.Provider value={true}>
      <div className="min-h-screen bg-clay-50 text-foreground selection:bg-brand/10 selection:text-brand">
      <div className="flex min-h-screen">
        <aside className="hidden md:flex w-64 border-r border-border/60 flex-col bg-clay-100 shrink-0">
          <div className="p-6">
            <div className="px-2">
              <img src={wrrcLogo.url} alt="Wash Rinse Repeat Cleaning Services" className="w-full h-auto object-contain" />
            </div>
          </div>


          <nav className="flex-1 px-4 space-y-1">
            {primaryNav.map((item) => {
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
                  {item.to === "/messages" && unreadCount > 0 && (
                    <span className="ml-auto bg-brand text-brand-foreground text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                  {item.to === "/client-chat" && clientChatUnreadCount > 0 && (
                    <span className="ml-auto bg-brand text-brand-foreground text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {clientChatUnreadCount > 99 ? "99+" : clientChatUnreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
            {profile?.isSuperAdmin && (
              <Link
                to={SUPER_ADMIN_NAV_ITEM.to}
                className={`mt-4 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors border-t border-border/60 pt-4 ${
                  pathname.startsWith(SUPER_ADMIN_NAV_ITEM.to)
                    ? "text-brand font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Shield className="size-4 shrink-0" />
                {SUPER_ADMIN_NAV_ITEM.label}
              </Link>
            )}
          </nav>

          <div className="p-4 border-t border-border/60">
            <div className="bg-clay-200/50 rounded-lg p-3 ring-1 ring-black/5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {profile?.isSuperAdmin ? "Super admin" : profile?.role === "owner" ? "Owner" : "Cleaner"}
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
            <img src={wrrcLogo.url} alt="Wash Rinse Repeat Cleaning Services" className="h-8 w-auto object-contain" />
          </div>

          <button onClick={signOut} className="text-xs text-muted-foreground"><LogOut className="size-4" /></button>
        </div>
        {/* mobile bottom nav */}
        <div className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-clay-100 border-t border-border/60 flex">
          {primaryNav.slice(0, 5).map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={`relative flex-1 flex flex-col items-center py-2 text-[10px] ${active ? "text-brand" : "text-muted-foreground"}`}>
                <Icon className="size-4 mb-0.5" />
                {item.label}
                {item.to === "/messages" && unreadCount > 0 && (
                  <span className="absolute top-1 right-1/3 bg-brand text-brand-foreground text-[9px] font-medium rounded-full size-3.5 grid place-items-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <main className="flex-1 flex flex-col pt-14 md:pt-0 pb-16 md:pb-0 min-w-0">
          {children}
        </main>
      </div>
      <AtlasChat />
      </div>
    </AppShellNestingContext.Provider>
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
