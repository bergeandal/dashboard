import { config } from "../config.js";

export type WeatherDay = {
  d: string;        // "Mon", "Tue", ...
  date: string;     // YYYY-MM-DD
  icon: string;     // emoji approximation of YR symbol_code
  hi: number;
  lo: number;
  pop: number;      // % probability of precipitation
};

export type WeatherPayload = {
  place: string;
  asOf: string;
  note: string;
  days: WeatherDay[];
};

type Cached = { payload: WeatherPayload; expires: number };
let cached: Cached | null = null;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Map YR symbol_code to a single emoji. YR has ~100 variants
// (e.g. "partlycloudy_day", "lightrainshowers_night"); we coarse-bucket.
const symbolToEmoji = (code: string): string => {
  if (!code) return "·";
  if (code.includes("thunder")) return "⛈";
  if (code.includes("sleet") || code.includes("snow")) return "❄";
  if (code.includes("heavyrain")) return "🌧";
  if (code.includes("rain") && code.includes("showers")) return "🌦";
  if (code.includes("rain")) return "🌧";
  if (code.includes("fog")) return "🌫";
  if (code.startsWith("clearsky")) return "☀";
  if (code.startsWith("fair")) return "🌤";
  if (code.startsWith("partlycloudy")) return "⛅";
  if (code.startsWith("cloudy")) return "☁";
  return "·";
};

const osloDateStr = (d: Date): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const osloWeekday = (d: Date): string => {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", weekday: "short" }).format(d);
  return wd; // "Mon", "Tue", ...
};

export async function getWeather(): Promise<WeatherPayload> {
  if (cached && Date.now() < cached.expires) return cached.payload;

  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.lat}&lon=${config.lon}`;
  const res = await fetch(url, {
    headers: { "User-Agent": config.yrUserAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`YR.no fetch failed: ${res.status}`);
  const json: any = await res.json();

  // Bucket timeseries entries by Oslo-local date.
  const byDate = new Map<string, { temps: number[]; pops: number[]; symbols: Map<string, number> }>();
  for (const ts of json.properties.timeseries as any[]) {
    const t = new Date(ts.time);
    const dateStr = osloDateStr(t);
    if (!byDate.has(dateStr)) byDate.set(dateStr, { temps: [], pops: [], symbols: new Map() });
    const bucket = byDate.get(dateStr)!;

    const inst = ts.data.instant?.details;
    if (inst && typeof inst.air_temperature === "number") bucket.temps.push(inst.air_temperature);

    const next6 = ts.data.next_6_hours;
    if (next6) {
      if (typeof next6.details?.probability_of_precipitation === "number") {
        bucket.pops.push(next6.details.probability_of_precipitation);
      }
      const sym = next6.summary?.symbol_code;
      if (sym) bucket.symbols.set(sym, (bucket.symbols.get(sym) ?? 0) + 1);
    }
  }

  const todayOslo = osloDateStr(new Date());
  const days: WeatherDay[] = [];
  for (const [date, b] of byDate) {
    if (date < todayOslo) continue;
    if (days.length >= 7) break;
    const hi = b.temps.length ? Math.round(Math.max(...b.temps)) : 0;
    const lo = b.temps.length ? Math.round(Math.min(...b.temps)) : 0;
    const pop = b.pops.length ? Math.round(Math.max(...b.pops)) : 0;
    let topSym = "";
    let topCount = -1;
    for (const [s, c] of b.symbols) if (c > topCount) { topSym = s; topCount = c; }
    days.push({
      d: osloWeekday(new Date(date + "T12:00:00Z")),
      date,
      icon: symbolToEmoji(topSym),
      hi, lo, pop,
    });
  }

  const payload: WeatherPayload = {
    place: "Bergen",
    asOf: new Date().toISOString(),
    note: "Live from YR.no / MET Norway.",
    days,
  };

  // Honor Expires header; fall back to 30 min.
  const exp = res.headers.get("expires");
  const expires = exp ? new Date(exp).getTime() : Date.now() + 30 * 60 * 1000;
  cached = { payload, expires };

  return payload;
}
