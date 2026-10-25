export type ActionReminderKind = "clock_in" | "arrival";
export type ActionReminderState = {
  job: { id: string; tenant_id: string; scheduled_start: string; scheduled_end: string; status: string; service_location_label: string | null; service_address: string | null };
  userId: string; assigned: boolean; active: boolean; clockedIn: boolean; onLunch: boolean; arrived: boolean;
  settings: { enabled: boolean; clock_in_minutes_before: number; arrival_minutes_after: number; channels: string[]; updated_at: string };
};
export function actionReminder(state: ActionReminderState, kind: ActionReminderKind, now: number) {
  const { job, settings } = state;
  if (!settings.enabled || !settings.channels.includes("push") || !state.assigned || !state.active || ["canceled", "completed"].includes(job.status)) return null;
  const start = Date.parse(job.scheduled_start), end = Date.parse(job.scheduled_end);
  const due = kind === "clock_in" ? start - settings.clock_in_minutes_before * 60000 : start + settings.arrival_minutes_after * 60000;
  if (now < due || now >= end || (kind === "clock_in" && (state.clockedIn || state.onLunch || state.arrived)) || (kind === "arrival" && (state.arrived || state.onLunch))) return null;
  const property = job.service_location_label || job.service_address || "Location needs review";
  const time = new Date(start).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    key: [job.tenant_id,job.id,state.userId,job.scheduled_start,kind].join(":"),
    title: kind === "clock_in" ? "Clock in for your appointment" : "Record your arrival",
    body: `${time} Pacific · ${property}. ${kind === "clock_in" ? "Clock in if you have not started work." : "Tap Arrived when you are at the property."}`,
    url: `/jobs/${job.id}#clock-actions`, due: new Date(due).toISOString(), kind,
  };
}