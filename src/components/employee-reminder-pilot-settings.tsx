import { useEffect,useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Save,RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getReminderPilot,saveReminderPilot } from '@/lib/employee-reminder-pilot.functions';
export function EmployeeReminderPilotSettings() {
 const get=useServerFn(getReminderPilot),save=useServerFn(saveReminderPilot),qc=useQueryClient();
 const q=useQuery({queryKey:['employee-reminder-pilot'],queryFn:()=>get()});
 const [on,setOn]=useState(true),[before,setBefore]=useState(15),[followup,setFollowup]=useState(5),[stages,setStages]=useState([true,true,true]),[channel,setChannel]=useState<'push'|'email'>('push'),[busy,setBusy]=useState(false);
 useEffect(()=>{const p=q.data?.pilot;if(p){setOn(p.rollout_all && p.delivery_enabled);setBefore(p.before_minutes);setFollowup(p.followup_minutes);setStages([p.before_enabled,p.start_enabled,p.followup_enabled]);setChannel(p.channel as 'push'|'email');}},[q.data?.pilot]);
 if(q.isLoading)return <p>Loading employee reminders…</p>;
 if(q.error)return <p className="text-destructive">Unable to load employee reminders.</p>;
 if(!q.data?.manager)return null;
 const live=!!q.data.pilot?.rollout_all && !!q.data.pilot?.delivery_enabled;
 const submit=async()=>{setBusy(true);try{await save({data:{delivery_enabled:on,before_enabled:stages[0] ?? false,start_enabled:stages[1] ?? false,followup_enabled:stages[2] ?? false,before_minutes:before,followup_minutes:followup,channel}});await qc.invalidateQueries({queryKey:['employee-reminder-pilot']});toast.success(on?'Reminders on for all current employees':'Employee reminders turned off');}catch(e){toast.error(e instanceof Error?e.message:'Unable to save reminders');}finally{setBusy(false);}};
 return <section aria-label="Employee clock-in and arrival reminders" className="space-y-5 border-y border-border py-6">
 <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Employee clock-in & arrival reminders</h2><p className="text-sm text-muted-foreground">{live?`On for all current employees (${q.data.people.length})`:'Off'} · archived staff never get reminders</p></div><Button variant="outline" size="icon" aria-label="Recheck phones" onClick={()=>q.refetch()}><RefreshCw className="size-4"/></Button></div>
 <label className="flex items-center gap-3 text-sm font-medium"><Switch checked={on} onCheckedChange={setOn} aria-label="Send reminders to all current employees"/>Send reminders to all current employees</label>
 <div className="grid gap-3 sm:grid-cols-3">{['Before appointment','At scheduled start','One follow-up'].map((label,i)=><label key={label} className="text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={stages[i]} onChange={e=>setStages(stages.map((v,k)=>k===i?e.target.checked:v))}/>{label}</span>{i!==1 && <input aria-label={i===0?'Minutes before start':'Follow-up minutes after start'} type="number" min={0} max={120} value={i===0?before:followup} onChange={e=>i===0?setBefore(Number(e.target.value)):setFollowup(Number(e.target.value))} className="mt-2 w-24 rounded border border-input bg-background px-2 py-1"/>}</label>)}</div>
 <fieldset className="flex flex-wrap gap-5 text-sm"><legend className="mb-2 font-medium">Send by</legend><label><input type="radio" name="pilot-channel" checked={channel==='push'} onChange={()=>setChannel('push')}/> Phone notification · {q.data.pushConfigured?'available':'setup needed'}</label><label><input type="radio" name="pilot-channel" checked={channel==='email'} disabled={!q.data.emailConfigured} onChange={()=>setChannel('email')}/> Email instead · {q.data.emailConfigured?'available':'unavailable'}</label></fieldset>
 <p className="text-sm text-muted-foreground">Only for published cleanings the employee is on. At most three per cleaning, at least ten minutes apart; none during lunch or after they record arrival.</p>
 <div className="divide-y divide-border">{q.data.people.map(p=>{const devices=q.data?.devices.filter(d=>d.user_id===p.id) ?? [];return <div key={p.id} className="py-3 space-y-2"><h3 className="font-medium">{p.full_name}</h3>{!devices.length?<p className="text-sm text-muted-foreground">No phone set up for notifications yet · sees reminders inside the app only</p>:devices.map((d,i)=>{const last=q.data?.deviceHistory.find(h=>h.subscription_id===d.id);return <div key={d.id} className="text-sm border-l-2 border-border pl-3"><p>Device {i+1} · {d.user_agent?.includes('iPhone')?'iPhone':d.user_agent?.includes('Android')?'Android':'Browser'}</p><p className="text-muted-foreground">{d.registration_checked_at?'Checked '+new Date(d.registration_checked_at).toLocaleString():'Older registration · reopen the app on this phone'} · {d.permission_state ?? 'permission unverified'}</p><p>{last?`Last reminder: ${last.status}${last.error?' · '+last.error:''}`:'No reminder sent yet'}</p></div>;})}</div>;})}</div>
 <Button onClick={submit} disabled={busy || before<0 || before>120 || followup<0 || followup>120}><Save className="size-4"/>Save reminder settings</Button>
 {q.data.history.length>0 && <ul className="text-sm divide-y divide-border">{q.data.history.map(h=><li key={h.id} className="py-2">{h.stage} · {h.action} · {h.channel} · {h.status} · {new Date(h.attempted_at).toLocaleString()}</li>)}</ul>}
 </section>;
}
