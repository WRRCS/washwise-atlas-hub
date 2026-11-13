import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock, History, Plus, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT, translateNow as tn, activeLocales } from "@/lib/i18n";
import type { DailyRow } from "@/lib/visits.functions";
import { deleteTimesheetLine, getTimesheetLineContext, quickEditTimesheetLine, type LineHistory } from "@/lib/timesheet-quick-edit.functions";
import { resolveLineTimes, wallTime } from "@/lib/timesheet-quick-edit";

const TZ = "America/Los_Angeles";
const REFRESH = ["timesheet", "timesheet-correction", "timesheet-line", "my-timesheet", "my-shift", "reports", "report-timesheets", "report-payroll"];

function dur(m: number) {
  const r = Math.max(0, Math.round(m));
  const h = Math.floor(r / 60), mm = r % 60;
  if (!h) return `${mm} ${tn("min")}`;
  return `${h} ${tn(h === 1 ? "hr" : "hrs")}${mm ? ` ${mm} ${tn("min")}` : ""}`;
}
const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(activeLocales()[0] ?? "en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).toLowerCase() : "—";
const firstName = (n: string) => n.split(/\s+/)[0] || n;
const expectedOf = (r: DailyRow) => ({ job_id: r.job_id, arrived_at: r.arrived_at!, left_at: r.left_at });

/** Plain word match on the visible name (ignores the hidden id after "|"), so "ryan" finds only Ryans. */
function matchWords(value: string, search: string) {
  const text = value.split("|")[0].toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w)) ? 1 : 0;
}

async function refresh(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all(REFRESH.map((key) => qc.invalidateQueries({ queryKey: [key] })));
}

/** Confirm, then remove one line. Used from the table row and from the line dialog. */
export function DeleteLineConfirm({ row, open, onOpenChange, onDeleted }: { row: DailyRow; open: boolean; onOpenChange: (o: boolean) => void; onDeleted?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const del = useServerFn(deleteTimesheetLine);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!row.visit_id || !row.arrived_at) return;
    setBusy(true);
    try {
      const res = await del({ data: { visit_id: row.visit_id, expected: expectedOf(row), reason: "" } });
      await refresh(qc);
      toast.success(res.paid_removed ? t("Line and its paid time deleted") : t("Line deleted — paid hours stay the same"));
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Unable to delete"));
    } finally { setBusy(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Delete this line?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {row.employee_name} · {row.client}{row.property ? ` · ${row.property}` : ""} · {clock(row.arrived_at)} – {row.left_at ? clock(row.left_at) : t("now")}
            <br />
            {t("Paid hours stay the same unless this was the only line in that clock-in.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void run(); }}>
            {busy ? t("Deleting…") : t("Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function historySummary(h: LineHistory) {
  const o = (h.original_values ?? {}) as { action?: string; visit?: { arrived_at?: string; left_at?: string | null } | null };
  const c = (h.corrected_values ?? {}) as { action?: string; visit?: { arrived_at?: string; left_at?: string | null } | null };
  if (o.action === "delete_line") return `${tn("Deleted line")} ${clock(o.visit?.arrived_at)} – ${o.visit?.left_at ? clock(o.visit.left_at) : tn("open")}`;
  if (o.action === "quick_edit") {
    const before = o.visit ? `${clock(o.visit.arrived_at)} – ${o.visit.left_at ? clock(o.visit.left_at) : tn("open")}` : tn("no times");
    const after = c.visit ? `${clock(c.visit.arrived_at)} – ${c.visit.left_at ? clock(c.visit.left_at) : tn("open")}` : "";
    return `${before} → ${after}`;
  }
  return tn("Full correction (lunch, drive or attendance)");
}

export function TimesheetLineDialog({ row, dayKey, from, to, onClose, onMoreCorrections }: {
  row: DailyRow; dayKey: string; from: string; to: string; onClose: () => void; onMoreCorrections: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const ctxFn = useServerFn(getTimesheetLineContext);
  const save = useServerFn(quickEditTimesheetLine);
  const ctx = useQuery({
    queryKey: ["timesheet-line", row.employee_id, row.job_id, from],
    queryFn: () => ctxFn({ data: { employee_id: row.employee_id, job_id: row.job_id, from, to } }),
    staleTime: 0,
  });
  const initialIn = wallTime(row.arrived_at, TZ);
  const initialOut = wallTime(row.left_at, TZ);
  // An appointment id, or "place:<client>:<property>" for any client location.
  const [jobId, setJobId] = useState(row.job_id ?? "");
  const [picking, setPicking] = useState(false);
  const [inTime, setInTime] = useState(initialIn);
  const [outTime, setOutTime] = useState(initialOut);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const appointments = ctx.data?.appointments ?? [];
  const mine = appointments.filter((a) => a.assigned);
  const others = appointments.filter((a) => !a.assigned);
  const currentMissing = row.job_id && !appointments.some((a) => a.id === row.job_id);
  const scheduledPlaces = new Set(appointments.map((a) => `${a.client_id}:${a.property_id ?? ""}`));
  const places = (ctx.data?.places ?? []).filter((p) => !scheduledPlaces.has(p.key));
  const place = jobId.startsWith("place:") ? places.find((p) => `place:${p.key}` === jobId) : undefined;
  const selected = appointments.find((a) => a.id === jobId);
  const selectedLabel = selected
    ? `${clock(selected.scheduled_start)} · ${selected.label}`
    : place?.label ?? (jobId && jobId === row.job_id ? `${row.client}${row.property ? ` · ${row.property}` : ""}` : t("Choose the appointment"));
  const choose = (value: string) => { setJobId(value); setPicking(false); };
  const schedStart = selected?.scheduled_start ?? (jobId === row.job_id ? row.scheduled_start : null);
  const schedEnd = selected?.scheduled_end ?? (jobId === row.job_id ? row.scheduled_end : null);
  const schedMin = schedStart && schedEnd ? (Date.parse(schedEnd) - Date.parse(schedStart)) / 60000 : null;

  const resolved = useMemo(() => {
    try {
      return inTime ? resolveLineTimes({ dayKey, tz: TZ, inTime, outTime, original: row.arrived_at ? { arrived_at: row.arrived_at, left_at: row.left_at } : undefined }) : null;
    } catch { return null; }
  }, [dayKey, inTime, outTime, row.arrived_at, row.left_at]);
  const workedMin = resolved ? ((resolved.left_at ? Date.parse(resolved.left_at) : Date.now()) - Date.parse(resolved.arrived_at)) / 60000 : 0;
  const diff = resolved?.left_at && schedMin != null ? workedMin - schedMin : null;
  const nextDay = !!outTime && !!inTime && outTime <= inTime;
  const changed = jobId !== (row.job_id ?? "") || inTime !== initialIn || outTime !== initialOut;

  const submit = async () => {
    setError("");
    if (!jobId) { setError(t("Choose the appointment")); return; }
    let times;
    try { times = resolveLineTimes({ dayKey, tz: TZ, inTime, outTime, original: row.arrived_at ? { arrived_at: row.arrived_at, left_at: row.left_at } : undefined }); }
    catch (e) { setError(t(e instanceof Error ? e.message : "Check the times")); return; }
    setBusy(true);
    try {
      const target = place ? { job_id: null, place: { client_id: place.client_id, property_id: place.property_id } } : { job_id: jobId, place: null };
      const res = await save({ data: { visit_id: row.visit_id, employee_id: row.employee_id, expected: row.visit_id && row.arrived_at ? expectedOf(row) : null, ...target, ...times, reason: note } });
      await Promise.all([refresh(qc), res.created ? qc.invalidateQueries({ queryKey: ["jobs"] }) : null]);
      toast.success(res.created ? t("Timesheet updated — appointment added to the schedule") : t("Timesheet updated"));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Unable to save"));
    } finally { setBusy(false); }
  };

  const day = new Date(`${dayKey}T12:00:00`).toLocaleDateString(activeLocales()[0] ?? "en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-xl p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-5 border-b border-border/60 text-left space-y-0">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</p>
                <DialogTitle className="text-2xl font-bold mt-1 truncate">{row.employee_name}</DialogTitle>
                <DialogDescription className="sr-only">{t("Change the appointment, clock-in or clock-out for this line.")}</DialogDescription>
              </div>
              {row.visit_id && (
                <Button type="button" variant="ghost" className="shrink-0 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4 mr-1.5" />{t("Delete")}
                </Button>
              )}
            </div>
            <div className="mt-4">
              <button type="button" aria-label={t("Appointment")} aria-expanded={picking} disabled={ctx.isLoading} onClick={() => setPicking((o) => !o)}
                className="flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
                <span className="flex-1 truncate">{ctx.isLoading ? t("Loading…") : selectedLabel}</span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${picking ? "rotate-180" : ""}`} />
              </button>
              {picking && (
                <Command filter={matchWords} className="mt-2 h-auto rounded-lg border border-input">
                  <CommandInput autoFocus placeholder={t("Search clients or appointments…")} />
                  <CommandList className="max-h-72">
                    <CommandEmpty>{t("No matches")}</CommandEmpty>
                    {currentMissing && (
                      <CommandGroup heading={t("Current")}>
                        <CommandItem value={`${row.client} ${row.property ?? ""}|${row.job_id}`} onSelect={() => choose(row.job_id!)}>
                          {jobId === row.job_id && <Check className="size-4" />}{row.client}{row.property ? ` · ${row.property}` : ""}
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {mine.length > 0 && (
                      <CommandGroup heading={`${firstName(row.employee_name)} — ${t("assigned this day")}`}>
                        {mine.map((a) => (
                          <CommandItem key={a.id} value={`${a.label}|${a.id}`} onSelect={() => choose(a.id)}>
                            {jobId === a.id && <Check className="size-4" />}<span className="tabular-nums text-muted-foreground">{clock(a.scheduled_start)}</span> {a.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {others.length > 0 && (
                      <CommandGroup heading={t("Other appointments this day")}>
                        {others.map((a) => (
                          <CommandItem key={a.id} value={`${a.label}|${a.id}`} onSelect={() => choose(a.id)}>
                            {jobId === a.id && <Check className="size-4" />}<span className="tabular-nums text-muted-foreground">{clock(a.scheduled_start)}</span> {a.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {places.length > 0 && (
                      <CommandGroup heading={t("All clients — not scheduled this day")}>
                        {places.map((p) => (
                          <CommandItem key={p.key} value={`${p.label}|${p.key}`} onSelect={() => choose(`place:${p.key}`)}>
                            {jobId === `place:${p.key}` ? <Check className="size-4" /> : <Plus className="size-4 text-muted-foreground" />}{p.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              )}
              {place && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("Not on the schedule this day. Saving adds this appointment for these times, assigned to")} {firstName(row.employee_name)}.
                </p>
              )}
            </div>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5 overflow-y-auto">
            <section className="flex gap-3">
              <Clock className="size-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold">{t("Worked")} ({resolved ? dur(workedMin) : "—"})</h3>
                <div className="mt-2 flex items-end gap-2">
                  <label className="flex-1 max-w-44 text-sm text-muted-foreground">{t("Clocked in")}
                    <Input aria-label={t("Clocked in")} type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} className="mt-1 h-11 text-base text-foreground" />
                  </label>
                  <span className="pb-3 text-muted-foreground">–</span>
                  <label className="flex-1 max-w-44 text-sm text-muted-foreground">{t("Clocked out")}
                    <Input aria-label={t("Clocked out")} type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className="mt-1 h-11 text-base text-foreground" />
                  </label>
                </div>
                {nextDay && <p className="mt-1 text-xs text-muted-foreground">{t("Clock-out is on the next day.")}</p>}
                {!outTime && inTime && <p className="mt-1 text-xs text-muted-foreground">{t("No clock-out — still working.")}</p>}
                {schedStart && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("Scheduled:")} {schedMin != null ? `${dur(schedMin)} ` : ""}({clock(schedStart)} – {clock(schedEnd)})
                  </p>
                )}
                {diff != null && (
                  Math.abs(diff) <= 5
                    ? <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-xs font-semibold text-foreground"><Check className="size-3.5" />{t("On scheduled time")}</span>
                    : diff > 0
                      ? <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-warning/20 px-2.5 py-1 text-xs font-semibold text-foreground"><ArrowUp className="size-3.5" />{dur(diff)} {t("over scheduled time")}</span>
                      : <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-foreground"><ArrowDown className="size-3.5" />{dur(-diff)} {t("under scheduled time")}</span>
                )}
              </div>
            </section>

            <label className="block border-t border-border/60 pt-4 text-sm text-muted-foreground">{t("Note (optional)")}
              <Input aria-label={t("Note (optional)")} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className="mt-1 text-foreground" placeholder={t("e.g. Forgot to clock out")} />
            </label>

            <button type="button" onClick={onMoreCorrections} className="flex w-full items-center gap-3 border-t border-border/60 pt-4 text-left">
              <Wrench className="size-5 text-muted-foreground shrink-0" />
              <span className="flex-1 font-semibold">{t("More corrections")}</span>
              <span className="text-xs text-muted-foreground">{t("lunch, drive, no-show")}</span>
            </button>

            <div className="border-t border-border/60 pt-4">
              <button type="button" onClick={() => setShowHistory((s) => !s)} className="flex w-full items-center gap-3 text-left" aria-expanded={showHistory}>
                <History className="size-5 text-muted-foreground shrink-0" />
                <span className="flex-1 font-semibold">{t("Edit history")} ({ctx.data?.history.length ?? 0})</span>
                <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showHistory ? "rotate-180" : ""}`} />
              </button>
              {showHistory && (
                <ul className="mt-3 ml-8 space-y-2 text-sm">
                  {(ctx.data?.history ?? []).length === 0 && <li className="text-muted-foreground">{t("No changes yet.")}</li>}
                  {(ctx.data?.history ?? []).map((h) => (
                    <li key={h.id}>
                      <div className="tabular-nums">{historySummary(h)}</div>
                      <div className="text-xs text-muted-foreground">
                        {h.editor} · {new Date(h.corrected_at).toLocaleString(activeLocales()[0] ?? "en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{h.reason ? ` · ${h.reason}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border/60 sm:justify-between">
            <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="button" disabled={!changed || busy || !jobId || !inTime} onClick={() => void submit()}>{busy ? t("Saving…") : t("Save changes")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {row.visit_id && <DeleteLineConfirm row={row} open={confirmDelete} onOpenChange={setConfirmDelete} onDeleted={onClose} />}
    </>
  );
}
