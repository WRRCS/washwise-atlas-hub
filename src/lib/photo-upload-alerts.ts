/** Close single-photo requests share a group; groups never cross cleaner/job boundaries. */
export const PHOTO_UPLOAD_QUIET_MS = 20_000;
export function groupPhotoUploads<T extends { id: string; uploaded_at: string; uploaded_by: string | null; job_id: string }>(rows: T[]) {
  const groups: T[][] = [];
  for (const row of [...rows].sort((a, b) => Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at))) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (previous && previous.job_id === row.job_id && previous.uploaded_by === row.uploaded_by && Date.parse(row.uploaded_at) - Date.parse(previous.uploaded_at) <= PHOTO_UPLOAD_QUIET_MS) last?.push(row);
    else groups.push([row]);
  }
  return groups;
}
export function photoAlertKey(tenantId: string, jobId: string, uploaderId: string, photoIds: string[]) {
  return `photo-upload:${tenantId}:${jobId}:${uploaderId}:${[...new Set(photoIds)].sort().join(",")}`;
}
export async function photoAlertClaimId(key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const hex = Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
export function photoAlertData(job: { id: string; service_address: string | null; service_location_label: string | null; scheduled_start: string | null; client?: { first_name?: string | null; last_name?: string | null } | null }, cleanerName: string, count: number) {
  return {
    cleanerName,
    clientName: [job.client?.first_name, job.client?.last_name].filter(Boolean).join(" ") || "Client",
    propertyName: job.service_location_label?.trim() || job.service_address?.trim() || "Location needs review",
    appointmentDate: job.scheduled_start ? new Date(job.scheduled_start).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" }) : "Date needs review",
    photoCount: count,
    appointmentUrl: `https://wrrcs.com/jobs/${job.id}#photos`,
  };
}