/**
 * Who may open an appointment. Everyone sees the whole schedule, but only owners/managers
 * and the cleaners assigned to an appointment may open it; a cleaner may only open their own
 * row of a shared appointment, never a teammate's.
 */
export function canOpenAppointment(opts: {
  viewerId: string | null | undefined;
  isReviewer: boolean;
  assigneeIds: (string | null | undefined)[];
  assignedTo?: string | null;
  /** The schedule row (cleaner) that was tapped, when opened from a cleaner's row. */
  rowEmployeeId?: string | null;
}): boolean {
  if (opts.isReviewer) return true;
  const viewer = opts.viewerId;
  if (!viewer) return false;
  if (opts.rowEmployeeId && opts.rowEmployeeId !== viewer) return false;
  return opts.assigneeIds.includes(viewer) || opts.assignedTo === viewer;
}
