/** Pure helpers for owner/manager app notifications about saved cleaner photos. */
export const PHOTO_PUSH_PREF = 'system:photo-upload-push-pref';
export const PHOTO_PUSH_RECORD_TYPES = ['system:photo-upload-push-sending', 'system:photo-upload-push-sent', 'system:photo-upload-push-failed'] as const;
export type PhotoPushPref = { enabled: boolean; starts_at: string };

/** Latest saved preference per person wins; people who never opted in are off. */
export function latestPhotoPushPrefs(rows: { actor_id: string | null; description: string; created_at: string }[]) {
  const prefs = new Map<string, PhotoPushPref & { saved_at: string }>();
  for (const row of rows) {
    if (!row.actor_id) continue;
    const previous = prefs.get(row.actor_id);
    if (previous && previous.saved_at >= row.created_at) continue;
    try {
      const parsed = JSON.parse(row.description) as PhotoPushPref;
      prefs.set(row.actor_id, { enabled: parsed.enabled === true, starts_at: parsed.starts_at, saved_at: row.created_at });
    } catch { /* ignore malformed rows */ }
  }
  return prefs;
}

/** Photos not already announced to this recipient, uploaded after they turned alerts on. */
export function unannouncedPhotoIds(rows: { id: string; uploaded_at: string }[], startsAt: string, announced: Set<string>) {
  return rows.filter(row => row.uploaded_at >= startsAt && !announced.has(row.id)).map(row => row.id);
}

export function photoPushMessage(data: { cleanerName: string; propertyName: string; appointmentDate: string; photoCount: number }, jobId: string, uploaderId: string) {
  const count = data.photoCount;
  return {
    title: `${data.cleanerName} uploaded ${count} photo${count === 1 ? '' : 's'}`,
    body: `${data.propertyName} · ${data.appointmentDate}`,
    url: `/jobs/${jobId}?cleaner=${encodeURIComponent(uploaderId)}#photos`,
    tag: `photos-${jobId}-${uploaderId}`,
  };
}
