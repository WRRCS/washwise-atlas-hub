/**
 * Saved team-member order for the schedule grid. People in the saved list keep
 * their position; anyone not in it (e.g. a newly added team member) goes to the
 * bottom in their existing order.
 */
export function applyTeamOrder<T extends { id: string }>(people: T[], savedIds: readonly string[] | null | undefined): T[] {
  if (!savedIds?.length) return people;
  const pos = new Map<string, number>();
  savedIds.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  const known = people.filter((p) => pos.has(p.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  const rest = people.filter((p) => !pos.has(p.id));
  return [...known, ...rest];
}

/** Move `movingId` so it sits directly before (or after) `targetId`. */
export function moveTeamMember(ids: readonly string[], movingId: string, targetId: string, place: "before" | "after"): string[] {
  if (movingId === targetId || !ids.includes(movingId) || !ids.includes(targetId)) return [...ids];
  const without = ids.filter((id) => id !== movingId);
  const at = without.indexOf(targetId) + (place === "after" ? 1 : 0);
  without.splice(at, 0, movingId);
  return without;
}
