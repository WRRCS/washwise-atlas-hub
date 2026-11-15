import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getScheduleTeamOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("schedule_team_order").select("employee_ids").maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.employee_ids ?? []) as string[];
  });

export const saveScheduleTeamOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ employee_ids: z.array(z.string().uuid()).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    if (!tenantId) throw new Error("Business not found");
    const { error } = await context.supabase.from("schedule_team_order").upsert(
      { tenant_id: tenantId as string, employee_ids: Array.from(new Set(data.employee_ids)), updated_by: context.userId, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    );
    if (error) throw new Error(error.message.includes("row-level security") ? "Only owners and managers can rearrange the schedule." : error.message);
    return { ok: true };
  });
