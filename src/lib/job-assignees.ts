/** Pure rules for changing which cleaners are on an appointment. */
export type AssigneePlan = { add: string[]; remove: string[]; primary: string | null };

/** Compare the current team with the requested one; the lead cleaner stays lead while still on the visit. */
export function planAssigneeChange(current: string[], requested: string[], currentPrimary: string | null = null): AssigneePlan {
  const next = [...new Set(requested)];
  const cur = new Set(current);
  return {
    add: next.filter((id) => !cur.has(id)),
    remove: [...cur].filter((id) => !next.includes(id)),
    primary: currentPrimary && next.includes(currentPrimary) ? currentPrimary : next[0] ?? null,
  };
}

/** Cleaners who already clocked, arrived, took photos or checked off steps can't be taken off that visit. */
export function blockedRemovals(remove: string[], workedEmployeeIds: Iterable<string>): string[] {
  const worked = new Set(workedEmployeeIds);
  return remove.filter((id) => worked.has(id));
}
