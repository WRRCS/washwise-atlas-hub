/** Weekly overtime threshold (Washington: 1.5x pay over 40 hours in a workweek). */
export const OVERTIME_THRESHOLD_MIN = 40 * 60;
export const OVERTIME_MULTIPLIER = 1.5;

export type DayPay = { regularMin: number; overtimeMin: number; cents: number };

/**
 * Splits a workweek's paid minutes (in day order, Monday first) into regular and overtime
 * minutes, and prices each day. Overtime begins once the week's running total passes 40 hours.
 * `priorMin` is paid time earlier in the same workweek that isn't in `perDayMin`.
 */
export function weeklyPay(perDayMin: number[], rateCents: number, priorMin = 0): { days: DayPay[]; totalCents: number; overtimeMin: number } {
  let running = Math.max(0, priorMin);
  const days = perDayMin.map((raw) => {
    const min = Math.max(0, raw || 0);
    const regularLeft = Math.max(0, OVERTIME_THRESHOLD_MIN - running);
    const regularMin = Math.min(min, regularLeft);
    const overtimeMin = min - regularMin;
    running += min;
    const cents = Math.round((regularMin / 60) * rateCents + (overtimeMin / 60) * rateCents * OVERTIME_MULTIPLIER);
    return { regularMin, overtimeMin, cents };
  });
  return {
    days,
    totalCents: days.reduce((s, d) => s + d.cents, 0),
    overtimeMin: days.reduce((s, d) => s + d.overtimeMin, 0),
  };
}

export const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
