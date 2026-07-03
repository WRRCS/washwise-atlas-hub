import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type JobRow = {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  scheduled_start: string;
  scheduled_end: string;
  price_cents: number;
  assigned_to: string | null;
  notes: string | null;
  client: { id: string; first_name: string | null; last_name: string | null; service_address: string | null } | null;
  service: { id: string; kind: string; name: string } | null;
  assignee: { full_name: string | null } | null;
};

export const listJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string; to?: string }) => input)
  .handler(async ({ data, context }): Promise<JobRow[]> => {
    let q = context.supabase
      .from("jobs")
      .select("id, status, scheduled_start, scheduled_end, price_cents, assigned_to, notes, client:clients(id,first_name,last_name,service_address), service:service_types(id,kind,name)")
      .order("scheduled_start", { ascending: true });
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lt("scheduled_start", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const jobs = rows ?? [];
    const assigneeIds = Array.from(new Set(jobs.map((j) => j.assigned_to).filter((v): v is string => !!v)));
    let profilesMap = new Map<string, string | null>();
    if (assigneeIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id, full_name").in("id", assigneeIds);
      profilesMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    return jobs.map((j) => ({
      ...j,
      assignee: j.assigned_to ? { full_name: profilesMap.get(j.assigned_to) ?? null } : null,
    })) as JobRow[];
  });

const createJobSchema = z.object({
  client_id: z.string().uuid(),
  service_type_id: z.string().uuid(),
  scheduled_start: z.string(),
  scheduled_end: z.string(),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: st } = await context.supabase.from("service_types").select("default_price_cents, sop_steps").eq("id", data.service_type_id).maybeSingle();
    const { data: job, error } = await context.supabase
      .from("jobs")
      .insert({
        tenant_id: prof.tenant_id,
        client_id: data.client_id,
        service_type_id: data.service_type_id,
        scheduled_start: data.scheduled_start,
        scheduled_end: data.scheduled_end,
        assigned_to: data.assigned_to ?? null,
        notes: data.notes ?? null,
        price_cents: st?.default_price_cents ?? 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const steps = (st?.sop_steps as string[] | null) ?? [];
    if (steps.length) {
      await context.supabase.from("job_sop_items").insert(
        steps.map((label, i) => ({ tenant_id: prof.tenant_id, job_id: job.id, position: i, label })),
      );
    }
    return job;
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
    let assignee: { id: string; full_name: string | null } | null = null;
    if (job.assigned_to) {
      const { data: p } = await context.supabase.from("profiles").select("id, full_name").eq("id", job.assigned_to).maybeSingle();
      assignee = p ?? null;
    }
    return { ...job, assignee };
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
