import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, type Category, type ProfileId, type CalMap, CAL_CATS, envCalendars, intervalsFor, birthdaysFor } from "./config.js";
import { fetchAllTasks, fetchBirthdays } from "./calendar/fetch.js";
import { getWeather } from "./weather/yr.js";
import { getFitness } from "./fitness/intervals.js";
import { geocode, planTrip } from "./transit/entur.js";
import { expandRecurrence } from "./recurrence.js";
import { dbo } from "./db.js";
import {
  authEnabled, COOKIE, COOKIE_MAX_AGE, issueToken, verifyToken, checkPasscode, parseCookie,
  isValidPin, hashPin, checkPin, issueUnlock, verifyUnlock,
} from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true, credentials: true });

// Trusted-device gate: every /api/* call (except the gate itself + health)
// needs a valid auth cookie. Static SPA assets stay open so the login screen
// can load. No-op when DECK_PASSCODE is unset (local dev).
const OPEN_API = new Set(["/api/login", "/api/logout", "/api/health"]);

// The device's session, or null if signed out. A device that belongs to a
// profile is signed out once that profile's sign-out epoch moves past the one
// in its cookie. (If the owner profile was removed, the device just has no owner.)
const sessionOf = (req: { headers: { cookie?: string } }) => {
  const s = verifyToken(parseCookie(req.headers.cookie, COOKIE));
  if (!s?.owner) return s;
  const p = dbo.getProfile(s.owner);
  if (!p) return { owner: "", epoch: 0 };
  return s.epoch === p.session_epoch ? s : null;
};
app.addHook("onRequest", async (req, reply) => {
  if (!authEnabled) return;
  const path = req.url.split("?")[0];
  if (!path.startsWith("/api/")) return;      // SPA + assets served openly
  if (OPEN_API.has(path)) return;
  // The login screen lists profiles (names + colors only) before sign-in.
  if (path === "/api/profiles" && req.method === "GET") return;
  if (sessionOf(req)) return;
  return reply.code(401).send({ error: "unauthorized" });
});

// --- Profile PIN gate ---
// A PIN-protected profile's data is readable/writable only by the device it
// was set up for (the cookie's owner) or with a fresh unlock token (header
// X-Profile-Unlock, from POST /api/profiles/:id/unlock). Profiles without a
// PIN, and shared items, are open to every trusted device.
const ownerOf = (req: { headers: { cookie?: string } }): string => sessionOf(req)?.owner ?? "";

const canAccess = (req: { headers: Record<string, any> }, profileId: string): boolean => {
  const p = dbo.getProfile(profileId);
  if (!p?.pin_hash) return true;
  if (ownerOf(req) === profileId) return true;
  return verifyUnlock(req.headers["x-profile-unlock"], profileId, p.pin_hash, p.session_epoch);
};

// Which profile a request touches, per route; null = nothing profile-private.
// Every route that reads or writes profile data must be listed here.
const touchedProfile = (req: any): string | null => {
  const route: string = req.routeOptions?.url ?? "";
  const id: string | undefined = req.params?.id;
  switch (route) {
    case "/api/data":
    case "/api/fitness":
      return reqProfile(req.query?.profile);
    case "/api/tasks":
    case "/api/tasks/import":
    case "/api/recurrences":
    case "/api/todos":
    case "/api/todos/clear":
      return req.method === "POST" ? reqProfile(req.body?.profile) : null;
    case "/api/tasks/:id": {
      const t = dbo.listLocalTasks().find((x) => x.id === id);
      return t && !t.shared ? t.profile : null;
    }
    case "/api/recurrences/:id":
    case "/api/recurrences/:id/skip":
    case "/api/recurrences/:id/truncate":
    case "/api/recurrences/:id/split": {
      const r = id ? dbo.getRecurrence(id) : undefined;
      return r && !r.shared ? r.profile : null;
    }
    case "/api/todos/:id":
      return (id && dbo.getTodo(id)?.profile) || null;
    case "/api/profiles/:id":
    case "/api/profiles/:id/pin":
    case "/api/profiles/:id/signout":
      return id ?? null;
    default:
      return null;
  }
};

app.addHook("preHandler", async (req, reply) => {
  const p = touchedProfile(req);
  if (p && !canAccess(req, p)) return reply.code(403).send({ error: "locked", profile: p });
});

const setAuthCookie = (req: { headers: Record<string, unknown> }, reply: { header: (k: string, v: string) => void }, value: string, maxAge: number) => {
  const secure = req.headers["x-forwarded-proto"] === "https";
  reply.header("Set-Cookie",
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
};

const publicDir = join(__dirname, "..", "public");
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.code(404).send({ error: "Not Found", message: `Route ${req.method}:${req.url} not found`, statusCode: 404 });
    } else {
      reply.sendFile("index.html");
    }
  });
}

const parseDate = (s: string | undefined, fallback: Date): Date => {
  if (!s) return fallback;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(+d) ? fallback : d;
};

// Must match the categories the add UI offers (CATS in App.jsx), or those
// picks fail validation and the add silently no-ops.
const VALID_CATS: Category[] = ["work", "training", "social", "home", "birthday", "event"];
const isCat = (s: unknown): s is Category =>
  typeof s === "string" && (VALID_CATS as string[]).includes(s);

// Active profile from a request (query or body); unknown ids fall back to the
// oldest profile (normally Berge).
const reqProfile = (v: unknown): ProfileId =>
  (typeof v === "string" && dbo.getProfile(v) ? v : dbo.listProfiles()[0].id);

// A profile's Google calendars: URLs saved in the DB win, env vars fill the rest.
const profileCalendars = (p: ProfileId): CalMap => {
  const row = dbo.getProfile(p);
  const cals: CalMap = envCalendars(p);
  for (const cat of CAL_CATS) if (row?.[`ics_${cat}`]) cals[cat] = row[`ics_${cat}`];
  return cals;
};
// A row is visible to a profile if it belongs to that profile or is shared.
const visibleTo = (p: ProfileId) => (r: { profile: string; shared: number }) => r.profile === p || !!r.shared;

// `version` lets an open app notice a deploy and reload into the new code.
// Fly sets FLY_IMAGE_REF per deployed image; locally, each server start counts.
const VERSION = process.env.FLY_IMAGE_REF || `dev-${Date.now()}`;
app.get("/api/health", async () => ({ ok: true, version: VERSION }));

// --- Auth (trusted device) ---
// The chosen profile becomes the device's owner (opens without its PIN here),
// so a PIN-protected profile must prove its PIN at sign-in.
app.post("/api/login", async (req, reply) => {
  const b = req.body as { passcode?: unknown; profile?: unknown; pin?: unknown };
  if (!checkPasscode(b?.passcode)) { reply.code(401); return { error: "wrong passcode" }; }
  const profile = typeof b?.profile === "string" ? dbo.getProfile(b.profile) : undefined;
  if (profile?.pin_hash) {
    const r = checkPin(profile.id, profile.pin_hash, b.pin);
    if (r !== "ok") {
      reply.code(r === "throttled" ? 429 : 401);
      return { error: r === "throttled" ? "too many tries — wait 5 min" : "wrong PIN", pin: true };
    }
  }
  setAuthCookie(req, reply, issueToken(profile?.id ?? "", profile?.session_epoch ?? 0), COOKIE_MAX_AGE);
  return { ok: true };
});

// Which profile this device belongs to ("" for devices trusted before profiles had owners).
app.get("/api/session", async (req) => ({ owner: ownerOf(req) }));

app.post("/api/logout", async (req, reply) => {
  setAuthCookie(req, reply, "", 0);
  return { ok: true };
});

app.get("/api/data", async (req) => {
  const q = req.query as { start?: string; days?: string; profile?: string };
  const profile = reqProfile(q.profile);
  const now = new Date();
  const start = parseDate(q.start, now);
  const days = Math.min(Math.max(Number(q.days ?? 60), 7), 120);
  const end = new Date(+start + days * 24 * 3600 * 1000);

  const birthdaysEnd = new Date(+start + 365 * 24 * 3600 * 1000);
  const [tasks, birthdays, weather] = await Promise.all([
    fetchAllTasks(profileCalendars(profile), start, end),
    birthdaysFor(profile) ? fetchBirthdays(birthdaysFor(profile), start, birthdaysEnd) : [],
    getWeather().catch((e) => { app.log.error(e); return null; }),
  ]);

  // Expand recurring series into virtual task instances within the window.
  const winStart = start.toISOString().slice(0, 10);
  const winEnd = end.toISOString().slice(0, 10);
  const exMap = new Map<string, Set<string>>();
  for (const e of dbo.listExceptions()) {
    if (!exMap.has(e.series_id)) exMap.set(e.series_id, new Set());
    exMap.get(e.series_id)!.add(e.date);
  }
  const recurringTasks = dbo.listRecurrences().filter(visibleTo(profile)).flatMap((r) => {
    const skip = exMap.get(r.id);
    return expandRecurrence(r, winStart, winEnd)
      .filter((date) => !skip?.has(date))
      .map((date) => ({
        id: `rec:${r.id}:${date}`, date, start: r.start, end: r.end,
        title: r.title, cat: r.cat, note: r.note, sport: r.sport, tss: r.tss,
        recurring: true, seriesId: r.id, shared: r.shared,
        location: r.location,
      }));
  });

  return {
    tasks: [...tasks, ...recurringTasks],
    birthdays,
    localTasks: dbo.listLocalTasks().filter(visibleTo(profile)),
    todos: dbo.listTodos(profile),
    doneIds: dbo.listDoneIds(),
    weather,
    fetchedAt: new Date().toISOString(),
  };
});

app.get("/api/weather", async () => getWeather());

// --- Profiles ---
// Palette keys the UI knows how to render (PALETTES in App.jsx).
const THEMES = ["denim", "rose", "sage", "plum", "amber", "teal", "slate", "coral"];

// Public shape: never echoes the secret calendar URLs, just which are connected.
app.get("/api/profiles", async () =>
  dbo.listProfiles().map((p) => ({
    id: p.id, name: p.name, theme: p.theme,
    calendars: Object.keys(profileCalendars(p.id)),
    fitness: !!intervalsFor(p.id),
    hasPin: !!p.pin_hash,
  })));

app.post("/api/profiles", async (req, reply) => {
  const b = req.body as any;
  const name = String(b?.name ?? "").trim().slice(0, 30);
  if (!name) { reply.code(400); return { error: "name required" }; }
  const theme = THEMES.includes(b?.theme) ? b.theme : "denim";
  const cals = (b?.calendars ?? {}) as Record<string, unknown>;
  const ics: Record<string, string> = {};
  for (const cat of CAL_CATS) {
    const url = String(cals[cat] ?? "").trim();
    if (url && !/^https?:\/\//i.test(url)) { reply.code(400); return { error: `${cat} calendar must be an http(s) URL` }; }
    ics[`ics_${cat}`] = url;
  }
  // Id is a URL-safe slug of the name, suffixed if taken ("anna", "anna-2").
  const base = name.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
  let id = base;
  for (let n = 2; dbo.getProfile(id); n++) id = `${base}-${n}`;
  const profile = { id, name, theme, ...ics, pin_hash: "" } as Parameters<typeof dbo.insertProfile>[0];
  dbo.insertProfile(profile);
  return { id, name, theme, calendars: Object.keys(profileCalendars(id)), fitness: !!intervalsFor(id), hasPin: false };
});

app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (req, reply) => {
  if (!dbo.getProfile(req.params.id)) { reply.code(404); return { error: "profile not found" }; }
  if (dbo.listProfiles().length <= 1) { reply.code(400); return { error: "can't remove the last profile" }; }
  dbo.deleteProfile(req.params.id);
  return { ok: true };
});

// Rename / re-colour a profile (the long-press settings sheet).
app.patch<{ Params: { id: string } }>("/api/profiles/:id", async (req, reply) => {
  const p = dbo.getProfile(req.params.id);
  if (!p) { reply.code(404); return { error: "profile not found" }; }
  const b = req.body as any;
  const name = b?.name !== undefined ? String(b.name).trim().slice(0, 30) : p.name;
  if (!name) { reply.code(400); return { error: "name required" }; }
  const theme = b?.theme !== undefined ? (THEMES.includes(b.theme) ? b.theme : null) : p.theme;
  if (!theme) { reply.code(400); return { error: "unknown theme" }; }
  dbo.updateProfile(p.id, name, theme);
  return { ok: true, name, theme };
});

// Sign out every OTHER device that belongs to this profile, and void any open
// PIN unlocks for it. The device asking keeps its session (re-issued on the new
// epoch if it is one of the profile's own devices).
const signOutOthers = (req: any, reply: any, profileId: string) => {
  const ownDevice = ownerOf(req) === profileId;
  dbo.bumpProfileEpoch(profileId);
  const p = dbo.getProfile(profileId)!;
  if (ownDevice) setAuthCookie(req, reply, issueToken(profileId, p.session_epoch), COOKIE_MAX_AGE);
  return p;
};

app.post<{ Params: { id: string } }>("/api/profiles/:id/signout", async (req, reply) => {
  if (!dbo.getProfile(req.params.id)) { reply.code(404); return { error: "profile not found" }; }
  const p = signOutOthers(req, reply, req.params.id);
  return { ok: true, unlock: p.pin_hash ? issueUnlock(p.id, p.pin_hash, p.session_epoch) : null };
});

// Set, change ("pin": "1234") or remove ("pin": "") a profile's PIN. The gate
// above already required access to the profile (owner device or unlocked).
// A new PIN also signs out the profile's other devices: whoever knew the old
// PIN (or was signed in as this profile) has to sign in again.
app.put<{ Params: { id: string } }>("/api/profiles/:id/pin", async (req, reply) => {
  if (!dbo.getProfile(req.params.id)) { reply.code(404); return { error: "profile not found" }; }
  const pin = String((req.body as any)?.pin ?? "");
  if (pin && !isValidPin(pin)) { reply.code(400); return { error: "PIN must be 4–6 digits" }; }
  const hash = pin ? hashPin(pin) : "";
  dbo.setProfilePin(req.params.id, hash);
  const p = pin ? signOutOthers(req, reply, req.params.id) : dbo.getProfile(req.params.id)!;
  // Hand back a fresh unlock so the device that just set it stays in.
  return { ok: true, hasPin: !!pin, unlock: hash ? issueUnlock(p.id, hash, p.session_epoch) : null };
});

// Enter a profile's PIN for this visit. claim:true also makes this device the
// profile's owner, so it stops asking here (re-issues the device cookie).
app.post<{ Params: { id: string } }>("/api/profiles/:id/unlock", async (req, reply) => {
  const p = dbo.getProfile(req.params.id);
  if (!p) { reply.code(404); return { error: "profile not found" }; }
  if (!p.pin_hash) return { unlock: null };
  const b = req.body as { pin?: unknown; claim?: unknown };
  const r = checkPin(p.id, p.pin_hash, b?.pin);
  if (r === "throttled") { reply.code(429); return { error: "too many tries — wait 5 min" }; }
  if (r === "wrong") { reply.code(403); return { error: "wrong PIN" }; }
  if (b?.claim) setAuthCookie(req, reply, issueToken(p.id, p.session_epoch), COOKIE_MAX_AGE);
  return { unlock: issueUnlock(p.id, p.pin_hash, p.session_epoch) };
});

// Fitness/health from intervals.icu — fetched lazily by the workout overlay,
// kept out of /api/data so the main dashboard load stays light.
app.get("/api/fitness", async (req, reply) => {
  const profile = reqProfile((req.query as { profile?: string }).profile);
  if (!intervalsFor(profile)) {
    reply.code(503);
    return { error: "intervals.icu not configured" };
  }
  try {
    return await getFitness();
  } catch (e) {
    app.log.error(e);
    reply.code(502);
    return { error: "intervals.icu fetch failed" };
  }
});

// --- Saved places (commute endpoints) ---
// Places are addresses geocoded once via Entur, then reused as commute from/to.
app.get("/api/places", async () => dbo.listPlaces());

app.post("/api/places", async (req, reply) => {
  const b = req.body as { label?: unknown; address?: unknown };
  const label = String(b?.label ?? "").trim();
  const address = String(b?.address ?? "").trim();
  if (!label || !address) { reply.code(400); return { error: "label and address required" }; }
  let geo;
  try {
    geo = await geocode(address);
  } catch (e) {
    app.log.error(e);
    reply.code(502); return { error: "geocoding failed" };
  }
  if (!geo) { reply.code(422); return { error: "address not found" }; }
  const place = {
    id: "place:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    label, address, lat: geo.lat, lon: geo.lon,
  };
  dbo.insertPlace(place);
  return place;
});

app.delete<{ Params: { id: string } }>("/api/places/:id", async (req) => {
  dbo.deletePlace(req.params.id);
  return { ok: true };
});

// The dedicated Home anchor: default location + where commutes return to.
app.get("/api/home", async () => dbo.getHome() ?? null);

app.put("/api/home", async (req, reply) => {
  const b = req.body as { address?: unknown };
  const address = String(b?.address ?? "").trim();
  if (!address) { reply.code(400); return { error: "address required" }; }
  let geo;
  try { geo = await geocode(address); }
  catch (e) { app.log.error(e); reply.code(502); return { error: "geocoding failed" }; }
  if (!geo) { reply.code(422); return { error: "address not found" }; }
  const home = { address, lat: geo.lat, lon: geo.lon };
  dbo.setHome(home);
  return home;
});

// Resolve a location token to coordinates. "" or "home" -> the Home anchor;
// anything else is a saved place id.
const resolveLoc = (token?: string) => {
  if (!token || token === "home") {
    const h = dbo.getHome();
    return h ? { id: "home", label: "Home", lat: h.lat, lon: h.lon } : undefined;
  }
  const p = dbo.getPlace(token);
  return p ? { id: p.id, label: p.label, lat: p.lat, lon: p.lon } : undefined;
};

// Compute a public-transport trip between two locations (place ids or "home").
// arriveBy (ISO) = be there by this time (commute in); departAt (ISO) = leave at
// this time (commute home). The estimate is planned conservatively (see entur.ts).
app.get("/api/travel", async (req, reply) => {
  const q = req.query as { from?: string; to?: string; arriveBy?: string; departAt?: string };
  const from = resolveLoc(q.from);
  const to = resolveLoc(q.to);
  if (!from || !to) { reply.code(400); return { error: "unknown from/to location (set Home?)" }; }
  try {
    const trip = await planTrip(
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
      q.arriveBy ? { arriveBy: q.arriveBy } : q.departAt ? { departAt: q.departAt } : {},
    );
    if (!trip) { reply.code(404); return { error: "no trip found" }; }
    return { from: { id: from.id, label: from.label }, to: { id: to.id, label: to.label }, trip };
  } catch (e) {
    app.log.error(e);
    reply.code(502); return { error: "transit routing failed" };
  }
});

// --- Local tasks ---
app.post("/api/tasks", async (req, reply) => {
  const b = req.body as any;
  if (!b?.date || !b?.title || !isCat(b?.cat)) {
    reply.code(400); return { error: "date, title, cat required" };
  }
  const tssNum = Number(b.tss);
  const task = {
    id: "local:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    date: String(b.date), start: String(b.start ?? ""), end: String(b.end ?? ""),
    title: String(b.title), cat: b.cat as Category, note: String(b.note ?? ""),
    sport: String(b.sport ?? ""),
    tss: Number.isFinite(tssNum) && tssNum > 0 ? Math.round(tssNum) : null,
    important: b.important ? 1 : 0,
    profile: reqProfile(b.profile), shared: b.shared ? 1 : 0,
    location: String(b.location ?? ""),
    source: String(b.source ?? ""),
  };
  dbo.insertLocalTask(task);
  return task;
});

// Sport labels Claude emits (Ride/Run/Strength/…) → the app's internal sport
// keys (so e.g. "Ride" trips the cycling-fuelling logic, which keys on "cycling").
const SPORT_MAP: Record<string, string> = {
  ride: "cycling", bike: "cycling", cycling: "cycling",
  run: "running", running: "running",
  strength: "strength", gym: "strength", lifting: "strength",
  mobility: "mobility", swim: "swimming", swimming: "swimming", other: "",
};
const normSport = (s: unknown): string => {
  const k = String(s ?? "").toLowerCase().trim();
  return SPORT_MAP[k] ?? k;
};

// Bulk-import a Claude-generated training plan (Stage-2 of the prompt flow).
// Blocks land as cat:"training" stored tasks tagged source:"claude" so they're
// identifiable + replaceable. Optional replaceRange wipes prior generated
// training across that span first — all atomic in one transaction.
app.post("/api/tasks/import", async (req, reply) => {
  const b = req.body as any;
  const profile = reqProfile(b?.profile);
  const blocks = Array.isArray(b?.blocks) ? b.blocks : null;
  if (!blocks?.length) { reply.code(400); return { error: "blocks array required" }; }
  if (blocks.length > 200) { reply.code(400); return { error: "too many blocks (max 200)" }; }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const made: any[] = [];
  for (const raw of blocks) {
    const date = String(raw?.date ?? "").trim();
    const title = String(raw?.title ?? "").trim();
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date)) || !title) {
      reply.code(400); return { error: `invalid block (need date + title): ${JSON.stringify(raw).slice(0, 80)}` };
    }
    const start = String(raw?.start ?? "").trim();
    const end = String(raw?.end ?? "").trim();
    if (start && !TIME_RE.test(start)) { reply.code(400); return { error: `bad start time on ${date}` }; }
    if (end && !TIME_RE.test(end)) { reply.code(400); return { error: `bad end time on ${date}` }; }
    // Zero-pad the hour ("6:30" -> "06:30"); the app sorts a day by start as a
    // plain string, so an unpadded hour would sort after the afternoon.
    const pad = (t: string) => (t ? t.replace(/^(\d):/, "0$1:") : "");
    const tssNum = Number(raw?.tss);
    made.push({
      id: "local:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
      date, start: pad(start), end: pad(end), title,
      cat: "training" as Category,
      note: String(raw?.note ?? ""),
      sport: normSport(raw?.sport),
      tss: Number.isFinite(tssNum) && tssNum > 0 ? Math.round(tssNum) : null,
      important: 0, profile, shared: 0, location: "", source: "claude",
    });
  }

  const rr = b?.replaceRange;
  const replace = rr && DATE_RE.test(String(rr.start)) && DATE_RE.test(String(rr.end))
    ? { profile, start: String(rr.start), end: String(rr.end) }
    : null;
  const replaced = dbo.importTasks(made, replace);
  return { created: made, replaced };
});

app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
  dbo.deleteLocalTask(req.params.id);
  return { ok: true };
});

// Edit a local task (any subset of fields; also covers the reschedule/push case via `date`).
app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
  const b = req.body as any;
  const { id } = req.params;
  // local: (daily blocks) and m: (migrated month-ahead events) are both stored
  // local tasks now — either can be edited. Calendar/recurring ids cannot.
  if (!id.startsWith("local:") && !id.startsWith("m:")) { reply.code(400); return { error: "only stored tasks can be edited" }; }
  if (b.cat !== undefined && !isCat(b.cat)) { reply.code(400); return { error: "invalid cat" }; }
  if (b.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) { reply.code(400); return { error: "invalid date" }; }
  const partial: Record<string, unknown> = {};
  for (const k of ["date", "start", "end", "title", "cat", "note", "sport", "location"]) if (b[k] !== undefined) partial[k] = String(b[k]);
  if (b.tss !== undefined) { const n = Number(b.tss); partial.tss = Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
  if (b.important !== undefined) partial.important = b.important ? 1 : 0;
  if (b.shared !== undefined) partial.shared = b.shared ? 1 : 0;
  if (!Object.keys(partial).length) { reply.code(400); return { error: "no fields to update" }; }
  dbo.updateLocalTask(id, partial);
  return { ok: true };
});

// --- To-dos (per-profile checklist) ---
app.post("/api/todos", async (req, reply) => {
  const b = req.body as any;
  const title = String(b?.title ?? "").trim().slice(0, 200);
  if (!title) { reply.code(400); return { error: "title required" }; }
  const todo = {
    id: "todo:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    profile: reqProfile(b.profile), title, done: 0,
  };
  dbo.insertTodo(todo);
  return todo;
});

app.patch<{ Params: { id: string } }>("/api/todos/:id", async (req) => {
  dbo.setTodoDone(req.params.id, !!(req.body as any)?.done);
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/todos/:id", async (req) => {
  dbo.deleteTodo(req.params.id);
  return { ok: true };
});

// Sweep away ticked items.
app.post("/api/todos/clear", async (req) => {
  dbo.clearDoneTodos(reqProfile((req.body as any)?.profile));
  return { ok: true };
});

// --- Done state ---
app.post<{ Params: { id: string } }>("/api/done/:id", async (req) => {
  dbo.markDone(req.params.id);
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/done/:id", async (req) => {
  dbo.unmarkDone(req.params.id);
  return { ok: true };
});

// --- Recurring tasks ---
const VALID_FREQ = ["daily", "weekly", "monthly"];
const VALID_END = ["never", "until", "count"];

app.post("/api/recurrences", async (req, reply) => {
  const b = req.body as any;
  if (!b?.title || !isCat(b?.cat) || !b?.dtstart || !VALID_FREQ.includes(b?.freq) || !VALID_END.includes(b?.endMode)) {
    reply.code(400); return { error: "title, cat, dtstart, freq, endMode required" };
  }
  const tssNum = Number(b.tss);
  const cnt = Number(b.count);
  const series = {
    id: "rec:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    title: String(b.title), cat: b.cat as Category, note: String(b.note ?? ""),
    sport: String(b.sport ?? ""), tss: Number.isFinite(tssNum) && tssNum > 0 ? Math.round(tssNum) : null,
    start: String(b.start ?? ""), end: String(b.end ?? ""), dtstart: String(b.dtstart),
    freq: b.freq as "daily" | "weekly" | "monthly",
    interval: Math.max(1, Math.round(Number(b.interval) || 1)),
    byweekday: Array.isArray(b.byweekday) ? b.byweekday.join(",") : String(b.byweekday ?? ""),
    endMode: b.endMode as "never" | "until" | "count",
    until: String(b.until ?? ""),
    count: b.endMode === "count" && Number.isFinite(cnt) && cnt > 0 ? Math.round(cnt) : null,
    profile: reqProfile(b.profile), shared: b.shared ? 1 : 0,
    location: String(b.location ?? ""),
  };
  dbo.insertRecurrence(series);
  return series;
});

app.delete<{ Params: { id: string } }>("/api/recurrences/:id", async (req) => {
  dbo.deleteRecurrence(req.params.id);
  return { ok: true };
});

// Skip a single occurrence ("delete this occurrence").
app.post<{ Params: { id: string } }>("/api/recurrences/:id/skip", async (req, reply) => {
  const b = req.body as any;
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) { reply.code(400); return { error: "valid date required" }; }
  dbo.addException(req.params.id, String(b.date));
  return { ok: true };
});

const dayBefore = (d: string) => new Date(new Date(d + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);

// Edit the whole series ("all occurrences"): update content/rule fields.
app.patch<{ Params: { id: string } }>("/api/recurrences/:id", async (req, reply) => {
  const b = req.body as any;
  if (b.cat !== undefined && !isCat(b.cat)) { reply.code(400); return { error: "invalid cat" }; }
  if (b.freq !== undefined && !VALID_FREQ.includes(b.freq)) { reply.code(400); return { error: "invalid freq" }; }
  if (b.endMode !== undefined && !VALID_END.includes(b.endMode)) { reply.code(400); return { error: "invalid endMode" }; }
  const partial: Record<string, unknown> = {};
  for (const k of ["title", "cat", "note", "sport", "start", "end", "dtstart", "freq", "endMode", "until", "location"]) if (b[k] !== undefined) partial[k] = String(b[k]);
  if (b.interval !== undefined) partial.interval = Math.max(1, Math.round(Number(b.interval) || 1));
  if (b.byweekday !== undefined) partial.byweekday = Array.isArray(b.byweekday) ? b.byweekday.join(",") : String(b.byweekday);
  if (b.tss !== undefined) { const n = Number(b.tss); partial.tss = Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
  if (b.count !== undefined) { const n = Number(b.count); partial.count = Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
  if (b.shared !== undefined) partial.shared = b.shared ? 1 : 0;
  dbo.updateRecurrence(req.params.id, partial);
  return { ok: true };
});

// "This and following" delete: truncate the series to end the day before `date`.
app.post<{ Params: { id: string } }>("/api/recurrences/:id/truncate", async (req, reply) => {
  const b = req.body as any;
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) { reply.code(400); return { error: "valid date required" }; }
  dbo.updateRecurrence(req.params.id, { endMode: "until", until: dayBefore(String(b.date)), count: null });
  return { ok: true };
});

// "This and following" edit: truncate the original, start a new series (same rule, new content) at `date`.
app.post<{ Params: { id: string } }>("/api/recurrences/:id/split", async (req, reply) => {
  const b = req.body as any;
  const orig = dbo.getRecurrence(req.params.id);
  if (!orig) { reply.code(404); return { error: "series not found" }; }
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) { reply.code(400); return { error: "valid date required" }; }
  if (b.cat !== undefined && !isCat(b.cat)) { reply.code(400); return { error: "invalid cat" }; }
  dbo.updateRecurrence(orig.id, { endMode: "until", until: dayBefore(String(b.date)), count: null });

  const n = Number(b.tss);
  const carryCount = orig.endMode === "count"; // counting from a new dtstart is ambiguous -> open-ended
  const series = {
    id: "rec:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    title: b.title !== undefined ? String(b.title) : orig.title,
    cat: (b.cat !== undefined ? b.cat : orig.cat) as Category,
    note: b.note !== undefined ? String(b.note) : orig.note,
    sport: b.sport !== undefined ? String(b.sport) : orig.sport,
    tss: b.tss !== undefined ? (Number.isFinite(n) && n > 0 ? Math.round(n) : null) : orig.tss,
    start: b.start !== undefined ? String(b.start) : orig.start,
    end: b.end !== undefined ? String(b.end) : orig.end,
    dtstart: String(b.date),
    freq: orig.freq, interval: orig.interval, byweekday: orig.byweekday,
    endMode: carryCount ? ("never" as const) : orig.endMode,
    until: carryCount ? "" : orig.until,
    count: null,
    profile: orig.profile,
    shared: b.shared !== undefined ? (b.shared ? 1 : 0) : orig.shared,
    location: b.location !== undefined ? String(b.location) : orig.location,
  };
  dbo.insertRecurrence(series);
  return series;
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`Command Deck server on :${config.port}`));
