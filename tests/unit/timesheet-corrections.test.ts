import { describe,expect,it } from "vitest";
import { attendanceIssue,insertLunch,adjustLunch,validateCorrectionIntervals,type CorrectionInterval } from "../../src/lib/timesheet-corrections";
import { clockTotals } from "../../src/lib/clock-totals";
const at=(h:string)=>`2026-10-20T${h}:00Z`;
const work:CorrectionInterval={id:"work",source:"clock",kind:"work",started_at:at("09:00"),ended_at:at("17:00"),job_id:"job",description:"Work"};
const lunch:CorrectionInterval={...work,id:"lunch",kind:"lunch",started_at:at("12:00"),ended_at:at("12:30")};
describe("admin timesheet corrections",()=>{
 it("missing data is not a confirmed no-show",()=>expect(attendanceIssue({arrived_at:null,left_at:null,scheduled_end:at("17:00")},Date.parse(at("18:00")))).toBe("Missing punch"));
 it("a confirmed no-show remains absent without fabricated hours",()=>{expect(attendanceIssue({attendance_status:"no_show",arrived_at:null,left_at:null,scheduled_end:at("17:00")})).toBe("No-Show");expect(()=>validateCorrectionIntervals([],[],"no_show","job")).not.toThrow();expect(()=>validateCorrectionIntervals([work],[],"no_show","job")).toThrow("cannot contain work");});
 it("allows no-show-to-worked actual punches",()=>expect(()=>validateCorrectionIntervals([work],[{id:"visit",arrived_at:work.started_at,left_at:work.ended_at}],"worked","job")).not.toThrow());
 it("splits lunch from paid work and arrival exactly once",()=>{const result=insertLunch([work],[{id:"visit",arrived_at:work.started_at,left_at:work.ended_at}],lunch,()=>"second");expect(clockTotals(result.records)).toEqual({paid:450,unpaid:30});expect(result.visits).toHaveLength(2);expect(result.records[0]?.id).toBe("work");});
 it("edits lunch and adjacent paid edges",()=>{const result=insertLunch([work],[],lunch,()=>"second");const edited=adjustLunch(result.records,[],lunch,{...lunch,ended_at:at("12:45")});expect(clockTotals(edited.records)).toEqual({paid:435,unpaid:45});});
 it("removes incorrect lunch and restores paid time",()=>{const result=insertLunch([work],[],lunch,()=>"second");expect(clockTotals(adjustLunch(result.records,[],lunch,null).records)).toEqual({paid:480,unpaid:0});});
 it("drive can be zero without zero-length work records",()=>{const drive={...work,id:"drive",kind:"drive" as const,started_at:at("08:30"),ended_at:at("09:00")};expect(clockTotals([drive,work]).paid).toBe(510);expect(clockTotals([drive,work].filter(r=>r.kind!=="drive")).paid).toBe(480);});
 it("rejects invalid and overlapping intervals",()=>{expect(()=>validateCorrectionIntervals([{...work,ended_at:work.started_at}],[],"missing_punch",null)).toThrow("after start");expect(()=>validateCorrectionIntervals([work,lunch],[],"missing_punch",null)).toThrow("overlap");});
 it("supports overnight work without altering original dates",()=>{expect(clockTotals([{...work,started_at:at("23:00"),ended_at:"2026-10-21T02:00:00Z"}]).paid).toBe(180);});
});