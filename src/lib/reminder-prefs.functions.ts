import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReminderChannel = "sms" | "email" | "push";
export type ReminderPrefs = {
  enabled: boolean;
  lead_minutes: number[];
  channels: ReminderChannel[];
  is_default: boolean;
};

export const REMINDER_LEAD_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 2880, label: "2 days before" },
  { value: 1440, label: "1 day before" },
  { value: 240, label: "4 hours before" },
  { value: 60, label: "1 hour before" },
  { value: 30, label: "30 minutes before" },
  { value: 15, label: "15 minutes before" },
];

const prefsSchema = z.object({
  lead_minutes: z.array(z.number().int().min(5).max(10080)).min(1).max(6),
  channels: z.array(z.enum(["sms", "email", "push"])).min(1),
  enabled: z.boolean(),
});

async function tenantIdFor(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!prof?.tenant_id) throw new Error("No tenant");
  return prof.tenant_id as string;
}

export const getMyReminderPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReminderPrefs> => {
    const tenantId = await tenantIdFor(context);
    const { data } = await context.supabase
      .from("reminder_preferences")
      .select("enabled, lead_minutes, channels")
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) {
      return { enabled: true, lead_minutes: [60], channels: ["push"], is_default: true };
    }
    return {
      enabled: (data as any).enabled,
      lead_minutes: ((data as any).lead_minutes ?? []) as number[],
      channels: ((data as any).channels ?? []) as ReminderChannel[],
      is_default: false,
    };
  });

export const upsertMyReminderPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => prefsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantIdFor(context);
    const { error } = await context.supabase
      .from("reminder_preferences")
      .upsert(
        {
          tenant_id: tenantId,
          user_id: context.userId,
          lead_minutes: data.lead_minutes,
          channels: data.channels,
          enabled: data.enabled,
        },
        { onConflict: "tenant_id,user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
