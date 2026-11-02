import {describe,expect,it,vi} from "vitest";
vi.mock("@tanstack/react-start",()=>({createServerFn:()=>{const b={middleware:()=>b,inputValidator:()=>b,handler:(h:unknown)=>h};return b;}}));
vi.mock("@/integrations/supabase/auth-middleware",()=>({requireSupabaseAuth:{}}));
import {getTimesheetCorrection,saveTimesheetCorrection} from "../../src/lib/timesheet-corrections.functions";
describe("timesheet correction authorization",()=>{
 it("employees cannot open correction records",async()=>{const from=vi.fn();const handler=getTimesheetCorrection as unknown as (args:unknown)=>Promise<unknown>;await expect(handler({data:{},context:{supabase:{rpc:async()=>({data:false}),from}}})).rejects.toThrow("Only owners and managers");expect(from).not.toHaveBeenCalled();});
 it("surfaces backend correction authorization errors",async()=>{const rpc=vi.fn(async()=>({error:{message:"Only owners and managers can correct timesheets"},data:null}));const handler=saveTimesheetCorrection as unknown as (args:unknown)=>Promise<unknown>;await expect(handler({data:{employee_id:"employee",job_id:null,from:"2020-01-15T08:00:00Z",to:"2020-01-16T08:00:00Z",original:{},records:[],visits:[],status:"missing_punch",reason:"Test"},context:{supabase:{rpc}}})).rejects.toThrow("Only owners and managers");expect(rpc.mock.calls[0]?.[0]).toBe("admin_correct_timesheet");});
});