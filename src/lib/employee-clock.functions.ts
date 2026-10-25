import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const employeeClockAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ action: z.enum(["start_work", "start_lunch", "end_lunch", "clock_out"]), description: z.string().trim().max(300).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("employee_clock_action", { _action: data.action, _description: data.description });
    if (error) throw new Error(error.message);
    return { id };
  });

export const updateClockRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), started_at: z.string().datetime({ offset: true }), ended_at: z.string().datetime({ offset: true }).nullable(), job_id: z.string().uuid().nullable(), description: z.string().trim().min(3).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    // PostgREST's generated function args omit SQL nullability; these nullable parameters are intentional.
    const args = { _id: data.id, _start: data.started_at, _end: data.ended_at, _job: data.job_id, _description: data.description };
    const { error } = await (context.supabase as unknown as { rpc: (name: "correct_clock_record", parameters: typeof args) => Promise<{error: {message:string} | null}> }).rpc("correct_clock_record", args);
    if (error) throw new Error(error.message);
    return { ok: true };
  });