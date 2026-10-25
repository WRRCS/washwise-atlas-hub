import { actionReminder, type ActionReminderKind } from "@/lib/cleaner-action-reminders";
type Db = any;
export async function loadActionState(db:Db,jobId:string,userId:string) {
  const [{data:job,error},{data:profile},{data:settings},{data:links},{data:clock},{data:other},{data:visits}] = await Promise.all([
    db.from("jobs").select("id,tenant_id,scheduled_start,scheduled_end,status,assigned_to,service_location_label,service_address").eq("id",jobId).maybeSingle(),
    db.from("profiles").select("tenant_id,is_active").eq("id",userId).maybeSingle(),
    db.from("cleaner_action_reminder_settings").select("*").eq("user_id",userId).maybeSingle(),
    db.from("job_employees").select("id").eq("job_id",jobId).eq("employee_id",userId),
    db.from("time_entries").select("id").eq("user_id",userId).is("ended_at",null),
    db.from("work_clock_entries").select("kind").eq("user_id",userId).is("ended_at",null),
    db.from("job_visits").select("id").eq("job_id",jobId).eq("employee_id",userId).limit(1),
  ]);
  if(error)throw new Error(error.message);
  if(!job || !settings || profile?.tenant_id!==job.tenant_id || settings.tenant_id!==job.tenant_id)return null;
  return {job,settings,userId,assigned:job.assigned_to===userId || !!links?.length,active:!!profile.is_active,clockedIn:!!clock?.length || !!other?.some((r:any)=>r.kind==="work"),onLunch:!!other?.some((r:any)=>r.kind==="lunch"),arrived:!!visits?.length};
}
export async function enqueueActionReminders(db:Db,now=Date.now()) {
  const {data:prefs,error}=await db.from("cleaner_action_reminder_settings").select("user_id,tenant_id").eq("enabled",true);
  if(error)throw new Error(error.message);
  let queued=0;
  for(const pref of prefs ?? []) {
    const {data:jobs,error:je}=await db.from("jobs").select("id").eq("tenant_id",pref.tenant_id).in("status",["scheduled","in_progress"]).gt("scheduled_end",new Date(now).toISOString()).lte("scheduled_start",new Date(now+120*60000).toISOString());
    if(je)throw new Error(je.message);
    for(const job of jobs ?? []) {
      const state=await loadActionState(db,job.id,pref.user_id);if(!state)continue;
      for(const kind of ["clock_in","arrival"] as ActionReminderKind[]) {
        const reminder=actionReminder(state,kind,now);if(!reminder)continue;
        const {error:ie}=await db.from("notifications").insert({tenant_id:pref.tenant_id,recipient_type:"employee",recipient_id:pref.user_id,channel:"push",template_name:`cleaner_action_${kind}`,action_reminder_key:reminder.key,scheduled_for:reminder.due,payload:{job_id:job.id,action:kind,scheduled_start:state.job.scheduled_start,title:reminder.title,body:reminder.body,url:reminder.url}});
        if(ie && ie.code!=="23505")throw new Error(ie.message);if(!ie)queued++;
      }
    }
  }
  return queued;
}
export async function currentActionReminder(db:Db,n:{recipient_id:string;payload:Record<string,unknown>;action_reminder_key:string|null},now=Date.now()) {
  if(typeof n.payload.job_id!=="string" || !["clock_in","arrival"].includes(String(n.payload.action)))return null;
  const state=await loadActionState(db,n.payload.job_id,n.recipient_id);if(!state)return null;
  const reminder=actionReminder(state,n.payload.action as ActionReminderKind,now);
  return reminder?.key===n.action_reminder_key ? reminder : null;
}