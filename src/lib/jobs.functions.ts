import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type JobAssignee = { id: string; full_name: string | null };
export type JobRow = {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  scheduled_start: string;
  scheduled_end: string;
  price_cents: number;
  notes: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  recurrence_end: string | null;
  client: { id: string; first_name: string | null; last_name: string | null; service_address: string | null } | null;
  service: { id: string; kind: string; name: string; color: string | null } | null;
  assignees: JobAssignee[];
};

async function loadAssignees(supabase: any, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, JobAssignee[]>();
  const { data: links } = await supabase
    .from("job_employees")
    .select("job_id, employee_id, profile:profiles!job_employees_employee_id_fkey(id, full_name)")
    .in("job_id", jobIds);
  const map = new Map<string, JobAssignee[]>();
  for (const l of links ?? []) {
    const arr = map.get(l.job_id) ?? [];
    const p = (l as any).profile;
    if (p) arr.push({ id: p.id, full_name: p.full_name });
    map.set(l.job_id, arr);
  }
  return map;
}

export const listJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string; to?: string }) => input)
  .handler(async ({ data, context }): Promise<JobRow[]> => {
    let q = context.supabase
      .from("jobs")
      .select("id, status, scheduled_start, scheduled_end, price_cents, notes, is_recurring, recurrence_rule, recurrence_end, client:clients(id,first_name,last_name,service_address), service:service_types(id,kind,name,color)")
      .order("scheduled_start", { ascending: true });
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lt("scheduled_start", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const jobs = rows ?? [];
    const assigneeMap = await loadAssignees(context.supabase, jobs.map((j: any) => j.id));
    return jobs.map((j: any) => ({ ...j, assignees: assigneeMap.get(j.id) ?? [] })) as JobRow[];
  });

const createJobSchema = z.object({
  client_id: z.string().uuid(),
  property_id: z.string().uuid().nullable().optional(),
  service_type_id: z.string().uuid(),
  scheduled_start: z.string(),
  scheduled_end: z.string(),
  assigned_employee_ids: z.array(z.string().uuid()).default([]),
  notes: z.string().optional(),
  price_cents: z.number().int().nonnegative().optional(),
  is_recurring: z.boolean().default(false),
  recurrence_rule: z.enum(["weekly", "biweekly", "monthly"]).nullable().optional(),
  recurrence_end: z.string().nullable().optional(),
});

function addRecurrence(date: Date, rule: "weekly" | "biweekly" | "monthly") {
  const d = new Date(date);
  if (rule === "weekly") d.setDate(d.getDate() + 7);
  else if (rule === "biweekly") d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export const checkConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_ids: string[]; scheduled_start: string; scheduled_end: string; ignore_job_id?: string }) => input)
  .handler(async ({ data, context }) => {
    if (!data.employee_ids.length) return { conflicts: [] as { employee_id: string; job_id: string }[] };
    const { data: links } = await context.supabase
      .from("job_employees")
      .select("employee_id, job:jobs!inner(id, scheduled_start, scheduled_end, status)")
      .in("employee_id", data.employee_ids);
    const s = new Date(data.scheduled_start).getTime();
    const e = new Date(data.scheduled_end).getTime();
    const conflicts: { employee_id: string; job_id: string; scheduled_start: string; scheduled_end: string }[] = [];
    for (const l of links ?? []) {
      const j: any = (l as any).job;
      if (!j || j.status === "canceled" || j.id === data.ignore_job_id) continue;
      const js = new Date(j.scheduled_start).getTime();
      const je = new Date(j.scheduled_end).getTime();
      if (js < e && je > s) conflicts.push({ employee_id: (l as any).employee_id, job_id: j.id, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end });
    }
    return { conflicts };
  });

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: st } = await context.supabase.from("service_types").select("default_price_cents, sop_steps").eq("id", data.service_type_id).maybeSingle();
    const price = data.price_cents ?? st?.default_price_cents ?? 0;
    const steps = (st?.sop_steps as string[] | null) ?? [];

    // Build occurrences
    const start0 = new Date(data.scheduled_start);
    const end0 = new Date(data.scheduled_end);
    const dur = end0.getTime() - start0.getTime();
    const occurrences: { start: Date; end: Date }[] = [{ start: start0, end: end0 }];
    if (data.is_recurring && data.recurrence_rule && data.recurrence_end) {
      const endBoundary = new Date(data.recurrence_end + "T23:59:59");
      let next = addRecurrence(start0, data.recurrence_rule);
      while (next.getTime() <= endBoundary.getTime() && occurrences.length < 60) {
        occurrences.push({ start: next, end: new Date(next.getTime() + dur) });
        next = addRecurrence(next, data.recurrence_rule);
      }
    }

    const groupId = data.is_recurring ? crypto.randomUUID() : null;
    const firstIds: string[] = [];

    for (const occ of occurrences) {
      const { data: job, error } = await context.supabase
        .from("jobs")
        .insert({
          tenant_id: prof.tenant_id,
          client_id: data.client_id,
          property_id: data.property_id ?? null,
          service_type_id: data.service_type_id,
          scheduled_start: occ.start.toISOString(),
          scheduled_end: occ.end.toISOString(),
          assigned_to: data.assigned_employee_ids[0] ?? null,
          notes: data.notes ?? null,
          price_cents: price,
          is_recurring: data.is_recurring,
          recurrence_rule: data.recurrence_rule ?? null,
          recurrence_end: data.recurrence_end ?? null,
          recurrence_group_id: groupId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      firstIds.push(job.id);
      if (data.assigned_employee_ids.length) {
        await context.supabase.from("job_employees").insert(
          data.assigned_employee_ids.map((eid) => ({ tenant_id: prof.tenant_id, job_id: job.id, employee_id: eid })),
        );
      }
      if (steps.length) {
        await context.supabase.from("job_sop_items").insert(
          steps.map((label, i) => ({ tenant_id: prof.tenant_id, job_id: job.id, position: i, label })),
        );
      }
    }
    return { id: firstIds[0], count: firstIds.length };
  });

export const toggleSopItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; completed: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("job_sop_items")
      .update({
        completed: data.completed,
        completed_at: data.completed ? new Date().toISOString() : null,
        completed_by: data.completed ? context.userId : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("jobs")
      .select("*, client:clients(*), service:service_types(*), sop:job_sop_items(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return null;
    const { data: links } = await context.supabase
      .from("job_employees")
      .select("employee_id, profile:profiles!job_employees_employee_id_fkey(id, full_name)")
      .eq("job_id", data.id);
    const assignees: JobAssignee[] = (links ?? []).map((l: any) => l.profile).filter(Boolean);
    return { ...job, assignees };
  });

export const updateJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "scheduled" | "in_progress" | "completed" | "canceled" }) => input)
  .handler(async ({ data, context }) => {
    const nowIso = new Date().toISOString();
    const patch =
      data.status === "in_progress"
        ? { status: data.status, actual_start: nowIso }
        : data.status === "completed"
          ? { status: data.status, actual_end: nowIso }
          : { status: data.status };
    const { error } = await context.supabase.from("jobs").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; scheduled_start: string; scheduled_end: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("jobs")
      .update({ scheduled_start: data.scheduled_start, scheduled_end: data.scheduled_end })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const publishSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("jobs")
      .update({ published_at: new Date().toISOString() })
      .is("published_at", null)
      .gte("scheduled_start", data.from)
      .lt("scheduled_start", data.to)
      .select("id");
    if (error) throw new Error(error.message);
    return { count: rows?.length ?? 0 };
  });

export const listUnavailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("employee_unavailability")
      .select("id, employee_id, starts_at, ends_at, all_day, reason")
      .gte("starts_at", data.from)
      .lt("starts_at", data.to);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
