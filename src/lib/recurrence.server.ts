// Rolls recurring job series forward so future schedules stay populated.
// Idempotent: it only ever appends occurrences after the latest existing one
// in each series, up to the horizon.

import {
  addMonthsISO,
  generateOccurrences,
  RECURRENCE_HORIZON_MONTHS,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { DEFAULT_TZ } from "@/lib/tz";

type AnyClient = any;

type SeriesJob = {
  id: string;
  tenant_id: string;
  client_id: string;
  property_id: string | null;
  service_type_id: string;
  scheduled_start: string;
  scheduled_end: string;
  price_cents: number | null;
  notes: string | null;
  assigned_to: string | null;
  recurrence_rule: RecurrenceRule | null;
  recurrence_end: string | null;
  recurrence_group_id: string;
};

export async function extendRecurringSeries(
  supabase: AnyClient,
  opts: { tenantId?: string; maxGroups?: number } = {},
): Promise<{ groups: number; created: number }> {
  const maxGroups = opts.maxGroups ?? 100;
  const horizonISO = addMonthsISO(new Date().toISOString(), RECURRENCE_HORIZON_MONTHS);

  let q = supabase
    .from("jobs")
    .select(
      "id, tenant_id, client_id, property_id, service_type_id, scheduled_start, scheduled_end, price_cents, notes, assigned_to, recurrence_rule, recurrence_end, recurrence_group_id",
    )
    .not("recurrence_group_id", "is", null)
    .order("scheduled_start", { ascending: false })
    .limit(5000);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  // Latest occurrence per series.
  const latest = new Map<string, SeriesJob>();
  for (const r of (rows ?? []) as SeriesJob[]) {
    if (!latest.has(r.recurrence_group_id)) latest.set(r.recurrence_group_id, r);
  }

  // Tenant timezones.
  const tenantIds = [...new Set([...latest.values()].map((j) => j.tenant_id))];
  const tzMap = new Map<string, string>();
  if (tenantIds.length) {
    const { data: tenants } = await supabase.from("tenants").select("id, timezone").in("id", tenantIds);
    for (const t of tenants ?? []) tzMap.set(t.id, t.timezone || DEFAULT_TZ);
  }

  let groups = 0;
  let created = 0;

  for (const job of latest.values()) {
    if (groups >= maxGroups) break;
    if (!job.recurrence_rule) continue;
    const seriesEnd = job.recurrence_end ? new Date(job.recurrence_end + "T23:59:59Z").toISOString() : null;
    const throughISO =
      seriesEnd && new Date(seriesEnd).getTime() < new Date(horizonISO).getTime() ? seriesEnd : horizonISO;
    if (new Date(job.scheduled_start).getTime() >= new Date(throughISO).getTime()) continue;

    const tz = tzMap.get(job.tenant_id) || DEFAULT_TZ;
    const dur = new Date(job.scheduled_end).getTime() - new Date(job.scheduled_start).getTime();
    const starts = generateOccurrences({
      anchorISO: job.scheduled_start,
      rule: job.recurrence_rule,
      afterISO: job.scheduled_start,
      throughISO,
      tz,
      max: 60,
    });
    if (!starts.length) continue;
    groups++;

    const { data: links } = await supabase
      .from("job_employees")
      .select("employee_id")
      .eq("job_id", job.id);
    const employeeIds: string[] = (links ?? []).map((l: any) => l.employee_id);
    const { data: sop } = await supabase
      .from("job_sop_items")
      .select("position, label")
      .eq("job_id", job.id)
      .order("position", { ascending: true });

    for (const startISO of starts) {
      const { data: inserted, error: insErr } = await supabase
        .from("jobs")
        .insert({
          tenant_id: job.tenant_id,
          client_id: job.client_id,
          property_id: job.property_id,
          service_type_id: job.service_type_id,
          scheduled_start: startISO,
          scheduled_end: new Date(new Date(startISO).getTime() + dur).toISOString(),
          assigned_to: job.assigned_to,
          notes: job.notes,
          price_cents: job.price_cents,
          is_recurring: true,
          recurrence_rule: job.recurrence_rule,
          recurrence_end: job.recurrence_end,
          recurrence_group_id: job.recurrence_group_id,
        })
        .select("id")
        .single();
      if (insErr || !inserted) break; // e.g. plan limit reached — stop this series
      created++;
      if (employeeIds.length) {
        await supabase
          .from("job_employees")
          .insert(employeeIds.map((eid) => ({ tenant_id: job.tenant_id, job_id: inserted.id, employee_id: eid })));
      }
      if (sop?.length) {
        await supabase.from("job_sop_items").insert(
          sop.map((s: any) => ({ tenant_id: job.tenant_id, job_id: inserted.id, position: s.position, label: s.label })),
        );
      }
    }
  }

  return { groups, created };
}
