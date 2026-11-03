export type ReminderStage = 'before' | 'start' | 'followup';
export type PilotSettings = { participant_ids: string[]; delivery_enabled: boolean; before_enabled: boolean; start_enabled: boolean; followup_enabled: boolean; before_minutes: number; followup_minutes: number; channel: 'push' | 'email' };
export type PilotState = { job: { id: string; tenant_id: string; scheduled_start: string; scheduled_end: string; status: string; service_location_label: string | null; service_address: string | null }; userId: string; assigned: boolean; active: boolean; clockedIn: boolean; onLunch: boolean; arrived: boolean };
export function pilotEligible(s: PilotState, p: PilotSettings) {
 return p.participant_ids.length === 2 && p.participant_ids.includes(s.userId) && s.assigned && s.active && !s.onLunch && !s.arrived && ['scheduled','in_progress'].includes(s.job.status);
}
export function pilotReminder(s: PilotState,p: PilotSettings,now: number,delivery=true) {
 if (!pilotEligible(s,p) || (delivery && !p.delivery_enabled)) return null;
 const start=Date.parse(s.job.scheduled_start),end=Date.parse(s.job.scheduled_end);
 if(now>=end)return null;
 const stages: {stage:ReminderStage;due:number;enabled:boolean}[]=[{stage:'before',due:start-p.before_minutes*60000,enabled:p.before_enabled},{stage:'start',due:start,enabled:p.start_enabled},{stage:'followup',due:start+p.followup_minutes*60000,enabled:p.followup_enabled}];
 // Only the latest enabled stage can be sent. Missed stages never create a burst.
 const due=stages.filter(x=>x.enabled && x.due<=now).at(-1);
 if(!due || (delivery && now-due.due>2*60000))return null;
 const action=s.clockedIn?'arrival':'clock_in';
 // Arrival cannot be requested before the scheduled appointment starts.
 if(action==='arrival' && now<start)return null;
 const time=new Date(start).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return {stage:due.stage,action,key:[s.job.tenant_id,s.job.id,s.userId,s.job.scheduled_start,due.stage].join(':'),due:new Date(due.due).toISOString(),title:action==='clock_in'?'Clock in':'Record your arrival',body:`${time} Pacific · ${s.job.service_location_label || s.job.service_address || 'Location needs review'}`,url:`/jobs/${s.job.id}#clock-actions`};
}
export function withinReminderLimits(attempts:{attempted_at:string;job_id:string;scheduled_start:string}[],s:PilotState,now:number) {
 return !attempts.some(a=>now-Date.parse(a.attempted_at)<10*60000) && attempts.filter(a=>a.job_id===s.job.id && a.scheduled_start===s.job.scheduled_start).length<3;
}
