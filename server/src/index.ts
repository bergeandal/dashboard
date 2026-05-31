import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config, type Category } from "./config.js";
import { fetchAllTasks, fetchBirthdays } from "./calendar/fetch.js";
import { getWeather } from "./weather/yr.js";
import { getFitness } from "./fitness/intervals.js";
import { dbo } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

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

const VALID_CATS: Category[] = ["work", "training", "social", "home"];
const isCat = (s: unknown): s is Category =>
  typeof s === "string" && (VALID_CATS as string[]).includes(s);

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/data", async (req) => {
  const q = req.query as { start?: string; days?: string };
  const now = new Date();
  const start = parseDate(q.start, now);
  const days = Math.min(Math.max(Number(q.days ?? 60), 7), 120);
  const end = new Date(+start + days * 24 * 3600 * 1000);

  const birthdaysEnd = new Date(+start + 365 * 24 * 3600 * 1000);
  const [tasks, birthdays, weather] = await Promise.all([
    fetchAllTasks(start, end),
    fetchBirthdays(start, birthdaysEnd),
    getWeather().catch((e) => { app.log.error(e); return null; }),
  ]);

  return {
    tasks,
    birthdays,
    localTasks: dbo.listLocalTasks(),
    doneIds: dbo.listDoneIds(),
    month: dbo.listMonth(),
    weather,
    fetchedAt: new Date().toISOString(),
  };
});

app.get("/api/weather", async () => getWeather());

// Fitness/health from intervals.icu — fetched lazily by the workout overlay,
// kept out of /api/data so the main dashboard load stays light.
app.get("/api/fitness", async (req, reply) => {
  if (!config.intervals) {
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
  const task = {
    id: "local:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    date: String(b.date), start: String(b.start ?? ""), end: String(b.end ?? ""),
    title: String(b.title), cat: b.cat as Category, note: String(b.note ?? ""),
  };
  dbo.insertLocalTask(task);
  return task;
});

app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
  dbo.deleteLocalTask(req.params.id);
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

// --- Month-ahead events ---
app.post("/api/month", async (req, reply) => {
  const b = req.body as any;
  if (!b?.date || !b?.title || !isCat(b?.cat)) {
    reply.code(400); return { error: "date, title, cat required" };
  }
  const ev = {
    id: "m:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8),
    date: String(b.date), title: String(b.title), cat: b.cat as Category,
  };
  dbo.insertMonth(ev);
  return ev;
});

app.delete<{ Params: { id: string } }>("/api/month/:id", async (req) => {
  dbo.deleteMonth(req.params.id);
  return { ok: true };
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`Command Deck server on :${config.port}`));
