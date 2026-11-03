import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
export const getReminderPilot = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const {data:manager,error:me}=await context.supabase.rpc('is_owner_or_manager');if(me)throw new Error(me.message);
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');
 const {data:pilot,error}=await context.supabase.from('employee_reminder_pilots').select('*').eq('tenant_id',tenant ?? '').maybeSingle();if(error)throw new Error(error.message);
 const {data:directory,error:de}=await context.supabase.rpc('staff_directory');if(de)throw new Error(de.message);
 const people=(directory ?? []).filter(p=>p.is_active && (manager || p.id===context.userId));
 const {data:devices,error:se}=await context.supabase.from('push_subscriptions').select('id,user_id,device_id,user_agent,permission_state,registration_checked_at,created_at');if(se)throw new Error(se.message);
 const {data:history,error:he}=await context.supabase.from('employee_reminder_attempts').select('id,user_id,stage,action,channel,status,attempted_at,accepted_at,error').order('attempted_at',{ascending:false}).limit(30);if(he)throw new Error(he.message);
 const {data:deviceHistory,error:dhe}=await context.supabase.from('employee_reminder_device_attempts').select('user_id,device_id,subscription_id,status,attempted_at,accepted_at,error').order('attempted_at',{ascending:false}).limit(60);if(dhe)throw new Error(dhe.message);
 return {manager:!!manager,pilot,people,devices:(devices ?? []).filter(d=>pilot?.participant_ids.includes(d.user_id ?? '')),history:history ?? [],deviceHistory:deviceHistory ?? [],pushConfigured:!!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY && !!process.env.PUSH_CRON_SECRET,emailConfigured:!!process.env.MICROSOFT_OUTLOOK_API_KEY && !!process.env.LOVABLE_API_KEY};
});
export const saveReminderPilot=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({participant_ids:z.array(z.string().uuid()).length(2).refine(ids=>new Set(ids).size===2),before_enabled:z.boolean(),start_enabled:z.boolean(),followup_enabled:z.boolean(),before_minutes:z.number().int().min(0).max(120),followup_minutes:z.number().int().min(0).max(120),channel:z.enum(['push','email'])}).parse(input)).handler(async({data,context})=>{
 const {data:manager}=await context.supabase.rpc('is_owner_or_manager');if(!manager)throw new Error('Only owners and managers can select pilot employees');
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');if(!tenant)throw new Error('Business not found');
 const {error}=await context.supabase.from('employee_reminder_pilots').upsert({...data,tenant_id:tenant,delivery_enabled:false});if(error)throw new Error(error.message);return {ok:true};
});
export const getMyReminderBanner=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');if(!tenant)return null;
 const {data:pilot,error}=await context.supabase.from('employee_reminder_pilots').select('*').eq('tenant_id',tenant).maybeSingle();if(error)throw new Error(error.message);
 if(!pilot?.participant_ids.includes(context.userId))return null;
 const {data:jobs,error:je}=await context.supabase.from('jobs').select('id').in('status',['scheduled','in_progress']).gt('scheduled_end',new Date().toISOString()).lte('scheduled_start',new Date(Date.now()+120*60000).toISOString()).order('scheduled_start');if(je)throw new Error(je.message);
 const {pilotState}=await import('@/lib/employee-reminder-pilot.server');const {pilotReminder}=await import('@/lib/employee-reminder-rules');
 for(const job of jobs ?? []) {const state=await pilotState(context.supabase,job.id,context.userId);if(!state)continue;const r=pilotReminder(state,{...pilot,channel:pilot.channel as 'push'|'email'},Date.now(),false);if(r)return r;}
 return null;
});
