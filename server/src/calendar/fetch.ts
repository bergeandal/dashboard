import { config, type Category } from "../config.js";
import { fetchCalendarAsTasks, type Task } from "./toTasks.js";

const CACHE_MS = 5 * 60 * 1000;

type CacheEntry = { at: number; tasks: Task[] };
const cache = new Map<string, CacheEntry>();

export async function fetchAllTasks(windowStart: Date, windowEnd: Date): Promise<Task[]> {
  const cats = Object.keys(config.calendars) as Category[];

  const results = await Promise.all(
    cats.map(async (cat) => {
      const url = config.calendars[cat];
      const key = `${cat}:${windowStart.toISOString()}:${windowEnd.toISOString()}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.tasks;

      try {
        const tasks = await fetchCalendarAsTasks(url, cat, windowStart, windowEnd);
        cache.set(key, { at: Date.now(), tasks });
        return tasks;
      } catch (err) {
        console.error(`[calendar:${cat}] fetch failed:`, err);
        return hit?.tasks ?? [];
      }
    }),
  );

  return results.flat().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
