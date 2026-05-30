import { config } from "../config.js";

export type WeatherHour = {
  hour: string;     // "HH:00" Oslo local
  icon: string;
  temp: number;
  precip: number;   // mm next 1h
  wind: number;     // m/s
};

export type WeatherDay = {
  d: string;        // "Mon", "Tue", ...
  date: string;     // YYYY-MM-DD
  icon: string;
  hi: number;
  lo: number;
  pop: number;      // % probability of precipitation
  hours: WeatherHour[];
};

export type WeatherPayload = {
  place: string;
  asOf: string;
  note: string;
  days: WeatherDay[];
};

type Cached = { payload: WeatherPayload; expires: number };
let cached: Cached | null = null;

const symbolToEmoji = (code: string): string => {
  if (!code) return "·";
  if (code.includes("thunder")) return "⛈️";
  if (code.includes("sleet") || code.includes("snow")) return "❄️";
  if (code.includes("heavyrain")) return "🌧️";
  if (code.includes("rain") && code.includes("showers")) return "🌦️";
  if (code.includes("rain")) return "🌧️";
  if (code.includes("fog")) return "🌫️";
  if (code.startsWith("clearsky")) return "☀️";
  if (code.startsWith("fair")) return "🌤️";
  if (code.startsWith("partlycloudy")) return "⛅️";
  if (code.startsWith("cloudy")) return "☁️";
  return "·";
};

const osloParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: `${get("hour")}:00`,
  };
};

const osloWeekday = (d: Date): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", weekday: "short" }).format(d);

type DayBucket = {
  temps: number[];
  pops: number[];
  symbols: Map<string, number>;
  hours: WeatherHour[];
};

export async function getWeather(): Promise<WeatherPayload> {
  if (cached && Date.now() < cached.expires) return cached.payload;

  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.lat}&lon=${config.lon}`;
  const res = await fetch(url, {
    headers: { "User-Agent": config.yrUserAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`YR.no fetch failed: ${res.status}`);
  const json: any = await res.json();

  const byDate = new Map<string, DayBucket>();
  for (const ts of json.properties.timeseries as any[]) {
    const t = new Date(ts.time);
    const { date, hour } = osloParts(t);
    if (!byDate.has(date)) byDate.set(date, { temps: [], pops: [], symbols: new Map(), hours: [] });
    const bucket = byDate.get(date)!;

    const inst = ts.data.instant?.details;
    const temp = typeof inst?.air_temperature === "number" ? inst.air_temperature : null;
    const wind = typeof inst?.wind_speed === "number" ? inst.wind_speed : 0;
    if (temp !== null) bucket.temps.push(temp);

    const next1 = ts.data.next_1_hours;
    const next6 = ts.data.next_6_hours;

    const sym1 = next1?.summary?.symbol_code;
    const sym6 = next6?.summary?.symbol_code;
    const precip = typeof next1?.details?.precipitation_amount === "number"
      ? next1.details.precipitation_amount : 0;

    // Roll daily aggregates from the 6-hour buckets.
    if (next6) {
      if (typeof next6.details?.probability_of_precipitation === "number") {
        bucket.pops.push(next6.details.probability_of_precipitation);
      }
      if (sym6) bucket.symbols.set(sym6, (bucket.symbols.get(sym6) ?? 0) + 1);
    }

    // YR returns hourly resolution for ~48h, then 6h. Only push hourly when next_1_hours exists.
    if (next1 && temp !== null) {
      bucket.hours.push({
        hour,
        icon: symbolToEmoji(sym1 || sym6 || ""),
        temp: Math.round(temp),
        precip: Math.round(precip * 10) / 10,
        wind: Math.round(wind),
      });
    }
  }

  const todayOslo = osloParts(new Date()).date;
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
      hours: b.hours,
    });
  }

  const payload: WeatherPayload = {
    place: "Bergen",
    asOf: new Date().toISOString(),
    note: "Live from YR.no / MET Norway.",
    days,
  };

  const exp = res.headers.get("expires");
  const expires = exp ? new Date(exp).getTime() : Date.now() + 30 * 60 * 1000;
  cached = { payload, expires };

  return payload;
}
