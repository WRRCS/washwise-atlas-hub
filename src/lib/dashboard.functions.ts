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
        .in("status", ["draft", "sent", "overdue"]),
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
