export const OUTLOOK_SENDER = 'info@washrinserepeatcleaning.com';
export type ClockAlertAction = 'clock_in' | 'clock_out';
export function clockAlertEligible(action: string, eventTime: string | null, startsAt: string) {
  return (action === 'clock_in' || action === 'clock_out') && eventTime !== null && Number.isFinite(Date.parse(eventTime)) && Date.parse(eventTime) >= Date.parse(startsAt);
}
export function clockAlertData(employee: string, action: ClockAlertAction, eventTime: string, property: string | null, jobId: string | null, now = Date.now()) {
  return { employee, action, eventTime, localTime: new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',dateStyle:'long',timeStyle:'long'}).format(new Date(eventTime)), property: jobId ? property || 'Location needs review' : 'Unscheduled work', delayed: now - Date.parse(eventTime) > 300_000, appointmentUrl: jobId ? `https://wrrcs.com/jobs/${jobId}` : null };
}