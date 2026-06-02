import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Category } from "./config.js";

const DB_PATH = process.env.DB_PATH ?? "./data/deck.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS local_tasks (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    start      TEXT NOT NULL DEFAULT '',
    end        TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL,
    cat        TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    sport      TEXT NOT NULL DEFAULT '',
    tss        INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_local_tasks_date ON local_tasks(date);

  CREATE TABLE IF NOT EXISTS done (
    task_id TEXT PRIMARY KEY,
    done_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS month_events (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    start      TEXT NOT NULL DEFAULT '',
    "end"      TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL,
    cat        TEXT NOT NULL,
    important  INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_month_events_date ON month_events(date);
`);

// Migrate older DBs that predate added columns (CREATE IF NOT EXISTS won't add columns).
for (const ddl of ["sport TEXT NOT NULL DEFAULT ''", "tss INTEGER"]) {
  try { db.exec(`ALTER TABLE local_tasks ADD COLUMN ${ddl}`); } catch { /* already present */ }
}
for (const ddl of ["start TEXT NOT NULL DEFAULT ''", `"end" TEXT NOT NULL DEFAULT ''`, "important INTEGER NOT NULL DEFAULT 1"]) {
  try { db.exec(`ALTER TABLE month_events ADD COLUMN ${ddl}`); } catch { /* already present */ }
}

export type LocalTask = {
  id: string; date: string; start: string; end: string;
  title: string; cat: Category; note: string;
  sport: string; tss: number | null;
};

export type MonthEvent = {
  id: string; date: string; start: string; end: string; title: string; cat: Category; important: number;
};

const stmts = {
  listLocalTasks: db.prepare<[], LocalTask>(
    `SELECT id, date, start, "end" as end, title, cat, note, sport, tss FROM local_tasks ORDER BY date, start`
  ),
  insertLocalTask: db.prepare<LocalTask & { created_at: number }>(
    `INSERT INTO local_tasks (id, date, start, "end", title, cat, note, sport, tss, created_at)
     VALUES (@id, @date, @start, @end, @title, @cat, @note, @sport, @tss, @created_at)`
  ),
  deleteLocalTask: db.prepare<[string]>(`DELETE FROM local_tasks WHERE id = ?`),
  moveLocalTask: db.prepare<[string, string]>(`UPDATE local_tasks SET date = ? WHERE id = ?`),

  listDone: db.prepare<[], { task_id: string }>(`SELECT task_id FROM done`),
  markDone: db.prepare<[string, number]>(
    `INSERT OR IGNORE INTO done (task_id, done_at) VALUES (?, ?)`
  ),
  unmarkDone: db.prepare<[string]>(`DELETE FROM done WHERE task_id = ?`),

  listMonth: db.prepare<[], MonthEvent>(
    `SELECT id, date, start, "end" as end, title, cat, important FROM month_events ORDER BY date, start`
  ),
  insertMonth: db.prepare<MonthEvent & { created_at: number }>(
    `INSERT INTO month_events (id, date, start, "end", title, cat, important, created_at)
     VALUES (@id, @date, @start, @end, @title, @cat, @important, @created_at)`
  ),
  setMonthImportant: db.prepare<[number, string]>(`UPDATE month_events SET important = ? WHERE id = ?`),
  deleteMonth: db.prepare<[string]>(`DELETE FROM month_events WHERE id = ?`),
};

export const dbo = {
  listLocalTasks: (): LocalTask[] => stmts.listLocalTasks.all(),
  insertLocalTask: (t: LocalTask) => stmts.insertLocalTask.run({ ...t, created_at: Date.now() }),
  deleteLocalTask: (id: string) => stmts.deleteLocalTask.run(id),
  moveLocalTask: (id: string, date: string) => stmts.moveLocalTask.run(date, id),

  listDoneIds: (): string[] => stmts.listDone.all().map((r) => r.task_id),
  markDone: (id: string) => stmts.markDone.run(id, Date.now()),
  unmarkDone: (id: string) => stmts.unmarkDone.run(id),

  listMonth: (): MonthEvent[] => stmts.listMonth.all(),
  insertMonth: (e: MonthEvent) => stmts.insertMonth.run({ ...e, created_at: Date.now() }),
  setMonthImportant: (id: string, important: boolean) => stmts.setMonthImportant.run(important ? 1 : 0, id),
  deleteMonth: (id: string) => stmts.deleteMonth.run(id),
};
