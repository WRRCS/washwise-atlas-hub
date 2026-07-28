import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listMyJobs, clockIn, listMyTimeEntries, getTenantGpsSettings, logGpsConsent, type MyJobRow, type TimeEntryRow } from "@/lib/time.functions";
import { createJobPhotoUploadUrl, completeJobWithPhotos, type PhotoType } from "@/lib/photos.functions";
import { listInventory, getRecipeForService, type InventoryItem } from "@/lib/inventory.functions";
import { supabase } from "@/integrations/supabase/client";
import { captureGps } from "@/lib/geolocation";
import { Play, Square, MapPin, Clock, Camera, X, Upload as UploadIcon, BookOpen, Navigation, StickyNote } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SopViewer } from "@/components/sop-viewer";
import { PushToggle } from "@/components/push-toggle";

export const Route = createFileRoute("/_authenticated/my-jobs")({
  component: MyJobsPage,
});

type Tab = "today" | "schedule" | "timesheet";

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function clientName(c: MyJobRow["client"]) {
  if (!c) return "—";
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
}
function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

import { directionsUrl } from "@/lib/maps";

function formatDuration(startIso: string, endIso: string) {
  const mins = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

type StaffNote = { label: string; text: string };
function collectStaffNotes(j: MyJobRow): StaffNote[] {
  const out: StaffNote[] = [];
  if (j.notes) out.push({ label: "Job notes", text: j.notes });
  const s = j.property_specs;
  if (s?.key_location) out.push({ label: "Key / access", text: s.key_location });
  if (s?.access_notes) out.push({ label: "Access notes", text: s.access_notes });
  if (s?.pets) out.push({ label: "Pets", text: s.pets });
  if (s?.parking_notes) out.push({ label: "Parking", text: s.parking_notes });
  if (s?.special_instructions) out.push({ label: "Special instructions", text: s.special_instructions });
  for (const n of j.client_notes.slice(0, 2)) out.push({ label: "Client note", text: n.note });
  return out;
}

function useMyUserId() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);
  return uid;
}

function tmInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function TeamOnJob({ teammates }: { teammates: MyJobRow["teammates"] }) {
  const myId = useMyUserId();
  const others = teammates.filter((t) => t.id !== myId);
  if (!others.length) return null;
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">With</span>
      {others.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5 bg-clay-100 rounded-full pl-0.5 pr-2 py-0.5">
          {t.avatar_url ? (
            <img src={t.avatar_url} alt="" className="size-5 rounded-full object-cover" />
          ) : (
            <span className="size-5 rounded-full bg-clay-200 grid place-items-center text-[9px] font-medium">{tmInitials(t.full_name)}</span>
          )}
          <span className="text-xs">{t.full_name ?? "Teammate"}</span>
        </span>
      ))}
    </div>
  );
}

function ScheduleTeammates({ teammates }: { teammates: MyJobRow["teammates"] }) {
  const myId = useMyUserId();
  const others = teammates.filter((t) => t.id !== myId);
  if (!others.length) return null;
  return (
    <div className="flex -space-x-1 mt-1" title={others.map((t) => t.full_name ?? "Teammate").join(", ")}>
      {others.slice(0, 3).map((t) =>
        t.avatar_url ? (
          <img key={t.id} src={t.avatar_url} alt="" className="size-4 rounded-full object-cover ring-1 ring-clay-50" />
        ) : (
          <span key={t.id} className="size-4 rounded-full bg-clay-200 grid place-items-center text-[8px] font-medium ring-1 ring-clay-50">
            {tmInitials(t.full_name)}
          </span>
        ),
      )}
      {others.length > 3 && <span className="text-[9px] ml-1 text-muted-foreground">+{others.length - 3}</span>}
    </div>
  );
}

function UpNextHero({
  job,
  onClockIn,
  onClockOut,
  onCompleteNow,
  onOpenSop,
}: {
  job: MyJobRow;
  onClockIn: () => void;
  onClockOut: () => void;
  onCompleteNow: () => void;
  onOpenSop: () => void;
}) {
  const address = job.client?.service_address ?? null;
  const notes = collectStaffNotes(job);
  const isToday = new Date(job.scheduled_start).toDateString() === new Date().toDateString();
  const isOpen = !!job.open_entry;
  return (
    <section className="mb-6 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 via-clay-50 to-clay-50 p-5 md:p-6 ring-1 ring-brand/10 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand">
          {isOpen ? "Currently on the clock" : isToday ? "Up next today" : "Your next appointment"}
        </span>
        <StatusPill status={job.status} />
      </div>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl md:text-2xl font-semibold leading-tight">{clientName(job.client)}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{job.service?.name ?? "Service"}</p>
          <div className="mt-3 grid gap-2 text-sm">
            <p className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <span className="font-medium">{fmtTime(job.scheduled_start)} – {fmtTime(job.scheduled_end)}</span>
              <span className="text-muted-foreground">· {formatDuration(job.scheduled_start, job.scheduled_end)}</span>
            </p>
            {address && (
              <a
                href={directionsUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-2 text-brand hover:underline"
              >
                <Navigation className="size-4 mt-0.5 shrink-0" />
                <span>{address}<span className="ml-2 text-xs text-muted-foreground">Tap for directions</span></span>
              </a>
            )}
          </div>
          {notes.length > 0 && (
            <div className="mt-4 rounded-lg bg-clay-100/70 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <StickyNote className="size-3.5" /> Notes for this visit
              </div>
              <ul className="space-y-1.5 text-sm">
                {notes.map((n, i) => (
                  <li key={i}>
                    <span className="font-medium">{n.label}:</span>{" "}
                    <span className="text-muted-foreground">{n.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TeamOnJob teammates={job.teammates} />
        </div>
        <div className="shrink-0 flex flex-col items-stretch md:items-end gap-2 min-w-[180px]">
          {isOpen ? (
            <button
              onClick={onClockOut}
              className="inline-flex items-center justify-center gap-2 bg-orange-600 text-white text-base font-semibold rounded-xl px-5 py-3.5 hover:opacity-90 shadow-sm"
            >
              <Square className="size-5" /> Clock out
            </button>
          ) : (
            <button
              onClick={onClockIn}
              className="inline-flex items-center justify-center gap-2 bg-brand text-brand-foreground text-base font-semibold rounded-xl px-5 py-3.5 hover:opacity-90 shadow-sm"
            >
              <Play className="size-5" /> Clock in
            </button>
          )}
          <button
            onClick={onOpenSop}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-brand hover:underline"
          >
            <BookOpen className="size-3.5" /> View SOP
          </button>
          {!isOpen && (
            <button
              onClick={onCompleteNow}
              className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Camera className="size-3" /> Complete with photos
            </button>
          )}
        </div>
      </div>
    </section>
  );
}



function MyJobsPage() {
  const [tab, setTab] = useState<Tab>("today");
  return (
    <AppShell>
      <PageHeader title="My jobs" subtitle="Your assigned work and time tracking" />
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 pt-4">
        <PushToggle mode="app" />
      </div>
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-6">
        <div className="flex gap-1 mb-6 bg-clay-100 p-1 rounded-lg w-fit">
          {(["today", "schedule", "timesheet"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t ? "bg-clay-50 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "today" ? "Today & upcoming" : t === "schedule" ? "My schedule" : "My timesheet"}
            </button>
          ))}
        </div>
        {tab === "today" && <TodayView />}
        {tab === "schedule" && <ScheduleView />}
        {tab === "timesheet" && <TimesheetView />}
      </div>
    </AppShell>
  );
}

function TodayView() {
  const qc = useQueryClient();
  const list = useServerFn(listMyJobs);
  const doClockIn = useServerFn(clockIn);
  const getGpsSettings = useServerFn(getTenantGpsSettings);
  const doLogConsent = useServerFn(logGpsConsent);

  const gpsSettingsQ = useQuery({
    queryKey: ["tenant-gps-settings"],
    queryFn: () => getGpsSettings(),
  });
  const trackGps = !!gpsSettingsQ.data?.track_gps;

  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const to = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const q = useQuery({
    queryKey: ["my-jobs", from, to],
    queryFn: () => list({ data: { from, to } }),
  });

  const handleClockIn = async (job_id: string) => {
    let gps: { latitude: number; longitude: number; accuracy_meters: number | null } | null = null;
    if (trackGps) {
      const res = await captureGps();
      if (res.status === "ok") {
        gps = res.gps;
        doLogConsent({ data: { consent_method: "explicit_opt_in" } }).catch(() => {});
      } else {
        const method = res.status === "denied" ? "device_permission_denied" : "denied";
        doLogConsent({ data: { consent_method: method } }).catch(() => {});
        console.warn("[clock-in] GPS unavailable:", res.status);
      }
    }
    try {
      await doClockIn({ data: { job_id, gps } });
      toast.success(gps ? "Clocked in · 📍 Location captured" : "Clocked in");
      qc.invalidateQueries({ queryKey: ["my-jobs"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clock in");
    }
  };

  const [completeFor, setCompleteFor] = useState<{ jobId: string; entryId: string | null; startedAt: string | null; serviceTypeId: string | null } | null>(null);
  const [sopFor, setSopFor] = useState<{ jobId: string; serviceTypeId: string | null; label: string } | null>(null);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const jobs = q.data ?? [];
  if (!jobs.length) return <p className="text-sm text-muted-foreground">No upcoming jobs assigned to you.</p>;

  const groups = new Map<string, MyJobRow[]>();
  for (const j of jobs) {
    const key = new Date(j.scheduled_start).toDateString();
    const arr = groups.get(key) ?? [];
    arr.push(j);
    groups.set(key, arr);
  }

  const now = Date.now();
  const todayStr = new Date().toDateString();
  const upNext =
    jobs.find((j) => j.open_entry) ??
    jobs.find(
      (j) =>
        new Date(j.scheduled_start).toDateString() === todayStr &&
        new Date(j.scheduled_end).getTime() >= now &&
        j.status !== "completed" &&
        j.status !== "canceled",
    ) ??
    jobs.find((j) => new Date(j.scheduled_end).getTime() >= now && j.status !== "completed" && j.status !== "canceled") ??
    null;

  return (
    <>
      {upNext && (
        <UpNextHero
          job={upNext}
          onClockIn={() => handleClockIn(upNext.id)}
          onClockOut={() =>
            setCompleteFor({
              jobId: upNext.id,
              entryId: upNext.open_entry?.id ?? null,
              startedAt: upNext.open_entry?.started_at ?? null,
              serviceTypeId: upNext.service?.id ?? null,
            })
          }
          onCompleteNow={() =>
            setCompleteFor({ jobId: upNext.id, entryId: null, startedAt: null, serviceTypeId: upNext.service?.id ?? null })
          }
          onOpenSop={() =>
            setSopFor({ jobId: upNext.id, serviceTypeId: upNext.service?.id ?? null, label: upNext.service?.name ?? "SOP" })
          }
        />
      )}

      <div className="space-y-6">
        {[...groups.entries()].map(([day, items]) => (
          <section key={day}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              {new Date(items[0].scheduled_start).toDateString() === new Date().toDateString() ? "Today · " : ""}
              {fmtDate(items[0].scheduled_start)}
            </h2>
            <div className="space-y-3">
              {items.map((j) => (
                <article key={j.id} className="bg-clay-50 border border-border/60 rounded-xl p-4 ring-1 ring-black/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ background: j.service?.color ?? "hsl(var(--brand))" }}
                        />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {j.service?.name ?? "Service"}
                        </span>
                        <StatusPill status={j.status} />
                      </div>
                      <p className="font-medium">{clientName(j.client)}</p>
                      {j.client?.service_address && (
                        <a
                          href={directionsUrl(j.client.service_address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-brand hover:underline flex items-center gap-1 mt-1"
                        >
                          <MapPin className="size-3" /> {j.client.service_address}
                        </a>
                      )}
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="size-3" /> {fmtTime(j.scheduled_start)} – {fmtTime(j.scheduled_end)}
                      </p>
                      {j.notes && <p className="text-sm mt-2 text-muted-foreground italic">{j.notes}</p>}
                      <TeamOnJob teammates={j.teammates} />

                      <button
                        type="button"
                        onClick={() => setSopFor({ jobId: j.id, serviceTypeId: j.service?.id ?? null, label: j.service?.name ?? "SOP" })}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                      >
                        <BookOpen className="size-3.5" /> View SOP
                      </button>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {j.open_entry ? (
                        <>
                          <button
                            onClick={() =>
                              setCompleteFor({
                                jobId: j.id,
                                entryId: j.open_entry!.id,
                                startedAt: j.open_entry!.started_at,
                                serviceTypeId: j.service?.id ?? null,
                              })
                            }
                            className="inline-flex items-center gap-2 bg-orange-600 text-white text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90"
                          >
                            <Square className="size-4" /> Clock out
                          </button>
                          {j.open_entry.has_gps && (
                            <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">📍 Location captured</span>
                          )}
                        </>
                      ) : j.status === "scheduled" || j.status === "in_progress" ? (
                        <>
                          <button
                            onClick={() => handleClockIn(j.id)}
                            className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-50"
                          >
                            <Play className="size-4" /> Clock in
                          </button>
                          <button
                            onClick={() => setCompleteFor({ jobId: j.id, entryId: null, startedAt: null, serviceTypeId: j.service?.id ?? null })}
                            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Camera className="size-3" /> Complete with photos
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Done</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {completeFor && (
        <CompleteJobDialog
          jobId={completeFor.jobId}
          entryId={completeFor.entryId}
          startedAt={completeFor.startedAt}
          serviceTypeId={completeFor.serviceTypeId}
          trackGps={trackGps}
          onClose={() => setCompleteFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["my-jobs"] });
            qc.invalidateQueries({ queryKey: ["my-timesheet"] });
            qc.invalidateQueries({ queryKey: ["jobs"] });
            qc.invalidateQueries({ queryKey: ["job", completeFor.jobId] });
            setCompleteFor(null);
          }}
        />
      )}
      {sopFor && (
        <Dialog open onOpenChange={(v) => !v && setSopFor(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>SOP · {sopFor.label}</DialogTitle>
            </DialogHeader>
            <SopViewer serviceTypeId={sopFor.serviceTypeId} jobId={sopFor.jobId} allowMarkReviewed />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

type Pending = {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
  photo_type: PhotoType;
};

function CompleteJobDialog({
  jobId,
  entryId,
  startedAt,
  serviceTypeId,
  trackGps,
  onClose,
  onDone,
}: {
  jobId: string;
  entryId: string | null;
  startedAt: string | null;
  serviceTypeId: string | null;
  trackGps: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const createUploadUrl = useServerFn(createJobPhotoUploadUrl);
  const complete = useServerFn(completeJobWithPhotos);
  const doLogConsent = useServerFn(logGpsConsent);
  const fetchInventory = useServerFn(listInventory);
  const fetchRecipe = useServerFn(getRecipeForService);
  const inventoryQ = useQuery<InventoryItem[]>({ queryKey: ["inventory-for-complete"], queryFn: () => fetchInventory() });
  const recipeQ = useQuery({
    queryKey: ["recipe-for-service", serviceTypeId],
    queryFn: () => (serviceTypeId ? fetchRecipe({ data: { service_type_id: serviceTypeId } }) : Promise.resolve([])),
    enabled: !!serviceTypeId,
  });
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Pending[]>([]);
  const [supplies, setSupplies] = useState<Record<string, number>>({});
  const [prefilled, setPrefilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const hours = startedAt ? hoursBetween(startedAt, new Date().toISOString()) : null;

  // Pre-fill supplies from the recipe once loaded
  if (!prefilled && recipeQ.data && recipeQ.data.length > 0) {
    const seed: Record<string, number> = {};
    for (const r of recipeQ.data) seed[r.inventory_item_id] = r.quantity_per_job;
    setSupplies(seed);
    setPrefilled(true);
  }


  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: Pending[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        caption: "",
        photo_type: "after",
      });
    }
    setItems((prev) => [...prev, ...next]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const update = (id: string, patch: Partial<Pending>) =>
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const onSubmit = async () => {
    setSaving(true);
    try {
      let clockOutGps: { latitude: number; longitude: number; accuracy_meters: number | null } | null = null;
      if (trackGps && entryId) {
        const res = await captureGps();
        if (res.status === "ok") {
          clockOutGps = res.gps;
          doLogConsent({ data: { consent_method: "explicit_opt_in" } }).catch(() => {});
        } else {
          const method = res.status === "denied" ? "device_permission_denied" : "denied";
          doLogConsent({ data: { consent_method: method } }).catch(() => {});
          console.warn("[clock-out] GPS unavailable:", res.status);
        }
      }
      const uploaded: { storage_path: string; caption?: string; photo_type: PhotoType }[] = [];
      for (const it of items) {
        const { path, token } = await createUploadUrl({ data: { job_id: jobId, file_name: it.file.name } });
        const { error } = await supabase.storage.from("job-photos").uploadToSignedUrl(path, token, it.file, {
          contentType: it.file.type,
        });
        if (error) throw new Error(error.message);
        uploaded.push({ storage_path: path, caption: it.caption || undefined, photo_type: it.photo_type });
      }
      await complete({
        data: {
          job_id: jobId,
          photos: uploaded,
          entry_id: entryId ?? undefined,
          notes: notes || undefined,
          clock_out_gps: clockOutGps,
          supplies_used: Object.entries(supplies)
            .filter(([, qty]) => qty > 0)
            .map(([item_id, quantity]) => ({ item_id, quantity })),
        },
      });
      toast.success(clockOutGps ? "Job completed · 📍 Location captured" : "Job completed");
      items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to complete job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-clay-50 rounded-xl border border-border/60 w-full max-w-xl p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium mb-1">Complete job</h3>
        {hours !== null ? (
          <p className="text-sm text-muted-foreground mb-4">
            You worked <strong className="text-foreground">{hours.toFixed(2)} hours</strong> (since {fmtTime(startedAt!)}).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-4">Attach any before/after photos before marking complete.</p>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Photos</label>
          <div className="flex gap-2 mb-3">
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90"
            >
              <Camera className="size-4" /> Take photo
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 border border-border text-sm font-medium rounded-lg px-3 py-2 hover:bg-clay-100"
            >
              <UploadIcon className="size-4" /> Upload
            </button>
          </div>
          {items.length > 0 && (
            <div className="space-y-3">
              {items.map((it) => (
                <div key={it.id} className="flex gap-3 bg-clay-100 rounded-lg p-2">
                  <img src={it.previewUrl} alt="" className="size-20 rounded object-cover shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex gap-1">
                      {(["before", "after", "other"] as PhotoType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => update(it.id, { photo_type: t })}
                          className={`text-[11px] uppercase tracking-wider px-2 py-1 rounded font-medium ${
                            it.photo_type === t
                              ? "bg-brand text-brand-foreground"
                              : "bg-clay-50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <input
                      value={it.caption}
                      onChange={(e) => update(it.id, { caption: e.target.value })}
                      placeholder="Caption (optional)"
                      className="w-full text-sm border border-border rounded px-2 py-1 bg-clay-50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="shrink-0 self-start p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <SuppliesUsedSection
          items={inventoryQ.data ?? []}
          selected={supplies}
          onChange={setSupplies}
        />

        <label className="block text-sm font-medium mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-clay-50"
          placeholder="Anything worth noting?"
        />

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg hover:bg-clay-100">Cancel</button>
          <button
            disabled={saving}
            onClick={onSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-brand-foreground disabled:opacity-50"
          >
            {saving ? "Uploading…" : "Mark complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuppliesUsedSection({
  items,
  selected,
  onChange,
}: {
  items: InventoryItem[];
  selected: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const toggle = (id: string) => {
    const next = { ...selected };
    if (id in next) delete next[id];
    else next[id] = 1;
    onChange(next);
  };
  const setQty = (id: string, qty: number) => {
    onChange({ ...selected, [id]: qty });
  };
  if (!items.length) return null;
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-2">Log supplies used (optional)</label>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-clay-50 divide-y divide-border/60">
        {items.map((it) => {
          const checked = it.id in selected;
          return (
            <div key={it.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(it.id)}
                className="size-4 accent-current"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{it.name}</p>
                <p className="text-[11px] text-muted-foreground">{it.quantity_on_hand} {it.unit} on hand</p>
              </div>
              {checked && (
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={selected[it.id]}
                  onChange={(e) => setQty(it.id, Number(e.target.value))}
                  className="w-20 text-sm border border-border rounded px-2 py-1 bg-white text-right tabular-nums"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: MyJobRow["status"] }) {
  const map: Record<MyJobRow["status"], string> = {
    scheduled: "bg-blue-100 text-blue-800",
    in_progress: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    canceled: "bg-gray-100 text-gray-600",
  };
  const label = status === "in_progress" ? "In progress" : status[0].toUpperCase() + status.slice(1);
  return <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${map[status]}`}>{label}</span>;
}

function ScheduleView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const list = useServerFn(listMyJobs);
  const from = weekStart.toISOString();
  const toDate = new Date(weekStart);
  toDate.setDate(toDate.getDate() + 7);
  const to = toDate.toISOString();

  const q = useQuery({
    queryKey: ["my-jobs", "week", from],
    queryFn: () => list({ data: { from, to } }),
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const jobsByDay = new Map<string, MyJobRow[]>();
  for (const j of q.data ?? []) {
    const k = new Date(j.scheduled_start).toDateString();
    const arr = jobsByDay.get(k) ?? [];
    arr.push(j);
    jobsByDay.set(k, arr);
  }

  const statusBg: Record<MyJobRow["status"], string> = {
    scheduled: "bg-blue-100 border-blue-300 text-blue-900",
    in_progress: "bg-orange-100 border-orange-300 text-orange-900",
    completed: "bg-green-100 border-green-300 text-green-900",
    canceled: "bg-gray-100 border-gray-300 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ‹
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100">
            Today
          </button>
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ›
          </button>
        </div>
        <span className="text-sm text-muted-foreground">
          {weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} –{" "}
          {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
        {days.map((d) => {
          const items = jobsByDay.get(d.toDateString()) ?? [];
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className="border border-border/60 rounded-lg p-2 min-h-32 bg-clay-50">
              <div className={`text-xs font-medium mb-2 ${isToday ? "text-brand" : "text-muted-foreground"}`}>
                {d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}
              </div>
              <div className="space-y-1.5">
                {items.map((j) => (
                  <div key={j.id} className={`text-xs px-2 py-1.5 rounded border ${statusBg[j.status]}`}>
                    <div className="font-medium">{fmtTime(j.scheduled_start)}</div>
                    <div className="truncate">{clientName(j.client)}</div>
                    <ScheduleTeammates teammates={j.teammates} />
                  </div>
                ))}
                {!items.length && <div className="text-[11px] text-muted-foreground/60">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimesheetView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const list = useServerFn(listMyTimeEntries);
  const from = weekStart.toISOString();
  const toDate = new Date(weekStart);
  toDate.setDate(toDate.getDate() + 7);
  const to = toDate.toISOString();

  const q = useQuery({
    queryKey: ["my-timesheet", from],
    queryFn: () => list({ data: { from, to } }),
  });

  const entries = q.data ?? [];
  const totalHours = entries.reduce((sum, e) => (e.ended_at ? sum + hoursBetween(e.started_at, e.ended_at) : sum), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ‹
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100">
            This week
          </button>
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ›
          </button>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Total: </span>
          <strong>{totalHours.toFixed(2)} hrs</strong>
        </div>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries.length ? (
        <p className="text-sm text-muted-foreground">No time entries this week.</p>
      ) : (
        <div className="border border-border/60 rounded-xl overflow-hidden bg-clay-50">
          <table className="w-full text-sm">
            <thead className="bg-clay-100 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Client</th>
                <th className="text-left px-4 py-2">Clock in</th>
                <th className="text-left px-4 py-2">Clock out</th>
                <th className="text-right px-4 py-2">Hours</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: TimeEntryRow) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="px-4 py-2">{fmtDate(e.started_at)}</td>
                  <td className="px-4 py-2">
                    {e.job?.client ? `${e.job.client.first_name ?? ""} ${e.job.client.last_name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {fmtTime(e.started_at)}
                    {e.clock_in_latitude !== null && <span className="ml-1 text-emerald-600" title={`±${Math.round(e.clock_in_accuracy_meters ?? 0)}m`}>📍</span>}
                  </td>
                  <td className="px-4 py-2">
                    {e.ended_at ? fmtTime(e.ended_at) : <span className="text-orange-600">In progress</span>}
                    {e.clock_out_latitude !== null && <span className="ml-1 text-emerald-600">📍</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {e.ended_at ? hoursBetween(e.started_at, e.ended_at).toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
