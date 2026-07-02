import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listJobs } from "@/lib/jobs.functions";
import { startOfWeek, addDays, format, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarView,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function CalendarView() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const fn = useServerFn(listJobs);
  const from = startOfDay(anchor).toISOString();
  const to = endOfDay(addDays(anchor, 6)).toISOString();
  const { data = [] } = useQuery({
    queryKey: ["jobs", "week", from, to],
    queryFn: () => fn({ data: { from, to } }),
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));

  return (
    <>
      <PageHeader
        title="Week"
        subtitle={`${format(anchor, "MMM d")} — ${format(addDays(anchor, 6), "MMM d, yyyy")}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}>←</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, 7))}>→</Button>
          </div>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((d) => {
          const dayJobs = data.filter((j) => isSameDay(new Date(j.scheduled_start), d));
          return (
            <div key={d.toISOString()} className="bg-card rounded-xl ring-1 ring-black/5 p-3 min-h-[180px]">
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{format(d, "EEE")}</p>
                <p className={`text-lg font-medium ${isSameDay(d, new Date()) ? "text-brand" : ""}`}>{format(d, "d")}</p>
              </div>
              <div className="space-y-2">
                {dayJobs.map((j) => (
                  <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }} className="block p-2 rounded-md bg-clay-100 hover:bg-clay-200/70 text-xs">
                    <p className="font-medium truncate">{j.service?.name}</p>
                    <p className="text-muted-foreground truncate">{format(new Date(j.scheduled_start), "h:mma")} · {j.property?.address_line1}</p>
                  </Link>
                ))}
                {dayJobs.length === 0 && <p className="text-[11px] text-muted-foreground">No jobs</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
