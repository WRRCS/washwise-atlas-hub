import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function tenantOf(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("current_tenant_id");
  if (!data) throw new Error("No business profile found");
  return data as string;
}

/**
 * Put an open (unassigned) shift on someone's schedule.
 * Owners/managers can assign anyone; team members can only claim it for themselves.
 */
export const claimOpenShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ job_id: z.string().uuid(), employee_id: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context);
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager");
    const employeeId = data.employee_id ?? context.userId;
    if (!isMgr && employeeId !== context.userId) throw new Error("You can only pick up shifts for yourself");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs").select("id, tenant_id, assigned_to, status").eq("id", data.job_id).maybeSingle();
    if (!job || job.tenant_id !== tenantId) throw new Error("Shift not found");
    const { count } = await supabaseAdmin
      .from("job_employees").select("job_id", { count: "exact", head: true }).eq("job_id", data.job_id);
    if (job.assigned_to || (count ?? 0) > 0) throw new Error("Someone already has this shift");
    const { data: emp } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("id", employeeId).maybeSingle();
    if (!emp || emp.tenant_id !== tenantId) throw new Error("Employee not found");

    const { error: je } = await supabaseAdmin.from("job_employees").insert({ job_id: data.job_id, employee_id: employeeId, tenant_id: tenantId });
    if (je) throw new Error(je.message);
    const { error } = await supabaseAdmin.from("jobs").update({ assigned_to: employeeId }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type JobVisit = { id: string; arrived_at: string; left_at: string | null };

export const getMyJobVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<JobVisit | null> => {
    const { data: rows } = await (context.supabase as any)
      .from("job_visits").select("id, arrived_at, left_at")
      .eq("job_id", data.job_id).eq("employee_id", context.userId)
      .order("arrived_at", { ascending: false }).limit(1);
    return (rows?.[0] as JobVisit) ?? null;
  });

export const arriveAtJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context);
    const sb = context.supabase as any;
    // Close any visit left open at another appointment.
    await sb.from("job_visits").update({ left_at: new Date().toISOString() })
      .eq("employee_id", context.userId).is("left_at", null);
    const { data: row, error } = await sb.from("job_visits")
      .insert({ tenant_id: tenantId, job_id: data.job_id, employee_id: context.userId })
      .select("id, arrived_at, left_at").single();
    if (error) throw new Error(error.message);
    // Arrived also clocks in, unless the clock is already running (e.g. driving from the last job).
    const { count } = await context.supabase.from("time_entries").select("id", { count: "exact", head: true })
      .eq("user_id", context.userId).is("ended_at", null);
    if (!count) {
      await context.supabase.from("time_entries").insert({ tenant_id: tenantId, job_id: data.job_id, user_id: context.userId, started_at: row.arrived_at });
    }
    await context.supabase.from("jobs").update({ status: "in_progress", actual_start: row.arrived_at })
      .eq("id", data.job_id).eq("status", "scheduled");
    return row as JobVisit;
  });

export const leaveJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ visit_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { data: row, error } = await (context.supabase as any).from("job_visits")
      .update({ left_at: now })
      .eq("id", data.visit_id).eq("employee_id", context.userId)
      .select("id, job_id, arrived_at, left_at").single();
    if (error) throw new Error(error.message);
    // Leaving stops time at this job only; the day clock keeps running so drive time counts.
    return { id: row.id, arrived_at: row.arrived_at, left_at: row.left_at } as JobVisit;
  });

export type TimesheetDay = {
  employee_id: string;
  employee_name: string;
  day: string; // yyyy-mm-dd (UTC date of clock-in / first event)
  clock_in: string | null;
  clock_out: string | null;
  entries: { id: string; started_at: string; ended_at: string | null }[];
  visits: { id: string; client: string; arrived_at: string; left_at: string | null }[];
};

/** Clock in/out plus arrive/leave at every appointment. Managers see everyone; others see themselves. */
export const listTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ from: z.string(), to: z.string(), tz: z.string().default("UTC") }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TimesheetDay[]> => {
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager");
    const sb = context.supabase as any;
    let te = sb.from("time_entries").select("id, user_id, started_at, ended_at")
      .gte("started_at", data.from).lt("started_at", data.to);
    let jv = sb.from("job_visits").select("id, employee_id, arrived_at, left_at, job:jobs(client:clients(first_name,last_name))")
      .gte("arrived_at", data.from).lt("arrived_at", data.to);
    if (!isMgr) { te = te.eq("user_id", context.userId); jv = jv.eq("employee_id", context.userId); }
    const [{ data: entries }, { data: visits }, { data: profs }] = await Promise.all([
      te, jv, context.supabase.rpc("staff_directory"),
    ]);
    const names = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name ?? "Unknown"]));
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: data.tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const map = new Map<string, TimesheetDay>();
    const get = (emp: string, iso: string) => {
      const day = fmt.format(new Date(iso));
      const k = `${emp}|${day}`;
      if (!map.has(k)) map.set(k, { employee_id: emp, employee_name: names.get(emp) ?? "Unknown", day, clock_in: null, clock_out: null, entries: [], visits: [] });
      return map.get(k)!;
    };
    for (const e of entries ?? []) {
      const d = get(e.user_id, e.started_at);
      d.entries.push({ id: e.id, started_at: e.started_at, ended_at: e.ended_at });
      if (!d.clock_in || e.started_at < d.clock_in) d.clock_in = e.started_at;
      if (e.ended_at && (!d.clock_out || e.ended_at > d.clock_out)) d.clock_out = e.ended_at;
    }
    for (const v of visits ?? []) {
      const d = get(v.employee_id, v.arrived_at);
      const c = v.job?.client;
      d.visits.push({ id: v.id, client: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Appointment", arrived_at: v.arrived_at, left_at: v.left_at });
    }
    const out = [...map.values()];
    out.forEach((d) => d.entries.sort((a, b) => a.started_at.localeCompare(b.started_at)));
    out.forEach((d) => d.visits.sort((a, b) => a.arrived_at.localeCompare(b.arrived_at)));
    return out.sort((a, b) => b.day.localeCompare(a.day) || a.employee_name.localeCompare(b.employee_name));
  });

async function assertManagerEntry(context: { supabase: any; userId: string }, entryId: string) {
  const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager");
  if (!isMgr) throw new Error("Only owners and managers can change time entries");
  const tenantId = await tenantOf(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: entry } = await supabaseAdmin.from("time_entries").select("id, tenant_id").eq("id", entryId).maybeSingle();
  if (!entry || entry.tenant_id !== tenantId) throw new Error("Time entry not found");
  return supabaseAdmin;
}

/** Owners/managers: fix clock in/out times, or clock someone out who forgot (ended_at = now). */
export const updateTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      started_at: z.string().datetime({ offset: true }).optional(),
      ended_at: z.string().datetime({ offset: true }).nullable().optional(),
      clock_out_now: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertManagerEntry(context, data.id);
    const patch: { started_at?: string; ended_at?: string | null } = {};
    if (data.started_at) patch.started_at = data.started_at;
    if (data.clock_out_now) patch.ended_at = new Date().toISOString();
    else if (data.ended_at !== undefined) patch.ended_at = data.ended_at;
    if (patch.started_at && patch.ended_at && patch.ended_at < patch.started_at) throw new Error("Clock out must be after clock in");
    const { error } = await admin.from("time_entries").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertManagerEntry(context, data.id);
    const { error } = await admin.from("time_entries").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type DailyRow = {
  key: string;
  employee_id: string;
  employee_name: string;
  job_id: string | null;
  client: string;
  property: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  visit_id: string | null;
  arrived_at: string | null;
  left_at: string | null;
  drive_min: number;
};

export type DailyTimesheet = {
  rows: DailyRow[];
  entries: { id: string; employee_id: string; employee_name: string; started_at: string; ended_at: string | null }[];
};

/** One row per cleaner per job for a single day: scheduled vs. actual arrive/leave, plus drive time between jobs. */
export const listDailyTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }): Promise<DailyTimesheet> => {
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager");
    const sb = context.supabase as any;
    const jobSel = "id, scheduled_start, scheduled_end, status, assigned_to, client:clients(first_name,last_name), property:client_properties(label,address), job_employees(employee_id)";
    let te = sb.from("time_entries").select("id, user_id, started_at, ended_at").gte("started_at", data.from).lt("started_at", data.to);
    let jv = sb.from("job_visits").select("id, job_id, employee_id, arrived_at, left_at").gte("arrived_at", data.from).lt("arrived_at", data.to);
    if (!isMgr) { te = te.eq("user_id", context.userId); jv = jv.eq("employee_id", context.userId); }
    const [{ data: entries }, { data: visits }, { data: jobs }, { data: profs }] = await Promise.all([
      te, jv,
      sb.from("jobs").select(jobSel).gte("scheduled_start", data.from).lt("scheduled_start", data.to).neq("status", "canceled"),
      context.supabase.rpc("staff_directory"),
    ]);
    const names = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.full_name ?? "Unknown"]));
    const jobMap = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));
    // Visits on jobs scheduled another day still need their job details.
    const missing = [...new Set(((visits ?? []) as any[]).map((v) => v.job_id).filter((id) => id && !jobMap.has(id)))];
    if (missing.length) {
      const { data: extra } = await sb.from("jobs").select(jobSel).in("id", missing);
      for (const j of extra ?? []) jobMap.set(j.id, j);
    }
    const label = (j: any) => {
      const c = j?.client;
      return [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Appointment";
    };
    const prop = (j: any) => j?.property ? (j.property.label || j.property.address || null) : null;
    const rows: DailyRow[] = [];
    const seen = new Set<string>();
    for (const v of (visits ?? []) as any[]) {
      const j = jobMap.get(v.job_id);
      seen.add(`${v.employee_id}|${v.job_id}`);
      rows.push({
        key: v.id, employee_id: v.employee_id, employee_name: names.get(v.employee_id) ?? "Unknown",
        job_id: v.job_id, client: label(j), property: prop(j),
        scheduled_start: j?.scheduled_start ?? null, scheduled_end: j?.scheduled_end ?? null,
        visit_id: v.id, arrived_at: v.arrived_at, left_at: v.left_at, drive_min: 0,
      });
    }
    for (const j of (jobs ?? []) as any[]) {
      const emps = new Set<string>([...(j.job_employees ?? []).map((x: any) => x.employee_id), ...(j.assigned_to ? [j.assigned_to] : [])]);
      for (const e of emps) {
        if (!isMgr && e !== context.userId) continue;
        if (seen.has(`${e}|${j.id}`)) continue;
        rows.push({
          key: `${j.id}|${e}`, employee_id: e, employee_name: names.get(e) ?? "Unknown",
          job_id: j.id, client: label(j), property: prop(j),
          scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end,
          visit_id: null, arrived_at: null, left_at: null, drive_min: 0,
        });
      }
    }
    // Drive/other time = gap since the cleaner clocked in or left their previous job.
    const entryList = ((entries ?? []) as any[]).map((e) => ({
      id: e.id, employee_id: e.user_id, employee_name: names.get(e.user_id) ?? "Unknown", started_at: e.started_at, ended_at: e.ended_at,
    }));
    const byEmp = new Map<string, DailyRow[]>();
    for (const r of rows) if (r.arrived_at) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) ?? []), r]);
    for (const [emp, list] of byEmp) {
      list.sort((a, b) => a.arrived_at!.localeCompare(b.arrived_at!));
      const clockIn = entryList.filter((e) => e.employee_id === emp).map((e) => e.started_at).sort()[0] ?? null;
      let prev: string | null = clockIn;
      for (const r of list) {
        if (prev && prev < r.arrived_at!) r.drive_min = (new Date(r.arrived_at!).getTime() - new Date(prev).getTime()) / 60000;
        prev = r.left_at;
      }
    }
    rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name) ||
      (a.arrived_at ?? a.scheduled_start ?? "").localeCompare(b.arrived_at ?? b.scheduled_start ?? ""));
    entryList.sort((a, b) => a.employee_name.localeCompare(b.employee_name) || a.started_at.localeCompare(b.started_at));
    return { rows, entries: entryList };
  });

async function assertManagerVisit(context: { supabase: any; userId: string }, visitId: string) {
  const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager");
  if (!isMgr) throw new Error("Only owners and managers can change job times");
  const tenantId = await tenantOf(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: v } = await supabaseAdmin.from("job_visits").select("id, tenant_id").eq("id", visitId).maybeSingle();
  if (!v || v.tenant_id !== tenantId) throw new Error("Job visit not found");
  return supabaseAdmin;
}

/** Owners/managers: fix a cleaner's arrive/leave times at one job. */
export const updateJobVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      arrived_at: z.string().datetime({ offset: true }),
      left_at: z.string().datetime({ offset: true }).nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.left_at && data.left_at < data.arrived_at) throw new Error("Leave time must be after arrive time");
    const admin = await assertManagerVisit(context, data.id);
    const { error } = await admin.from("job_visits").update({ arrived_at: data.arrived_at, left_at: data.left_at }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteJobVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertManagerVisit(context, data.id);
    const { error } = await admin.from("job_visits").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
