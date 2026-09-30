import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardStats = {
  jobsThisWeek: number;
  jobsCompletedThisWeek: number;
  revenueThisMonthCents: number;
  outstandingCents: number;
};

export type TodayJob = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  client_name: string;
  service_name: string | null;
  assignees: string[];
};

export type ActivityRow = {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  created_at: string;
};

function weekBounds(now = new Date()) {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Mon=0
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

function monthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function dayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const week = weekBounds();
    const month = monthBounds();

    const [scheduled, completed, paid, outstanding] = await Promise.all([
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_start", week.start)
        .lt("scheduled_start", week.end),
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("scheduled_start", week.start)
        .lt("scheduled_start", week.end),
      supabase
        .from("invoices")
        .select("total_cents")
        .eq("status", "paid")
        .gte("paid_at", month.start)
        .lt("paid_at", month.end),
      supabase
        .from("invoices")
        .select("total_cents")
        .in("status", ["sent", "overdue"]),
    ]);

    const sum = (rows: any[] | null) =>
      (rows ?? []).reduce((a, r) => a + (r.total_cents ?? 0), 0);

    return {
      jobsThisWeek: scheduled.count ?? 0,
      jobsCompletedThisWeek: completed.count ?? 0,
      revenueThisMonthCents: sum(paid.data as any),
      outstandingCents: sum(outstanding.data as any),
    };
  });

export const getTodayJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayJob[]> => {
    const { supabase } = context;
    const { start, end } = dayBounds();
    const { data: jobs } = await supabase
      .from("jobs")
      .select(
        "id, scheduled_start, scheduled_end, status, client:clients(first_name, last_name), service:service_types(name)"
      )
      .gte("scheduled_start", start)
      .lt("scheduled_start", end)
      .order("scheduled_start", { ascending: true });

    const ids = (jobs ?? []).map((j: any) => j.id);
    const assigneeMap = new Map<string, string[]>();
    if (ids.length) {
      const { data: links } = await supabase
        .from("job_employees")
        .select("job_id, profile:profiles!job_employees_employee_id_fkey(full_name)")
        .in("job_id", ids);
      for (const l of (links ?? []) as any[]) {
        const arr = assigneeMap.get(l.job_id) ?? [];
        if (l.profile?.full_name) arr.push(l.profile.full_name);
        assigneeMap.set(l.job_id, arr);
      }
    }

    return (jobs ?? []).map((j: any) => ({
      id: j.id,
      scheduled_start: j.scheduled_start,
      scheduled_end: j.scheduled_end,
      status: j.status,
      client_name:
        [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "—",
      service_name: j.service?.name ?? null,
      assignees: assigneeMap.get(j.id) ?? [],
    }));
  });

export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActivityRow[]> => {
    const { supabase } = context;
    const { data } = await supabase
      .from("activity_log")
      .select("id, action_type, entity_type, entity_id, description, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    return (data ?? []) as ActivityRow[];
  });

export type Debtor = {
  client_id: string | null;
  client_name: string;
  total_cents: number;
  overdue_cents: number;
  invoices: number;
  oldest_due: string | null;
};

export type MoneyOwed = {
  total_cents: number;
  overdue_cents: number;
  overdue_count: number;
  invoice_count: number;
  debtors: Debtor[];
};

/** Everything already invoiced but not yet paid — real money owed, not drafts. */
export const getMoneyOwed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MoneyOwed> => {
    const { data: rows, error } = await context.supabase
      .from("invoices")
      .select("id, client_id, total_cents, status, due_date, client:clients(first_name, last_name)")
      .in("status", ["sent", "overdue"])
      .limit(1000);
    if (error) throw new Error(error.message);

    const todayISO = new Date().toISOString().slice(0, 10);
    const byClient = new Map<string, Debtor>();
    let totalCents = 0;
    let overdueCents = 0;
    let overdueCount = 0;

    for (const r of (rows ?? []) as any[]) {
      const cents = r.total_cents ?? 0;
      const isOverdue =
        r.status === "overdue" || (!!r.due_date && String(r.due_date) < todayISO);
      totalCents += cents;
      if (isOverdue) {
        overdueCents += cents;
        overdueCount += 1;
      }
      const key = r.client_id ?? "__none__";
      const entry = byClient.get(key) ?? {
        client_id: r.client_id ?? null,
        client_name:
          [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ") || "Unassigned client",
        total_cents: 0,
        overdue_cents: 0,
        invoices: 0,
        oldest_due: null as string | null,
      };
      entry.total_cents += cents;
      if (isOverdue) entry.overdue_cents += cents;
      entry.invoices += 1;
      if (r.due_date) {
        const due = String(r.due_date);
        if (!entry.oldest_due || due < entry.oldest_due) entry.oldest_due = due;
      }
      byClient.set(key, entry);
    }

    const debtors = Array.from(byClient.values()).sort((a, b) => b.total_cents - a.total_cents);
    return {
      total_cents: totalCents,
      overdue_cents: overdueCents,
      overdue_count: overdueCount,
      invoice_count: (rows ?? []).length,
      debtors,
    };
  });

export type OpenShift = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  client_name: string;
  property_label: string | null;
  service_name: string | null;
};

/** Published or upcoming jobs in the next 7 days that nobody is assigned to. */
export const getOpenShifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpenShift[]> => {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { data: jobs, error } = await context.supabase
      .from("jobs")
      .select("id, scheduled_start, scheduled_end, client:clients(first_name, last_name), property:client_properties!jobs_property_id_fkey(label), service:service_types(name)")
      .gte("scheduled_start", from.toISOString())
      .lt("scheduled_start", to.toISOString())
      .in("status", ["scheduled", "in_progress"])
      .order("scheduled_start", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);

    const ids = (jobs ?? []).map((j: any) => j.id);
    if (!ids.length) return [];
    const { data: links } = await context.supabase
      .from("job_employees")
      .select("job_id")
      .in("job_id", ids);
    const assigned = new Set((links ?? []).map((l: any) => l.job_id));

    return (jobs ?? [])
      .filter((j: any) => !assigned.has(j.id))
      .map((j: any) => ({
        id: j.id,
        scheduled_start: j.scheduled_start,
        scheduled_end: j.scheduled_end,
        client_name:
          j.property?.label ||
          [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") ||
          "Client",
        property_label: j.property?.label ?? null,
        service_name: j.service?.name ?? null,
      }));
  });
