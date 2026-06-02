/* ============================================================
   Recurrence expansion. A series is a rule; we expand it into
   concrete occurrence dates for a requested window. Unbounded
   ("never") series are fine because expansion is always window-bounded.

   freq:
     - daily   : every `interval` days from dtstart
     - weekly  : on `byweekday` (Mon=0..Sun=6), every `interval` weeks
     - monthly : same day-of-month as dtstart, every `interval` months
   end:
     - never | until <date> | count <n>
   ============================================================ */

export type RecurrenceRule = {
  dtstart: string; // YYYY-MM-DD (first possible day)
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  byweekday: string; // csv of 0..6 (Mon=0); empty => dtstart's weekday (weekly only)
  endMode: "never" | "until" | "count";
  until: string; // YYYY-MM-DD when endMode = until
  count: number | null; // when endMode = count
};

const dUTC = (s: string) => new Date(s + "T00:00:00Z");
const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const mondayIdx = (d: Date) => (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6

function addMonths(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastOfMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastOfMonth)); // clamp e.g. Jan 31 -> Feb 28
  return base;
}

const CAP = 5000; // safety bound on iterations

// Occurrence dates (YYYY-MM-DD) within [winStart, winEnd]. Exceptions NOT applied here.
export function expandRecurrence(r: RecurrenceRule, winStartStr: string, winEndStr: string): string[] {
  const dtstart = dUTC(r.dtstart);
  const winStart = dUTC(winStartStr);
  const winEnd = dUTC(winEndStr);
  const interval = Math.max(1, r.interval || 1);
  const until = r.endMode === "until" && r.until ? dUTC(r.until) : null;
  const maxCount = r.endMode === "count" ? Math.max(0, r.count || 0) : Infinity;
  const out: string[] = [];

  // Records occurrence #idx; returns false when the series has ended.
  const consider = (d: Date, idx: number): boolean => {
    if (until && d > until) return false;
    if (idx >= maxCount) return false;
    if (d >= dtstart && d >= winStart && d <= winEnd) out.push(isoUTC(d));
    return true;
  };

  if (r.freq === "daily" || r.freq === "monthly") {
    for (let k = 0; k < CAP; k++) {
      const d = r.freq === "daily" ? addDays(dtstart, k * interval) : addMonths(dtstart, k * interval);
      if (d > winEnd) break; // monotonic: no further in-window occurrences
      if (!consider(d, k)) break;
    }
  } else {
    // weekly
    const days = (r.byweekday ? r.byweekday.split(",").map(Number) : [mondayIdx(dtstart)])
      .filter((n) => n >= 0 && n <= 6)
      .sort((a, b) => a - b);
    const week0 = addDays(dtstart, -mondayIdx(dtstart)); // Monday of dtstart's week
    let idx = 0;
    for (let w = 0; w < CAP; w++) {
      const ws = addDays(week0, w * 7);
      if (ws > winEnd) break;
      if (w % interval !== 0) continue;
      let ended = false;
      for (const wd of days) {
        const d = addDays(ws, wd);
        if (d < dtstart) continue; // before the series actually starts
        if (!consider(d, idx)) { ended = true; break; }
        idx++;
      }
      if (ended) break;
    }
  }
  return out;
}
