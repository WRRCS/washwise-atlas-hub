import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ logs: [] as any[], sends: [] as any[], fail: false, photos: [] as any[] }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table:string) => query(table) } }));
vi.mock('../../src/lib/email-templates/send-email', () => ({ sendTemplateEmail: async (...args:any[]) => { if (state.fail) throw new Error('Controlled failure');state.sends.push(args);return { sent:true }; } }));
function query(table:string) {
  let filters: ((r:any) => boolean)[]=[];let patch:any;let insert:any;let reverse=false;let limit=1000;
  const q:any = {
    select: () => q, eq: (k:string,v:any) => {filters.push(r => r[k]===v);return q;},
    in: (k:string,v:any[]) => {filters.push(r=>v.includes(r[k]));return q;},
    gte:(k:string,v:any) => {filters.push(r=>r[k]>=v);return q;},
    order:(_k:string,opt?:any) => {reverse=opt?.ascending===false;return q;},limit:(n:number)=>{limit=n;return q;},
    insert:(r:any)=>{insert=r;return q;},update:(r:any)=>{patch=r;return q;},
    single:()=>run(true),maybeSingle:()=>run(true),then:(a:any,b:any)=>run(false).then(a,b),
  };
  async function run(single:boolean) {
    let rows:any[]=[];
    if(table==='activity_log') rows=state.logs;
    if(table==='job_photos') rows=state.photos;
    if(table==='user_roles') rows=[{id:'role',tenant_id:'tenant',user_id:'owner',role:'owner'}];
    if(table==='profiles') rows=[{id:'owner',tenant_id:'tenant',is_active:true,email:'controlled@example.com'}, {id:'cleaner',full_name:'Actual Cleaner'}];
    if(table==='jobs') rows=[{id:'job',tenant_id:'tenant',service_address:'25 Selected St',service_location_label:'Selected unit 2',scheduled_start:'2026-10-25T02:25:00Z',client:{first_name:'Real',last_name:'Client'}}];
    if(insert) {
      if(state.logs.some(r=>r.id===insert.id)) return {data:null,error:{code:'23505'}};
      state.logs.push({...insert,created_at:new Date().toISOString()});return {data:null,error:null};
    }
    rows=rows.filter(r=>filters.every(f=>f(r)));
    if(patch) rows.forEach(r=>Object.assign(r,patch));
    rows=(reverse?[...rows].reverse():rows).slice(0,limit);
    return {data:single?rows[0] ?? null:rows,error:null};
  }
  return q;
}
import { notifySavedPhotoBatch } from '../../src/lib/photo-upload-alerts.server';
const db:any={from:query};
beforeEach(()=>{
  state.logs=[{id:'settings',tenant_id:'tenant',action_type:'system:photo-upload-email-settings',description:JSON.stringify({enabled:true,recipient_id:'owner',starts_at:'2026-10-20T00:00:00Z'})}];state.sends=[];state.fail=false;
  // A slow 3-photo upload spanning minutes is still one explicitly completed batch.
  state.photos=[0,60,120].map((seconds,i)=>({id:`p${i}`,job_id:'job',uploaded_by:'cleaner',uploaded_at:new Date(Date.parse('2026-10-24T10:00:00Z')+seconds*1000).toISOString()}));
});
describe('saved photo delivery',()=>{
  it('sends one email for a slow completed batch with correct cleaner and selected property',async()=>{
    await notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0','p1','p2']);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0][2].templateData).toMatchObject({cleanerName:'Actual Cleaner',propertyName:'Selected unit 2',photoCount:3,appointmentUrl:'https://wrrcs.com/jobs/job#photos'});
  });
  it('concurrent retries and reordered duplicate events cannot send twice',async()=>{
    await Promise.all([notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0','p1','p2']),notifySavedPhotoBatch(db,'tenant','job','cleaner',['p2','p1','p0'])]);
    await notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0','p1','p2']);
    expect(state.sends).toHaveLength(1);
  });
  it('no saved photos means no notification',async()=>{
    await notifySavedPhotoBatch(db,'tenant','job','cleaner',['not-saved']);expect(state.sends).toHaveLength(0);
  });
  it('disabled preferences send nothing',async()=>{
    state.logs[0].description=JSON.stringify({enabled:false,recipient_id:'owner'});
    await notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0']);expect(state.sends).toHaveLength(0);
  });
  it('records failures and permits a delayed retry using the same logical event',async()=>{
    state.fail=true;await notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0','p1','p2']);
    const failed=state.logs.find(r=>r.action_type==='system:photo-upload-email-failed');
    expect(JSON.parse(failed.description).error).toBe('Controlled failure');
    failed.created_at='2026-10-20T00:00:00Z';state.fail=false;
    await notifySavedPhotoBatch(db,'tenant','job','cleaner',['p0','p1','p2']);expect(state.sends).toHaveLength(1);
  });
});