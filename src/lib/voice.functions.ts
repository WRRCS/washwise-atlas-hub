import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getTenant(context: any): Promise<string> {
  const { data: profile, error } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.tenant_id) throw new Error("No tenant");
  return profile.tenant_id as string;
}

export const getVoiceConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await getTenant(context);
    let { data, error } = await context.supabase
      .from("voice_agent_config").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const { data: created, error: ce } = await context.supabase
        .from("voice_agent_config").insert({ tenant_id: tenantId } as never)
        .select("*").single();
      if (ce) throw new Error(ce.message);
      data = created;
    }
    return data;
  });

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  greeting: z.string().min(1).max(500).optional(),
  system_prompt: z.string().min(1).max(4000).optional(),
  voice: z.string().max(60).optional(),
  language: z.string().max(20).optional(),
  forward_number: z.string().max(30).nullable().optional(),
  twilio_phone_number: z.string().max(30).nullable().optional(),
});

export const updateVoiceConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { error } = await context.supabase
      .from("voice_agent_config").update(data as never).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listVoiceCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await getTenant(context);
    const { data, error } = await context.supabase
      .from("voice_calls")
      .select("id, call_sid, from_number, to_number, status, direction, duration_sec, recording_url, summary, lead_id, started_at, ended_at")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getVoiceCall = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const [{ data: call, error: ce }, { data: turns, error: te }] = await Promise.all([
      context.supabase.from("voice_calls").select("*").eq("id", data.id).eq("tenant_id", tenantId).maybeSingle(),
      context.supabase.from("voice_call_turns").select("*").eq("call_id", data.id).order("seq", { ascending: true }),
    ]);
    if (ce) throw new Error(ce.message);
    if (te) throw new Error(te.message);
    if (!call) throw new Error("Call not found");
    return { call, turns: turns ?? [] };
  });
