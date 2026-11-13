import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

type Rpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const ts = z.string().datetime({ offset: true });
const expected = z.object({ job_id: z.string().uuid().nullable(), arrived_at: ts, left_at: ts.nullable() });

export type LineAppointment = { id: string; label: string; scheduled_start: string; scheduled_end: string | null; assigned: boolean };
export type LineHistory = { id: string; corrected_at: string; editor: string; reason: string; original_values: Json; corrected_values: Json };

/** Appointments to pick from for one cleaner's line, plus that line's correction history. */
export const getTimesheetLineContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ employee_id: z.string().uuid(), job_id: z.string().uuid().nullable(), from: ts, to: ts }).parse(input))
  .handler(async ({ data, context }): Promise<{ appointments: LineAppointment[]; history: LineHistory[] }> => {
    const { data: allowed } = await context.supabase.rpc("is_owner_or_manager");
    if (!allowed) throw new Error("Only owners and managers can correct timesheets");
    const sb = context.supabase;
    const [jobs, history, directory] = await Promise.all([
      sb.from("jobs").select("id, scheduled_start, scheduled_end, assigned_to, service_location_label, service_address, client:clients(first_name,last_name), job_employees(employee_id)")
        .gte("scheduled_start", data.from).lt("scheduled_start", data.to).neq("status", "canceled").order("scheduled_start"),
      data.job_id
        ? sb.from("timesheet_correction_history").select("id, corrected_at, editor_id, reason, original_values, corrected_values").eq("employee_id", data.employee_id).eq("job_id", data.job_id).order("corrected_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      sb.rpc("staff_directory"),
    ]);
    if (jobs.error) throw new Error(jobs.error.message);
    if (history.error) throw new Error(history.error.message);
    const names = new Map(((directory.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Someone"]));
    const appointments = (jobs.data ?? []).map((j) => {
      const client = [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "Appointment";
      const place = j.service_location_label || j.service_address;
      const assigned = j.assigned_to === data.employee_id || (j.job_employees ?? []).some((e) => e.employee_id === data.employee_id);
      return { id: j.id, label: place ? `${client} · ${place}` : client, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, assigned };
    });
    return {
      appointments,
      history: (history.data ?? []).map((h) => ({ id: h.id, corrected_at: h.corrected_at, editor: names.get(h.editor_id) ?? "Someone", reason: h.reason, original_values: h.original_values, corrected_values: h.corrected_values })),
    };
  });

/** Save one line's appointment and clock-in/out; paid clock edges follow the line. */
export const quickEditTimesheetLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    visit_id: z.string().uuid().nullable(), employee_id: z.string().uuid(), expected: expected.nullable(),
    job_id: z.string().uuid(), arrived_at: ts, left_at: ts.nullable(), reason: z.string().trim().max(1000).default(""),
  }).parse(input))
  .handler(async ({ data, context }) => {
    if (data.left_at && Date.parse(data.left_at) <= Date.parse(data.arrived_at)) throw new Error("Clock-out must be after clock-in");
    const { data: id, error } = await (context.supabase as unknown as Rpc).rpc("admin_quick_edit_visit", {
      _visit: data.visit_id, _employee: data.employee_id, _expected: data.expected, _job: data.job_id,
      _arrived: data.arrived_at, _left: data.left_at, _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

/** Remove one line (e.g. a repeated tap). Paid time goes only if it belonged to this line alone. */
export const deleteTimesheetLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ visit_id: z.string().uuid(), expected, reason: z.string().trim().max(1000).default("") }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as unknown as Rpc).rpc("admin_delete_visit", { _visit: data.visit_id, _expected: data.expected, _reason: data.reason });
    if (error) throw new Error(error.message);
    return result as { id: string; paid_removed: boolean };
  });
