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
    important  INTEGER NOT NULL DEFAULT 0,
    profile    TEXT NOT NULL DEFAULT 'berge',
    shared     INTEGER NOT NULL DEFAULT 0,
    location   TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',
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
    profile    TEXT NOT NULL DEFAULT 'berge',
    shared     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_month_events_date ON month_events(date);

  CREATE TABLE IF NOT EXISTS recurrences (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    cat        TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    sport      TEXT NOT NULL DEFAULT '',
    tss        INTEGER,
    start      TEXT NOT NULL DEFAULT '',
    "end"      TEXT NOT NULL DEFAULT '',
    dtstart    TEXT NOT NULL,
    freq       TEXT NOT NULL,
    interval   INTEGER NOT NULL DEFAULT 1,
    byweekday  TEXT NOT NULL DEFAULT '',
    end_mode   TEXT NOT NULL DEFAULT 'never',
    until      TEXT NOT NULL DEFAULT '',
    count      INTEGER,
    profile    TEXT NOT NULL DEFAULT 'berge',
    shared     INTEGER NOT NULL DEFAULT 0,
    location   TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurrence_exceptions (
    series_id TEXT NOT NULL,
    date      TEXT NOT NULL,
    PRIMARY KEY (series_id, date)
  );

  CREATE TABLE IF NOT EXISTS places (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    address    TEXT NOT NULL,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Household profiles (one deck each). theme is a palette key the UI knows;
  -- ics_* are optional Google Calendar secret URLs (env vars are the fallback).
  CREATE TABLE IF NOT EXISTS profiles (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    theme        TEXT NOT NULL DEFAULT 'denim',
    ics_training TEXT NOT NULL DEFAULT '',
    ics_work     TEXT NOT NULL DEFAULT '',
    ics_social   TEXT NOT NULL DEFAULT '',
    ics_home     TEXT NOT NULL DEFAULT '',
    ics_event    TEXT NOT NULL DEFAULT '',
    pin_hash     TEXT NOT NULL DEFAULT '',
    session_epoch INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  -- Simple per-profile to-do checklist: no dates, just a title and a tick.
  CREATE TABLE IF NOT EXISTS todos (
    id         TEXT PRIMARY KEY,
    profile    TEXT NOT NULL,
    title      TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_todos_profile ON todos(profile);

  -- Single-row "home" anchor: the default location + where commutes return to.
  CREATE TABLE IF NOT EXISTS home (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    address TEXT NOT NULL,
    lat     REAL NOT NULL,
    lon     REAL NOT NULL
  );
`);

// Migrate older DBs that predate added columns (CREATE IF NOT EXISTS won't add columns).
const profileCols = ["profile TEXT NOT NULL DEFAULT 'berge'", "shared INTEGER NOT NULL DEFAULT 0"];
const locationCol = ["location TEXT NOT NULL DEFAULT ''"];
const sourceCol = ["source TEXT NOT NULL DEFAULT ''"];
for (const ddl of ["sport TEXT NOT NULL DEFAULT ''", "tss INTEGER", "important INTEGER NOT NULL DEFAULT 0", ...profileCols, ...locationCol, ...sourceCol]) {
  try { db.exec(`ALTER TABLE local_tasks ADD COLUMN ${ddl}`); } catch { /* already present */ }
}
for (const ddl of ["start TEXT NOT NULL DEFAULT ''", `"end" TEXT NOT NULL DEFAULT ''`, "important INTEGER NOT NULL DEFAULT 1", ...profileCols]) {
  try { db.exec(`ALTER TABLE month_events ADD COLUMN ${ddl}`); } catch { /* already present */ }
}
for (const ddl of [...profileCols, ...locationCol]) {
  try { db.exec(`ALTER TABLE recurrences ADD COLUMN ${ddl}`); } catch { /* already present */ }
}
for (const ddl of ["pin_hash TEXT NOT NULL DEFAULT ''", "session_epoch INTEGER NOT NULL DEFAULT 0"]) {
  try { db.exec(`ALTER TABLE profiles ADD COLUMN ${ddl}`); } catch { /* already present */ }
}

// One-time merge: month-ahead events and daily blocks are now one concept, so
// fold any existing month_events into local_tasks (keeping their ids so done-
// state survives) and empty the old table. Idempotent — a no-op once drained.
{
  const monthRows = db.prepare(
    `SELECT id, date, start, "end" as end, title, cat, important, profile, shared, created_at FROM month_events`
  ).all() as Array<{
    id: string; date: string; start: string; end: string; title: string;
    cat: string; important: number; profile: string; shared: number; created_at: number;
  }>;
  if (monthRows.length) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO local_tasks (id, date, start, "end", title, cat, note, sport, tss, important, profile, shared, created_at)
       VALUES (@id, @date, @start, @end, @title, @cat, '', '', NULL, @important, @profile, @shared, @created_at)`
    );
    const drain = db.transaction(() => {
      for (const r of monthRows) ins.run(r);
      db.prepare(`DELETE FROM month_events`).run();
    });
    drain();
  }
}

// Seed the two original (previously hardcoded) profiles on first run. Never
// re-seeds after that: removing the last profile is refused, so the table
// can't go empty again.
if (!(db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get() as { n: number }).n) {
  const seed = db.prepare(`INSERT INTO profiles (id, name, theme, created_at) VALUES (?, ?, ?, ?)`);
  seed.run("berge", "Berge", "denim", 1);
  seed.run("amanda", "Amanda", "rose", 2);
}

export type Profile = {
  id: string; name: string; theme: string;
  ics_training: string; ics_work: string; ics_social: string; ics_home: string; ics_event: string;
  pin_hash: string; // "" = no PIN
  session_epoch: number; // bumped to sign out every device owned by this profile
};

export type Todo = { id: string; profile: string; title: string; done: number };

export type LocalTask = {
  id: string; date: string; start: string; end: string;
  title: string; cat: Category; note: string;
  sport: string; tss: number | null; important: number;
  profile: string; shared: number;
  location: string; // place id where the event happens; "" = home (default)
  source: string;   // "" = user-created; "claude" = imported from a generated plan
};

// A saved place (work, gym, …) — an address geocoded once via Entur and used as
// an event's location. Managed inline from the add/edit form. Home is separate.
export type Place = {
  id: string; label: string; address: string; lat: number; lon: number;
};

export type Home = { address: string; lat: number; lon: number };

export type Recurrence = {
  id: string; title: string; cat: Category; note: string; sport: string; tss: number | null;
  start: string; end: string; dtstart: string;
  freq: "daily" | "weekly" | "monthly"; interval: number; byweekday: string;
  endMode: "never" | "until" | "count"; until: string; count: number | null;
  profile: string; shared: number;
  location: string;
};

const stmts = {
  listLocalTasks: db.prepare<[], LocalTask>(
    `SELECT id, date, start, "end" as end, title, cat, note, sport, tss, important, profile, shared,
            location, source FROM local_tasks ORDER BY date, start`
  ),
  insertLocalTask: db.prepare<LocalTask & { created_at: number }>(
    `INSERT INTO local_tasks (id, date, start, "end", title, cat, note, sport, tss, important, profile, shared, location, source, created_at)
     VALUES (@id, @date, @start, @end, @title, @cat, @note, @sport, @tss, @important, @profile, @shared, @location, @source, @created_at)`
  ),
  deleteLocalTask: db.prepare<[string]>(`DELETE FROM local_tasks WHERE id = ?`),
  // Wipe generated training in a date span — backs "re-generate this week".
  deleteGeneratedInRange: db.prepare<[string, string, string]>(
    `DELETE FROM local_tasks WHERE source = 'claude' AND profile = ? AND date >= ? AND date <= ?`
  ),
  moveLocalTask: db.prepare<[string, string]>(`UPDATE local_tasks SET date = ? WHERE id = ?`),

  listDone: db.prepare<[], { task_id: string }>(`SELECT task_id FROM done`),
  markDone: db.prepare<[string, number]>(
    `INSERT OR IGNORE INTO done (task_id, done_at) VALUES (?, ?)`
  ),
  unmarkDone: db.prepare<[string]>(`DELETE FROM done WHERE task_id = ?`),

  listRecurrences: db.prepare<[], Recurrence>(
    `SELECT id, title, cat, note, sport, tss, start, "end" as end, dtstart,
            freq, interval, byweekday, end_mode as endMode, until, count, profile, shared, location
     FROM recurrences`
  ),
  getRecurrence: db.prepare<[string], Recurrence>(
    `SELECT id, title, cat, note, sport, tss, start, "end" as end, dtstart,
            freq, interval, byweekday, end_mode as endMode, until, count, profile, shared, location
     FROM recurrences WHERE id = ?`
  ),
  insertRecurrence: db.prepare<Recurrence & { created_at: number }>(
    `INSERT INTO recurrences (id, title, cat, note, sport, tss, start, "end", dtstart,
                              freq, interval, byweekday, end_mode, until, count, profile, shared, location, created_at)
     VALUES (@id, @title, @cat, @note, @sport, @tss, @start, @end, @dtstart,
             @freq, @interval, @byweekday, @endMode, @until, @count, @profile, @shared, @location, @created_at)`
  ),
  deleteRecurrence: db.prepare<[string]>(`DELETE FROM recurrences WHERE id = ?`),
  listExceptions: db.prepare<[], { series_id: string; date: string }>(
    `SELECT series_id, date FROM recurrence_exceptions`
  ),
  addException: db.prepare<[string, string]>(
    `INSERT OR IGNORE INTO recurrence_exceptions (series_id, date) VALUES (?, ?)`
  ),
  clearExceptions: db.prepare<[string]>(`DELETE FROM recurrence_exceptions WHERE series_id = ?`),

  listPlaces: db.prepare<[], Place>(`SELECT id, label, address, lat, lon FROM places ORDER BY created_at`),
  insertPlace: db.prepare<Place & { created_at: number }>(
    `INSERT INTO places (id, label, address, lat, lon, created_at)
     VALUES (@id, @label, @address, @lat, @lon, @created_at)`
  ),
  deletePlace: db.prepare<[string]>(`DELETE FROM places WHERE id = ?`),

  listProfiles: db.prepare<[], Profile>(
    `SELECT id, name, theme, ics_training, ics_work, ics_social, ics_home, ics_event, pin_hash, session_epoch
     FROM profiles ORDER BY created_at`
  ),
  insertProfile: db.prepare<Profile & { created_at: number }>(
    `INSERT INTO profiles (id, name, theme, ics_training, ics_work, ics_social, ics_home, ics_event, pin_hash, created_at)
     VALUES (@id, @name, @theme, @ics_training, @ics_work, @ics_social, @ics_home, @ics_event, @pin_hash, @created_at)`
  ),
  setProfilePin: db.prepare<[string, string]>(`UPDATE profiles SET pin_hash = ? WHERE id = ?`),
  bumpProfileEpoch: db.prepare<[string]>(`UPDATE profiles SET session_epoch = session_epoch + 1 WHERE id = ?`),
  renameProfile: db.prepare<[string, string, string]>(`UPDATE profiles SET name = ?, theme = ? WHERE id = ?`),
  deleteProfile: db.prepare<[string]>(`DELETE FROM profiles WHERE id = ?`),
  // A removed profile's private items go with it; shared ones stay (they're
  // already visible on every other deck).
  deleteProfileTasks: db.prepare<[string]>(`DELETE FROM local_tasks WHERE profile = ? AND shared = 0`),
  deleteProfileExceptions: db.prepare<[string]>(
    `DELETE FROM recurrence_exceptions WHERE series_id IN (SELECT id FROM recurrences WHERE profile = ? AND shared = 0)`
  ),
  deleteProfileRecurrences: db.prepare<[string]>(`DELETE FROM recurrences WHERE profile = ? AND shared = 0`),
  deleteProfileTodos: db.prepare<[string]>(`DELETE FROM todos WHERE profile = ?`),

  listTodos: db.prepare<[string], Todo>(
    `SELECT id, profile, title, done FROM todos WHERE profile = ? ORDER BY created_at`
  ),
  getTodo: db.prepare<[string], Todo>(`SELECT id, profile, title, done FROM todos WHERE id = ?`),
  insertTodo: db.prepare<Todo & { created_at: number }>(
    `INSERT INTO todos (id, profile, title, done, created_at) VALUES (@id, @profile, @title, @done, @created_at)`
  ),
  setTodoDone: db.prepare<[number, string]>(`UPDATE todos SET done = ? WHERE id = ?`),
  deleteTodo: db.prepare<[string]>(`DELETE FROM todos WHERE id = ?`),
  clearDoneTodos: db.prepare<[string]>(`DELETE FROM todos WHERE profile = ? AND done = 1`),

  getHome: db.prepare<[], Home>(`SELECT address, lat, lon FROM home WHERE id = 1`),
  setHome: db.prepare<Home>(
    `INSERT INTO home (id, address, lat, lon) VALUES (1, @address, @lat, @lon)
     ON CONFLICT(id) DO UPDATE SET address = @address, lat = @lat, lon = @lon`
  ),
};

// Partial-update helper. Keys map to (possibly quoted) column names; only
// provided & whitelisted keys are written.
const LOCAL_COLS: Record<string, string> = {
  date: "date", start: "start", end: '"end"', title: "title", cat: "cat", note: "note", sport: "sport", tss: "tss",
  important: "important", profile: "profile", shared: "shared", location: "location",
};
const REC_COLS: Record<string, string> = {
  title: "title", cat: "cat", note: "note", sport: "sport", tss: "tss", start: "start", end: '"end"',
  dtstart: "dtstart", freq: "freq", interval: "interval", byweekday: "byweekday",
  endMode: "end_mode", until: "until", count: "count", profile: "profile", shared: "shared",
  location: "location",
};
function updateRow(table: string, cols: Record<string, string>, id: string, partial: Record<string, unknown>) {
  const keys = Object.keys(partial).filter((k) => k in cols);
  if (!keys.length) return;
  const sets = keys.map((k) => `${cols[k]} = @${k}`).join(", ");
  const bind: Record<string, unknown> = { id };
  for (const k of keys) bind[k] = partial[k] as unknown;
  db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run(bind);
}

export const dbo = {
  listLocalTasks: (): LocalTask[] => stmts.listLocalTasks.all(),
  insertLocalTask: (t: LocalTask) => stmts.insertLocalTask.run({ ...t, created_at: Date.now() }),
  deleteLocalTask: (id: string) => stmts.deleteLocalTask.run(id),

  // Bulk-insert a generated plan in one transaction. When `replace` is given,
  // first clears prior generated training in that span (so re-importing a week
  // swaps rather than duplicates). Returns how many old rows were replaced.
  importTasks: (
    tasks: LocalTask[],
    replace: { profile: string; start: string; end: string } | null,
  ): number => {
    const tx = db.transaction(() => {
      const replaced = replace
        ? stmts.deleteGeneratedInRange.run(replace.profile, replace.start, replace.end).changes
        : 0;
      const at = Date.now();
      for (const t of tasks) stmts.insertLocalTask.run({ ...t, created_at: at });
      return replaced;
    });
    return tx();
  },
  moveLocalTask: (id: string, date: string) => stmts.moveLocalTask.run(date, id),
  updateLocalTask: (id: string, partial: Record<string, unknown>) => updateRow("local_tasks", LOCAL_COLS, id, partial),

  listDoneIds: (): string[] => stmts.listDone.all().map((r) => r.task_id),
  markDone: (id: string) => stmts.markDone.run(id, Date.now()),
  unmarkDone: (id: string) => stmts.unmarkDone.run(id),

  listRecurrences: (): Recurrence[] => stmts.listRecurrences.all(),
  getRecurrence: (id: string): Recurrence | undefined => stmts.getRecurrence.get(id),
  insertRecurrence: (r: Recurrence) => stmts.insertRecurrence.run({ ...r, created_at: Date.now() }),
  updateRecurrence: (id: string, partial: Record<string, unknown>) => updateRow("recurrences", REC_COLS, id, partial),
  deleteRecurrence: (id: string) => { stmts.clearExceptions.run(id); stmts.deleteRecurrence.run(id); },
  listExceptions: (): { series_id: string; date: string }[] => stmts.listExceptions.all(),
  addException: (seriesId: string, date: string) => stmts.addException.run(seriesId, date),

  listPlaces: (): Place[] => stmts.listPlaces.all(),
  insertPlace: (p: Place) => stmts.insertPlace.run({ ...p, created_at: Date.now() }),
  deletePlace: (id: string) => stmts.deletePlace.run(id),
  getPlace: (id: string): Place | undefined => stmts.listPlaces.all().find((p) => p.id === id),

  listProfiles: (): Profile[] => stmts.listProfiles.all(),
  getProfile: (id: string): Profile | undefined => stmts.listProfiles.all().find((p) => p.id === id),
  insertProfile: (p: Profile) => stmts.insertProfile.run({ ...p, created_at: Date.now() }),
  deleteProfile: (id: string) => db.transaction(() => {
    stmts.deleteProfileTasks.run(id);
    stmts.deleteProfileExceptions.run(id);
    stmts.deleteProfileRecurrences.run(id);
    stmts.deleteProfileTodos.run(id);
    stmts.deleteProfile.run(id);
  })(),
  setProfilePin: (id: string, pinHash: string) => stmts.setProfilePin.run(pinHash, id),
  bumpProfileEpoch: (id: string) => stmts.bumpProfileEpoch.run(id),
  updateProfile: (id: string, name: string, theme: string) => stmts.renameProfile.run(name, theme, id),

  listTodos: (profile: string): Todo[] => stmts.listTodos.all(profile),
  getTodo: (id: string): Todo | undefined => stmts.getTodo.get(id),
  insertTodo: (t: Todo) => stmts.insertTodo.run({ ...t, created_at: Date.now() }),
  setTodoDone: (id: string, done: boolean) => stmts.setTodoDone.run(done ? 1 : 0, id),
  deleteTodo: (id: string) => stmts.deleteTodo.run(id),
  clearDoneTodos: (profile: string) => stmts.clearDoneTodos.run(profile),

  getHome: (): Home | undefined => stmts.getHome.get(),
  setHome: (h: Home) => stmts.setHome.run(h),
};
