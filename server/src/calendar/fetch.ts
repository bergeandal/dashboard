import { config, type Category } from "../config.js";
import { fetchCalendarAsTasks, fetchCalendarFromFile, type Task } from "./toTasks.js";

const CACHE_MS = 5 * 60 * 1000;

type CacheEntry = { at: number; tasks: Task[] };
const cache = new Map<string, CacheEntry>();

type CalMap = Partial<Record<Exclude<Category, "birthday">, string>>;
type Source = { cat: Category; kind: "url" | "file"; value: string };

const urlSources = (calendars: CalMap): Source[] =>
  (Object.keys(calendars) as Array<Exclude<Category, "birthday">>)
    .filter((cat) => calendars[cat])
    .map((cat): Source => ({ cat, kind: "url", value: calendars[cat]! }));

async function fetchSource(s: Source, windowStart: Date, windowEnd: Date): Promise<Task[]> {
  // Key includes the source value so two profiles sharing a category but
  // pointing at different calendar URLs don't collide in the cache.
  const key = `${s.cat}:${s.value}:${windowStart.toISOString()}:${windowEnd.toISOString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tasks;

  try {
    const tasks = s.kind === "url"
      ? await fetchCalendarAsTasks(s.value, s.cat, windowStart, windowEnd)
      : await fetchCalendarFromFile(s.value, s.cat, windowStart, windowEnd);
    cache.set(key, { at: Date.now(), tasks });
    return tasks;
  } catch (err) {
    console.error(`[calendar:${s.cat}] fetch failed:`, err);
    return hit?.tasks ?? [];
  }
}

export async function fetchAllTasks(calendars: CalMap, windowStart: Date, windowEnd: Date): Promise<Task[]> {
  const results = await Promise.all(
    urlSources(calendars).map((s) => fetchSource(s, windowStart, windowEnd))
  );
  return results.flat().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export async function fetchBirthdays(windowStart: Date, windowEnd: Date): Promise<Task[]> {
  const src: Source = { cat: "birthday", kind: "file", value: config.birthdaysFile };
  if (!src.value) return [];
  // Roll window back 1 day so today's birthday is included regardless of TZ offset.
  const inclusiveStart = new Date(+windowStart - 24 * 3600 * 1000);
  const todayOslo = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).split("/").reverse().join("-");
  const tasks = await fetchSource(src, inclusiveStart, windowEnd);
  const upcoming = tasks.filter((t) => t.date >= todayOslo).sort((a, b) => a.date.localeCompare(b.date));
  // Keep only the next occurrence per person (id encodes uid + date).
  const seen = new Set<string>();
  const out: typeof upcoming = [];
  for (const t of upcoming) {
    const personKey = t.id.split(":").slice(0, -1).join(":");
    if (seen.has(personKey)) continue;
    seen.add(personKey);
    out.push(t);
  }
  return out;
}
