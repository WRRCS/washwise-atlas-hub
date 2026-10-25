import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { getActionReminderSettings,saveActionReminderSettings } from "@/lib/cleaner-action-reminders.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function CleanerActionReminderSettings() {
  const get=useServerFn(getActionReminderSettings),save=useServerFn(saveActionReminderSettings),qc=useQueryClient();
  const q=useQuery({queryKey:["action-reminder-settings"],queryFn:()=>get()});
  const [user,setUser]=useState("");const [enabled,setEnabled]=useState(false);const [before,setBefore]=useState(15);const [after,setAfter]=useState(5);const [busy,setBusy]=useState(false);
  const person=q.data?.people.find(p=>p.id===user);
  useEffect(()=>{if(!user && q.data?.people[0])setUser(q.data.people[0].id);},[q.data,user]);
  useEffect(()=>{if(!person)return;setEnabled(person.settings.enabled);setBefore(person.settings.clock_in_minutes_before);setAfter(person.settings.arrival_minutes_after);},[person]);
  const submit=async()=>{setBusy(true);try{await save({data:{user_id:user,enabled,clock_in_minutes_before:before,arrival_minutes_after:after,channels:["push"]}});await qc.invalidateQueries({queryKey:["action-reminder-settings"]});toast.success("Action reminders saved");}catch(e){toast.error(e instanceof Error?e.message:"Unable to save reminders");}finally{setBusy(false);}};
  return <section aria-label="Clock-in and arrival reminders" className="border-y border-border py-6 space-y-4">
    <h2 className="font-semibold">Clock-in &amp; arrival reminders</h2>
    {q.isLoading?<p className="text-sm text-muted-foreground">Loading…</p>:q.error?<p className="text-sm text-destructive">Unable to load action reminders</p>:<>
      <div className="flex flex-wrap gap-4 items-center">
        <label className="text-sm font-medium">Cleaner<select aria-label="Action reminder cleaner" className="block mt-1 border border-input rounded-md bg-background px-3 py-2 max-w-full" value={user} onChange={e=>setUser(e.target.value)}>{q.data?.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><Switch aria-label="Enable clock-in and arrival reminders" checked={enabled} onCheckedChange={setEnabled} disabled={!q.data?.pushConfigured || busy}/>{enabled?"On":"Off"}</label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
        <label className="text-sm">Clock-in reminder · minutes before appointment<input aria-label="Clock-in minutes before" type="number" min={0} max={120} value={before} onChange={e=>setBefore(Number(e.target.value))} className="block mt-1 border border-input rounded-md bg-background px-3 py-2 w-24"/></label>
        <label className="text-sm">Arrival reminder · minutes after appointment start<input aria-label="Arrival minutes after" type="number" min={0} max={120} value={after} onChange={e=>setAfter(Number(e.target.value))} className="block mt-1 border border-input rounded-md bg-background px-3 py-2 w-24"/></label>
      </div>
      <fieldset className="space-y-1 text-sm"><legend className="font-medium">Delivery channels</legend>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!q.data?.pushConfigured} disabled/>Push · {q.data?.pushConfigured?"configured":"setup needed"}</label>
        <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" disabled/>Email · action reminders not enabled</label>
        <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" disabled/>Text message · sending service not connected</label>
      </fieldset>
      <div className="text-sm text-muted-foreground space-y-1">
        <p>{person?.deviceCount ? `${person.deviceCount} registered push device${person.deviceCount===1?"":"s"}.` : "No push device registered for this cleaner. Enable notifications on their device."}</p>
        <p>Push can arrive with the app closed. Browser/device notification permission is required; iPhone and iPad require the home-screen app.</p>
        <p>The email sender is verified, but these reminders use push only. Scheduled email delivery must be added before email can be selected; no emails or texts are enabled here.</p>
      </div>
      <Button onClick={submit} disabled={busy || !person || before<0 || before>120 || after<0 || after>120}><Save className="size-4"/>Save action reminders</Button>
    </>}
  </section>;
}