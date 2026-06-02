import { config } from "../config.js";

/* ============================================================
   intervals.icu read layer.
   One personal API key (HTTP Basic, username literally "API_KEY").
   We pull three things and merge them into one payload:
     - sport-settings  -> FTP + power/HR zones
     - wellness         -> sleep / HRV / resting-HR / weight
     - activities       -> TSS (icu_training_load) + CTL/ATL/form
   CTL/ATL live on each activity (icu_ctl/icu_atl), so current
   fitness/fatigue survive even when the daily wellness rows have
   null ctl/atl (which they do during a sync gap).
   ============================================================ */

export type FitnessZone = { name: string; from: number; to: number | null }; // watts
export type HrZone = { name: string; from: number; to: number | null }; // bpm

export type WellnessPoint = {
  date: string; // YYYY-MM-DD
  sleepSecs: number | null;
  sleepScore: number | null;
  hrv: number | null;
  restingHR: number | null;
};

export type RecentActivity = {
  id: string;
  date: string; // YYYY-MM-DD (local)
  type: string;
  name: string;
  load: number | null; // TSS
  durationSec: number | null;
  avgHr: number | null;
  calories: number | null;
};

export type FitnessPayload = {
  asOf: string; // when we fetched
  staleDays: number | null; // days since most recent activity, null if none
  load: {
    ctl: number | null; // fitness
    atl: number | null; // fatigue
    form: number | null; // TSB = ctl - atl
    asOf: string | null; // date of the activity these came from
    last7Tss: number;
    last42Tss: number;
  };
  ftp: {
    value: number | null;
    wPrime: number | null;
    zones: FitnessZone[]; // watts
  };
  hr: {
    lthr: number | null;
    maxHr: number | null;
    restingHr: number | null;
    zones: HrZone[]; // bpm
  };
  wellness: {
    date: string | null; // date of most recent record in window
    restingHR: number | null;
    hrv: number | null;
    sleepSecs: number | null;
    sleepScore: number | null;
    weight: number | null;
    series: WellnessPoint[]; // last 14 days, chronological
  };
  recent: RecentActivity[];
};

type Cached = { payload: FitnessPayload; expires: number };
let cached: Cached | null = null;
const TTL_MS = 10 * 60 * 1000; // training data barely moves; 10 min is plenty

const DAY_MS = 24 * 3600 * 1000;

// intervals.icu wants a local datetime for activity windows; plain dates
// silently return []. We anchor to UTC midnight which is close enough for windowing.
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dateTime = (d: Date) => isoDate(d) + "T00:00:00";

async function api<T>(path: string): Promise<T> {
  if (!config.intervals) throw new Error("intervals.icu not configured");
  const auth = Buffer.from(`API_KEY:${config.intervals.apiKey}`).toString("base64");
  const url = `https://intervals.icu/api/v1/athlete/${config.intervals.athleteId}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`intervals.icu ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Most recent non-null value of `key` scanning newest-first.
const latestNonNull = <T,>(rows: any[], key: string): T | null => {
  for (const r of rows) if (r[key] !== null && r[key] !== undefined) return r[key] as T;
  return null;
};

const round = (n: number | null | undefined, dp = 1): number | null =>
  typeof n === "number" ? Math.round(n * 10 ** dp) / 10 ** dp : null;

function buildZones(ftp: number | null, pcts: number[] | null, names: string[] | null): FitnessZone[] {
  if (!ftp || !pcts?.length) return [];
  const zones: FitnessZone[] = [];
  let prevPct = 0;
  pcts.forEach((pct, i) => {
    const from = Math.round((prevPct / 100) * ftp);
    // 999 (or anything absurd) means "open-ended top zone".
    const to = pct >= 999 ? null : Math.round((pct / 100) * ftp);
    zones.push({ name: names?.[i] ?? `Z${i + 1}`, from, to });
    prevPct = pct;
  });
  return zones;
}

// HR zones come straight from intervals as bpm upper-bounds; we just pair them
// with names. %HRR is derived on the frontend (it needs resting HR).
function buildHrZones(bpms: number[] | null, names: string[] | null): HrZone[] {
  if (!bpms?.length) return [];
  const zones: HrZone[] = [];
  let prev = 0;
  bpms.forEach((bpm, i) => {
    const to = bpm >= 999 ? null : bpm;
    zones.push({ name: names?.[i] ?? `Z${i + 1}`, from: prev, to });
    prev = bpm;
  });
  return zones;
}

export async function getFitness(): Promise<FitnessPayload> {
  if (!config.intervals) throw new Error("intervals.icu not configured");
  if (cached && Date.now() < cached.expires) return cached.payload;

  const now = new Date();
  const wellnessOldest = isoDate(new Date(+now - 30 * DAY_MS));
  const actOldest = dateTime(new Date(+now - 45 * DAY_MS));
  const actNewest = dateTime(new Date(+now + DAY_MS));

  const [settings, wellness, activities] = await Promise.all([
    api<any[]>(`/sport-settings`),
    api<any[]>(`/wellness?oldest=${wellnessOldest}&newest=${isoDate(now)}`),
    api<any[]>(`/activities?oldest=${actOldest}&newest=${actNewest}`),
  ]);

  // newest-first ordering for both, defensively.
  const acts = [...activities].sort((a, b) =>
    String(b.start_date_local).localeCompare(String(a.start_date_local)),
  );
  const wel = [...wellness].sort((a, b) => String(b.id).localeCompare(String(a.id)));

  // --- Training load: from the most recent activity carrying ctl/atl ---
  const loadSrc = acts.find((a) => a.icu_ctl !== null && a.icu_ctl !== undefined);
  const welLoad = wel.find((w) => w.ctl !== null && w.ctl !== undefined);
  const ctl = loadSrc ? round(loadSrc.icu_ctl) : round(welLoad?.ctl);
  const atl = loadSrc ? round(loadSrc.icu_atl) : round(welLoad?.atl);
  const form = ctl !== null && atl !== null ? round(ctl - atl) : null;
  const loadAsOf = loadSrc ? String(loadSrc.start_date_local).slice(0, 10) : welLoad?.id ?? null;

  const sumTss = (sinceDays: number) => {
    const cutoff = +now - sinceDays * DAY_MS;
    return acts.reduce((sum, a) => {
      const t = new Date(a.start_date_local).getTime();
      return t >= cutoff && typeof a.icu_training_load === "number" ? sum + a.icu_training_load : sum;
    }, 0);
  };

  const latestActDate = acts[0] ? new Date(acts[0].start_date_local).getTime() : null;
  const staleDays = latestActDate !== null ? Math.floor((+now - latestActDate) / DAY_MS) : null;

  // --- FTP + power zones: the cycling sport-settings row ---
  const ride =
    settings.find((s) => Array.isArray(s.types) && s.types.includes("Ride")) ?? settings[0] ?? {};
  const ftpVal = typeof ride.ftp === "number" ? ride.ftp : null;

  // --- Wellness: latest non-null per metric (gaps are common) ---
  const restingHr = latestNonNull<number>(wel, "restingHR");

  // 14-day series for the recovery chart, chronological, one slot per day.
  const seriesStart = +now - 13 * DAY_MS;
  const byDate = new Map(wel.map((w) => [String(w.id), w]));
  const series: WellnessPoint[] = [];
  for (let i = 0; i < 14; i++) {
    const date = isoDate(new Date(seriesStart + i * DAY_MS));
    const w = byDate.get(date);
    series.push({
      date,
      sleepSecs: typeof w?.sleepSecs === "number" ? w.sleepSecs : null,
      sleepScore: round(w?.sleepScore, 0),
      hrv: round(w?.hrv),
      restingHR: typeof w?.restingHR === "number" ? w.restingHR : null,
    });
  }

  const payload: FitnessPayload = {
    asOf: now.toISOString(),
    staleDays,
    load: {
      ctl,
      atl,
      form,
      asOf: loadAsOf,
      last7Tss: Math.round(sumTss(7)),
      last42Tss: Math.round(sumTss(42)),
    },
    ftp: {
      value: ftpVal,
      wPrime: typeof ride.w_prime === "number" ? ride.w_prime : null,
      zones: buildZones(ftpVal, ride.power_zones ?? null, ride.power_zone_names ?? null),
    },
    hr: {
      lthr: typeof ride.lthr === "number" ? ride.lthr : null,
      maxHr: typeof ride.max_hr === "number" ? ride.max_hr : null,
      restingHr,
      zones: buildHrZones(ride.hr_zones ?? null, ride.hr_zone_names ?? null),
    },
    wellness: {
      date: wel[0]?.id ?? null,
      restingHR: restingHr,
      hrv: round(latestNonNull<number>(wel, "hrv")),
      sleepSecs: latestNonNull<number>(wel, "sleepSecs"),
      sleepScore: round(latestNonNull<number>(wel, "sleepScore"), 0),
      weight: round(latestNonNull<number>(wel, "weight")),
      series,
    },
    recent: acts.slice(0, 8).map((a) => ({
      id: String(a.id),
      date: String(a.start_date_local).slice(0, 10),
      type: String(a.type ?? "Workout"),
      name: String(a.name ?? a.type ?? "Workout"),
      load: typeof a.icu_training_load === "number" ? a.icu_training_load : null,
      durationSec: typeof a.moving_time === "number" ? a.moving_time : null,
      avgHr: typeof a.average_heartrate === "number" ? Math.round(a.average_heartrate) : null,
      calories: typeof a.calories === "number" ? a.calories : null,
    })),
  };

  cached = { payload, expires: Date.now() + TTL_MS };
  return payload;
}
