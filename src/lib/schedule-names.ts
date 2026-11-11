/** Short name for the schedule's team column: nickname in parentheses, else first name. */
function shortName(full: string | null | undefined, email?: string | null): string {
  const name = (full ?? "").trim();
  if (!name) return (email ?? "").split("@")[0] || "?";
  const nick = name.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (nick) return nick;
  return name.split(/\s+/)[0];
}

function lastInitial(full: string | null | undefined): string {
  const parts = (full ?? "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1][0].toUpperCase()}.` : "";
}

/** First names for each person; adds a last initial only when two people share a first name. */
export function scheduleFirstNames(people: { id: string; full_name?: string | null; email?: string | null }[]): Map<string, string> {
  const counts = new Map<string, number>();
  const base = people.map((p) => {
    const s = shortName(p.full_name, p.email);
    counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1);
    return [p.id, s, p.full_name] as const;
  });
  const out = new Map<string, string>();
  for (const [id, s, full] of base) {
    const initial = (counts.get(s.toLowerCase()) ?? 0) > 1 ? lastInitial(full) : "";
    out.set(id, initial ? `${s} ${initial}` : s);
  }
  return out;
}

/** Owners/managers see everyone's weekly hours; everyone else sees only their own. */
export function canSeeScheduleHours(viewer: { isOwnerOrManager: boolean; userId: string | null | undefined }, employeeId: string): boolean {
  return viewer.isOwnerOrManager || (!!viewer.userId && viewer.userId === employeeId);
}
