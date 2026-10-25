/** Upload paths bind a photo to the verified login and appointment occurrence. */
export function photoUploadPrefix(tenantId: string, jobId: string, userId: string) {
  return `${tenantId}/${jobId}/${userId}/`;
}
export function ownsPhotoUpload(path: string, tenantId: string, jobId: string, userId: string) {
  const prefix = photoUploadPrefix(tenantId, jobId, userId);
  const filename = path.slice(prefix.length);
  return path.startsWith(prefix) && filename.length > 0 && !filename.includes("/") && filename !== "." && filename !== "..";
}