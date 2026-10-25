import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveCanViewPricing } from "@/lib/team.functions";
import { clientContact } from "@/lib/privacy";
import { DEFAULT_TZ } from "@/lib/tz";
import { ownSopConfirmation } from "@/lib/sop-confirmation";
import {
  addMonthsISO,
  generateOccurrences,
  RECURRENCE_HORIZON_MONTHS,
  type RecurrenceRule,
} from "@/lib/recurrence";


export type JobAssignee = { id: string; full_name: string | null };
export type JobRow = {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  scheduled_start: string;
  scheduled_end: string;
  price_cents: number | null;
  notes: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  recurrence_end: string | null;
  published_at: string | null;
  service_address: string | null;
  service_location_label: string | null;
  location_needs_review: boolean;
  client: { id: string; first_name: string | null; last_name: string | null; service_address: string | null } | null;
  property: { id: string; label: string; address: string; color?: string | null } | null;
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
      .select("id, service_address, service_location_label, location_needs_review, status, scheduled_start, scheduled_end, price_cents, notes, is_recurring, recurrence_rule, recurrence_end, published_at, client:clients(id,first_name,last_name,service_address,color), property:client_properties!jobs_property_id_fkey(id,label,address,color), service:service_types(id,kind,name,color)")
      .order("scheduled_start", { ascending: true });
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lt("scheduled_start", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const jobs = rows ?? [];
    const [assigneeMap, canViewPricing] = await Promise.all([
      loadAssignees(context.supabase, jobs.map((j: any) => j.id)),
      resolveCanViewPricing(context),
    ]);
    return jobs.map((j: any) => ({
      ...j,
      price_cents: canViewPricing ? j.price_cents : null,
      assignees: assigneeMap.get(j.id) ?? [],
    })) as JobRow[];
  });

const createJobSchema = z.object({
  client_id: z.string().uuid(),
  property_id: z.string().uuid().nullable().optional(),
  service_address: z.string().trim().max(400).optional(),
  service_type_id: z.string().uuid(),
  scheduled_start: z.string(),
  scheduled_end: z.string(),
  assigned_employee_ids: z.array(z.string().uuid()).default([]),
  notes: z.string().optional(),
  price_cents: z.number().int().nonnegative().optional(),
  is_recurring: z.boolean().default(false),
  recurrence_rule: z.enum(["weekly", "biweekly", "every3weeks", "every4weeks", "monthly", "monthly_dow"]).nullable().optional(),
  /** null = open-ended series (auto-extends into future schedules) */
  recurrence_end: z.string().nullable().optional(),
});

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
    const [{ data: st }, { data: tenant }] = await Promise.all([
      context.supabase.from("service_types").select("default_price_cents, sop_steps").eq("id", data.service_type_id).maybeSingle(),
      context.supabase.from("tenants").select("timezone").eq("id", prof.tenant_id).maybeSingle(),
    ]);
    let address = data.service_address?.trim() || null;
    let locationLabel: string | null = null;
    if (data.property_id) {
      const { data: property, error } = await context.supabase.from("client_properties").select("address, label").eq("id", data.property_id).eq("client_id", data.client_id).eq("tenant_id", prof.tenant_id).single();
      if (error || !property) throw new Error("Select a property belonging to this client");
      address = property.address.trim(); locationLabel = property.label;
    }
    if (!address) throw new Error("Select a service location before saving this appointment");
    const tz = (tenant as any)?.timezone || DEFAULT_TZ;
    const price = data.price_cents ?? st?.default_price_cents ?? 0;
    const steps = (st?.sop_steps as string[] | null) ?? [];

    // Build occurrences (wall-clock stable in the business timezone).
    const start0 = new Date(data.scheduled_start);
    const end0 = new Date(data.scheduled_end);
    const dur = end0.getTime() - start0.getTime();
    const occurrences: { start: Date; end: Date }[] = [{ start: start0, end: end0 }];
    const recurring = data.is_recurring && !!data.recurrence_rule;
    if (recurring) {
      const horizon = addMonthsISO(new Date().toISOString(), RECURRENCE_HORIZON_MONTHS);
      const seriesEnd = data.recurrence_end ? new Date(data.recurrence_end + "T23:59:59Z").toISOString() : null;
      const throughISO =
        seriesEnd && new Date(seriesEnd).getTime() < new Date(horizon).getTime() ? seriesEnd : horizon;
      for (const iso of generateOccurrences({
        anchorISO: start0.toISOString(),
        rule: data.recurrence_rule as RecurrenceRule,
        afterISO: start0.toISOString(),
        throughISO,
        tz,
      })) {
        const s = new Date(iso);
        occurrences.push({ start: s, end: new Date(s.getTime() + dur) });
      }
    }

    const groupId = recurring ? crypto.randomUUID() : null;
    const firstIds: string[] = [];

    for (const occ of occurrences) {
      const { data: job, error } = await context.supabase
        .from("jobs")
        .insert({
          tenant_id: prof.tenant_id,
          client_id: data.client_id,
          property_id: data.property_id ?? null,
          service_address: address,
          service_location_label: locationLabel,
          service_type_id: data.service_type_id,
          scheduled_start: occ.start.toISOString(),
          scheduled_end: occ.end.toISOString(),
          assigned_to: data.assigned_employee_ids[0] ?? null,
          notes: data.notes ?? null,
          price_cents: price,
          is_recurring: recurring,
          recurrence_rule: recurring ? data.recurrence_rule : null,
          recurrence_end: recurring ? (data.recurrence_end ?? null) : null,
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
    // Employees may only toggle their OWN checklist copy; owners/managers may
    // toggle any row. The RLS policies enforce this too — this just gives a
    // clear error instead of a silent no-op.
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager" as never);
    let q = context.supabase
      .from("job_sop_items")
      .update({
        completed: data.completed,
        completed_at: data.completed ? new Date().toISOString() : null,
        completed_by: data.completed ? context.userId : null,
      })
      .eq("id", data.id);
    if (!isMgr) q = q.eq("employee_id", context.userId);
    const { data: updated, error } = await q.select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("That checklist item isn't yours to change");
    return { ok: true };
  });

export const getJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    // Client CPNI (email/phone/billing address) is not column-readable via the
    // Data API; it is merged in below through the permission-checked RPC.
    const { data: job, error } = await context.supabase
      .from("jobs")
      .select("*, client:clients(id, first_name, last_name, service_address, color), property:client_properties!jobs_property_id_fkey(id,label,address,color), service:service_types(*), sop:job_sop_items(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return null;
    const { data: ownConfirmation, error: confirmationError } = await context.supabase
      .from("job_sop_confirmations").select("job_id, employee_id, confirmed_at")
      .eq("job_id", data.id).eq("employee_id", context.userId).maybeSingle();
    if (confirmationError) throw new Error(confirmationError.message);
    job.sop_confirmed_at = ownSopConfirmation(ownConfirmation ? [ownConfirmation] : [], data.id, context.userId);
    job.sop_confirmed_by = ownConfirmation ? context.userId : null;
    const contact = job.client_id
      ? await clientContact(context.supabase, job.client_id)
      : null;
    type JobClient = {
      id: string;
      first_name: string | null;
      last_name: string | null;
      service_address: string | null;
      color: string | null;
      client_sop: string | null;
      email: string | null;
      phone: string | null;
      billing_address: string | null;
    };
    let propertySop: string | null = null;
    if ((job as { property_id?: string | null }).property_id) {
      const { data: prop } = await (context.supabase as any)
        .from("client_properties").select("sop").eq("id", (job as any).property_id).maybeSingle();
      propertySop = prop?.sop?.trim() ? prop.sop : null;
    }
    const jobClient: JobClient | null = job.client
      ? {
          ...(job.client as Omit<JobClient, "email" | "phone" | "billing_address" | "client_sop">),
          email: contact?.email ?? null,
          phone: contact?.phone ?? null,
          billing_address: contact?.billing_address ?? null,
          client_sop: propertySop ?? contact?.client_sop ?? null,
        }
      : null;
    const [{ data: links }, { data: specs }, { data: clientNotes }] = await Promise.all([
      context.supabase
        .from("job_employees")
        .select("employee_id, profile:profiles!job_employees_employee_id_fkey(id, full_name)")
        .eq("job_id", data.id),
      job.client_id
        ? context.supabase
            .from("property_specs")
            .select("key_location, access_notes, pets, parking_notes, special_instructions")
            .eq("client_id", job.client_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.client_id
        ? context.supabase
            .from("client_notes")
            .select("id, note, created_at")
            .eq("client_id", job.client_id)
            .order("created_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] as Array<{ id: string; note: string; created_at: string }> }),
    ]);
    const assignees: JobAssignee[] = (links ?? []).map((l: any) => l.profile).filter(Boolean);
    const canViewPricing = await resolveCanViewPricing(context);

    // Per-cleaner checklists: rows with employee_id set belong to that cleaner;
    // rows with employee_id NULL are the shared template / legacy records.
    type SopItem = {
      id: string; position: number; label: string; label_uk?: string | null;
      completed: boolean; completed_at: string | null; completed_by: string | null;
      employee_id: string | null;
    };
    let sopRows = ((job as { sop?: SopItem[] }).sop ?? []) as SopItem[];
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager" as never);
    let sopByEmployee: { employee_id: string; name: string; items: SopItem[] }[] | null = null;

    if (isMgr) {
      // Admin view: template rows stay as "shared", plus each cleaner's own copy.
      const byEmp = new Map<string, SopItem[]>();
      for (const r of sopRows) {
        if (!r.employee_id) continue;
        if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
        byEmp.get(r.employee_id)!.push(r);
      }
      if (byEmp.size) {
        const { data: profs } = await context.supabase
          .from("profiles").select("id, full_name").in("id", [...byEmp.keys()]);
        const names = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "Cleaner"]));
        sopByEmployee = [...byEmp.entries()].map(([employee_id, items]) => ({
          employee_id,
          name: names.get(employee_id) ?? "Cleaner",
          items,
        }));
      }
      sopRows = sopRows.filter((r) => !r.employee_id);
    } else {
      // Cleaner view: provision their own copy from the template on first open,
      // then show only their rows.
      let mine = sopRows.filter((r) => r.employee_id === context.userId);
      const template = sopRows.filter((r) => !r.employee_id);
      if (!mine.length && template.length) {
        const { data: inserted } = await context.supabase
          .from("job_sop_items")
          .insert(template.map((t) => ({
            tenant_id: (job as { tenant_id: string }).tenant_id,
            job_id: (job as { id: string }).id,
            position: t.position,
            label: t.label,
            label_uk: t.label_uk ?? null,
            employee_id: context.userId,
          })) as never)
          .select("id, position, label, label_uk, completed, completed_at, completed_by, employee_id");
        mine = (inserted ?? []) as SopItem[];
      }
      sopRows = mine;
    }

    return {
      ...job,
      sop: sopRows,
      sopByEmployee,
      client: jobClient,
      price_cents: canViewPricing ? job.price_cents : null,
      assignees,
      property_specs: specs ?? null,
      client_notes: clientNotes ?? [],
    };
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
  .inputValidator((input: unknown) =>
    z.object({
      from: z.string(),
      to: z.string(),
      notify: z.enum(["everyone", "impacted", "none"]).default("impacted"),
      client_channel: z.enum(["none", "email", "sms"]).default("none"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("publish_schedule" as never, {
      _from: data.from, _to: data.to, _notify: data.notify, _client_channel: data.client_channel,
    } as never);
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { count?: number; drafts?: number };
    return { count: r.count ?? 0, drafts: r.drafts ?? 0 };
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

/** Owner/manager action: top up recurring series into future schedules now. */
export const extendRecurringNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof?.tenant_id) throw new Error("No workspace");
    const { extendRecurringSeries } = await import("@/lib/recurrence.server");
    return await extendRecurringSeries(context.supabase, { tenantId: prof.tenant_id, maxGroups: 100 });
  });

/**
 * Owner/manager action: remove a scheduled shift.
 * When employee_id is given and other people are still assigned to the same
 * shift, only that person is taken off it — the shift stays for everyone else.
 */
export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; employee_id?: string }) => input)
  .handler(async ({ data, context }) => {
    if (data.employee_id) {
      const { data: links } = await context.supabase
        .from("job_employees")
        .select("employee_id")
        .eq("job_id", data.id);
      const others = (links ?? []).filter((l: any) => l.employee_id !== data.employee_id);
      if (others.length) {
        const { error: unErr } = await context.supabase
          .from("job_employees")
          .delete()
          .eq("job_id", data.id)
          .eq("employee_id", data.employee_id);
        if (unErr) throw new Error(unErr.message);
        const { data: job } = await context.supabase
          .from("jobs")
          .select("assigned_to")
          .eq("id", data.id)
          .maybeSingle();
        if ((job as any)?.assigned_to === data.employee_id) {
          await context.supabase
            .from("jobs")
            .update({ assigned_to: (others[0] as any).employee_id })
            .eq("id", data.id);
        }
        return { ok: true, unassigned: true as const };
      }
    }
    await context.supabase.from("job_employees").delete().eq("job_id", data.id);
    await context.supabase.from("job_sop_items").delete().eq("job_id", data.id);
    const { error } = await context.supabase.from("jobs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, unassigned: false as const };
  });

/** Copy an existing shift onto another employee (optionally another day). */
export const duplicateJobToEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; employee_id: string; scheduled_start?: string; scheduled_end?: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: src, error: srcErr } = await context.supabase
      .from("jobs")
      .select("tenant_id, client_id, property_id, service_address, service_location_label, service_type_id, scheduled_start, scheduled_end, notes, price_cents")
      .eq("id", data.id)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!src) throw new Error("Shift not found");

    const start = data.scheduled_start ?? src.scheduled_start;
    const end = data.scheduled_end ?? src.scheduled_end;

    const { data: job, error } = await context.supabase
      .from("jobs")
      .insert({
        tenant_id: src.tenant_id,
        client_id: src.client_id,
        property_id: src.property_id,
        service_address: src.service_address,
        service_location_label: src.service_location_label,
        service_type_id: src.service_type_id,
        scheduled_start: start,
        scheduled_end: end,
        notes: src.notes,
        price_cents: src.price_cents,
        assigned_to: data.employee_id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase
      .from("job_employees")
      .insert({ tenant_id: src.tenant_id, job_id: job.id, employee_id: data.employee_id });

    const { data: steps } = await context.supabase
      .from("job_sop_items")
      .select("position, label, label_uk")
      .eq("job_id", data.id);
    if (steps?.length) {
      await context.supabase.from("job_sop_items").insert(
        steps.map((s: any) => ({ tenant_id: src.tenant_id, job_id: job.id, position: s.position, label: s.label, label_uk: s.label_uk ?? null })),
      );
    }
    return { id: job.id };
  });

/**
 * Owner/manager action: close jobs that weren't marked complete in the field.
 * Marking a job completed creates its draft invoice automatically (DB trigger).
 */
export const closeJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager" as any);
    if (!isMgr) throw new Error("Only owners and managers can close jobs");
    const { data: open } = await context.supabase
      .from("jobs")
      .select("id, scheduled_end")
      .in("id", data.ids)
      .in("status", ["scheduled", "in_progress"]);
    let closed = 0;
    for (const j of open ?? []) {
      // End time at this job only (open visits) so hours land on the invoice; day clocks keep running.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as any).from("job_visits").update({ left_at: new Date().toISOString() })
        .eq("job_id", (j as any).id).is("left_at", null);
      const { error } = await context.supabase
        .from("jobs")
        .update({ status: "completed", actual_end: (j as any).scheduled_end })
        .eq("id", (j as any).id);
      if (error) throw new Error(error.message);
      closed++;
    }
    return { closed };
  });

export const confirmJobSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ job_id: z.string().uuid(), confirmed: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("confirm_job_sop" as never, {
      _job: data.job_id, _confirmed: data.confirmed,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Change only this visit, or explicitly selected scheduled future series visits. */
export const updateJobLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), property_id: z.string().uuid(), scope: z.enum(["this", "future"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("is_owner_or_manager");
    if (!allowed) throw new Error("Only owners and managers can change locations");
    const { data: job, error } = await context.supabase.from("jobs").select("client_id, tenant_id, recurrence_group_id, scheduled_start").eq("id", data.id).single();
    if (error || !job) throw new Error("Appointment not found");
    const { data: property } = await context.supabase.from("client_properties").select("id, address, label").eq("id", data.property_id).eq("client_id", job.client_id).eq("tenant_id", job.tenant_id).single();
    if (!property?.address.trim()) throw new Error("Select a property with a service address");
    let q = context.supabase.from("jobs").update({ property_id: property.id, service_address: property.address, service_location_label: property.label });
    if (data.scope === "future" && job.recurrence_group_id) q = q.eq("recurrence_group_id", job.recurrence_group_id).gte("scheduled_start", job.scheduled_start).eq("status", "scheduled");
    else q = q.eq("id", data.id);
    const { error: saveError } = await q;
    if (saveError) throw new Error(saveError.message);
    return { ok: true };
  });
