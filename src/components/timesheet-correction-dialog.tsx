import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { listEmployees } from "@/lib/entities.functions";
import { listJobs } from "@/lib/jobs.functions";
import { getTimesheetCorrection, saveTimesheetCorrection, type CorrectionReview } from "@/lib/timesheet-corrections.functions";
import { adjustLunch, insertLunch, type AttendanceStatus, type CorrectionInterval, type CorrectionVisit } from "@/lib/timesheet-corrections";
import { dayKeyTZ, hourMinuteTZ, zonedToUTCISO } from "@/lib/tz";

const tz="America/Los_Angeles";
const local=(value:string|null)=>{if(!value)return "";const t=hourMinuteTZ(value,tz);return `${dayKeyTZ(value,tz)}T${String(t.hour).padStart(2,"0")}:${String(t.minute).padStart(2,"0")}`;};
const iso=(value:string)=>{const [date,time]=value.split("T");return zonedToUTCISO(date??"",time??"",tz);};
export function TimesheetCorrectionDialog({employeeId,jobId,from,to,onClose}:{employeeId?:string;jobId?:string|null;from:string;to:string;onClose:()=>void}) {
  const [employee,setEmployee]=useState(employeeId??"");
  const [job,setJob]=useState(jobId??"");
  const employeesFn=useServerFn(listEmployees), jobsFn=useServerFn(listJobs), reviewFn=useServerFn(getTimesheetCorrection);
  const employees=useQuery({queryKey:["employees"],queryFn:()=>employeesFn({})});
  const jobs=useQuery({queryKey:["clock-review-jobs"],queryFn:()=>jobsFn({data:{}})});
  const review=useQuery({queryKey:["timesheet-correction",employee,job,from,to],queryFn:()=>reviewFn({data:{employee_id:employee,job_id:job||null,from,to}}),enabled:!!employee,staleTime:0});
  return <Dialog open onOpenChange={open=>!open&&onClose()}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Correct timesheet</DialogTitle></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Employee<select aria-label="Correction employee" disabled={!!employeeId} value={employee} onChange={e=>setEmployee(e.target.value)} className="block w-full border border-input bg-background rounded-md p-2"><option value="">Select employee…</option>{employees.data?.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
      <label>Attendance appointment<select aria-label="Attendance appointment" disabled={!!employeeId} value={job} onChange={e=>setJob(e.target.value)} className="block w-full border border-input bg-background rounded-md p-2"><option value="">Unscheduled work / day clock</option>{jobs.data?.map(j=><option key={j.id} value={j.id}>{dayKeyTZ(j.scheduled_start,tz)} · {j.service_location_label??j.service_address}</option>)}</select></label>
    </div>
    {review.isFetching ? <p>Loading time records…</p> : review.error ? <p className="text-destructive">{review.error.message}</p> : review.data && <CorrectionForm key={`${employee}:${job}:${review.dataUpdatedAt}`} review={review.data} employee={employee} job={job} from={from} to={to} jobs={jobs.data??[]} onClose={onClose}/>}
  </DialogContent></Dialog>;
}

function CorrectionForm({review,employee,job,from,to,jobs,onClose}:{review:CorrectionReview;employee:string;job:string;from:string;to:string;jobs:{id:string;scheduled_start:string;service_location_label:string|null;service_address:string|null}[];onClose:()=>void}) {
  const [records,setRecords]=useState(review.records),[visits,setVisits]=useState(review.visits),[status,setStatus]=useState<AttendanceStatus>(review.status);
  const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [lunchStart,setLunchStart]=useState(""),[lunchEnd,setLunchEnd]=useState("");
  const save=useServerFn(saveTimesheetCorrection),qc=useQueryClient();
  const patchRecord=(r:CorrectionInterval,patch:Partial<CorrectionInterval>)=>{
    const next={...r,...patch};
    if(r.kind==="lunch" && (patch.started_at || patch.ended_at!==undefined)) {
      const adjusted=adjustLunch(records,visits,r,next);setRecords(adjusted.records);setVisits(adjusted.visits);
    } else setRecords(prev=>prev.map(x=>x.id===r.id?next:x));
  };
  const addRecord=(kind:"work"|"drive")=>setRecords(prev=>[...prev,{id:crypto.randomUUID(),source:"clock",kind,started_at:from,ended_at:null,job_id:job||null,description:kind==="drive"?"Drive time":"Work correction"}]);
  const addLunch=()=>{try {const lunch:CorrectionInterval={id:crypto.randomUUID(),source:"clock",kind:"lunch",started_at:iso(lunchStart),ended_at:iso(lunchEnd),job_id:job||null,description:"Unpaid lunch"};const split=insertLunch(records,visits,lunch,()=>crypto.randomUUID());setRecords(split.records);setVisits(split.visits);setLunchStart("");setLunchEnd("");setError("");}catch(e){setError(e instanceof Error?e.message:"Invalid lunch");}};
  const remove=(r:CorrectionInterval)=>{try{if(r.kind==="lunch"){const changed=adjustLunch(records,visits,r,null);setRecords(changed.records);setVisits(changed.visits);}else setRecords(prev=>prev.filter(x=>x.id!==r.id));}catch(e){setError(e instanceof Error?e.message:"Unable to remove");}};
  const submit=async()=>{setBusy(true);setError("");try{await save({data:{employee_id:employee,job_id:job||null,from,to,original:review.original,records,visits,status,reason}});await Promise.all(["timesheet","timesheet-correction","my-timesheet","my-shift","reports","report-timesheets","report-payroll"].map(key=>qc.invalidateQueries({queryKey:[key]})));toast.success("Timesheet correction saved");onClose();}catch(e){setError(e instanceof Error?e.message:"Unable to save");}finally{setBusy(false);}};
  return <>
    {job&&<label>Attendance status<select aria-label="Attendance status" value={status} onChange={e=>setStatus(e.target.value as AttendanceStatus)} className="block border border-input bg-background rounded-md p-2"><option value="worked">Worked</option><option value="missing_punch">Missing punch</option><option value="no_show">Confirmed no-show</option></select></label>}
    <section className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold mr-auto">Paid work &amp; drive intervals</h3><Button variant="outline" size="sm" onClick={()=>addRecord("work")}><Plus className="size-4 mr-1"/>Add work</Button><Button variant="outline" size="sm" onClick={()=>addRecord("drive")}><Plus className="size-4 mr-1"/>Add drive</Button><Button variant="outline" size="sm" onClick={()=>setRecords(prev=>prev.filter(r=>r.kind!=="drive"))}>Set drive to zero</Button></div>
      {records.map(r=><div key={r.id} className="border-t border-border pt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-interval-id={r.id}>
        <label>Record type<select aria-label="Record type" value={r.kind} disabled={r.source==="time"||r.kind==="lunch"} onChange={e=>patchRecord(r,{kind:e.target.value as CorrectionInterval["kind"]})} className="block w-full border border-input bg-background rounded-md p-2"><option value="work">Work</option><option value="drive">Drive</option><option value="lunch">Unpaid lunch</option></select></label>
        <label>Start (Pacific)<Input aria-label="Interval start" type="datetime-local" value={local(r.started_at)} onChange={e=>e.target.value&&patchRecord(r,{started_at:iso(e.target.value)})}/></label>
        <label>End (Pacific)<Input aria-label="Interval end" type="datetime-local" value={local(r.ended_at)} onChange={e=>patchRecord(r,{ended_at:e.target.value?iso(e.target.value):null})}/></label>
        <label>Appointment<select aria-label="Interval appointment" value={r.job_id??""} onChange={e=>patchRecord(r,{job_id:e.target.value||null,source:e.target.value?r.source:"clock"})} className="block w-full border border-input bg-background rounded-md p-2"><option value="">Unscheduled work</option>{jobs.map(j=><option key={j.id} value={j.id}>{dayKeyTZ(j.scheduled_start,tz)} · {j.service_location_label??j.service_address}</option>)}</select></label>
        <label className="sm:col-span-2">Description<Input aria-label="Interval description" value={r.description} onChange={e=>patchRecord(r,{description:e.target.value})}/></label>
        <Button variant="ghost" size="icon" aria-label={`Remove ${r.kind} interval`} onClick={()=>remove(r)}><Trash2 className="size-4"/></Button>
      </div>)}
    </section>
    <section className="space-y-2"><h3 className="font-semibold">Unpaid lunch</h3><div className="flex flex-wrap gap-2 items-end"><label>Lunch start (Pacific)<Input aria-label="New lunch start" type="datetime-local" value={lunchStart} onChange={e=>setLunchStart(e.target.value)}/></label><label>Lunch end (Pacific)<Input aria-label="New lunch end" type="datetime-local" value={lunchEnd} onChange={e=>setLunchEnd(e.target.value)}/></label><Button variant="outline" disabled={!lunchStart||!lunchEnd} onClick={addLunch}><Plus className="size-4 mr-1"/>Add lunch</Button></div></section>
    {job&&<section className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-semibold">Appointment arrival / leave intervals</h3><Button variant="outline" size="sm" onClick={()=>setVisits(prev=>[...prev,{id:crypto.randomUUID(),arrived_at:from,left_at:null}])}><Plus className="size-4 mr-1"/>Add arrival</Button></div>{visits.map(v=><div key={v.id} className="flex flex-wrap gap-2 items-end"><label>Arrived (Pacific)<Input aria-label="Arrival start" type="datetime-local" value={local(v.arrived_at)} onChange={e=>e.target.value&&setVisits(prev=>prev.map(x=>x.id===v.id?{...x,arrived_at:iso(e.target.value)}:x))}/></label><label>Left (Pacific)<Input aria-label="Arrival end" type="datetime-local" value={local(v.left_at)} onChange={e=>setVisits(prev=>prev.map(x=>x.id===v.id?{...x,left_at:e.target.value?iso(e.target.value):null}:x))}/></label><Button variant="ghost" size="icon" aria-label="Remove arrival interval" onClick={()=>setVisits(prev=>prev.filter(x=>x.id!==v.id))}><Trash2 className="size-4"/></Button></div>)}</section>}
    <label>Correction reason<Input aria-label="Correction reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    <details><summary className="cursor-pointer font-semibold">Correction history ({review.history.length})</summary>{review.history.map(h=><div key={h.id} className="border-t border-border py-2"><p>{new Date(h.corrected_at).toLocaleString("en-US",{timeZone:tz})} · {h.reason}</p><p className="text-xs text-muted-foreground">Editor: {h.editor_id}</p><details><summary>Original and corrected records</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({original:h.original_values,corrected:h.corrected_values},null,2)}</pre></details></div>)}</details>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy||reason.trim().length<3} onClick={()=>void submit()}>{busy?"Saving…":"Save correction"}</Button></DialogFooter>
  </>;
}