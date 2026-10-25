import {describe,it,expect,vi} from "vitest";
import {enqueueActionReminders,currentActionReminder} from "../../src/lib/cleaner-action-reminders.server";
const now=Date.parse("2026-10-25T17:10:00Z");
function fakeDb(){
  const records:Record<string,any[]>={
    cleaner_action_reminder_settings:[{user_id:"test-cleaner",tenant_id:"test-business",enabled:true,channels:["push"],clock_in_minutes_before:15,arrival_minutes_after:5}],
    jobs:[{id:"test-job",tenant_id:"test-business",assigned_to:null,status:"scheduled",scheduled_start:"2026-10-25T17:00:00Z",scheduled_end:"2026-10-25T19:00:00Z",service_location_label:"Fern",service_address:"12 Fern Road"}],
    profiles:[{id:"test-cleaner",tenant_id:"test-business",is_active:true}],job_employees:[{id:"assignment",job_id:"test-job",employee_id:"test-cleaner"}],time_entries:[],work_clock_entries:[],job_visits:[],notifications:[],
  };
  const keys=new Set<string>();
  const db={from(table:string){let rows=[...(records[table]??[])];let single=false;let value:any;
    const q:any={select(){return q;},eq(k:string,v:any){rows=rows.filter(r=>r[k]===v);return q;},in(k:string,v:any[]){rows=rows.filter(r=>v.includes(r[k]));return q;},gt(){return q;},lte(){return q;},is(k:string,v:any){rows=rows.filter(r=>(r[k]??null)===v);return q;},limit(n:number){rows=rows.slice(0,n);return q;},maybeSingle(){single=true;return q;},insert(row:any){if(keys.has(row.action_reminder_key))value={data:null,error:{code:"23505"}};else{keys.add(row.action_reminder_key);records.notifications.push(row);value={data:null,error:null};}return q;},then(resolve:any){return Promise.resolve(value??{data:single?rows[0]??null:rows,error:null}).then(resolve);}};return q;
  }};return{db,records};
}
describe("no-send test cleaner delivery",()=>{
  it("concurrent scheduling creates exactly one reminder per action with no network requests",async()=>{
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No real notification sends allowed"));
    try{const {db,records}=fakeDb();await Promise.all([enqueueActionReminders(db,now),enqueueActionReminders(db,now)]);
      expect(records.notifications).toHaveLength(2);expect(records.notifications.map(r=>r.template_name).sort()).toEqual(["cleaner_action_arrival","cleaner_action_clock_in"]);expect(network).not.toHaveBeenCalled();
    }finally{network.mockRestore();}
  });
  it("rechecks saved arrival, lunch, assignment and reschedule before delivery",async()=>{
    const {db,records}=fakeDb();await enqueueActionReminders(db,now);const n=records.notifications.find(r=>r.payload.action==="arrival");
    expect(await currentActionReminder(db,n,now)).not.toBeNull();
    records.job_visits.push({id:"saved-arrival",job_id:"test-job",employee_id:"test-cleaner"});expect(await currentActionReminder(db,n,now)).toBeNull();records.job_visits=[];
    records.work_clock_entries.push({user_id:"test-cleaner",kind:"lunch",ended_at:null});expect(await currentActionReminder(db,n,now)).toBeNull();records.work_clock_entries=[];
    records.job_employees=[];expect(await currentActionReminder(db,n,now)).toBeNull();records.job_employees.push({job_id:"test-job",employee_id:"test-cleaner"});
    records.jobs[0].scheduled_start="2026-10-25T18:00:00Z";expect(await currentActionReminder(db,n,now)).toBeNull();
  });
});