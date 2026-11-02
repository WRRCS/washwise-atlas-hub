import {describe,it,expect} from 'vitest';
import {clockAlertEligible,clockAlertData} from '../../src/lib/owner-email-events';
import {photoAlertData} from '../../src/lib/photo-upload-alerts';
describe('owner event email rules',()=>{
  it('excludes historical clock events when enabled',()=>expect(clockAlertEligible('clock_in','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z')).toBe(false));
  it('includes a new saved clock out',()=>expect(clockAlertEligible('clock_out','2026-11-02T04:00:00Z','2026-11-02T00:00:00Z')).toBe(true));
  it('lunch resume is not a work-session start alert',()=>expect(clockAlertEligible('end_lunch','2026-11-02T04:00:00Z','2026-11-02T00:00:00Z')).toBe(false));
  it('admin correction is not a normal clock event',()=>expect(clockAlertEligible('admin_correction','2026-11-02T04:00:00Z','2026-11-02T00:00:00Z')).toBe(false));
  it('uses original event time and Pacific timezone',()=>{const d=clockAlertData('Employee','clock_in','2026-11-02T04:00:00Z',null,null,Date.parse('2026-11-02T04:01:00Z'));expect(d.eventTime).toBe('2026-11-02T04:00:00Z');expect(d.localTime).toContain('8:00:00 PM');expect(d.localTime).toContain('PST');});
  it('identifies unscheduled work',()=>expect(clockAlertData('Employee','clock_in','2026-11-02T04:00:00Z',null,null).property).toBe('Unscheduled work'));
  it('labels late processing as delayed',()=>expect(clockAlertData('Employee','clock_out','2026-11-02T04:00:00Z','Saved property','job',Date.parse('2026-11-02T04:10:00Z')).delayed).toBe(true));
  it('direct photo link retains the cleaner scope',()=>expect(photoAlertData({id:'job',service_address:'Saved address',service_location_label:null,scheduled_start:null},'Cleaner',3,'cleaner-id').appointmentUrl).toBe('https://wrrcs.com/jobs/job?cleaner=cleaner-id#photos'));
});