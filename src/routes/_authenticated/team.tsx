import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listTeamRoster, type TeamMember } from "@/lib/team.functions";
import { Mail, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function TeamPage() {
  return (
    <AppShell>
      <PageHeader title="Team" subtitle="Your teammates" />
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-6">
        <RosterView />
      </div>
    </AppShell>
  );
}

function initialsOf(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function RosterView() {
  const rosterFn = useServerFn(listTeamRoster);
  const q = useQuery({ queryKey: ["team-roster"], queryFn: () => rosterFn() });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const members = q.data ?? [];
  if (!members.length)
    return <p className="text-sm text-muted-foreground">No teammates yet.</p>;

  // Contact visibility is enforced server-side — email/phone are null when
  // the viewer isn't allowed to see them.
  const anyContact = members.some((m) => m.email || m.phone);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {members.map((m) => (
        <RosterCard key={m.id} member={m} showContact={anyContact} />
      ))}
    </div>
  );
}

function RosterCard({ member, showContact }: { member: TeamMember; showContact: boolean }) {
  return (
    <article className="bg-clay-50 border border-border/60 rounded-xl p-4 ring-1 ring-black/5 flex items-center gap-4">
      <div className="size-12 rounded-full bg-clay-200 overflow-hidden grid place-items-center text-sm font-medium shrink-0">
        {member.avatar_url ? (
          <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>{initialsOf(member.full_name)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{member.full_name ?? "—"}</p>
        <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
        {showContact && (member.email || member.phone) && (
          <div className="mt-1 space-y-0.5">
            {member.email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                <Mail className="size-3 shrink-0" /> {member.email}
              </p>
            )}
            {member.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="size-3 shrink-0" /> {member.phone}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

