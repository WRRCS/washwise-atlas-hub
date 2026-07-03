import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MyJobRow = {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  scheduled_start: string;
  scheduled_end: string;
  notes: string | null;
  client: { id: string; first_name: string | null; last_name: string | null; service_address: string | null } | null;
  service: { id: string; name: string; color: string | null } | null;
  open_entry: { id: string; started_at: string } | null;
};

export type TimeEntryRow = {
  id: string;
  job_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  job: { id: string; client: { first_name: string | null; last_name: string | null } | null } | null;
};

export const listMyJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string; to?: string }) => input)
  .handler(async ({ data, context }): Promise<MyJobRow[]> => {
    const uid = context.userId;
    // Get job ids assigned via job_employees
    const { data: links, error: le } = await context.supabase
      .from("job_employees")
      .select("job_id")
      .eq("employee_id", uid);
    if (le) throw new Error(le.message);
    const jobIds = (links ?? []).map((l: any) => l.job_id);
    if (!jobIds.length) return [];

    let q = context.supabase
      .from("jobs")
      .select("id, status, scheduled_start, scheduled_end, notes, client:clients(id,first_name,last_name,service_address), service:service_types(id,name,color)")
      .in("id", jobIds)
      .order("scheduled_start", { ascending: true });
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lt("scheduled_start", data.to);
    const { data: jobs, error } = await q;
    if (error) throw new Error(error.message);

    const { data: entries } = await context.supabase
      .from("time_entries")
      .select("id, job_id, started_at")
      .eq("user_id", uid)
      .is("ended_at", null)
      .in("job_id", jobIds);
    const openMap = new Map<string, { id: string; started_at: string }>();
    for (const e of entries ?? []) openMap.set((e as any).job_id, { id: (e as any).id, started_at: (e as any).started_at });

    return (jobs ?? []).map((j: any) => ({ ...j, open_entry: openMap.get(j.id) ?? null })) as MyJobRow[];
  });

export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const { data: entry, error } = await context.supabase
      .from("time_entries")
      .insert({ job_id: data.job_id, user_id: context.userId, tenant_id: (prof as any).tenant_id, started_at: new Date().toISOString() })
      .select("id, started_at")
      .single();
    if (error) throw new Error(error.message);
    const { error: ue } = await context.supabase
      .from("jobs")
      .update({ status: "in_progress", actual_start: new Date().toISOString() })
      .eq("id", data.job_id)
      .in("status", ["scheduled", "in_progress"]);
    if (ue) throw new Error(ue.message);
    return entry;
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ entry_id: z.string().uuid(), notes: z.string().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const endedAt = new Date().toISOString();
    const { data: entry, error } = await context.supabase
      .from("time_entries")
      .update({ ended_at: endedAt, notes: data.notes ?? null })
      .eq("id", data.entry_id)
      .eq("user_id", context.userId)
      .select("id, started_at, ended_at, job_id, notes")
      .single();
    if (error) throw new Error(error.message);
    return entry;
  });

export const listMyTimeEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }): Promise<TimeEntryRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("time_entries")
      .select("id, job_id, started_at, ended_at, notes, job:jobs(id, client:clients(first_name,last_name))")
      .eq("user_id", context.userId)
      .gte("started_at", data.from)
      .lt("started_at", data.to)
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as any;
  });
