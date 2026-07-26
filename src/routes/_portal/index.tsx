import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format, isPast } from "date-fns";
import { listMyAppointments, submitClientRequest, type PortalAppointment } from "@/lib/portal.functions";
import { MapPin, Plus, Users } from "lucide-react";

export const Route = createFileRoute("/_portal/")({
  component: PortalAppointmentsPage,
});

function getSessionToken(): string {
  return localStorage.getItem("portal_session") ?? "";
}

function PortalAppointmentsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyAppointments);
  const requestFn = useServerFn(submitClientRequest);
  const [requestFor, setRequestFor] = useState<PortalAppointment | null>(null);
  const [requestBody, setRequestBody] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["portal-appointments"],
    queryFn: () => listFn({ data: { session_token: getSessionToken() } }),
  });

  const upcoming = appointments.filter((a) => !isPast(new Date(a.scheduled_end)) && a.status !== "canceled");
  const past = appointments.filter((a) => isPast(new Date(a.scheduled_end)) || a.status === "canceled");

  const onSubmitRequest = async () => {
    if (!requestFor || !requestBody.trim()) return;
    setBusy(true);
    try {
      await requestFn({ data: { session_token: getSessionToken(), job_id: requestFor.id, body: requestBody.trim() } });
      toast.success("Sent! Your cleaning team will follow up.");
      setRequestFor(null);
      setRequestBody("");
      qc.invalidateQueries({ queryKey: ["portal-appointments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that — try again.");
    } finally {
      setBusy(false);
    }
  };

  function AppointmentCard({ appt }: { appt: PortalAppointment }) {
    return (
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-sm">{appt.service_name ?? "Cleaning"}</p>
            <p className="text-sm text-muted-foreground">{format(new Date(appt.scheduled_start), "EEEE, MMM d · h:mm a")}</p>
          </div>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-clay-100 text-muted-foreground shrink-0">
            {appt.status.replace("_", " ")}
          </span>
        </div>
        {appt.service_address && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" /> {appt.service_address}
          </p>
        )}
        {appt.cleaner_first_names.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" /> {appt.cleaner_first_names.join(", ")}
          </p>
        )}
        {appt.status !== "completed" && appt.status !== "canceled" && (
          <button
            onClick={() => setRequestFor(appt)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <Plus className="size-3.5" /> Add a request for this visit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : appointments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No appointments on file yet.</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled right now.</p>
            ) : (
              upcoming.map((a) => <AppointmentCard key={a.id} appt={a} />)
            )}
          </section>
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Past</h2>
              {past.slice(0, 10).map((a) => <AppointmentCard key={a.id} appt={a} />)}
            </section>
          )}
        </>
      )}

      {requestFor && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-20" onClick={() => setRequestFor(null)}>
          <div className="bg-card rounded-xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-1">Add a request</h3>
            <p className="text-xs text-muted-foreground mb-3">
              For your {requestFor.service_name ?? "cleaning"} on {format(new Date(requestFor.scheduled_start), "MMM d")}. This goes to our team for review before your visit.
            </p>
            <textarea
              autoFocus
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              placeholder="e.g. Please clean the upstairs bathroom and the patio furniture"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[90px]"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setRequestFor(null)} className="text-sm px-3 py-2 text-muted-foreground">Cancel</button>
              <button
                onClick={onSubmitRequest}
                disabled={busy || !requestBody.trim()}
                className="bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
