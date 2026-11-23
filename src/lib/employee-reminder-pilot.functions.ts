import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
export const getReminderPilot = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const {data:manager,error:me}=await context.supabase.rpc('is_owner_or_manager');if(me)throw new Error(me.message);
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');
 const {data:pilot,error}=await context.supabase.from('employee_reminder_pilots').select('*').eq('tenant_id',tenant ?? '').maybeSingle();if(error)throw new Error(error.message);
 const {data:directory,error:de}=await context.supabase.rpc('staff_directory');if(de)throw new Error(de.message);
 const active=(directory ?? []).filter(p=>p.is_active && (manager || p.id===context.userId));
 // Reminders go to employee accounts only; owners and managers are left out.
 const roles=await Promise.all(active.map(p=>context.supabase.rpc('has_role',{_user_id:p.id,_role:'employee'})));
 const people=active.filter((_,i)=>roles[i]?.data===true).map(p=>({id:p.id,full_name:p.full_name}));
 const covered=new Set(pilot?.rollout_all?people.map(p=>p.id):(pilot?.participant_ids ?? []));
 const {data:devices,error:se}=await context.supabase.from('push_subscriptions').select('id,user_id,device_id,user_agent,permission_state,registration_checked_at,created_at');if(se)throw new Error(se.message);
 const {data:history,error:he}=await context.supabase.from('employee_reminder_attempts').select('id,user_id,stage,action,channel,status,attempted_at,accepted_at,error').order('attempted_at',{ascending:false}).limit(30);if(he)throw new Error(he.message);
 const {data:deviceHistory,error:dhe}=await context.supabase.from('employee_reminder_device_attempts').select('user_id,device_id,subscription_id,status,attempted_at,accepted_at,error').order('attempted_at',{ascending:false}).limit(60);if(dhe)throw new Error(dhe.message);
 return {manager:!!manager,pilot,people:people.filter(p=>covered.has(p.id)),devices:(devices ?? []).filter(d=>covered.has(d.user_id ?? '')),history:history ?? [],deviceHistory:deviceHistory ?? [],pushConfigured:!!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY && !!process.env.PUSH_CRON_SECRET,emailConfigured:!!process.env.MICROSOFT_OUTLOOK_API_KEY && !!process.env.LOVABLE_API_KEY};
});
/** Saves the all-employee reminder settings; the old two-person pilot can no longer be chosen. */
export const saveReminderPilot=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({delivery_enabled:z.boolean(),before_enabled:z.boolean(),start_enabled:z.boolean(),followup_enabled:z.boolean(),before_minutes:z.number().int().min(0).max(120),followup_minutes:z.number().int().min(0).max(120),channel:z.enum(['push','email'])}).parse(input)).handler(async({data,context})=>{
 const {data:manager}=await context.supabase.rpc('is_owner_or_manager');if(!manager)throw new Error('Only owners and managers can change employee reminders');
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');if(!tenant)throw new Error('Business not found');
 const {error}=await context.supabase.from('employee_reminder_pilots').upsert({...data,tenant_id:tenant,rollout_all:true,participant_ids:[]});if(error)throw new Error(error.message);return {ok:true};
});
export const getMyReminderBanner=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const {data:tenant}=await context.supabase.rpc('current_tenant_id');if(!tenant)return null;
 const {data:pilot,error}=await context.supabase.from('employee_reminder_pilots').select('*').eq('tenant_id',tenant).maybeSingle();if(error)throw new Error(error.message);
 if(!pilot)return null;
 const {reminderParticipant}=await import('@/lib/employee-reminder-rules');
 if(!reminderParticipant(pilot,context.userId))return null;
 if(pilot.rollout_all){const {data:isEmployee}=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'employee'});if(!isEmployee)return null;}
 const {data:jobs,error:je}=await context.supabase.from('jobs').select('id').in('status',['scheduled','in_progress']).gt('scheduled_end',new Date().toISOString()).lte('scheduled_start',new Date(Date.now()+120*60000).toISOString()).order('scheduled_start');if(je)throw new Error(je.message);
 const {pilotState}=await import('@/lib/employee-reminder-pilot.server');const {pilotReminder}=await import('@/lib/employee-reminder-rules');
 for(const job of jobs ?? []) {const state=await pilotState(context.supabase,job.id,context.userId);if(!state)continue;const r=pilotReminder(state,{...pilot,channel:pilot.channel as 'push'|'email'},Date.now(),false);if(r)return r;}
 return null;
});
