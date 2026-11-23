import {describe,it,expect} from 'vitest';
import {pilotReminder,type PilotSettings,type PilotState} from '../../src/lib/employee-reminder-rules';
import {reminderRecipients,jobCleaners} from '../../src/lib/employee-reminder-pilot.server';
const all=():PilotSettings=>({participant_ids:[],rollout_all:true,delivery_enabled:true,before_enabled:true,start_enabled:true,followup_enabled:true,before_minutes:15,followup_minutes:5,channel:'push'});
const s=(userId:string):PilotState=>({userId,assigned:true,active:true,clockedIn:false,onLunch:false,arrived:false,job:{id:'job',tenant_id:'wrrcs',scheduled_start:'2026-11-03T18:00:00Z',scheduled_end:'2026-11-03T20:00:00Z',status:'scheduled',service_location_label:'Test property',service_address:null}});
const at=Date.parse('2026-11-03T18:00:00Z');
function fakeDb(profiles:string[],employees:string[]) {
 return {from(table:string){const q:any={select(){return q;},eq(){return q;},in(){return q;},then(r:any){return Promise.resolve({data:table==='profiles'?profiles.map(id=>({id})):employees.map(user_id=>({user_id})),error:null}).then(r);}};return q;}};
}
describe('reminders for all current employees',()=>{
 it('any employee on the cleaning gets a reminder, not just the old pilot pair',()=>{for(const id of ['ashley','nelia','masha'])expect(pilotReminder(s(id),all(),at)).not.toBeNull();});
 it('turning reminders off sends nothing to anyone',()=>expect(pilotReminder(s('ashley'),{...all(),delivery_enabled:false},at)).toBeNull());
 it('employees not on the cleaning get nothing',()=>expect(pilotReminder({...s('ashley'),assigned:false},all(),at)).toBeNull());
 it('recipients are active employee accounts only (owners/managers left out)',async()=>{const r=await reminderRecipients(fakeDb(['ashley','leslie-owner'],['ashley']),{...all(),tenant_id:'wrrcs'});expect([...r]).toEqual(['ashley']);});
 it('both cleaners on a shared cleaning are checked once each',()=>expect(jobCleaners({assigned_to:'zoe',job_employees:[{employee_id:'zoe'},{employee_id:'ashley'}]})).toEqual(['zoe','ashley']));
});
