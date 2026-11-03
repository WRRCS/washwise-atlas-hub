import { pilotReminder, type PilotSettings } from '@/lib/employee-reminder-rules';
import { loadActionState } from '@/lib/cleaner-action-reminders.server';
type Db = any;
export async function pilotState(db:Db,jobId:string,userId:string) {
 const state=await loadActionState(db,jobId,userId,true);
 return state;
}
export async function dispatchPilotReminders(db:Db,now=Date.now()) {
 const {data:pilots,error}=await db.from('employee_reminder_pilots').select('*').eq('delivery_enabled',true);
 if(error)throw new Error(error.message);
 for(const p of (pilots ?? []) as (PilotSettings & {tenant_id:string})[]) {
  if(p.participant_ids.length!==2)continue;
  const {data:jobs,error:je}=await db.from('jobs').select('id').eq('tenant_id',p.tenant_id).in('status',['scheduled','in_progress']).gt('scheduled_end',new Date(now).toISOString()).lte('scheduled_start',new Date(now+120*60000).toISOString()).order('scheduled_start');
  if(je)throw new Error(je.message);
  for(const userId of p.participant_ids)for(const job of jobs ?? []) {
   const s=await pilotState(db,job.id,userId);if(!s)continue;
   const reminder=pilotReminder(s,p,now);if(!reminder)continue;
   const {data:claim,error:ce}=await db.rpc('claim_employee_reminder',{_tenant:p.tenant_id,_user:userId,_job:job.id,_start:s.job.scheduled_start,_key:reminder.key,_stage:reminder.stage,_action:reminder.action,_channel:p.channel});
   if(ce)throw new Error(ce.message);if(!claim)continue;
   try {
    const {data:fresh,error:fe}=await db.from('employee_reminder_pilots').select('*').eq('tenant_id',p.tenant_id).maybeSingle();if(fe)throw new Error(fe.message);
    const current=await pilotState(db,job.id,userId);const valid=current && fresh && pilotReminder(current,fresh,Date.now());
    if(!valid || valid.key!==reminder.key || valid.action!==reminder.action || fresh.channel!==p.channel){await db.from('employee_reminder_attempts').update({status:'suppressed'}).eq('id',claim);continue;}
    let accepted=false;
    if(p.channel==='email') {
     const {data:person,error:pe}=await db.from('profiles').select('email').eq('id',userId).eq('tenant_id',p.tenant_id).eq('is_active',true).maybeSingle();if(pe)throw new Error(pe.message);
     if(!person?.email)throw new Error('Pilot employee has no email address');
     const {sendOutlookAlert}=await import('@/lib/outlook-email.server');
     await sendOutlookAlert(person.email,`WRRCS · ${valid.title}`,`${valid.body}\n\nhttps://wrrcs.com${valid.url}`);accepted=true;
    } else {
     const {data:subs,error:se}=await db.from('push_subscriptions').select('id,device_id,endpoint,p256dh,auth').eq('tenant_id',p.tenant_id).eq('user_id',userId);if(se)throw new Error(se.message);
     if(!subs?.length)throw new Error('No registered device for this pilot employee');
     const {sendWebPush}=await import('@/lib/push.server');
     for(const sub of subs) {
      const state=await pilotState(db,job.id,userId);const {data:latest}=await db.from('employee_reminder_pilots').select('*').eq('tenant_id',p.tenant_id).maybeSingle();
      const latestReminder=state && latest && pilotReminder(state,latest,Date.now());
      if(!latestReminder || latestReminder.key!==valid.key || latestReminder.action!==valid.action || latest.channel!=='push')break;
      const {data:device,error:de}=await db.from('employee_reminder_device_attempts').insert({attempt_id:claim,tenant_id:p.tenant_id,user_id:userId,device_id:sub.device_id,subscription_id:sub.id,status:'attempted'}).select('id').single();if(de)throw new Error(de.message);
      try {
       const result=await sendWebPush(sub,{...latestReminder,recipientUserId:userId,ttlSeconds:120});
       await db.from('employee_reminder_device_attempts').update({status:result==='sent'?'accepted':'failed',accepted_at:result==='sent'?new Date().toISOString():null,error:result==='gone'?'Expired registration':null}).eq('id',device.id);
       if(result==='sent')accepted=true;
       if(result==='gone')await db.from('push_subscriptions').delete().eq('id',sub.id).eq('user_id',userId);
      } catch(e) {await db.from('employee_reminder_device_attempts').update({status:'failed',error:e instanceof Error?e.message:'Push request failed'}).eq('id',device.id);}
     }
    }
    await db.from('employee_reminder_attempts').update({status:accepted?'accepted':'failed',accepted_at:accepted?new Date().toISOString():null,error:accepted?null:'No push service accepted this reminder'}).eq('id',claim);
   } catch(e){await db.from('employee_reminder_attempts').update({status:'failed',error:e instanceof Error?e.message:'Reminder request failed'}).eq('id',claim);}
  }
 }
}
