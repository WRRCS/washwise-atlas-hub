export type CorrectionInterval = {
  id: string; source: "time" | "clock"; kind: "work" | "drive" | "lunch";
  started_at: string; ended_at: string | null; job_id: string | null; description: string;
};
export type CorrectionVisit = { id: string; arrived_at: string; left_at: string | null };
export type AttendanceStatus = "worked" | "no_show" | "missing_punch";

export function attendanceIssue(row: { attendance_status?: AttendanceStatus | null; arrived_at: string | null; left_at: string | null; scheduled_end: string | null }, now = Date.now()) {
  if (row.attendance_status === "no_show") return "No-Show";
  if (row.attendance_status === "missing_punch") return "Missing punch";
  if (row.arrived_at && !row.left_at) return "Clocked in";
  if (!row.arrived_at && row.scheduled_end && Date.parse(row.scheduled_end) < now) return "Missing punch";
  return null;
}

export function validateCorrectionIntervals(records: CorrectionInterval[], visits: CorrectionVisit[], status: AttendanceStatus, jobId: string | null) {
  for (const record of records) {
    if (!Number.isFinite(Date.parse(record.started_at)) || (record.ended_at && (!Number.isFinite(Date.parse(record.ended_at)) || Date.parse(record.ended_at) <= Date.parse(record.started_at)))) throw new Error("End time must be after start time");
    if (status === "no_show" && jobId && record.job_id === jobId && record.kind !== "lunch") throw new Error("Confirmed no-show cannot contain work or drive hours for this appointment");
  }
  const sorted = [...records].sort((a,b) => Date.parse(a.started_at)-Date.parse(b.started_at));
  for (let i=1;i<sorted.length;i++) {
    const prev=sorted[i-1], next=sorted[i];
    if (prev && next && (!prev.ended_at || Date.parse(prev.ended_at)>Date.parse(next.started_at))) throw new Error("Work, drive and unpaid lunch cannot overlap");
  }
  if (status === "no_show" && visits.length) throw new Error("Confirmed no-show cannot contain arrival intervals");
  if (status === "worked" && jobId && !visits.length) throw new Error("Enter actual arrival times or choose missing punch");
  for (const visit of visits) {
    if (!Number.isFinite(Date.parse(visit.arrived_at)) || (visit.left_at && (!Number.isFinite(Date.parse(visit.left_at)) || Date.parse(visit.left_at)<=Date.parse(visit.arrived_at)))) throw new Error("Leave time must be after arrival");
  }
}

/** Lunch cuts paid work and arrival intervals; the original IDs stay on the first segment. */
export function insertLunch(records: CorrectionInterval[], visits: CorrectionVisit[], lunch: CorrectionInterval, newId: () => string) {
  if (!lunch.ended_at) throw new Error("Enter lunch start and end before splitting work");
  const start=Date.parse(lunch.started_at), end=Date.parse(lunch.ended_at);
  if (end<=start) throw new Error("Lunch end must be after start");
  const paid=records.flatMap(r => {
    const rs=Date.parse(r.started_at), re=r.ended_at ? Date.parse(r.ended_at) : Infinity;
    if (r.kind==="lunch" || re<=start || rs>=end) return [r];
    return [...(rs<start ? [{...r, ended_at:lunch.started_at}] : []), ...(re>end ? [{...r,id:rs<start ? newId() : r.id,started_at:lunch.ended_at}] : [])];
  });
  const splitVisits=visits.flatMap(v => {
    const vs=Date.parse(v.arrived_at), ve=v.left_at ? Date.parse(v.left_at) : Infinity;
    if (ve<=start || vs>=end) return [v];
    return [...(vs<start ? [{...v,left_at:lunch.started_at}] : []), ...(ve>end ? [{...v,id:vs<start ? newId() : v.id,arrived_at:lunch.ended_at}] : [])];
  });
  return { records:[...paid,lunch], visits:splitVisits };
}

export function adjustLunch(records: CorrectionInterval[], visits: CorrectionVisit[], oldLunch: CorrectionInterval, nextLunch: CorrectionInterval | null) {
  const start=nextLunch?.started_at ?? oldLunch.ended_at;
  const end=nextLunch?.ended_at ?? oldLunch.ended_at;
  if (!start) throw new Error("Enter an end time before removing open lunch");
  return {
    records: records.filter(r => r.id!==oldLunch.id).map(r => ({...r,
      ended_at:r.ended_at===oldLunch.started_at ? start : r.ended_at,
      started_at:oldLunch.ended_at && r.started_at===oldLunch.ended_at ? end ?? r.started_at : r.started_at,
    })).concat(nextLunch ? [nextLunch] : []),
    visits:visits.map(v=>({...v,left_at:v.left_at===oldLunch.started_at ? start : v.left_at,
      arrived_at:oldLunch.ended_at && v.arrived_at===oldLunch.ended_at ? end ?? v.arrived_at : v.arrived_at})),
  };
}