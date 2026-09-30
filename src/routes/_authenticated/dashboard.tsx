import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/app-shell";
import { LogLeadDialog } from "@/components/log-lead-dialog";
import {
  getDashboardStats,
  getMoneyOwed,
  getOpenShifts,
  getRecentActivity,
  type ActivityRow,
} from "@/lib/dashboard.functions";
import { listNeedsReply, leadSourceLabel } from "@/lib/leads.functions";
import { listLowInventory, logInventoryTransaction, type InventoryItem } from "@/lib/inventory.functions";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  DollarSign,
  FileText,
  Plus,
  UserPlus,
  Receipt,
  Package,
  Activity as ActivityIcon,
  Briefcase,
  CircleDollarSign,
  Inbox,
  UserRoundSearch,
  AlarmClock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { listJobs } from "@/lib/jobs.functions";
import { useBusinessTz } from "@/hooks/use-business-tz";
import { dayKeyTZ, fmtTimeTZ, zonedToUTCISO } from "@/lib/tz";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "Dashboard | WRRCS.com" },
    { name: "description", content: "Today's cleaning schedule, money owed, and leads waiting for a reply." },
    { property: "og:title", content: "Dashboard | WRRCS.com" },
    { property: "og:description", content: "Today's cleaning schedule, money owed, and leads waiting for a reply." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DashboardPage,
  errorComponent: ({ error }) => (
    <AppShell>
      <div className="p-8 text-sm text-destructive">
        Failed to load dashboard: {(error as Error).message}
      </div>
    </AppShell>
  ),
});

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWaiting(hours: number) {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h waiting`;
  return `${Math.round(hours / 24)}d waiting`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className={`size-8 rounded-lg grid place-items-center ${accent}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="text-2xl font-medium tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

const ACTIVITY_ICON: Record<string, { icon: any; tone: string }> = {
  job_created: { icon: Calendar, tone: "bg-clay-200 text-foreground" },
  job_completed: { icon: CheckCircle2, tone: "bg-brand/10 text-brand" },
  invoice_created: { icon: Receipt, tone: "bg-clay-200 text-foreground" },
  invoice_paid: { icon: CircleDollarSign, tone: "bg-success/15 text-success" },
  client_created: { icon: UserPlus, tone: "bg-clay-200 text-foreground" },
};

function ActivityItem({ row }: { row: ActivityRow }) {
  const meta = ACTIVITY_ICON[row.action_type] ?? {
    icon: ActivityIcon,
    tone: "bg-clay-200 text-foreground",
  };
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-3 py-3">
      <div className={`size-8 rounded-full grid place-items-center shrink-0 ${meta.tone}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{row.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
        </p>
      </div>
    </li>
  );
}

function DashboardPage() {
  const tz = useBusinessTz();
  const todayKey = dayKeyTZ(new Date(), tz);
  const tomorrowKey = new Date(Date.parse(`${todayKey}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = zonedToUTCISO(todayKey, "00:00", tz);
  const to = zonedToUTCISO(tomorrowKey, "00:00", tz);
  const fetchStats = useServerFn(getDashboardStats);
  const fetchJobs = useServerFn(listJobs);
  const fetchActivity = useServerFn(getRecentActivity);
  const fetchMoney = useServerFn(getMoneyOwed);
  const fetchOpen = useServerFn(getOpenShifts);
  const fetchNeedsReply = useServerFn(listNeedsReply);

  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => fetchStats() });
  const { data: today = [], isPending: todayPending, isError: todayError } = useQuery({
    queryKey: ["jobs", "dashboard-day", from, to],
    queryFn: () => fetchJobs({ data: { from, to } }),
    refetchInterval: 5 * 60_000,
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => fetchActivity(),
  });
  const { data: money } = useQuery({
    queryKey: ["dashboard-money"],
    queryFn: () => fetchMoney(),
  });
  const { data: openShifts = [] } = useQuery({
    queryKey: ["dashboard-open-shifts"],
    queryFn: () => fetchOpen(),
  });
  const { data: needsReply = [] } = useQuery({
    queryKey: ["dashboard-needs-reply"],
    queryFn: () => fetchNeedsReply(),
  });

  const openToday = today.filter((j) => j.assignees.length === 0).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date())}
        action={
          <LogLeadDialog>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90"
            >
              <UserRoundSearch className="size-4" /> Log a lead
            </button>
          </LogLeadDialog>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-6">
        {/* ---- What needs you first ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Today's schedule */}
            <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium">
                  Today's jobs
                  {today.length > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      {today.length} {today.length === 1 ? "clean" : "cleans"}
                    </span>
                  )}
                </h2>
                <Link to="/calendar" className="text-xs text-brand hover:underline">
                  View schedule →
                </Link>
              </div>
              {todayError ? (
                <p className="text-sm text-destructive py-6 text-center">Could not load today's schedule.</p>
              ) : todayPending ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading today's schedule…</p>
              ) : today.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-10 text-center">
                  <Briefcase className="size-5 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No jobs scheduled today.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {today.map((j) => (
                    <li key={j.id}>
                      <Link
                        to="/jobs/$jobId"
                        params={{ jobId: j.id }}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 hover:bg-clay-100/60 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{j.property?.label || [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "Client"}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {j.service?.name ?? "Service"} ·{" "}
                            {j.assignees.length ? j.assignees.map((a) => a.full_name ?? "Team member").join(", ") : "Open shift"}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm tabular-nums">
                            {fmtTimeTZ(j.scheduled_start, tz)}–{fmtTimeTZ(j.scheduled_end, tz)}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {j.status.replace("_", " ")}{!j.published_at ? " · draft" : ""}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Open shifts */}
            <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <AlarmClock className="size-4 text-warning" />
                  Open shifts
                  {openShifts.length > 0 && (
                    <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      {openShifts.length}
                    </span>
                  )}
                </h2>
                <Link to="/calendar" className="text-xs text-brand hover:underline">
                  Fill them →
                </Link>
              </div>
              {openShifts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every job in the next 7 days has someone on it.
                  {openToday > 0 ? " Today still needs coverage." : ""}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {openShifts.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <Link
                        to="/jobs/$jobId"
                        params={{ jobId: s.id }}
                        className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-clay-100/60 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.client_name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {format(new Date(s.scheduled_start), "EEE MMM d")} · {s.service_name ?? "Service"}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                          {fmtTimeTZ(s.scheduled_start, tz)}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {openShifts.length > 4 && (
                    <li className="pt-2 text-xs text-muted-foreground">
                      +{openShifts.length - 4} more in the next 7 days
                    </li>
                  )}
                </ul>
              )}
            </section>
          </div>

          <div className="space-y-4">
            {/* Money owed */}
            <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="size-4 text-destructive" />
                  Money owed
                </h2>
                <Link to="/invoices" className="text-xs text-brand hover:underline">
                  Invoices →
                </Link>
              </div>
              <p className="text-2xl font-medium tracking-tight tabular-nums">
                {money ? fmtCents(money.total_cents) : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {money && money.invoice_count > 0
                  ? `${money.invoice_count} unpaid invoice${money.invoice_count === 1 ? "" : "s"}`
                  : "Nothing invoiced and unpaid."}
                {money && money.overdue_count > 0 && (
                  <> · <span className="text-destructive">{fmtCents(money.overdue_cents)} past due</span></>
                )}
              </p>
              {money && money.debtors.length > 0 && (
                <ul className="mt-3 divide-y divide-border/60">
                  {money.debtors.slice(0, 4).map((d) => (
                    <li key={d.client_id ?? d.client_name} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{d.client_name}</p>
                        {d.oldest_due && new Date(`${d.oldest_due}T23:59:59`) < new Date() && (
                          <p className="text-[10px] uppercase tracking-wider text-destructive">
                            due {format(new Date(`${d.oldest_due}T12:00:00`), "MMM d")}
                          </p>
                        )}
                      </div>
                      <span className="text-sm tabular-nums shrink-0">{fmtCents(d.total_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Leads needing a reply */}
            <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <Inbox className="size-4 text-brand" />
                  Needs a reply
                  {needsReply.length > 0 && (
                    <span className="rounded-full bg-brand text-brand-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      {needsReply.length}
                    </span>
                  )}
                </h2>
                <Link to="/leads" className="text-xs text-brand hover:underline">
                  Leads →
                </Link>
              </div>
              {needsReply.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every prospect has been answered. Log a new one any time.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {needsReply.slice(0, 4).map((l) => (
                    <li key={l.id}>
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: l.id }}
                        className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-clay-100/60 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{l.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {leadSourceLabel(l.source)}
                            {l.service_interest ? ` · ${l.service_interest}` : ""}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-destructive shrink-0">
                          {fmtWaiting(l.hours_waiting)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* ---- Week at a glance ---- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            icon={Calendar}
            label="Scheduled this week"
            value={String(stats?.jobsThisWeek ?? "—")}
            accent="bg-brand/10 text-brand"
          />
          <StatCard
            icon={CheckCircle2}
            label="Completed this week"
            value={String(stats?.jobsCompletedThisWeek ?? "—")}
            accent="bg-success/15 text-success"
          />
          <StatCard
            icon={DollarSign}
            label="Revenue this month"
            value={stats ? fmtCents(stats.revenueThisMonthCents) : "—"}
            accent="bg-clay-200 text-foreground"
          />
          <StatCard
            icon={FileText}
            label="Money owed"
            value={stats ? fmtCents(stats.outstandingCents) : "—"}
            accent="bg-destructive/10 text-destructive"
          />
        </div>

        {/* Quick actions */}
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <LogLeadDialog>
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-lg bg-brand text-brand-foreground hover:opacity-90 transition-opacity px-3 py-2.5 text-sm font-medium"
              >
                <UserRoundSearch className="size-4" /> Log a lead
              </button>
            </LogLeadDialog>
            <Link
              to="/clients"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <UserPlus className="size-4 text-brand" /> New Client
            </Link>
            <Link
              to="/jobs/new"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <Plus className="size-4 text-brand" /> New Job
            </Link>
            <Link
              to="/invoices"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <Receipt className="size-4 text-brand" /> Invoices
            </Link>
          </div>
        </div>

        {/* ---- Activity & supplies ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <section className="lg:col-span-2 bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
            <h2 className="text-sm font-medium mb-2">Recent Activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No activity yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {activity.map((row) => (
                  <ActivityItem key={row.id} row={row} />
                ))}
              </ul>
            )}
          </section>
          <LowInventoryCard />
        </div>
      </div>
    </>
  );
}

function LowInventoryCard() {
  const fetchLow = useServerFn(listLowInventory);
  const { data: items = [], refetch } = useQuery<InventoryItem[]>({
    queryKey: ["dashboard-low-inventory"],
    queryFn: () => fetchLow(),
  });
  const restock = useServerFn(logInventoryTransaction);
  const onRestock = async (id: string, name: string) => {
    try {
      await restock({ data: { item_id: id, change_amount: 1, reason: "restock" } });
      toast.success(`+1 ${name}`);
      refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Package className="size-4 text-muted-foreground" />
          Low Inventory Alerts
        </h2>
        <Link to="/inventory" className="text-xs text-brand hover:underline">Manage inventory</Link>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm text-muted-foreground">All supplies are stocked.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{it.name}</p>
                <p className="text-xs text-muted-foreground">
                  {it.quantity_on_hand} {it.unit} on hand · reorder at {it.reorder_threshold}
                </p>
              </div>
              <span className={`text-[10px] mr-3 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium ${
                it.status === "OUT" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
              }`}>{it.status}</span>
              <button
                onClick={() => onRestock(it.id, it.name)}
                className="text-xs font-medium bg-clay-100 hover:bg-clay-200/70 transition-colors px-2.5 py-1.5 rounded-md"
              >
                +1 Restock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
