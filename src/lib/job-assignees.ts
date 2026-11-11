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

/** A saved appointment that a pasted shift might belong to. */
export type PasteCandidate = {
  id: string;
  client_id: string | null;
  property_id: string | null;
  service_type_id: string | null;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  assignee_ids: string[];
};

/**
 * Pasting a shift onto a cleaner joins the existing cleaning when one matches:
 * same client, same property, same service, same day and an overlapping time.
 * Open (unassigned) shifts and canceled visits are never joined, and a
 * different client never matches. Returns null when a new job is needed.
 */
export function findPasteTarget(
  source: Pick<PasteCandidate, "id" | "client_id" | "property_id" | "service_type_id">,
  target: { start: string; end: string; dayKey: string },
  candidates: PasteCandidate[],
  dayKeyOf: (iso: string) => string,
): PasteCandidate | null {
  if (!source.client_id) return null;
  const s = new Date(target.start).getTime();
  const e = new Date(target.end).getTime();
  const matches = candidates.filter((c) =>
    c.status !== "canceled" &&
    c.assignee_ids.length > 0 &&
    c.client_id === source.client_id &&
    (c.property_id ?? null) === (source.property_id ?? null) &&
    (c.service_type_id ?? null) === (source.service_type_id ?? null) &&
    dayKeyOf(c.scheduled_start) === target.dayKey &&
    new Date(c.scheduled_start).getTime() < e && new Date(c.scheduled_end).getTime() > s,
  );
  if (!matches.length) return null;
  const overlap = (c: PasteCandidate) =>
    Math.min(e, new Date(c.scheduled_end).getTime()) - Math.max(s, new Date(c.scheduled_start).getTime());
  return [...matches].sort((a, b) =>
    Number(b.id === source.id) - Number(a.id === source.id) ||
    Number(new Date(b.scheduled_start).getTime() === s) - Number(new Date(a.scheduled_start).getTime() === s) ||
    overlap(b) - overlap(a),
  )[0];
}
