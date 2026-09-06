import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClientJobRow = {
  id: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  price_cents: number | null;
  notes: string | null;
  property: { id: string; label: string; address: string } | null;
  service: { id: string; name: string; kind: string } | null;
  assignees: { id: string; full_name: string | null }[];
};

const idInput = z.object({ client_id: z.string().uuid() });

export const listClientJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<ClientJobRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("jobs")
      .select(
        "id, status, scheduled_start, scheduled_end, actual_start, actual_end, price_cents, notes, property:client_properties(id,label,address), service:service_types(id,name,kind)",
      )
      .eq("client_id", data.client_id)
      .order("scheduled_start", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const jobs = (rows ?? []) as any[];
    const ids = jobs.map((j) => j.id);
    const map = new Map<string, { id: string; full_name: string | null }[]>();
    if (ids.length) {
      const { data: links } = await context.supabase
        .from("job_employees")
        .select("job_id, profile:profiles(id, full_name)")
        .in("job_id", ids);
      for (const l of (links ?? []) as any[]) {
        const arr = map.get(l.job_id) ?? [];
        if (l.profile) arr.push({ id: l.profile.id, full_name: l.profile.full_name });
        map.set(l.job_id, arr);
      }
    }
    return jobs.map((j) => ({ ...j, assignees: map.get(j.id) ?? [] })) as ClientJobRow[];
  });

export type ClientSummary = {
  active_properties: number;
  next_job: { id: string; scheduled_start: string; property: string | null; service: string | null } | null;
  last_job: { id: string; scheduled_start: string; property: string | null; service: string | null } | null;
  outstanding_cents: number;
  open_invoices: number;
  requests: { id: string; requested_date: string | null; notes: string | null; status: string; created_at: string }[];
};

export const getClientSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<ClientSummary> => {
    const nowIso = new Date().toISOString();
    const [props, next, last, invs, reqs] = await Promise.all([
      context.supabase
        .from("client_properties")
        .select("id", { count: "exact", head: true })
        .eq("client_id", data.client_id)
        .eq("is_active", true),
      context.supabase
        .from("jobs")
        .select("id, scheduled_start, property:client_properties(label), service:service_types(name)")
        .eq("client_id", data.client_id)
        .gte("scheduled_start", nowIso)
        .order("scheduled_start", { ascending: true })
        .limit(1),
      context.supabase
        .from("jobs")
        .select("id, scheduled_start, property:client_properties(label), service:service_types(name)")
        .eq("client_id", data.client_id)
        .lt("scheduled_start", nowIso)
        .order("scheduled_start", { ascending: false })
        .limit(1),
      context.supabase
        .from("invoices")
        .select("id, status, total_cents, amount_cents")
        .eq("client_id", data.client_id),
      context.supabase
        .from("client_service_requests")
        .select("id, requested_date, notes, status, created_at")
        .eq("client_id", data.client_id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const shape = (r: any) =>
      r
        ? {
            id: r.id,
            scheduled_start: r.scheduled_start,
            property: r.property?.label ?? null,
            service: r.service?.name ?? null,
          }
        : null;

    const openInvoices = ((invs.data ?? []) as any[]).filter(
      (i) => !["paid", "void", "cancelled"].includes(String(i.status)),
    );
    const outstanding = openInvoices.reduce(
      (sum, i) => sum + Number(i.total_cents ?? i.amount_cents ?? 0),
      0,
    );

    return {
      active_properties: props.count ?? 0,
      next_job: shape(((next.data ?? []) as any[])[0]),
      last_job: shape(((last.data ?? []) as any[])[0]),
      outstanding_cents: outstanding,
      open_invoices: openInvoices.length,
      requests: (reqs.data ?? []) as ClientSummary["requests"],
    };
  });
