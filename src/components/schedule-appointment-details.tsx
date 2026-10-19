import { jobLocation } from "@/lib/job-location";
import { fmtTimeTZ } from "@/lib/tz";

type Appointment = Parameters<typeof jobLocation>[0] & { scheduled_start: string; scheduled_end: string };

/** Keep essential details shared between compact roster cells and appointment lists. */
export function ScheduleAppointmentDetails({ job, tz, compact = false }: { job: Appointment; tz: string; compact?: boolean }) {
  const location = jobLocation(job);
  return <div className={`space-y-1 ${compact ? "text-[15px]" : "text-[16px]"} leading-snug`}>
    <p className="flex flex-wrap gap-x-1 font-semibold tabular-nums">
      <span className="whitespace-nowrap">{fmtTimeTZ(job.scheduled_start, tz)}</span>
      <span aria-hidden="true">–</span>
      <span className="whitespace-nowrap">{fmtTimeTZ(job.scheduled_end, tz)}</span>
    </p>
    {location.label && <p className="font-semibold whitespace-normal [overflow-wrap:anywhere]">{location.label}</p>}
    <p className="font-medium whitespace-normal [overflow-wrap:anywhere]">{location.address ?? "Location needs review"}</p>
  </div>;
}

/** Choose the higher-contrast semantic foreground without changing a saved appointment color. */
export function scheduleColorText(color: string) {
  const hex = color.replace("#", "");
  const expanded = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "text-schedule-paper";
  const channels = [0, 2, 4].map(i => {
    const value = parseInt(expanded.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "text-schedule-ink" : "text-schedule-paper";
}