import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBusinessTz } from "@/hooks/use-business-tz";
import { fmtDateTZ, fmtTimeTZ } from "@/lib/tz";
import { TIME_OFF_REASONS, defaultTimeOffHours, timeOffInputError, type TimeOffCategory } from "@/lib/time-off";
import {
  deleteScheduleTimeOff,
  previewTimeOffOverlaps,
  saveScheduleTimeOff,
  type ScheduleTimeOff,
  type TimeOffOverlap,
} from "@/lib/time-off-schedule.functions";

type Person = { id: string; full_name?: string | null };

/** "Add shift | Time off" switch at the top of the schedule's add window. */
export function ScheduleAddTabs({ mode, onChange }: { mode: "shift" | "time_off"; onChange: (m: "shift" | "time_off") => void }) {
  const item = (m: "shift" | "time_off", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onChange(m)}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${mode === m ? "bg-background shadow-sm border border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="What to add" className="inline-flex gap-1 rounded-lg bg-muted p-1 w-fit">
      {item("shift", "Add shift")}
      {item("time_off", "Time off")}
    </div>
  );
}

export function TimeOffDialog({
  date,
  employeeId,
  existing,
  people,
  onClose,
  onSwitchToShift,
}: {
  date: string;
  employeeId?: string;
  existing?: ScheduleTimeOff | null;
  people: Person[];
  onClose: () => void;
  onSwitchToShift?: () => void;
}) {
  const qc = useQueryClient();
  const tz = useBusinessTz();
  const saveFn = useServerFn(saveScheduleTimeOff);
  const delFn = useServerFn(deleteScheduleTimeOff);
  const previewFn = useServerFn(previewTimeOffOverlaps);

  const [who, setWho] = useState(existing?.employee_id ?? employeeId ?? "");
  const [category, setCategory] = useState<TimeOffCategory>(existing?.category ?? "unpaid");
  const [reason, setReason] = useState<string>(existing?.reason ?? "vacation");
  const [note, setNote] = useState(existing?.note ?? "");
  const [allDay, setAllDay] = useState(existing?.all_day ?? true);
  const [startDate, setStartDate] = useState(existing?.start_date ?? date);
  const [endDate, setEndDate] = useState(existing?.end_date ?? date);
  const [startTime, setStartTime] = useState(existing?.start_time ?? "09:00");
  const [endTime, setEndTime] = useState(existing?.end_time ?? "13:00");
  const [hoursStr, setHoursStr] = useState<string | null>(existing ? String(existing.hours) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const input = useMemo(
    () => ({ start_date: startDate, end_date: allDay ? endDate : startDate, all_day: allDay, start_time: allDay ? null : startTime, end_time: allDay ? null : endTime }),
    [startDate, endDate, allDay, startTime, endTime],
  );
  const inputError = timeOffInputError(input);
  const suggested = defaultTimeOffHours(input);
  const hoursValue = hoursStr === null ? suggested : Number(hoursStr);

  // Keep the end date from falling before the start date.
  useEffect(() => {
    if (endDate < startDate) setEndDate(startDate);
  }, [startDate, endDate]);

  const overlapsQ = useQuery({
    queryKey: ["time-off-overlaps", who, input, existing?.id],
    queryFn: () => previewFn({ data: { employee_id: who, ...input, ...(existing?.id ? { ignore_id: existing.id } : {}) } }),
    enabled: !!who && !inputError,
  });
  const overlaps: TimeOffOverlap[] = overlapsQ.data?.overlaps ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["schedule-time-off"] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(existing?.id ? { id: existing.id } : {}),
          employee_id: who,
          ...input,
          category,
          reason: reason as any,
          note: note.trim() || null,
          hours: Number.isFinite(hoursValue) ? Math.max(0, hoursValue) : suggested,
        },
      }),
    onSuccess: (res) => {
      refresh();
      const n = res.overlaps.length;
      toast.success(existing ? "Time off updated" : "Time off added", {
        description: n ? `${n} cleaning${n === 1 ? "" : "s"} during this time still need someone else.` : undefined,
      });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save time off"),
  });

  const remove = useMutation({
    mutationFn: () => delFn({ data: { id: existing!.id } }),
    onSuccess: () => {
      refresh();
      toast.success("Time off removed");
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove time off"),
  });

  const personName = people.find((p) => p.id === who)?.full_name ?? "This person";
  const selectCls = "w-full h-9 rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit time off" : "Time off"}</DialogTitle>
        </DialogHeader>
        {!existing && onSwitchToShift && <ScheduleAddTabs mode="time_off" onChange={(m) => m === "shift" && onSwitchToShift()} />}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="to-who">Team member</Label>
            <select id="to-who" value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} disabled={!!existing}>
              <option value="">Select…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? "Team member"}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="to-cat">Category</Label>
              <select id="to-cat" value={category} onChange={(e) => setCategory(e.target.value as TimeOffCategory)} className={selectCls}>
                <option value="unpaid">Unpaid time off</option>
                <option value="paid">Paid time off</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to-reason">Reason</Label>
              <select id="to-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
                {TIME_OFF_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="to-note">Note</Label>
            <Textarea id="to-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Leave a note (only you, managers and this person can see it)" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <Switch checked={allDay} onCheckedChange={(v) => { setAllDay(v); setHoursStr(null); }} aria-label="Whole day" />
            <span className="text-sm font-medium">Whole day</span>
          </label>

          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="to-start">From</Label>
                <Input id="to-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setHoursStr(null); }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-end">Through</Label>
                <Input id="to-end" type="date" min={startDate} value={endDate} onChange={(e) => { setEndDate(e.target.value); setHoursStr(null); }} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="to-day">Day</Label>
                <Input id="to-day" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-st">From</Label>
                <Input id="to-st" type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setHoursStr(null); }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-et">To</Label>
                <Input id="to-et" type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setHoursStr(null); }} />
              </div>
            </div>
          )}

          <div className="space-y-1.5 w-40">
            <Label htmlFor="to-hours">Total hours</Label>
            <Input id="to-hours" type="number" min={0} step={0.25} value={hoursStr ?? String(suggested)} onChange={(e) => setHoursStr(e.target.value)} />
          </div>

          {inputError && <p className="text-sm text-destructive">{inputError}</p>}

          {who && !inputError && overlaps.length > 0 && (
            <div className="rounded-md bg-warning/10 border border-warning/40 p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="font-medium">{personName.split(" ")[0]} is on {overlaps.length} cleaning{overlaps.length === 1 ? "" : "s"} during this time</p>
                <ul className="text-xs space-y-0.5">
                  {overlaps.slice(0, 8).map((o) => (
                    <li key={`${o.job_id}-${o.scheduled_start}`}>
                      {fmtDateTZ(o.scheduled_start, tz)} · {fmtTimeTZ(o.scheduled_start, tz)}–{fmtTimeTZ(o.scheduled_end, tz)} · {o.label}
                    </li>
                  ))}
                  {overlaps.length > 8 && <li>…and {overlaps.length - 8} more</li>}
                </ul>
                <p className="text-xs text-muted-foreground">Saving won't change these cleanings. Reassign them on the schedule.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {existing && (
              confirmDelete ? (
                <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  {remove.isPending ? "Removing…" : "Yes, remove"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4 mr-1" /> Remove
                </Button>
              )
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!who || !!inputError || save.isPending} className="bg-brand text-brand-foreground hover:opacity-90">
              {save.isPending ? "Saving…" : existing ? "Save" : "Add"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
