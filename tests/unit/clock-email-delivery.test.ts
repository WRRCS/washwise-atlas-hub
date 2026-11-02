import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({logs:[] as any[],records:[] as any[],sends:[] as any[],fail:false}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(table:string)=>query(table)}}));
vi.mock('../../src/lib/outlook-email.server',()=>({sendOutlookAlert:async(...args:any[])=>{state.sends.push(args);if(state.fail)throw new Error('Provider failure');return {sent:true,status:'accepted'};}}));
function query(table:string) {
  const filters:((r:any)=>boolean)[]=[];let insert:any,patch:any,limit=1000;
  const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q;},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q;},order:()=>q,limit:(n:number)=>{limit=n;return q;},insert:(r:any)=>{insert=r;return q;},update:(r:any)=>{patch=r;return q;},single:()=>run(true),maybeSingle:()=>run(true),then:(a:any,b:any)=>run(false).then(a,b)};
  async function run(single:boolean){
    let rows:any[]=table==='activity_log'?state.logs:table==='time_entries'?state.records.filter(r=>!r.kind):table==='work_clock_entries'?state.records.filter(r=>r.kind):table==='profiles'?[{id:'employee',tenant_id:'tenant',full_name:'Employee'},{id:'owner',tenant_id:'tenant',email:'test@example.com',is_active:true}]:table==='user_roles'?[{id:'role',user_id:'owner',tenant_id:'tenant',role:'owner'}]:[];
    if(insert){if(state.logs.some(r=>r.id===insert.id))return {data:null,error:{code:'23505'}};state.logs.push({...insert,created_at:new Date().toISOString()});return {data:null,error:null};}
    rows=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(patch)rows.forEach(r=>Object.assign(r,patch));return {data:single?rows[0]??null:rows,error:null};
  }return q;
}
import {notifySavedClock} from '../../src/lib/clock-email-alerts.server';
const context:any={supabase:{from:query},userId:'employee'};
beforeEach(()=>{state.logs=[{tenant_id:'tenant',action_type:'system:clock-email-settings',description:JSON.stringify({confirmed:true,clock_in:{enabled:true,recipient_id:'owner',starts_at:'2026-11-02T00:00:00Z'},clock_out:{enabled:true,recipient_id:'owner',starts_at:'2026-11-02T00:00:00Z'}})}];state.records=[{id:'record',user_id:'employee',kind:'work',job_id:null,started_at:'2026-11-02T04:00:00Z',ended_at:'2026-11-02T05:00:00Z'}];state.sends=[];state.fail=false;});
describe('saved clock delivery',()=>{
  it('reads saved event time and identifies unscheduled work',async()=>{await notifySavedClock(context,'record','clock_in');expect(state.sends).toHaveLength(1);expect(state.sends[0][2]).toContain('8:00:00 PM PST');expect(state.sends[0][2]).toContain('Unscheduled work');expect(JSON.parse(state.logs[1].description)).toMatchObject({status:'accepted',deliveryConfirmed:false});});
  it('concurrent retries send at most once',async()=>{await Promise.all([notifySavedClock(context,'record','clock_out'),notifySavedClock(context,'record','clock_out')]);expect(state.sends).toHaveLength(1);});
  it('missing saved record cannot send',async()=>{await notifySavedClock(context,'missing','clock_in');expect(state.sends).toHaveLength(0);});
  it('historical saved work cannot send',async()=>{state.records[0].started_at='2026-10-01T00:00:00Z';await notifySavedClock(context,'record','clock_in');expect(state.sends).toHaveLength(0);});
  it('lunch records cannot send',async()=>{state.records[0].kind='lunch';await notifySavedClock(context,'record','clock_out');expect(state.sends).toHaveLength(0);});
  it('failed or ambiguous Outlook requests cannot be resent by refresh',async()=>{state.fail=true;await notifySavedClock(context,'record','clock_in');state.fail=false;await notifySavedClock(context,'record','clock_in');expect(state.sends).toHaveLength(1);expect(JSON.parse(state.logs[1].description).status).toBe('failed');});
  it('unconfirmed addresses cannot activate sending',async()=>{const settings=JSON.parse(state.logs[0].description);settings.confirmed=false;state.logs[0].description=JSON.stringify(settings);await notifySavedClock(context,'record','clock_in');expect(state.sends).toHaveLength(0);});
});