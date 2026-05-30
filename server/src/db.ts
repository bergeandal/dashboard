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
    title      TEXT NOT NULL,
    cat        TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_month_events_date ON month_events(date);
`);

export type LocalTask = {
  id: string; date: string; start: string; end: string;
  title: string; cat: Category; note: string;
};

export type MonthEvent = {
  id: string; date: string; title: string; cat: Category;
};

const stmts = {
  listLocalTasks: db.prepare<[], LocalTask>(
    `SELECT id, date, start, "end" as end, title, cat, note FROM local_tasks ORDER BY date, start`
  ),
  insertLocalTask: db.prepare<LocalTask & { created_at: number }>(
    `INSERT INTO local_tasks (id, date, start, "end", title, cat, note, created_at)
     VALUES (@id, @date, @start, @end, @title, @cat, @note, @created_at)`
  ),
  deleteLocalTask: db.prepare<[string]>(`DELETE FROM local_tasks WHERE id = ?`),

  listDone: db.prepare<[], { task_id: string }>(`SELECT task_id FROM done`),
  markDone: db.prepare<[string, number]>(
    `INSERT OR IGNORE INTO done (task_id, done_at) VALUES (?, ?)`
  ),
  unmarkDone: db.prepare<[string]>(`DELETE FROM done WHERE task_id = ?`),

  listMonth: db.prepare<[], MonthEvent>(
    `SELECT id, date, title, cat FROM month_events ORDER BY date`
  ),
  insertMonth: db.prepare<MonthEvent & { created_at: number }>(
    `INSERT INTO month_events (id, date, title, cat, created_at)
     VALUES (@id, @date, @title, @cat, @created_at)`
  ),
  deleteMonth: db.prepare<[string]>(`DELETE FROM month_events WHERE id = ?`),
};

export const dbo = {
  listLocalTasks: (): LocalTask[] => stmts.listLocalTasks.all(),
  insertLocalTask: (t: LocalTask) => stmts.insertLocalTask.run({ ...t, created_at: Date.now() }),
  deleteLocalTask: (id: string) => stmts.deleteLocalTask.run(id),

  listDoneIds: (): string[] => stmts.listDone.all().map((r) => r.task_id),
  markDone: (id: string) => stmts.markDone.run(id, Date.now()),
  unmarkDone: (id: string) => stmts.unmarkDone.run(id),

  listMonth: (): MonthEvent[] => stmts.listMonth.all(),
  insertMonth: (e: MonthEvent) => stmts.insertMonth.run({ ...e, created_at: Date.now() }),
  deleteMonth: (id: string) => stmts.deleteMonth.run(id),
};
