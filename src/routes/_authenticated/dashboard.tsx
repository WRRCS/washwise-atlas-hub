import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/app-shell";
import {
  getDashboardStats,
  getTodayJobs,
  getRecentActivity,
  type ActivityRow,
} from "@/lib/dashboard.functions";
import { listLowInventory, logInventoryTransaction, type InventoryItem } from "@/lib/inventory.functions";
import { countNewLeads } from "@/lib/leads.functions";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  DollarSign,
  FileText,
  Plus,
  UserPlus,
  Receipt,
  CalendarDays,
  Package,
  Activity as ActivityIcon,
  Briefcase,
  CircleDollarSign,
  Inbox,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  errorComponent: ({ error }) => (
    <AppShell>
      <div className="p-8 text-sm text-destructive">
        Failed to load dashboard: {error.message}
      </div>
    </AppShell>
  ),
});

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const fetchStats = useServerFn(getDashboardStats);
  const fetchToday = useServerFn(getTodayJobs);
  const fetchActivity = useServerFn(getRecentActivity);
  const fetchNewLeads = useServerFn(countNewLeads);

  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => fetchStats() });
  const { data: today = [] } = useQuery({ queryKey: ["dashboard-today"], queryFn: () => fetchToday() });
  const { data: activity = [] } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => fetchActivity(),
  });
  const { data: newLeadsCount = 0 } = useQuery({
    queryKey: ["new-leads-count"],
    queryFn: () => fetchNewLeads(),
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={format(new Date(), "EEEE, MMMM d, yyyy")}
      />
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-6">
        {/* Stat row */}
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
            label="Outstanding"
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
            <Link
              to="/clients"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <UserPlus className="size-4 text-brand" /> New Client
            </Link>
            <Link
              to="/jobs/new"
              className="flex items-center gap-2 rounded-lg bg-brand text-brand-foreground hover:opacity-90 transition-opacity px-3 py-2.5 text-sm font-medium"
            >
              <Plus className="size-4" /> New Job
            </Link>
            <Link
              to="/calendar"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <CalendarDays className="size-4 text-brand" /> Schedule
            </Link>
            <Link
              to="/invoices"
              className="flex items-center gap-2 rounded-lg bg-clay-100 hover:bg-clay-200/70 transition-colors px-3 py-2.5 text-sm font-medium"
            >
              <Receipt className="size-4 text-brand" /> Invoices
            </Link>
          </div>
        </div>

        {/* New leads card */}
        <Link
          to="/leads"
          className="flex items-center gap-4 bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5 hover:ring-brand/40 transition-all group"
        >
          <div className="size-11 rounded-lg bg-brand/10 text-brand grid place-items-center shrink-0">
            <Inbox className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">New Leads</h2>
              {newLeadsCount > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand text-brand-foreground font-medium">
                  {newLeadsCount}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {newLeadsCount === 0
                ? "No new website submissions."
                : `${newLeadsCount} website submission${newLeadsCount === 1 ? "" : "s"} waiting to be reviewed.`}
            </p>
          </div>
          <span className="text-xs text-brand group-hover:underline shrink-0">View all →</span>
        </Link>


        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Today's schedule */}
          <section className="lg:col-span-2 bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium">Today's Schedule</h2>
              <Link to="/calendar" className="text-xs text-brand hover:underline">
                View schedule →
              </Link>
            </div>
            {today.length === 0 ? (
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
                        <p className="text-sm font-medium truncate">{j.client_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {j.service_name ?? "Service"} ·{" "}
                          {j.assignees.length ? j.assignees.join(", ") : "Unassigned"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm tabular-nums">
                          {format(new Date(j.scheduled_start), "h:mm a")}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {j.status.replace("_", " ")}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent activity */}
          <section className="bg-card rounded-xl ring-1 ring-black/5 p-4 sm:p-5">
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
        </div>

        <LowInventoryCard />
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
          <p className="text-sm text-muted-foreground">All supplies are stocked. 🎉</p>
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

