import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {getClockEmailSettings,saveClockEmailSettings} from '@/lib/clock-email-alerts.functions';
import {getPhotoEmailSettings} from '@/lib/photo-upload-alerts.functions';
import {OUTLOOK_SENDER} from '@/lib/owner-email-events';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Checkbox} from '@/components/ui/checkbox';
import {toast} from 'sonner';
export function ClockEmailSettings() {
  const load=useServerFn(getClockEmailSettings),save=useServerFn(saveClockEmailSettings),recipientsFn=useServerFn(getPhotoEmailSettings);
  const qc=useQueryClient();
  const query=useQuery({queryKey:['clock-email-settings'],queryFn:()=>load()});
  const recipients=useQuery({queryKey:['photo-email-settings'],queryFn:()=>recipientsFn()});
  const [inEnabled,setInEnabled]=useState(false),[outEnabled,setOutEnabled]=useState(false),[inRecipient,setInRecipient]=useState(''),[outRecipient,setOutRecipient]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{if(query.data){const s=query.data.settings;setInEnabled(s.clock_in.enabled);setOutEnabled(s.clock_out.enabled);setInRecipient(s.clock_in.recipient_id??'');setOutRecipient(s.clock_out.recipient_id??'');setConfirmed(s.confirmed);}},[query.data]);
  return <section aria-label="Employee clock emails" className="border-b border-border pb-6 space-y-4">
    <h3 className="font-semibold">Employee clock emails · Outlook</h3>
    <p className="text-sm">Sender: {OUTLOOK_SENDER}</p>
    {query.error || recipients.error ? <p className="text-destructive">Unable to load clock email settings.</p> : <>
      {[{key:'in',label:'Clock in',enabled:inEnabled,setEnabled:setInEnabled,recipient:inRecipient,setRecipient:setInRecipient},{key:'out',label:'Clock out',enabled:outEnabled,setEnabled:setOutEnabled,recipient:outRecipient,setRecipient:setOutRecipient}].map(row=><div key={row.key} className="space-y-2">
        <label className="flex items-center gap-3"><Switch aria-label={`${row.label} email`} checked={row.enabled} onCheckedChange={row.setEnabled} disabled={busy || query.isLoading}/>{row.label}</label>
        <select aria-label={`${row.label} email recipient`} value={row.recipient} onChange={e=>{row.setRecipient(e.target.value);setConfirmed(false);}} className="w-full max-w-lg rounded-md border border-input bg-background p-2 text-sm">
          <option value="">Choose owner/admin recipient</option>{recipients.data?.recipients.map(r=><option key={r.id} value={r.id}>{r.full_name} · {r.email}</option>)}
        </select>
      </div>)}
      <label className="flex items-start gap-3 text-sm"><Checkbox aria-label="Confirm clock email addresses" checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/>I confirm this Outlook sender and the selected recipients.</label>
      <Button disabled={busy || query.isLoading || ((inEnabled || outEnabled) && (!confirmed || (inEnabled&&!inRecipient) || (outEnabled&&!outRecipient)))} onClick={async()=>{setBusy(true);try{await save({data:{clock_in:{enabled:inEnabled,recipient_id:inRecipient||null},clock_out:{enabled:outEnabled,recipient_id:outRecipient||null},confirmed}});await qc.invalidateQueries({queryKey:['clock-email-settings']});toast.success('Clock email settings saved');}catch(e){toast.error(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}}>{busy?'Saving…':'Save clock email settings'}</Button>
      <p className="text-sm text-muted-foreground">Future work-session events only. Lunch and admin corrections are excluded. Accepted means Outlook accepted the message, not confirmed delivery.</p>
      <h4 className="text-sm font-semibold">Recent clock email activity</h4>
      <ul className="text-sm space-y-2">{query.data?.logs.map(log=>{const d=JSON.parse(log.description);return <li key={log.id} className="border-t border-border pt-2 break-words">{d.status} · {d.employee} · {d.action==='clock_in'?'Clock in':'Clock out'} · {d.localTime} · {d.property}{d.delayed?' · Delayed':''}{d.error&&<span className="block text-destructive">{d.error}</span>}</li>;})}</ul>
      {!query.data?.logs.length&&<p className="text-sm text-muted-foreground">No clock email activity.</p>}
    </>}
  </section>;
}