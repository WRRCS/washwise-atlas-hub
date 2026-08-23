import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { endDateFrom, RECURRENCE_LABELS, type EndUnit, type RecurrenceRule } from "@/lib/recurrence";

export type RecurrenceValue = {
  mode: "one_off" | "recurring";
  rule: RecurrenceRule;
  endMode: "never" | "after" | "on";
  endCount: number;
  endUnit: EndUnit;
  endDate: string;
};

export function defaultRecurrence(startDate: string): RecurrenceValue {
  return {
    mode: "one_off",
    rule: "weekly",
    endMode: "never",
    endCount: 6,
    endUnit: "months",
    endDate: endDateFrom(startDate, 6, "months"),
  };
}

/** The recurrence_end value to send to createJob (null = open-ended). */
export function recurrenceEndValue(v: RecurrenceValue, startDate: string): string | null {
  if (v.mode !== "recurring" || v.endMode === "never") return null;
  if (v.endMode === "after") return endDateFrom(startDate, v.endCount, v.endUnit);
  return v.endDate;
}

export function RecurrenceFields({
  value,
  onChange,
  startDate,
}: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  startDate: string;
}) {
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch });
  const recurring = value.mode === "recurring";

  return (
    <div className="rounded-md border border-input p-3 space-y-3">
      <div className="inline-flex rounded-md border border-input overflow-hidden">
        {(["one_off", "recurring"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set({ mode: m })}
            className={`px-3 h-8 text-sm ${value.mode === m ? "bg-brand text-brand-foreground" : "bg-background"}`}
          >
            {m === "one_off" ? "One-off" : "Recurring"}
          </button>
        ))}
      </div>

      {recurring && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Repeats</Label>
            <select
              value={value.rule}
              onChange={(e) => set({ rule: e.target.value as RecurrenceRule })}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {(Object.keys(RECURRENCE_LABELS) as RecurrenceRule[]).map((r) => (
                <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Ends</Label>
            <select
              value={value.endMode}
              onChange={(e) => set({ endMode: e.target.value as RecurrenceValue["endMode"] })}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="never">Never — keeps auto-filling future schedules</option>
              <option value="after">Ends after…</option>
              <option value="on">Ends on a date</option>
            </select>
          </div>

          {value.endMode === "after" && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min={1}
                value={value.endCount}
                onChange={(e) => set({ endCount: Math.max(1, Number(e.target.value)) })}
              />
              <select
                value={value.endUnit}
                onChange={(e) => set({ endUnit: e.target.value as EndUnit })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
          )}

          {value.endMode === "on" && (
            <Input type="date" value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />
          )}

          <p className="text-xs text-muted-foreground">
            Visits are created 6 months ahead and topped up automatically, so the schedule always stays filled.
            {value.endMode === "after" && ` Series ends ${endDateFrom(startDate, value.endCount, value.endUnit)}.`}
          </p>
        </div>
      )}
    </div>
  );
}
