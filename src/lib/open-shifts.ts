// Which cleanings belong in the schedule's "Open shifts" row, and who can pick
// them up. A cleaning is open when nobody is on it, or when it still has open
// spots (for example after an archived cleaner was taken off a shared cleaning).

export type OpenShiftJob = {
  status: string;
  open_spots?: number | null;
  assignees?: ReadonlyArray<{ id: string }> | null;
};

export function openSpotsLeft(job: OpenShiftJob): number {
  if (job.status === "canceled" || job.status === "completed") return 0;
  const spots = Math.max(0, job.open_spots ?? 0);
  if (spots > 0) return spots;
  return (job.assignees?.length ?? 0) === 0 ? 1 : 0;
}

export function isOpenShift(job: OpenShiftJob): boolean {
  return openSpotsLeft(job) > 0;
}

/** A team member can pick up an open cleaning they are not already on. */
export function canPickUp(job: OpenShiftJob, viewerId: string | null | undefined): boolean {
  if (!viewerId || !isOpenShift(job)) return false;
  return !(job.assignees ?? []).some((a) => a.id === viewerId);
}

/** How many open spots remain after cleaners are added by a manager. */
export function spotsAfterAdding(openSpots: number | null | undefined, added: number): number {
  return Math.max(0, (openSpots ?? 0) - Math.max(0, added));
}
