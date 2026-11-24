import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_TZ } from "@/lib/tz";
import { defaultTimeOffHours, timeOffInputError, timeOffWindow } from "@/lib/time-off";

export type ScheduleTimeOff = {
  id: string;
  employee_id: string;
  category: "paid" | "unpaid";
  reason: string;
  note: string | null;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  starts_at: string;
  ends_at: string;
  hours: number;
  time_off_request_id: string | null;
};

export type TimeOffOverlap = { job_id: string; label: string; scheduled_start: string; scheduled_end: string };

const COLS = "id, employee_id, category, reason, note, start_date, end_date, all_day, start_time, end_time, starts_at, ends_at, hours, time_off_request_id";

function normalize(r: any): ScheduleTimeOff {
  return {
    ...r,
    start_time: r.start_time ? String(r.start_time).slice(0, 5) : null,
    end_time: r.end_time ? String(r.end_time).slice(0, 5) : null,
    hours: Number(r.hours ?? 0),
  };
}

async function requireManager(supabase: any) {
  const { data } = await supabase.rpc("is_owner_or_manager");
  if (!data) throw new Error("Only owners and managers can change time off");
}

async function tenantInfo(supabase: any, userId: string) {
  const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (!prof?.tenant_id) throw new Error("No workspace");
  const { data: t } = await supabase.from("tenants").select("timezone").eq("id", prof.tenant_id).maybeSingle();
  return { tenantId: prof.tenant_id as string, tz: (t?.timezone as string | null) || DEFAULT_TZ };
}

/** Cleanings this person is on during [starts_at, ends_at). Uses each cleaner's own hours on shared cleanings. */
async function findOverlaps(supabase: any, employeeId: string, startsAt: string, endsAt: string): Promise<TimeOffOverlap[]> {
  const pad = new Date(Date.parse(startsAt) - 2 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("job_employees")
    .select("scheduled_start, scheduled_end, job:jobs!inner(id, status, scheduled_start, scheduled_end, service_location_label, client:clients(first_name,last_name), property:client_properties!jobs_property_id_fkey(label))")
    .eq("employee_id", employeeId)
    .gte("job.scheduled_start", pad)
    .lt("job.scheduled_start", endsAt);
  if (error) throw new Error(error.message);
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  const out: TimeOffOverlap[] = [];
  for (const l of data ?? []) {
    const j: any = (l as any).job;
    if (!j || j.status === "canceled") continue;
    const start = (l as any).scheduled_start ?? j.scheduled_start;
    const end = (l as any).scheduled_end ?? j.scheduled_end;
    if (Date.parse(start) < e && Date.parse(end) > s) {
      const label = j.property?.label || j.service_location_label || [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "Cleaning";
      out.push({ job_id: j.id, label, scheduled_start: start, scheduled_end: end });
    }
  }
  return out.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
}

export const listScheduleTimeOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS: owners/managers see everyone's; a cleaner sees only their own.
    const { data: rows, error } = await context.supabase
      .from("employee_time_off")
      .select(COLS)
      .lt("starts_at", data.to)
      .gt("ends_at", data.from);
    if (error) throw new Error(error.message);
    return (rows ?? []).map(normalize);
  });

const inputSchema = z.object({
  employee_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  all_day: z.boolean(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const previewTimeOffOverlaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.extend({ ignore_id: z.string().uuid().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireManager(context.supabase);
    if (timeOffInputError(data)) return { overlaps: [] as TimeOffOverlap[] };
    const { tz } = await tenantInfo(context.supabase, context.userId);
    const w = timeOffWindow(data, tz);
    return { overlaps: await findOverlaps(context.supabase, data.employee_id, w.starts_at, w.ends_at) };
  });

export const saveScheduleTimeOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    inputSchema.extend({
      id: z.string().uuid().optional(),
      category: z.enum(["paid", "unpaid"]),
      reason: z.enum(["vacation", "sick", "personal", "appointment", "family", "other"]),
      note: z.string().trim().max(1000).nullable().optional(),
      hours: z.number().min(0).max(2000).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context.supabase);
    const err = timeOffInputError(data);
    if (err) throw new Error(err);
    const { tenantId, tz } = await tenantInfo(context.supabase, context.userId);
    const w = timeOffWindow(data, tz);
    const row = {
      tenant_id: tenantId,
      employee_id: data.employee_id,
      category: data.category,
      reason: data.reason,
      note: data.note?.trim() || null,
      start_date: data.start_date,
      end_date: data.all_day ? data.end_date : data.start_date,
      all_day: data.all_day,
      start_time: data.all_day ? null : data.start_time,
      end_time: data.all_day ? null : data.end_time,
      starts_at: w.starts_at,
      ends_at: w.ends_at,
      hours: data.hours ?? defaultTimeOffHours(data),
    };
    const q = data.id
      ? context.supabase.from("employee_time_off").update(row).eq("id", data.id).select(COLS).single()
      : context.supabase.from("employee_time_off").insert({ ...row, created_by: context.userId }).select(COLS).single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    const overlaps = await findOverlaps(context.supabase, data.employee_id, w.starts_at, w.ends_at);
    return { timeOff: normalize(saved), overlaps };
  });

export const deleteScheduleTimeOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireManager(context.supabase);
    const { data: rows, error } = await context.supabase.from("employee_time_off").delete().eq("id", data.id).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("That time off was already removed");
    return { ok: true };
  });

/**
 * Called when an owner approves or declines a time-off request: approval puts
 * whole-day unpaid time off on the schedule (once per request); declining removes it.
 */
export async function syncApprovedTimeOff(supabase: any, userId: string, requestId: string, decision: "approved" | "denied") {
  if (decision === "denied") {
    await supabase.from("employee_time_off").delete().eq("time_off_request_id", requestId);
    return;
  }
  const { data: req } = await supabase
    .from("time_off_requests")
    .select("id, employee_id, start_date, end_date, reason, reason_en")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return;
  const { tenantId, tz } = await tenantInfo(supabase, userId);
  const input = { start_date: req.start_date, end_date: req.end_date, all_day: true };
  if (timeOffInputError(input)) return;
  const w = timeOffWindow(input, tz);
  const note = String(req.reason_en || req.reason || "").slice(0, 1000) || null;
  const { error } = await supabase.from("employee_time_off").upsert(
    {
      tenant_id: tenantId, employee_id: req.employee_id, category: "unpaid", reason: "other", note,
      start_date: req.start_date, end_date: req.end_date, all_day: true, start_time: null, end_time: null,
      starts_at: w.starts_at, ends_at: w.ends_at, hours: defaultTimeOffHours(input),
      time_off_request_id: req.id, created_by: userId,
    },
    { onConflict: "time_off_request_id" },
  );
  if (error) throw new Error(`Approved, but couldn't add it to the schedule: ${error.message}`);
}
