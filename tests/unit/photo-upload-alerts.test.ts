import { describe, expect, it } from 'vitest';
import { groupPhotoUploads, photoAlertData, photoAlertKey, photoAlertClaimId } from '../../src/lib/photo-upload-alerts';
const row = (id: string, seconds: number, uploader = 'cleaner-a', job = 'job-a') => ({ id, uploaded_at: new Date(seconds * 1000).toISOString(), uploaded_by: uploader, job_id: job });
describe('photo upload alerts', () => {
  it('groups closely spaced single uploads, but separates later batches', () => {
    expect(groupPhotoUploads([row('a', 0), row('b', 10), row('c', 25), row('d', 60)]).map(g => g.map(p => p.id))).toEqual([['a', 'b', 'c'], ['d']]);
  });
  it('never groups two cleaners', () => expect(groupPhotoUploads([row('a', 0), row('b', 1, 'cleaner-b')])).toHaveLength(2));
  it('never groups two appointments', () => expect(groupPhotoUploads([row('a', 0), row('b', 1, 'cleaner-a', 'job-b')])).toHaveLength(2));
  it('retries and reordered duplicate events have the same key', () => expect(photoAlertKey('t','j','c',['b','a','a'])).toBe(photoAlertKey('t','j','c',['a','b'])));
  it('produces the same valid durable claim for duplicate events', async () => {
    const id = await photoAlertClaimId('event');
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(await photoAlertClaimId('event')).toBe(id);
    expect(await photoAlertClaimId('other-event')).not.toBe(id);
  });
  it('uses selected property and Pacific appointment date, with only safe fields', () => {
    const job = { id:'j', service_location_label:'Selected rental unit 2', service_address:'25 Selected St', scheduled_start:'2026-10-25T02:25:00Z', client:{ first_name:'Test', last_name:'Client', address:'Wrong default', door_code:'secret' } };
    expect(photoAlertData(job,'Cleaner A',3)).toEqual({ cleanerName:'Cleaner A', clientName:'Test Client', propertyName:'Selected rental unit 2', appointmentDate:'October 24, 2026', photoCount:3, appointmentUrl:'https://wrrcs.com/jobs/j#photos' });
  });
});