/** Upload paths bind a photo to the verified login and appointment occurrence. */
export function photoUploadPrefix(tenantId: string, jobId: string, userId: string) {
  return `${tenantId}/${jobId}/${userId}/`;
}
export function ownsPhotoUpload(path: string, tenantId: string, jobId: string, userId: string) {
  const prefix = photoUploadPrefix(tenantId, jobId, userId);
  const filename = path.slice(prefix.length);
  return path.startsWith(prefix) && filename.length > 0 && !filename.includes("/") && filename !== "." && filename !== "..";
}

/** Explicit scope prevents an employee's own view sharing the manager's combined cache. */
export function photoQueryKey(jobId: string, viewerId: string, employeeId?: string, allCleaners = false) {
  return ["job-photos", jobId, viewerId, allCleaners ? "combined" : "cleaner", employeeId ?? viewerId] as const;
}

/** A cleaner may never select another employee; only a reviewer can request that scope. */
export function photoReadScope(viewerId: string, isReviewer: boolean, employeeId?: string, allCleaners = false) {
  if (!isReviewer) {
    if (employeeId && employeeId !== viewerId) throw new Error("You can only view your own photos");
    return viewerId;
  }
  return allCleaners ? undefined : employeeId ?? viewerId;
}