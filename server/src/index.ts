import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { fetchAllTasks } from "./calendar/fetch.js";
import { getWeather } from "./weather/yr.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

// Serve the built frontend if present (Docker image copies it to /app/public).
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

app.get("/api/health", async () => ({ ok: true }));

// Combined endpoint — frontend hits this on load + every few minutes.
app.get("/api/data", async (req) => {
  const q = req.query as { start?: string; days?: string };
  const now = new Date();
  const start = parseDate(q.start, now);
  const days = Math.min(Math.max(Number(q.days ?? 60), 7), 120);
  const end = new Date(+start + days * 24 * 3600 * 1000);

  const [tasks, weather] = await Promise.all([
    fetchAllTasks(start, end),
    getWeather().catch((e) => { app.log.error(e); return null; }),
  ]);

  return { tasks, weather, fetchedAt: new Date().toISOString() };
});

app.get("/api/weather", async () => getWeather());

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`Command Deck server on :${config.port}`));
