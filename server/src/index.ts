import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, type Category, type ProfileId, isProfile, profileCalendars, intervalsFor } from "./config.js";
import { fetchAllTasks, fetchBirthdays } from "./calendar/fetch.js";
import { getWeather } from "./weather/yr.js";
import { getFitness } from "./fitness/intervals.js";
import { expandRecurrence } from "./recurrence.js";
import { dbo } from "./db.js";
import { authEnabled, COOKIE, COOKIE_MAX_AGE, issueToken, verifyToken, checkPasscode, parseCookie } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true, credentials: true });

// Trusted-device gate: every /api/* call (except the gate itself + health)
// needs a valid auth cookie. Static SPA assets stay open so the login screen
// can load. No-op when DECK_PASSCODE is unset (local dev).
const OPEN_API = new Set(["/api/login", "/api/logout", "/api/health"]);
app.addHook("onRequest", async (req, reply) => {
  if (!authEnabled) return;
  const path = req.url.split("?")[0];
  if (!path.startsWith("/api/")) return;      // SPA + assets served openly
  if (OPEN_API.has(path)) return;
  if (verifyToken(parseCookie(req.headers.cookie, COOKIE))) return;
  return reply.code(401).send({ error: "unauthorized" });
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

// Active profile from a request (query or body); defaults to the primary profile.
const reqProfile = (v: unknown): ProfileId => (isProfile(v) ? v : "berge");
// A row is visible to a profile if it belongs to that profile or is shared.
const visibleTo = (p: ProfileId) => (r: { profile: string; shared: number }) => r.profile === p || !!r.shared;

app.get("/api/health", async () => ({ ok: true }));

// --- Auth (trusted device) ---
app.post("/api/login", async (req, reply) => {
  const b = req.body as { passcode?: unknown };
  if (!checkPasscode(b?.passcode)) { reply.code(401); return { error: "wrong passcode" }; }
  setAuthCookie(req, reply, issueToken(), COOKIE_MAX_AGE);
  return { ok: true };
});

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
    fetchBirthdays(start, birthdaysEnd),
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
      }));
  });

  return {
    tasks: [...tasks, ...recurringTasks],
    birthdays,
    localTasks: dbo.listLocalTasks().filter(visibleTo(profile)),
    doneIds: dbo.listDoneIds(),
    weather,
    fetchedAt: new Date().toISOString(),
  };
});

app.get("/api/weather", async () => getWeather());

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
  };
  dbo.insertLocalTask(task);
  return task;
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
  for (const k of ["date", "start", "end", "title", "cat", "note", "sport"]) if (b[k] !== undefined) partial[k] = String(b[k]);
  if (b.tss !== undefined) { const n = Number(b.tss); partial.tss = Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
  if (b.important !== undefined) partial.important = b.important ? 1 : 0;
  if (b.shared !== undefined) partial.shared = b.shared ? 1 : 0;
  if (!Object.keys(partial).length) { reply.code(400); return { error: "no fields to update" }; }
  dbo.updateLocalTask(id, partial);
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
  for (const k of ["title", "cat", "note", "sport", "start", "end", "dtstart", "freq", "endMode", "until"]) if (b[k] !== undefined) partial[k] = String(b[k]);
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
  };
  dbo.insertRecurrence(series);
  return series;
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`Command Deck server on :${config.port}`));
