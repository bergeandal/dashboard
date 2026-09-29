import { config } from "../config.js";

// Public-transport routing via Entur — Norway's national journey planner
// (the data behind every Skyss/Bybanen departure board). Free and open: no API
// key, just an identifying ET-Client-Name header — the same "be polite, no
// secret" model as our YR weather call. Two endpoints are used:
//   geocoder    — address text -> coordinates (resolved once when a place is saved)
//   journey-planner v3 (GraphQL) — coordinates -> a real transit trip with legs
// Docs: https://developer.entur.org/

const GEOCODER = "https://api.entur.io/geocoder/v1/autocomplete";
const JOURNEY = "https://api.entur.io/journey-planner/v3/graphql";

const headers = () => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  "ET-Client-Name": config.enturClientName,
});

export type Coord = { lat: number; lon: number };

export type GeoResult = { label: string; lat: number; lon: number };

// Resolve a free-text address (e.g. "Nattlandsveien 64, 5093 Bergen") to a
// single best coordinate. Returns null when Entur finds nothing.
export async function geocode(text: string): Promise<GeoResult | null> {
  const url = `${GEOCODER}?text=${encodeURIComponent(text)}&lang=no&size=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Entur geocoder failed: ${res.status}`);
  const json: any = await res.json();
  const f = json?.features?.[0];
  if (!f?.geometry?.coordinates) return null;
  const [lon, lat] = f.geometry.coordinates; // GeoJSON order is [lon, lat]
  return { label: f.properties?.label ?? text, lat, lon };
}

export type TripLeg = {
  mode: string;        // "foot", "bus", "tram", "rail", "metro", "water", ...
  line: string;        // public code, e.g. "12" (empty for walking legs)
  name: string;        // human label, e.g. "Bus 12 Lyngbø"
  from: string;        // boarding stop name
  to: string;          // alighting stop name
  start: string;       // ISO, expected departure of this leg
  end: string;         // ISO, expected arrival of this leg
  durationMin: number;
  distanceM: number;
};

export type Trip = {
  start: string;       // ISO, when you leave the origin
  end: string;         // ISO, when you arrive at the destination
  durationMin: number; // door-to-door, rounded up
  walkMin: number;     // total walking minutes
  transfers: number;   // number of vehicle boardings minus one (>= 0)
  legs: TripLeg[];
};

const TRIP_QUERY = `
query Trip($from: Location!, $to: Location!, $dateTime: DateTime!, $arriveBy: Boolean!) {
  trip(from: $from, to: $to, dateTime: $dateTime, arriveBy: $arriveBy, numTripPatterns: 1) {
    tripPatterns {
      duration
      walkDistance
      expectedStartTime
      expectedEndTime
      legs {
        mode
        distance
        duration
        expectedStartTime
        expectedEndTime
        fromPlace { name }
        toPlace { name }
        line { publicCode name }
      }
    }
  }
}`;

type PlanOpts = {
  // Aim to arrive by this instant (ISO). The "conservative" lever: we shift the
  // target earlier by arriveBufferMin so the planned trip lands a little before
  // the event actually starts.
  arriveBy?: string;
  // Or: depart this instant (ISO) — used for the return leg, which leaves once
  // the event ends. We add departBufferMin first, since nobody teleports to the
  // platform the second they clock out. arriveBy takes precedence if both given.
  departAt?: string;
  arriveBufferMin?: number; // default 5
  departBufferMin?: number; // default 8
};

// Cache transit lookups briefly. A home->work trip's structure barely changes
// minute-to-minute, and this keeps us light on Entur (and fast on reload).
type Cached = { trip: Trip | null; expires: number };
const cache = new Map<string, Cached>();
const TTL_MS = 10 * 60 * 1000;

export async function planTrip(from: Coord, to: Coord, opts: PlanOpts = {}): Promise<Trip | null> {
  const arriveBy = !!opts.arriveBy;
  // arriveBy: shift target earlier by the buffer. departAt: leave a touch after
  // (pack up + walk to the stop). Neither: plan from now.
  const targetMs = opts.arriveBy
    ? Date.parse(opts.arriveBy) - (opts.arriveBufferMin ?? 5) * 60000
    : opts.departAt ? Date.parse(opts.departAt) + (opts.departBufferMin ?? 8) * 60000 : Date.now();
  // Bucket the target time to the cache TTL so repeated loads share a result.
  const bucket = Math.floor(targetMs / TTL_MS);
  const key = `${from.lat},${from.lon}>${to.lat},${to.lon}@${arriveBy ? "arr" : "dep"}:${bucket}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.trip;

  const dateTime = new Date(targetMs).toISOString();
  const variables = {
    from: { coordinates: { latitude: from.lat, longitude: from.lon } },
    to: { coordinates: { latitude: to.lat, longitude: to.lon } },
    dateTime,
    arriveBy,
  };

  const res = await fetch(JOURNEY, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query: TRIP_QUERY, variables }),
  });
  if (!res.ok) throw new Error(`Entur journey planner failed: ${res.status}`);
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(`Entur query error: ${json.errors[0]?.message ?? "unknown"}`);

  const pattern = json?.data?.trip?.tripPatterns?.[0];
  const trip = pattern ? toTrip(pattern) : null;
  cache.set(key, { trip, expires: Date.now() + TTL_MS });
  return trip;
}

const ceilMin = (seconds: number) => Math.max(0, Math.ceil(seconds / 60));

function toTrip(p: any): Trip {
  const legs: TripLeg[] = (p.legs ?? []).map((l: any): TripLeg => ({
    mode: l.mode ?? "",
    line: l.line?.publicCode ?? "",
    name: legName(l),
    from: l.fromPlace?.name ?? "",
    to: l.toPlace?.name ?? "",
    start: l.expectedStartTime ?? "",
    end: l.expectedEndTime ?? "",
    durationMin: ceilMin(l.duration ?? 0),
    distanceM: Math.round(l.distance ?? 0),
  }));
  const transit = legs.filter((l) => l.mode && l.mode !== "foot");
  const walkMin = legs.filter((l) => l.mode === "foot").reduce((s, l) => s + l.durationMin, 0);
  return {
    start: p.expectedStartTime ?? legs[0]?.start ?? "",
    end: p.expectedEndTime ?? legs[legs.length - 1]?.end ?? "",
    durationMin: ceilMin(p.duration ?? 0),
    walkMin,
    transfers: Math.max(0, transit.length - 1),
    legs,
  };
}

function legName(l: any): string {
  if (l.mode === "foot") return "Walk";
  const code = l.line?.publicCode ? `${l.line.publicCode}` : "";
  const verb = l.mode === "tram" ? "Bybanen" : l.mode === "bus" ? "Bus" : l.mode === "rail" ? "Train" : (l.mode ?? "");
  return [verb, code, l.line?.name].filter(Boolean).join(" ").trim() || "Transit";
}
