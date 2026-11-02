import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { clockAlertData, clockAlertEligible, type ClockAlertAction } from './owner-email-events';
import { photoAlertClaimId } from './photo-upload-alerts';
export type ClockEmailSettings = {clock_in:{enabled:boolean;recipient_id:string|null;starts_at:string};clock_out:{enabled:boolean;recipient_id:string|null;starts_at:string};confirmed:boolean};
export const CLOCK_SETTING = 'system:clock-email-settings';
export async function readClockEmailSettings(db:SupabaseClient<Database>,tenantId:string):Promise<ClockEmailSettings> {
  const {data,error}=await db.from('activity_log').select('description').eq('tenant_id',tenantId).eq('action_type',CLOCK_SETTING).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw new Error(error.message);
  const off={enabled:false,recipient_id:null,starts_at:new Date().toISOString()};
  return data ? JSON.parse(data.description) : {clock_in:{...off},clock_out:{...off},confirmed:false};
}
/** Called only after authenticated employee mutations commit; corrections never call this. */
export async function notifySavedClock(context:{supabase:SupabaseClient<Database>;userId:string},id:string|null,action:ClockAlertAction) {
  if(!id) return;
  try {
    const {data:profile}=await context.supabase.from('profiles').select('tenant_id,full_name').eq('id',context.userId).single();
    if(!profile) return;
    const {data:scheduled}=await context.supabase.from('time_entries').select('id,job_id,started_at,ended_at').eq('id',id).eq('user_id',context.userId).maybeSingle();
    const {data:work}=scheduled ? {data:null} : await context.supabase.from('work_clock_entries').select('id,job_id,kind,started_at,ended_at').eq('id',id).eq('user_id',context.userId).maybeSingle();
    const record=scheduled ?? work;
    if(!record || work?.kind==='lunch') return;
    const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
    const settings=await readClockEmailSettings(db,profile.tenant_id);
    const setting=settings[action];
    const eventTime=action==='clock_in'?record.started_at:record.ended_at;
    if(!settings.confirmed || !setting.enabled || !setting.recipient_id || !clockAlertEligible(action,eventTime,setting.starts_at) || !eventTime) return;
    const {data:role}=await db.from('user_roles').select('id').eq('tenant_id',profile.tenant_id).eq('user_id',setting.recipient_id).in('role',['owner','manager']).limit(1).maybeSingle();
    const {data:recipient}=await db.from('profiles').select('email').eq('tenant_id',profile.tenant_id).eq('id',setting.recipient_id).eq('is_active',true).maybeSingle();
    if(!role || !recipient?.email) return;
    const {data:job}=record.job_id ? await db.from('jobs').select('service_location_label,service_address,client:clients(first_name,last_name)').eq('tenant_id',profile.tenant_id).eq('id',record.job_id).maybeSingle() : {data:null};
    const detail=clockAlertData(profile.full_name || 'Employee',action,eventTime,job?.service_location_label || job?.service_address || null,record.job_id);
    const claimId=await photoAlertClaimId(`clock-email:${profile.tenant_id}:${context.userId}:${id}:${action}`);
    const {error:claim}=await db.from('activity_log').insert({id:claimId,tenant_id:profile.tenant_id,actor_id:context.userId,entity_type:'time_entry',entity_id:id,action_type:'system:clock-email-sending',description:JSON.stringify({...detail,status:'sending'})});
    if(claim?.code==='23505') return;
    if(claim) throw new Error(claim.message);
    let status='failed';let failure:string|null=null;
    try {
      const {sendOutlookAlert}=await import('./outlook-email.server');
      const client=[job?.client?.first_name,job?.client?.last_name].filter(Boolean).join(' ');
      await sendOutlookAlert(recipient.email,`${detail.employee} clocked ${action==='clock_in'?'in':'out'} — WRRCS`,`${detail.employee} clocked ${action==='clock_in'?'in':'out'}.\nRecorded event: ${detail.localTime}\n${detail.delayed?'Delayed notification — received after the recorded event.\n':''}${client?`Client: ${client}\n`:''}Property: ${detail.property}\n${detail.appointmentUrl || ''}`);
      status='accepted';
    } catch(error) {failure=error instanceof Error?error.message:'Outlook send failed';}
    const {error}=await db.from('activity_log').update({action_type:`system:clock-email-${status}`,description:JSON.stringify({...detail,status,recipient:recipient.email.replace(/^(.).+(@.*)$/,'$1***$2'),error:failure,deliveryConfirmed:false})}).eq('id',claimId);
    if(error) console.error('Clock email log failed',error.message);
  } catch(error) {console.error('Saved clock alert failed',error instanceof Error?error.message:error);}
}