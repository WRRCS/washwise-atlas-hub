import { describe,it,expect } from "vitest";
import { actionReminder,type ActionReminderState } from "../../src/lib/cleaner-action-reminders";
const state = ():ActionReminderState => ({
  job:{id:"test-job",tenant_id:"test-business",scheduled_start:"2026-10-25T17:00:00Z",scheduled_end:"2026-10-25T19:00:00Z",status:"scheduled",service_location_label:"Fern · Unit 12",service_address:"12 Fern Road, Unit 12"},
  userId:"test-cleaner",assigned:true,active:true,clockedIn:false,onLunch:false,arrived:false,
  settings:{enabled:true,clock_in_minutes_before:15,arrival_minutes_after:5,channels:["push"],updated_at:"2026-10-24T00:00:00Z"},
});
const now=Date.parse("2026-10-25T17:10:00Z");
describe("assigned cleaner action reminders",()=>{
  it("uses configured distinct timing in Pacific time and links the existing clock actions",()=>{
    const s=state();
    expect(actionReminder(s,"clock_in",Date.parse("2026-10-25T16:44:59Z"))).toBeNull();
    expect(actionReminder(s,"clock_in",Date.parse("2026-10-25T16:45:00Z"))?.due).toBe("2026-10-25T16:45:00.000Z");
    expect(actionReminder(s,"arrival",Date.parse("2026-10-25T17:04:59Z"))).toBeNull();
    const r=actionReminder(s,"arrival",now);
    expect(r?.body).toContain("10:00 AM Pacific · Fern · Unit 12");
    expect(r?.url).toBe("/jobs/test-job#clock-actions");
    expect(r?.due).toBe("2026-10-25T17:05:00.000Z");
  });
  it("does not require a second clock-in from an earlier appointment or unassigned work",()=>{
    const s=state();s.clockedIn=true;
    expect(actionReminder(s,"clock_in",now)).toBeNull();
    expect(actionReminder(s,"arrival",now)?.kind).toBe("arrival");
  });
  it("suppresses both actions during explicit unpaid lunch",()=>{
    const s=state();s.onLunch=true;
    expect(actionReminder(s,"clock_in",now)).toBeNull();expect(actionReminder(s,"arrival",now)).toBeNull();
  });
  it("suppresses a cleaner's completed arrival even after Leaving",()=>{
    const s=state();s.arrived=true;
    expect(actionReminder(s,"arrival",now)).toBeNull();expect(actionReminder(s,"clock_in",now)).toBeNull();
  });
  it.each(["canceled","completed"])("never reminds on %s appointments",status=>{
    const s=state();s.job.status=status;
    expect(actionReminder(s,"clock_in",now)).toBeNull();expect(actionReminder(s,"arrival",now)).toBeNull();
  });
  it("suppresses reassignment and inactive employees",()=>{
    const s=state();s.assigned=false;expect(actionReminder(s,"arrival",now)).toBeNull();
    s.assigned=true;s.active=false;expect(actionReminder(s,"clock_in",now)).toBeNull();
  });
  it("rescheduling invalidates the old key and waits for the new time",()=>{
    const s=state();const old=actionReminder(s,"arrival",now)?.key;
    s.job.scheduled_start="2026-10-25T18:00:00Z";s.job.scheduled_end="2026-10-25T20:00:00Z";
    expect(actionReminder(s,"arrival",now)).toBeNull();
    expect(actionReminder(s,"arrival",Date.parse("2026-10-25T18:10:00Z"))?.key).not.toBe(old);
  });
  it("stops after appointment end and respects disabled or unsupported channels",()=>{
    const s=state();expect(actionReminder(s,"arrival",Date.parse(s.job.scheduled_end))).toBeNull();
    s.settings.enabled=false;expect(actionReminder(s,"arrival",now)).toBeNull();
    s.settings.enabled=true;s.settings.channels=["email"];expect(actionReminder(s,"arrival",now)).toBeNull();
  });
  it("retries and settings saves retain one deduplication key per action",()=>{
    const s=state();const key=actionReminder(s,"arrival",now)?.key;
    s.settings.updated_at="2026-10-25T17:09:00Z";
    expect(actionReminder(s,"arrival",now+1000)?.key).toBe(key);
    expect(actionReminder(s,"clock_in",now)?.key).not.toBe(key);
  });
  it("handles Pacific daylight saving without moving the actual appointment instant",()=>{
    const s=state();s.job.scheduled_start="2026-11-01T18:00:00Z";s.job.scheduled_end="2026-11-01T20:00:00Z";
    expect(actionReminder(s,"arrival",Date.parse("2026-11-01T18:10:00Z"))?.body).toContain("10:00 AM Pacific");
  });
});