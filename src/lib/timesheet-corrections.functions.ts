import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateCorrectionIntervals, type CorrectionInterval, type CorrectionVisit, type AttendanceStatus } from "@/lib/timesheet-corrections";

const reviewSchema=z.object({employee_id:z.string().uuid(),job_id:z.string().uuid().nullable(),from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true})});
export type CorrectionReview = {
  original: {records: Record<string,unknown>[];visits: Record<string,unknown>[];attendance: Record<string,unknown>|null};
  records:CorrectionInterval[];visits:CorrectionVisit[];status:AttendanceStatus;
  history:{id:string;reason:string;corrected_at:string;editor_id:string;original_values:unknown;corrected_values:unknown}[];
};
export const getTimesheetCorrection = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>reviewSchema.parse(input))
  .handler(async({data,context}):Promise<CorrectionReview>=>{
    const {data:allowed}=await context.supabase.rpc("is_owner_or_manager");
    if(!allowed) throw new Error("Only owners and managers can correct timesheets");
    const {data:employee,error:employeeError}=await context.supabase.from("profiles").select("id").eq("id",data.employee_id).single();
    if(employeeError || !employee) throw new Error("Employee not found");
    const sb=context.supabase;
    const results=await Promise.all([
      sb.from("time_entries").select("*").eq("user_id",data.employee_id).lt("started_at",data.to).or(`ended_at.is.null,ended_at.gt.${data.from}`),
      sb.from("work_clock_entries").select("*").eq("user_id",data.employee_id).lt("started_at",data.to).or(`ended_at.is.null,ended_at.gt.${data.from}`),
      data.job_id ? sb.from("job_visits").select("*").eq("employee_id",data.employee_id).eq("job_id",data.job_id).lt("arrived_at",data.to).or(`left_at.is.null,left_at.gt.${data.from}`) : Promise.resolve({data:[],error:null}),
      data.job_id ? sb.from("attendance_corrections").select("*").eq("employee_id",data.employee_id).eq("job_id",data.job_id).maybeSingle() : Promise.resolve({data:null,error:null}),
      sb.from("timesheet_correction_history").select("*").eq("employee_id",data.employee_id).order("corrected_at",{ascending:false}).limit(20),
    ]);
    const error=results.find(r=>r.error)?.error;if(error)throw new Error(error.message);
    const rawRecords=[...(results[0].data??[]).map(r=>({...r,source:"time"})),...(results[1].data??[]).map(r=>({...r,source:"clock"}))].sort((a,b)=>a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
    const rawVisits=[...(results[2].data??[])].sort((a,b)=>a.id.localeCompare(b.id));
    const records=rawRecords.map((r):CorrectionInterval=>{
      if(r.source==="clock" && "kind" in r) return {id:r.id,source:"clock",kind:r.kind==="lunch" ? "lunch" : r.activity_type==="drive" ? "drive" : "work",started_at:r.started_at,ended_at:r.ended_at,job_id:r.job_id,description:r.description};
      return {id:r.id,source:"time",kind:"work",started_at:r.started_at,ended_at:r.ended_at,job_id:r.job_id,description:"notes" in r ? r.notes??"" : ""};
    });
    const visits=rawVisits.map(r=>({id:r.id,arrived_at:r.arrived_at,left_at:r.left_at}));
    return {original:{records:rawRecords,visits:rawVisits,attendance:results[3].data},records,visits,status:results[3].data?.status as AttendanceStatus ?? (visits.length ? "worked":"missing_punch"),history:results[4].data??[]};
  });

const intervalSchema=z.object({id:z.string().uuid(),source:z.enum(["time","clock"]),kind:z.enum(["work","drive","lunch"]),started_at:z.string().datetime({offset:true}),ended_at:z.string().datetime({offset:true}).nullable(),job_id:z.string().uuid().nullable(),description:z.string().max(300)});
export const saveTimesheetCorrection=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>reviewSchema.extend({original:z.unknown(),records:z.array(intervalSchema).max(100),visits:z.array(z.object({id:z.string().uuid(),arrived_at:z.string().datetime({offset:true}),left_at:z.string().datetime({offset:true}).nullable()})).max(50),status:z.enum(["worked","no_show","missing_punch"]),reason:z.string().trim().min(3).max(1000)}).parse(input))
  .handler(async({data,context})=>{
    validateCorrectionIntervals(data.records,data.visits,data.status,data.job_id);
    const {data:id,error}=await context.supabase.rpc("admin_correct_timesheet",{_employee:data.employee_id,_job:data.job_id as string,_from:data.from,_to:data.to,_original:data.original as never,_records:data.records,_visits:data.visits,_status:data.status,_reason:data.reason});
    if(error)throw new Error(error.message);return {id};
  });