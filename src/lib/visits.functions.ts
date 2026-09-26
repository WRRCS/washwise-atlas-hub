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
    await context.supabase.from("jobs").update({ status: "in_progress", actual_start: row.arrived_at })
      .eq("id", data.job_id).eq("status", "scheduled");
    return row as JobVisit;
  });

export const leaveJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ visit_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any).from("job_visits")
      .update({ left_at: new Date().toISOString() })
      .eq("id", data.visit_id).eq("employee_id", context.userId)
      .select("id, arrived_at, left_at").single();
    if (error) throw new Error(error.message);
    return row as JobVisit;
  });

export type TimesheetDay = {
  employee_id: string;
  employee_name: string;
  day: string; // yyyy-mm-dd (UTC date of clock-in / first event)
  clock_in: string | null;
  clock_out: string | null;
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
    let te = sb.from("time_entries").select("user_id, started_at, ended_at")
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
      if (!map.has(k)) map.set(k, { employee_id: emp, employee_name: names.get(emp) ?? "Unknown", day, clock_in: null, clock_out: null, visits: [] });
      return map.get(k)!;
    };
    for (const e of entries ?? []) {
      const d = get(e.user_id, e.started_at);
      if (!d.clock_in || e.started_at < d.clock_in) d.clock_in = e.started_at;
      if (e.ended_at && (!d.clock_out || e.ended_at > d.clock_out)) d.clock_out = e.ended_at;
    }
    for (const v of visits ?? []) {
      const d = get(v.employee_id, v.arrived_at);
      const c = v.job?.client;
      d.visits.push({ id: v.id, client: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "Appointment", arrived_at: v.arrived_at, left_at: v.left_at });
    }
    const out = [...map.values()];
    out.forEach((d) => d.visits.sort((a, b) => a.arrived_at.localeCompare(b.arrived_at)));
    return out.sort((a, b) => b.day.localeCompare(a.day) || a.employee_name.localeCompare(b.employee_name));
  });
