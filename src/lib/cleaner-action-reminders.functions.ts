import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const getActionReminderSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const {data: manager} = await context.supabase.rpc("is_owner_or_manager");
  const {data: directory,error} = await context.supabase.rpc("staff_directory");
  if(error) throw new Error(error.message);
  const people=(directory ?? []).filter(p=>p.is_active && (manager || p.id===context.userId));
  const {data: prefs,error: pe} = await context.supabase.from("cleaner_action_reminder_settings").select("*");
  if(pe) throw new Error(pe.message);
  const {data: devices} = await context.supabase.from("push_subscriptions").select("user_id");
  return { manager: !!manager, pushConfigured: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY && !!process.env.PUSH_CRON_SECRET,
    people: people.map(p=>({id:p.id,name:p.full_name ?? "Cleaner",deviceCount:(devices ?? []).filter(d=>d.user_id===p.id).length, settings:prefs?.find(r=>r.user_id===p.id) ?? {enabled:false,clock_in_minutes_before:15,arrival_minutes_after:5,channels:["push"]}})) };
});
export const saveActionReminderSettings = createServerFn({ method:"POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>z.object({user_id:z.string().uuid(),enabled:z.boolean(),clock_in_minutes_before:z.number().int().min(0).max(120),arrival_minutes_after:z.number().int().min(0).max(120),channels:z.array(z.literal("push")).length(1)}).parse(input))
  .handler(async({data,context})=>{
    const {data:manager}=await context.supabase.rpc("is_owner_or_manager");
    if(data.user_id!==context.userId && !manager) throw new Error("Only owners and managers can change another cleaner's reminders");
    const {data:tenant}=await context.supabase.rpc("current_tenant_id");
    if(!tenant) throw new Error("Business not found");
    if(data.enabled && (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.PUSH_CRON_SECRET)) throw new Error("Push delivery is not configured");
    const {data:target}=await context.supabase.from("profiles").select("id").eq("id",data.user_id).eq("tenant_id",tenant).eq("is_active",true).maybeSingle();
    if(!target) throw new Error("Active employee not found");
    const {error}=await context.supabase.from("cleaner_action_reminder_settings").upsert({...data,tenant_id:tenant,updated_at:new Date().toISOString()});
    if(error)throw new Error(error.message);
    return {ok:true};
  });