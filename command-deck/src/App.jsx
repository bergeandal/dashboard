import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* ============================================================
   BERGE — Weekly Command Deck (v2)
   Calendar + weather come from the home-server API (/api/data).
   Done-state and dashboard-only tasks live in localStorage for now.
   ============================================================ */

const CATS = {
  work:     { label: "Work",     dot: "#2f5d9e", soft: "rgba(47,93,158,0.12)" },
  training: { label: "Training", dot: "#5b96cf", soft: "rgba(91,150,207,0.12)" },
  home:     { label: "Home",     dot: "#6f9e6a", soft: "rgba(111,158,106,0.12)" },
  social:   { label: "Social",   dot: "#b07ec2", soft: "rgba(176,126,194,0.12)" },
  birthday: { label: "Birthday", dot: "#d96a8a", soft: "rgba(217,106,138,0.14)" },
  event:    { label: "Event",    dot: "#d4a056", soft: "rgba(212,160,86,0.14)" },
};

// Household profiles. Berge is primary (his calendars + intervals.icu);
// Amanda is the second deck. Shared events surface in both.
const PROFILE_IDS = ["berge", "amanda"];
// Each profile carries a full accent palette; the active one is published as
// CSS variables on the shell so the whole page re-themes on switch.
const PROFILES = {
  berge:  { name: "Berge",  color: "#2f5d9e", soft: "#eef3fa", border: "#cdddef", grad: "linear-gradient(135deg, #2f5d9e 0%, #244b80 100%)", glow: "rgba(36,75,128,0.7)" },
  amanda: { name: "Amanda", color: "#b5547e", soft: "#fbeef4", border: "#edccda", grad: "linear-gradient(135deg, #b5547e 0%, #8f3f63 100%)", glow: "rgba(143,63,99,0.7)" },
};
const profileOf = (p) => PROFILES[p] || PROFILES.berge;
const themeVars = (p) => {
  const t = profileOf(p);
  return { "--accent": t.color, "--accent-soft": t.soft, "--accent-border": t.border, "--accent-grad": t.grad, "--accent-glow": t.glow };
};

const stripBursdag = (s) => s.replace(/\s*sin\s+bursdag\s*$/i, "").trim();

// Daily blocks and month-ahead events are one store now. Both are editable
// "stored tasks": new ones carry a `local:` id, migrated month events a `m:` id.
const isStored = (id) => typeof id === "string" && (id.startsWith("local:") || id.startsWith("m:"));

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const iso = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// "HH:MM" -> minutes since midnight (null for all-day / malformed).
const hm = (s) => { if (!s || !/^\d{1,2}:\d{2}/.test(s)) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmtRange = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${h}h ${m}m`;
};

// Per-task glyph — category default, with playful keyword overrides (some Norwegian, for Bergen).
const CAT_ICON = { work: "💼", training: "🏃", home: "🏡", social: "👥", birthday: "🎂", event: "📅" };
const taskIcon = (t) => {
  const s = (t.title || "").toLowerCase();
  if (t.cat === "training") {
    if (/\b(bike|cycl|ride|spin|sykk)\w*/.test(s)) return "🚴";
    if (/\b(run|jog|løp)\w*/.test(s)) return "🏃";
    if (/\b(swim|svøm)\w*/.test(s)) return "🏊";
    if (/\b(yoga|mobility|stretch|tøy)\w*/.test(s)) return "🧘";
    if (/\b(strength|gym|lift|styrke|vekt)\w*/.test(s)) return "🏋️";
    return "🏃";
  }
  if (/\b(call|ring|phone|telefon)\w*/.test(s)) return "📞";
  if (/\b(meet|møte|standup|sync|1:1)\w*/.test(s)) return "👥";
  if (/\b(lunch|dinner|breakfast|eat|middag|frokost|mat)\w*/.test(s)) return "🍽️";
  if (/\b(laundry|clean|vask|rydd)\w*/.test(s)) return "🧺";
  if (/\b(shop|handle|groceries|butikk)\w*/.test(s)) return "🛒";
  return CAT_ICON[t.cat] || "•";
};

// ── Fuelling config ───────────────────────────────────────────────
// All tunables live here. TODO: surface these in a settings panel so they're
// adjustable without a redeploy. Carbs in grams; rates in grams/hour.
const FUEL = {
  easyRate: 60,          // g/h for easy rides
  hardRate: 100,         // g/h for hard rides
  hardIF: 0.78,          // intensity factor at/above which a ride counts as "hard"
  bottleCarb: 60,        // carbs per full sports-drink bottle
  bottleStep: 0.5,       // bottles can be half-filled (≈30 g)
  maxBottles: 2,
  gelCarb: 25, maxGels: 2,
  barCarb: 30,  maxBars: 1,
};

const CYCLING_RE = /\b(bike|cycl|ride|spin|gravel|road|zwift|sykk|sykl)\w*/i;
const isCycling = (t) => t?.sport === "cycling" || CYCLING_RE.test(t?.title || "");

// Minutes from start→end ("HH:MM"), or null if not a timed block.
const taskDuration = (t) => {
  const s = hm(t?.start), e = hm(t?.end);
  return s != null && e != null && e > s ? e - s : null;
};

// Intensity Factor back-derived from planned TSS + duration: TSS = hours·IF²·100.
const rideIF = (tss, hours) => (tss && hours ? Math.sqrt(tss / (100 * hours)) : null);

// Greedy fuelling ladder: bottles first (½-granularity), then gels, then a bar.
function computeFuel(durationMin, tss, cfg = FUEL) {
  if (!durationMin || durationMin <= 0) return null;
  const hours = durationMin / 60;
  const IF = rideIF(tss, hours);
  const hard = IF != null && IF >= cfg.hardIF;
  const rate = hard ? cfg.hardRate : cfg.easyRate;
  const target = rate * hours;

  const clampStep = (v, step, max) => Math.max(0, Math.min(max, Math.round(v / step) * step));
  const bottles = clampStep(target / cfg.bottleCarb, cfg.bottleStep, cfg.maxBottles);
  let rem = target - bottles * cfg.bottleCarb;
  const gels = Math.max(0, Math.min(cfg.maxGels, Math.round(rem / cfg.gelCarb)));
  rem -= gels * cfg.gelCarb;
  const bars = Math.max(0, Math.min(cfg.maxBars, Math.round(rem / cfg.barCarb)));

  const delivered = Math.round(bottles * cfg.bottleCarb + gels * cfg.gelCarb + bars * cfg.barCarb);
  const capped = target > cfg.maxBottles * cfg.bottleCarb + cfg.maxGels * cfg.gelCarb + cfg.maxBars * cfg.barCarb;
  return { rate, hard, target: Math.round(target), delivered, capped, bottles, gels, bars, IF };
}

const fmtCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const REFRESH_MS = 5 * 60 * 1000;

const jsonPost = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function App() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const [calendarTasks, setCalendarTasks] = useState([]);
  const [birthdays, setBirthdays] = useState([]);
  const [weather, setWeather] = useState(null);
  const [localTasks, setLocalTasks] = useState([]);
  const [doneIds, setDoneIds] = useState([]);
  const [selectedDate, setSelectedDate] = useState(iso(today));
  const [openWeatherDate, setOpenWeatherDate] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [fitnessOpen, setFitnessOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editTask, setEditTask] = useState(null); // task open in the edit form
  const [scopePrompt, setScopePrompt] = useState(null); // { mode:'edit'|'delete', task, edited? }
  const [now, setNow] = useState(() => new Date());
  const [profile, setProfile] = useState(() => {
    const p = localStorage.getItem("cd.profile");
    return PROFILE_IDS.includes(p) ? p : "berge";
  });

  const switchProfile = (p) => {
    if (p === profile) return;
    localStorage.setItem("cd.profile", p);
    setProfile(p);
  };

  // Undo ("regret") toast for accidental deletes.
  const [toast, setToast] = useState(null); // { msg, onUndo }
  const toastTimer = useRef(null);
  const dismissToast = () => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); };
  const showToast = (msg, onUndo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, onUndo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Tick once a minute so the "now" marker, progress fill, and "min remaining" stay live.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const start = iso(today);
      const res = await fetch(`/api/data?start=${start}&days=120&profile=${profile}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalendarTasks(data.tasks || []);
      setBirthdays(data.birthdays || []);
      setLocalTasks(data.localTasks || []);
      setDoneIds(data.doneIds || []);
      setWeather(data.weather || null);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus((s) => s === "ready" ? "ready" : "error");
      setError(String(e.message || e));
    }
  }, [today, profile]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // One-time migration: push any localStorage values to the server, then clear them.
  useEffect(() => {
    if (status !== "ready") return;
    if (localStorage.getItem("cd.migrated")) return;
    (async () => {
      try {
        const lt = JSON.parse(localStorage.getItem("cd.localTasks") || "[]");
        const di = JSON.parse(localStorage.getItem("cd.doneIds") || "[]");
        const m  = JSON.parse(localStorage.getItem("cd.month") || "[]");
        for (const t of lt) await jsonPost("/api/tasks", t);
        for (const id of di) await fetch(`/api/done/${encodeURIComponent(id)}`, { method: "POST" });
        // Month-ahead events are now stored tasks; mark them important on the way in.
        for (const e of m) await jsonPost("/api/tasks", { ...e, important: e.important === false || e.important === 0 ? 0 : 1 });
        localStorage.setItem("cd.migrated", "1");
        localStorage.removeItem("cd.localTasks");
        localStorage.removeItem("cd.doneIds");
        localStorage.removeItem("cd.month");
        if (lt.length || di.length || m.length) fetchData();
      } catch (e) { console.warn("migration failed", e); }
    })();
  }, [status, fetchData]);

  useEffect(() => {
    if (!weather?.days?.length || openWeatherDate) return;
    setOpenWeatherDate(weather.days[0].date);
  }, [weather, openWeatherDate]);

  const doneSet = useMemo(() => new Set(doneIds), [doneIds]);
  const allTasks = useMemo(() => {
    const merged = [...calendarTasks, ...birthdays, ...localTasks].map((t) => ({ ...t, done: doneSet.has(t.id) }));
    return merged.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  }, [calendarTasks, birthdays, localTasks, doneSet]);

  const toggle = (id) => {
    const wasDone = doneSet.has(id);
    setDoneIds((prev) => wasDone ? prev.filter(x => x !== id) : [...prev, id]);
    const url = `/api/done/${encodeURIComponent(id)}`;
    fetch(url, { method: wasDone ? "DELETE" : "POST" }).catch((e) => console.warn("toggle failed", e));
  };

  // One add path for both the daily timeline and the month-ahead adder. The
  // month adder passes its own date + important:1; daily blocks default to the
  // selected day. Both land in the same store.
  const addTask = async (task) => {
    const res = await jsonPost("/api/tasks", { ...task, date: task.date || selectedDate, profile });
    if (res.ok) {
      const created = await res.json();
      setLocalTasks((prev) => [...prev, created]);
    } else {
      const e = await res.json().catch(() => ({}));
      alert(`Couldn't save block: ${e.error || `HTTP ${res.status}`}`);
    }
  };

  const removeTask = (id) => {
    if (!isStored(id)) return;
    const t = localTasks.find((x) => x.id === id);
    setLocalTasks((prev) => prev.filter(t => t.id !== id));
    fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => console.warn("delete failed", e));
    if (t) showToast(`Deleted “${t.title}”`, async () => {
      dismissToast();
      const res = await jsonPost("/api/tasks", t);
      if (res.ok) { const created = await res.json(); setLocalTasks((prev) => [...prev, created]); }
      else fetchData();
    });
  };

  const moveTask = (id, date) => {
    if (!isStored(id)) return;
    setLocalTasks((prev) => prev.map(t => t.id === id ? { ...t, date } : t));
    fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }),
    }).catch((e) => console.warn("move failed", e));
  };

  const createRecurrence = async (series) => {
    const res = await jsonPost("/api/recurrences", { ...series, profile });
    if (res.ok) fetchData();
    else { const e = await res.json().catch(() => ({})); alert(`Couldn't save repeat: ${e.error || `HTTP ${res.status}`}`); }
  };

  // --- Edit / delete, with recurrence scope (this / this+following / all) ---
  const recApi = (path, method, body) =>
    fetch(`/api/recurrences/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
      .then((r) => { if (r.ok) fetchData(); else console.warn("recurrence op failed", r.status); })
      .catch((e) => console.warn("recurrence op failed", e));

  const editLocalTask = async (id, fields) => {
    setLocalTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...fields } : t));
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(`Couldn't save edit: ${e.error || `HTTP ${res.status}`}`); fetchData(); }
  };

  const handleEdit = (task) => setEditTask(task);

  const saveEdit = (fields) => {
    const task = editTask;
    setEditTask(null);
    if (!task) return;
    if (task.recurring) setScopePrompt({ mode: "edit", task, edited: fields });
    else editLocalTask(task.id, fields);
  };

  const handleDelete = (task) => {
    if (task.recurring) setScopePrompt({ mode: "delete", task });
    else removeTask(task.id);
  };

  const applyScope = (which) => {
    const { mode, task, edited } = scopePrompt;
    const sid = encodeURIComponent(task.seriesId);
    if (mode === "delete") {
      if (which === "this") recApi(`${sid}/skip`, "POST", { date: task.date });
      else if (which === "following") recApi(`${sid}/truncate`, "POST", { date: task.date });
      else recApi(sid, "DELETE");
    } else {
      if (which === "this") {
        // skip the occurrence, then drop a one-off with the edits on that day
        fetch(`/api/recurrences/${sid}/skip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: task.date }) })
          .then(() => jsonPost("/api/tasks", { ...edited, date: task.date }))
          .then(() => fetchData()).catch((e) => console.warn("edit-this failed", e));
      } else if (which === "following") {
        recApi(`${sid}/split`, "POST", { date: task.date, ...edited });
      } else {
        recApi(sid, "PATCH", edited);
      }
    }
    setScopePrompt(null);
  };

  // Star (★) = surface in Month ahead. Shared = show on both decks. Both are
  // just fields on the unified store, patched on the task itself.
  const toggleImportant = (id, important) => {
    if (!isStored(id)) return;
    setLocalTasks((prev) => prev.map(t => t.id === id ? { ...t, important: important ? 1 : 0 } : t));
    fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ important }),
    }).catch((e) => console.warn("star failed", e));
  };

  const toggleShared = (id, shared) => {
    if (!isStored(id)) return;
    setLocalTasks((prev) => prev.map(t => t.id === id ? { ...t, shared: shared ? 1 : 0 } : t));
    fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shared }),
    }).catch((e) => console.warn("share toggle failed", e));
  };

  const dayTasks = (dateStr) =>
    allTasks.filter((t) => t.date === dateStr);

  const selectedTasks = dayTasks(selectedDate);
  const selDate = new Date(selectedDate + "T00:00:00");
  const isToday = selectedDate === iso(today);

  const upcomingTraining = useMemo(() => {
    const todayStr = iso(today);
    const cutoff = iso(addDays(today, 6));
    return allTasks
      .filter((t) => t.cat === "training" && t.date >= todayStr && t.date <= cutoff)
      .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  }, [allTasks, today]);

  const nextWorkout = useMemo(
    () => upcomingTraining.find((t) => !t.done) || null,
    [upcomingTraining],
  );

  const nextFuel = useMemo(
    () => (nextWorkout && isCycling(nextWorkout) ? computeFuel(taskDuration(nextWorkout), nextWorkout.tss) : null),
    [nextWorkout],
  );

  const { imminent, later } = useMemo(() => {
    const todayStr = iso(today);
    const tomorrowStr = iso(addDays(today, 1));
    const cutoffStr = iso(addDays(today, 30));
    // Month ahead = the ★-starred stored tasks (regardless of where they were added).
    const starred = localTasks.filter(t => t.important);
    const seen = new Set(starred.map(m => `${m.date}|${m.title}`));
    const bdays = birthdays
      .map(t => ({ id: t.id, date: t.date, title: stripBursdag(t.title), cat: "birthday" }))
      .filter(b => {
        const k = `${b.date}|${b.title}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    // Events from the calendar, dedup'd. Excluded from the imminent box later
    // since they already appear in the Today timeline with a time.
    const events = calendarTasks
      .filter(t => t.cat === "event")
      .map(t => ({ id: t.id, date: t.date, title: t.title, cat: "event", start: t.start }))
      .filter(e => {
        const k = `${e.date}|${e.title}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    // Month-ahead is curated: ★-starred stored tasks show here, alongside
    // birthdays and calendar 'event' items (which always surface).
    const all = [...starred, ...bdays, ...events]
      .filter(e => e.date >= todayStr && e.date <= cutoffStr)
      .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
    // Timed items (calendar events + timed month entries) show in the Today timeline,
    // so keep only untimed reminders/birthdays in the imminent box.
    return {
      imminent: all.filter(e => !e.start && (e.date === todayStr || e.date === tomorrowStr)),
      later: all.filter(e => e.date > tomorrowStr),
    };
  }, [localTasks, birthdays, calendarTasks, today]);

  if (status === "loading") {
    return <div style={{ ...S.shell, ...themeVars(profile) }}><style>{globalCss}</style><div style={S.loading}>Connecting to Command Deck…</div></div>;
  }

  const dayProgress = (dateStr) => {
    const ts = dayTasks(dateStr);
    if (!ts.length) return 0;
    return Math.round((ts.filter((t) => t.done).length / ts.length) * 100);
  };

  return (
    <div style={{ ...S.shell, ...themeVars(profile) }}>
      <style>{globalCss}</style>

      <header style={S.header}>
        <div>
          <div style={S.profileBar}>
            {PROFILE_IDS.map((id) => {
              const on = id === profile;
              return (
                <button key={id} onClick={() => switchProfile(id)}
                  style={{ ...S.profilePill, ...(on ? { background: profileOf(id).color, color: "#fff", borderColor: profileOf(id).color } : {}) }}
                  className="cd-push" aria-pressed={on}>
                  {profileOf(id).name}
                </button>
              );
            })}
          </div>
          <h1 style={S.h1}>Hei, {profileOf(profile).name} 👋</h1>
        </div>
        <div style={S.headerDate}>
          <div style={{ ...S.bigDay, color: profileOf(profile).color }}>{today.getDate()}</div>
          <div style={S.bigMonth}>{MONTHS[today.getMonth()].slice(0,3)} {today.getFullYear()}</div>
        </div>
      </header>

      {error && status !== "loading" && (
        <div style={S.errorBanner}>Couldn't reach server — showing last fetch. ({error})</div>
      )}

      <section style={{ ...S.card, ...S.weekCard }} className="cd-card">
        <div style={S.cardHead}>
          <h2 style={S.h2}>Next 7 days</h2>
          <button style={S.calOpenBtn} className="cd-push" onClick={() => setCalendarOpen(true)}>📅 Calendar</button>
        </div>
        <div style={S.weekRow}>
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(today, i);
            const dateStr = iso(d);
            const dname = i === 0 ? "Today" : DAYS[(d.getDay()+6)%7];
            const ts = dayTasks(dateStr);
            const active = dateStr === selectedDate;
            const isTod = i === 0;
            return (
              <button key={dateStr} onClick={() => setSelectedDate(dateStr)}
                style={{ ...S.weekDay, ...(active ? S.weekDayActive : {}) }} className="cd-weekday">
                <div style={S.weekName}>{dname}</div>
                <div style={{ ...S.weekNum, ...(isTod ? S.weekNumToday : {}) }}>{d.getDate()}</div>
                <div style={S.weekDots}>
                  {ts.slice(0, 5).map((t, j) => (
                    <span key={j} style={{ ...S.weekDot, background: CATS[t.cat].dot, opacity: t.done ? 0.4 : 1 }} />
                  ))}
                </div>
                <div style={S.weekCount}>{ts.length ? `${ts.filter(t=>t.done).length}/${ts.length}` : "—"}</div>
              </button>
            );
          })}
        </div>
      </section>

      <div style={S.grid}>
        <section style={{ ...S.card, gridColumn: "1 / 2" }} className="cd-card">
          <div style={S.cardHead}>
            <h2 style={S.h2}>{isToday ? "Today" : DAYS[(selDate.getDay()+6)%7]}</h2>
            <span style={S.cardSub}>{selDate.getDate()} {MONTHS[selDate.getMonth()].slice(0,3)} · {dayProgress(selectedDate)}% done</span>
          </div>

          <Timeline tasks={selectedTasks} isToday={isToday} now={now} onToggle={toggle} onEdit={handleEdit} onDelete={handleDelete} onMove={moveTask} onStar={toggleImportant} />

          <AddRow
            adding={adding} setAdding={setAdding}
            onAdd={addTask} onAddRecurring={createRecurrence}
            selectedDate={selectedDate}
          />
        </section>

        <section
          style={{ ...S.card, ...S.workoutCard }}
          className="cd-card cd-workout"
          onClick={() => setFitnessOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFitnessOpen(true); } }}
        >
          <div style={S.cardHead}>
            <h2 style={{ ...S.h2, color: "#fff" }}>Next workout</h2>
            <span style={S.woOpen}>Fitness ↗</span>
          </div>
          {nextWorkout ? (
            <>
              <div style={S.woTitle}>{nextWorkout.title}</div>
              <div style={S.woMeta}>
                {[
                  nextWorkout.date === iso(today) ? "Today" : DAYS[(new Date(nextWorkout.date+"T00:00:00").getDay()+6)%7],
                  nextWorkout.start && (nextWorkout.end ? `${nextWorkout.start}–${nextWorkout.end}` : nextWorkout.start),
                  taskDuration(nextWorkout) && fmtRange(taskDuration(nextWorkout)),
                  nextWorkout.tss && `${nextWorkout.tss} TSS`,
                ].filter(Boolean).join(" · ")}
              </div>
              {nextWorkout.note && <div style={S.woNote}>{nextWorkout.note}</div>}
              {nextFuel && (
                <div style={S.woFuel}>
                  <div style={S.woFuelHead}>
                    Fuelling · {nextFuel.rate} g/h{nextFuel.hard ? " (hard)" : ""} · ~{nextFuel.delivered} g carbs
                    {nextFuel.capped ? " · capped" : ""}
                  </div>
                  <div style={S.woFuelChips}>
                    <FuelChip icon="🥤" n={nextFuel.bottles} label="Bottles" />
                    <FuelChip icon="🍬" n={nextFuel.gels} label="Gels" />
                    <FuelChip icon="🍫" n={nextFuel.bars} label="Bar" />
                  </div>
                </div>
              )}
            </>
          ) : <div style={{ ...S.empty, color: "rgba(255,255,255,0.8)" }}>No upcoming training scheduled.</div>}
        </section>
      </div>

      <div style={S.grid}>
        <section style={S.card} className="cd-card">
          <div style={S.cardHead}><h2 style={S.h2}>Month ahead</h2><span style={S.cardSub}>next 30 days</span></div>
          <MonthList imminent={imminent} later={later} today={today} onAdd={addTask} onRemove={removeTask} onStar={toggleImportant} onShare={toggleShared} />
        </section>

        <section style={S.card} className="cd-card">
          <div style={S.cardHead}>
            <h2 style={S.h2}>{weather?.place || "Bergen"}</h2>
            <span style={S.cardSub}>{weather ? "Live from YR.no" : "Loading…"}</span>
          </div>
          {weather?.days?.length ? (
            <>
              <div style={S.wxRow}>
                {weather.days.map((w) => {
                  const open = w.date === openWeatherDate;
                  return (
                    <button key={w.date} onClick={() => setOpenWeatherDate(open ? null : w.date)}
                      style={{ ...S.wxDay, ...(open ? S.wxDayActive : {}) }} className="cd-weekday">
                      <div style={S.wxName}>{w.d}</div>
                      <div style={S.wxIcon}>{w.icon}</div>
                      <div style={S.wxHi}>{w.hi}°</div>
                      <div style={S.wxLo}>{w.lo}°</div>
                      <div style={S.wxPop}>{w.pop}%</div>
                    </button>
                  );
                })}
              </div>
              <WeatherDetail day={weather.days.find(d => d.date === openWeatherDate)} />
            </>
          ) : <div style={S.empty}>Weather unavailable.</div>}
        </section>
      </div>

      <footer style={S.footer}>
        v2 · everything synced via your home server · refreshes every 5 min
      </footer>

      {fitnessOpen && <FitnessOverlay nextWorkout={nextWorkout} upcoming={upcomingTraining} today={today} profile={profile} onClose={() => setFitnessOpen(false)} />}
      {calendarOpen && (
        <CalendarOverlay
          selectedDate={selectedDate} today={today}
          onPick={(ds) => { setSelectedDate(ds); setCalendarOpen(false); }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {editTask && (
        <EditModal task={editTask} onSave={saveEdit} onClose={() => setEditTask(null)} />
      )}
      {scopePrompt && (
        <ScopePopup
          mode={scopePrompt.mode} task={scopePrompt.task}
          onThis={() => applyScope("this")}
          onFollowing={() => applyScope("following")}
          onAll={() => applyScope("all")}
          onClose={() => setScopePrompt(null)}
        />
      )}
      {toast && (
        <div style={S.toast} className="cd-toast" role="status">
          <span style={S.toastMsg}>{toast.msg}</span>
          {toast.onUndo && <button style={S.toastUndo} className="cd-toast-undo" onClick={toast.onUndo}>↩ Undo</button>}
          <button style={S.toastClose} onClick={dismissToast} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}

const fmtDur = (secs) => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
};
const fmtSleep = (secs) => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
};
const relDay = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff}d ago`;
};
// Form/TSB bands (Coggan): >5 fresh, -10..5 grey/neutral, -30..-10 optimal-ish, <-30 high fatigue.
const formBand = (f) => {
  if (f === null || f === undefined) return { label: "—", color: faint };
  if (f > 5) return { label: "Fresh", color: "#5b96cf" };
  if (f >= -10) return { label: "Neutral", color: "#6f9e6a" };
  if (f >= -30) return { label: "Building", color: "#d4a056" };
  return { label: "Fatigued", color: "#d96a8a" };
};

function FitnessOverlay({ nextWorkout, upcoming, today, profile, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState(null); // null | "power" | "hr"

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/fitness?profile=${profile}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (alive) { setData(j); setState("ready"); }
      } catch (e) {
        if (alive) { setErr(String(e.message || e)); setState("error"); }
      }
    })();
    return () => { alive = false; };
  }, [profile]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Esc backs out of the detail drill-in first, then closes the overlay.
      if (detail) setDetail(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose, detail]);

  const load = data?.load;
  const ftp = data?.ftp;
  const hr = data?.hr;
  const wel = data?.wellness;
  const band = formBand(load?.form);
  const wkg = ftp?.value && wel?.weight ? (ftp.value / wel.weight).toFixed(1) : null;

  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={S.ovPanel} className="cd-ov-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={S.ovHead}>
          <div>
            <div style={S.kicker}>Fitness &amp; Health</div>
            <h2 style={S.ovTitle}>Training readiness</h2>
          </div>
          <button style={S.ovClose} onClick={onClose} aria-label="Close" className="cd-ov-close">×</button>
        </div>

        {state === "loading" && <div style={S.ovLoading}>Reading intervals.icu…</div>}
        {state === "error" && <div style={S.ovError}>Couldn't load fitness data. ({err})</div>}

        {state === "ready" && data && (
          <div style={S.ovBody}>
            {data.staleDays !== null && data.staleDays > 2 && (
              <div style={S.ovStale}>
                Last activity {data.staleDays} days ago — intervals.icu may still be syncing.
              </div>
            )}

            {/* This week's plan */}
            <div style={S.ovSection}>
              <div style={S.ovSectionHead}>This week<span style={S.ovAsOf}>next 7 days</span></div>
              <MiniPlan upcoming={upcoming} today={today} nextId={nextWorkout?.id} />
            </div>

            {/* Training load — the dynamic thing worth watching */}
            <div style={S.ovSection}>
              <div style={S.ovSectionHead}>Training load{load?.asOf ? <span style={S.ovAsOf}>as of {relDay(load.asOf)}</span> : null}</div>
              <div style={S.ovStats}>
                <Stat label="Fitness" sub="CTL" value={load?.ctl ?? "—"} />
                <Stat label="Fatigue" sub="ATL" value={load?.atl ?? "—"} />
                <Stat label="Form" sub="TSB" value={load?.form ?? "—"} accent={band.color} chip={band.label} />
              </div>
              <div style={S.ovTssRow}>
                <span>Last 7 days <b style={S.ovTssNum}>{load?.last7Tss ?? 0}</b> TSS</span>
                <span>Last 6 weeks <b style={S.ovTssNum}>{load?.last42Tss ?? 0}</b> TSS</span>
              </div>
            </div>

            {/* Compact threshold boxes — tap to drill into zones */}
            <div style={S.ovBoxRow}>
              <MetricBox
                label="FTP" value={ftp?.value ?? "—"} unit="W"
                sub={wkg ? `${wkg} W/kg` : (ftp?.value ? "power" : "not set")}
                disabled={!ftp?.zones?.length}
                onClick={() => ftp?.zones?.length && setDetail("power")}
              />
              <MetricBox
                label="Threshold HR" value={hr?.lthr ?? "—"} unit="bpm"
                sub={hr?.maxHr ? `max ${hr.maxHr}` : "heart rate"}
                disabled={!hr?.zones?.length}
                onClick={() => hr?.zones?.length && setDetail("hr")}
              />
            </div>

            {/* Recovery — sleep bars + HRV / sleep-score trend lines */}
            <div style={S.ovSection}>
              <div style={S.ovSectionHead}>Recovery{wel?.date ? <span style={S.ovAsOf}>14-day trend</span> : null}</div>
              <RecoveryChart series={wel?.series || []} />
              <div style={S.ovRecCap}>
                <span>HRV <b style={{ color: accent }}>{wel?.hrv ?? "—"}</b> ms</span>
                <span>Sleep <b style={{ color: ink }}>{fmtSleep(wel?.sleepSecs)}</b></span>
                <span>Resting HR <b style={{ color: ink }}>{wel?.restingHR ?? "—"}</b></span>
                <span>Weight <b style={{ color: ink }}>{wel?.weight ?? "—"}</b> kg</span>
              </div>
            </div>

            <div style={S.ovFootHint}>Workout-plan generator coming next — this is the data it'll use.</div>
          </div>
        )}

        {/* Drill-in detail window */}
        {detail === "power" && (
          <ZoneDetail
            title="Power zones" onBack={() => setDetail(null)}
            head={[ftp?.value ? `FTP ${ftp.value} W` : null, wkg ? `${wkg} W/kg` : null, ftp?.wPrime ? `W' ${(ftp.wPrime / 1000).toFixed(1)} kJ` : null].filter(Boolean).join(" · ")}
            rows={ftp.zones.map((z, i) => ({
              color: ZONE_COLORS[i] || accent,
              name: z.name,
              main: `${z.from}${z.to ? `–${z.to}` : "+"} W`,
              pct: ftp.value ? `${Math.round((z.from / ftp.value) * 100)}${z.to ? `–${Math.round((z.to / ftp.value) * 100)}` : "+"}% FTP` : "",
            }))}
          />
        )}
        {detail === "hr" && (
          <ZoneDetail
            title="Heart-rate zones" onBack={() => setDetail(null)}
            head={[hr?.lthr ? `LTHR ${hr.lthr}` : null, hr?.maxHr ? `max ${hr.maxHr}` : null, hr?.restingHr ? `rest ${hr.restingHr}` : null].filter(Boolean).join(" · ")}
            rows={hr.zones.map((z, i) => ({
              color: ZONE_COLORS[i] || accent,
              name: z.name,
              main: `${z.from || "<"}${z.to ? `–${z.to}` : "+"} bpm`,
              pct: hrrPct(z, hr),
            }))}
          />
        )}
      </div>
    </div>
  );
}

// %HRR (Karvonen): (bpm - rest) / (max - rest). Needs both anchors.
function hrrPct(z, hr) {
  if (!hr?.maxHr || !hr?.restingHr) return "";
  const reserve = hr.maxHr - hr.restingHr;
  const pc = (bpm) => Math.max(0, Math.round(((bpm - hr.restingHr) / reserve) * 100));
  return `${pc(z.from)}${z.to ? `–${pc(z.to)}` : "+"}% HRR`;
}

function Stat({ label, sub, value, accent: ac, chip }) {
  return (
    <div style={S.ovStat}>
      <div style={S.ovStatLabel}>{label}{sub ? <span style={S.ovStatSub}> {sub}</span> : null}</div>
      <div style={{ ...S.ovStatValue, color: ac || ink }}>{value}</div>
      {chip && <div style={{ ...S.ovStatChip, color: ac, background: `${ac}1f` }}>{chip}</div>}
    </div>
  );
}

function MetricBox({ label, value, unit, sub, onClick, disabled }) {
  return (
    <button
      style={{ ...S.ovBox, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.7 : 1 }}
      className={disabled ? "" : "cd-ov-box"} onClick={onClick} disabled={disabled}
    >
      <div style={S.ovBoxLabel}>{label}{!disabled && <span style={S.ovBoxChevron}>›</span>}</div>
      <div style={S.ovBoxValue}>{value}<span style={S.ovBoxUnit}> {unit}</span></div>
      <div style={S.ovBoxSub}>{sub}</div>
    </button>
  );
}

function MiniPlan({ upcoming, today, nextId }) {
  if (!upcoming?.length) {
    return <div style={S.ovPlanEmpty}>No training scheduled this week. The plan generator will fill this in.</div>;
  }
  return (
    <div style={S.ovPlan}>
      {upcoming.map((t) => {
        const d = new Date(t.date + "T00:00:00");
        const isToday = t.date === iso(today);
        const isNext = t.id === nextId;
        return (
          <div key={t.id} style={{ ...S.ovPlanRow, ...(isNext ? S.ovPlanNext : {}) }}>
            <span style={S.ovPlanDay}>{isToday ? "Today" : DAYS[(d.getDay() + 6) % 7]}</span>
            <span style={{ ...S.ovPlanDot, opacity: t.done ? 0.35 : 1 }} />
            <span style={{ ...S.ovPlanTitle, textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.55 : 1 }}>{t.title}</span>
            <span style={S.ovPlanTime}>{t.start || ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function ZoneDetail({ title, head, rows, onBack }) {
  return (
    <div style={S.ovDetail} className="cd-ov-panel">
      <div style={S.ovDetailHead}>
        <button style={S.ovBack} onClick={onBack} className="cd-ov-close" aria-label="Back">‹</button>
        <div>
          <h3 style={S.ovDetailTitle}>{title}</h3>
          {head && <div style={S.ovDetailSub}>{head}</div>}
        </div>
      </div>
      <div style={S.ovZones}>
        {rows.map((r, i) => (
          <div key={i} style={S.ovZoneRow}>
            <span style={{ ...S.ovZoneBar, background: r.color }} />
            <span style={S.ovZoneName}>{r.name}</span>
            <span style={S.ovZonePct}>{r.pct}</span>
            <span style={S.ovZoneMain}>{r.main}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Hand-rolled SVG: sleep duration as bars, HRV + sleep-score as trend lines.
// Each line is auto-scaled to its own 14-day range, so you read the *shape*
// (e.g. an HRV dip = early sickness) rather than absolute axis values.
function RecoveryChart({ series }) {
  const pts = series || [];
  const has = (k) => pts.some((p) => p[k] != null);
  if (!pts.length || (!has("hrv") && !has("sleepSecs"))) {
    return <div style={S.empty}>Not enough recovery data yet.</div>;
  }
  const W = 320, H = 116, padX = 6, padTop = 10, padBot = 18;
  const n = pts.length;
  const plotH = H - padTop - padBot;
  const x = (i) => padX + (i * (W - 2 * padX)) / (n - 1);
  const bw = ((W - 2 * padX) / n) * 0.5;

  // Bars: sleep hours against a fixed 10h ceiling so bar height reads absolutely.
  const sleepH = (s) => (s == null ? null : s / 3600);
  const barY = (h) => padTop + plotH - Math.min(h / 10, 1) * plotH;

  // Lines: auto-scale to each series' own min/max (with a little padding).
  const lineY = (val, vals) => {
    const arr = vals.filter((v) => v != null);
    if (!arr.length || val == null) return null;
    let lo = Math.min(...arr), hi = Math.max(...arr);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.15;
    lo -= pad; hi += pad;
    return padTop + plotH - ((val - lo) / (hi - lo)) * plotH;
  };
  const hrvVals = pts.map((p) => p.hrv);
  const scoreVals = pts.map((p) => p.sleepScore);

  const path = (vals) => {
    let d = "", started = false;
    pts.forEach((p, i) => {
      const y = lineY(p[vals], pts.map((q) => q[vals]));
      if (y == null) { started = false; return; }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y.toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const lastIdx = (k) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i][k] != null) return i; return -1; };
  const hrvLast = lastIdx("hrv"), scoreLast = lastIdx("sleepScore");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={S.ovChart} preserveAspectRatio="none">
      {/* sleep bars */}
      {pts.map((p, i) => {
        const h = sleepH(p.sleepSecs);
        if (h == null) return null;
        const y = barY(h);
        return <rect key={i} x={x(i) - bw / 2} y={y} width={bw} height={padTop + plotH - y} rx={1.5} fill="#cfe0f0" />;
      })}
      {/* sleep-score line (secondary) */}
      <path d={path("sleepScore")} fill="none" stroke="#b07ec2" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.75" />
      {/* HRV line (primary — the sickness signal) */}
      <path d={path("hrv")} fill="none" stroke={accent} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {scoreLast >= 0 && <circle cx={x(scoreLast)} cy={lineY(pts[scoreLast].sleepScore, scoreVals)} r="2.6" fill="#b07ec2" />}
      {hrvLast >= 0 && <circle cx={x(hrvLast)} cy={lineY(pts[hrvLast].hrv, hrvVals)} r="3" fill={accent} />}
      {/* end date labels */}
      <text x={padX} y={H - 5} style={S.ovChartTick} textAnchor="start">{(pts[0].date || "").slice(5)}</text>
      <text x={W - padX} y={H - 5} style={S.ovChartTick} textAnchor="end">{(pts[n - 1].date || "").slice(5)}</text>
    </svg>
  );
}

function CalendarOverlay({ selectedDate, today, onPick, onClose }) {
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [byDay, setByDay] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  // Monday on/before the 1st — start of the 6-week grid.
  const gridStart = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    return addDays(first, -((first.getDay() + 6) % 7));
  }, [viewMonth]);

  // The calendar fetches its own window per displayed month, so you can browse anywhere.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/data?start=${iso(gridStart)}&days=42`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        const map = {};
        const push = (date, cat) => { (map[date] ||= new Set()).add(cat); };
        (d.tasks || []).forEach((t) => push(t.date, t.cat));
        (d.birthdays || []).forEach((t) => push(t.date, "birthday"));
        (d.localTasks || []).forEach((t) => push(t.date, t.cat));
        setByDay(map); setLoading(false);
      })
      .catch(() => { if (alive) { setByDay({}); setLoading(false); } });
    return () => { alive = false; };
  }, [gridStart]);

  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayStr = iso(today);
  const stepMonth = (n) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={{ ...S.ovPanel, maxWidth: 680 }} className="cd-ov-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={S.ovHead}>
          <div>
            <div style={S.kicker}>Calendar</div>
            <h2 style={S.ovTitle}>{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</h2>
          </div>
          <div style={S.calNav}>
            <button style={S.calNavBtn} className="cd-ov-close" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
            <button style={S.calTodayBtn} className="cd-push" onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
            <button style={S.calNavBtn} className="cd-ov-close" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
            <button style={S.ovClose} className="cd-ov-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div style={S.calWeekHead}>
          {DAYS.map((d) => <div key={d} style={S.calWeekName}>{d}</div>)}
        </div>
        <div style={S.calGrid}>
          {cells.map((d) => {
            const ds = iso(d);
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const cats = byDay[ds] ? [...byDay[ds]] : [];
            const isTod = ds === todayStr;
            const isSel = ds === selectedDate;
            return (
              <button key={ds} onClick={() => onPick(ds)} className="cd-cal-cell"
                style={{ ...S.calCell, ...(inMonth ? {} : S.calCellOut), ...(isSel ? S.calCellSel : {}), ...(isTod ? S.calCellToday : {}) }}>
                <div style={{ ...S.calNum, ...(isTod ? S.calNumToday : {}) }}>{d.getDate()}</div>
                <div style={S.calDots}>
                  {cats.slice(0, 5).map((c, j) => <span key={j} style={{ ...S.calDot, background: CATS[c]?.dot || "#888" }} />)}
                </div>
              </button>
            );
          })}
        </div>
        <div style={S.calFoot}>{loading ? "Loading…" : "Tap a day to open it"}</div>
      </div>
    </div>
  );
}

function Timeline({ tasks, isToday, now, onToggle, onEdit, onDelete, onMove, onStar }) {
  if (!tasks.length) {
    return <div style={S.tlEmpty}>Nothing scheduled. Tap <b>+ Add block</b> to shape your day.</div>;
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Interleave free-time nudges between consecutive timed blocks (Structured-style).
  const rows = [];
  tasks.forEach((t, i) => {
    rows.push({ kind: "task", t });
    const next = tasks[i + 1];
    const end = hm(t.end), nStart = next && hm(next.start);
    if (end != null && nStart != null && nStart - end >= 15) {
      rows.push({ kind: "gap", from: end, to: nStart, mins: nStart - end });
    }
  });

  return (
    <div style={S.timeline}>
      {rows.map((r, idx) => {
        if (r.kind === "gap") {
          const nowHere = isToday && nowMin >= r.from && nowMin < r.to;
          return (
            <div key={`gap-${idx}`} style={S.tlGapRow}>
              <div style={S.tlTime} />
              <div style={S.tlSpine}><div style={S.tlLineDash} /></div>
              <div style={S.tlGap}>
                <span style={S.tlGapIcon}>🕒</span>
                {nowHere
                  ? <span style={S.tlGapNow}>{fmtRange(r.to - nowMin)} of free time right now</span>
                  : <span>{r.mins <= 30 ? `${r.mins} min to spare — squeeze something in?` : `A ${fmtRange(r.mins)} breather`}</span>}
              </div>
            </div>
          );
        }

        const t = r.t;
        const start = hm(t.start), end = hm(t.end);
        const inProgress = isToday && !t.done && start != null && end != null && nowMin >= start && nowMin < end;
        const progress = inProgress ? Math.min(1, Math.max(0, (nowMin - start) / (end - start))) : 0;
        const c = CATS[t.cat] || CATS.work;
        // Overdue: today, not done, its time has passed. Only local tasks can be rescheduled.
        const endMin = end ?? start;
        const overdue = isToday && !t.done && endMin != null && nowMin > endMin;
        const stored = isStored(t.id);
        const canPush = overdue && stored;

        return (
          <div key={t.id} style={S.tlRow} className="cd-row">
            <div style={S.tlTime}>
              <div style={inProgress ? S.tlNowTime : null}>{t.start || "all-day"}</div>
              {t.end ? <div style={S.tlTimeEnd}>{t.end}</div> : null}
            </div>

            <div style={S.tlSpine}>
              <div style={S.tlLineFull} />
              <div
                style={{ ...S.tlBadge, background: c.soft, border: `2px solid ${c.dot}`,
                         opacity: t.done ? 0.5 : 1,
                         boxShadow: inProgress ? `0 0 0 4px ${cardBg}, 0 0 0 7px ${c.soft}` : `0 0 0 4px ${cardBg}` }}
                className={inProgress ? "cd-badge-live" : ""}
              >
                <span style={S.tlBadgeGlyph}>{taskIcon(t)}</span>
              </div>
            </div>

            <div style={S.tlBlockCol}>
              <button
                onClick={() => onToggle(t.id)}
                style={{ ...S.tlBlock, ...(inProgress ? S.tlBlockActive : {}), ...(overdue ? S.tlBlockOverdue : {}), opacity: t.done ? 0.62 : 1 }}
                className="cd-block"
              >
                {inProgress && <div style={{ ...S.tlFill, width: `${Math.round(progress * 100)}%`, background: c.soft }} />}
                <div style={S.tlBlockInner}>
                  <div style={S.tlBlockTop}>
                    <span style={{ ...S.tlTitle, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                    <span style={{ ...S.check, borderColor: c.dot, background: t.done ? c.dot : "transparent" }}>
                      {t.done ? "✓" : ""}
                    </span>
                  </div>
                  {inProgress
                    ? <div style={S.tlRemaining}>{end - nowMin} min remaining</div>
                    : (t.note ? <div style={S.tlNote}>{t.note}</div> : null)}
                  {!inProgress && (
                    <span style={{ ...S.tag, color: c.dot }}>{c.label}{t.important ? " · ★" : ""}{t.recurring ? " · ↻" : ""}{t.shared ? " · 🔗" : ""}</span>
                  )}
                </div>
              </button>
              {canPush && <PushBar taskDate={t.date} onMove={(d) => onMove(t.id, d)} />}
            </div>

            {(stored || t.recurring) && (
              <div style={S.tlActions}>
                {stored && (
                  <button onClick={() => onStar(t.id, !t.important)} style={{ ...S.actBtn, color: t.important ? "#d4a056" : faint }}
                    title={t.important ? "Starred — shown in Month ahead. Tap to unstar." : "Star — show in Month ahead"}
                    className={t.important ? "" : "cd-del"}>{t.important ? "★" : "☆"}</button>
                )}
                <button onClick={() => onEdit(t)} style={S.actBtn} title="Edit" className="cd-del">✎</button>
                <button onClick={() => onDelete(t)} style={S.actBtn} title={t.recurring ? "Delete (repeating)" : "Delete"} className="cd-del">×</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PushBar({ taskDate, onMove }) {
  const [pick, setPick] = useState(false);
  const plus = (n) => { const d = new Date(taskDate + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  return (
    <div style={S.pushBar}>
      <span style={S.pushHint}>⌛ time's up — push to</span>
      <button style={S.pushBtn} className="cd-push" onClick={() => onMove(plus(1))}>Tomorrow</button>
      <button style={S.pushBtn} className="cd-push" onClick={() => onMove(plus(2))}>+2d</button>
      {pick
        ? <input type="date" autoFocus min={plus(1)} style={S.pushDate}
            onChange={(e) => e.target.value && onMove(e.target.value)} />
        : <button style={S.pushBtn} className="cd-push" onClick={() => setPick(true)}>📅 Pick</button>}
    </div>
  );
}

function FuelChip({ icon, n, label }) {
  return (
    <div style={{ ...S.woChip, opacity: n > 0 ? 1 : 0.5 }}>
      <div style={S.woChipNum}><span style={S.woChipIcon}>{icon}</span> {fmtCount(n)}</div>
      <div style={S.woChipLbl}>{label}</div>
    </div>
  );
}

function AddRow({ adding, setAdding, onAdd, onAddRecurring, selectedDate }) {
  const defaultWd = ((new Date(selectedDate + "T00:00:00").getDay()) + 6) % 7;
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("");
  const [cat, setCat] = useState("work");
  const [note, setNote] = useState("");
  const [tss, setTss] = useState("");
  const [freq, setFreq] = useState("none");
  const [interval, setIntervalN] = useState(1);
  const [weekdays, setWeekdays] = useState([defaultWd]);
  const [endMode, setEndMode] = useState("never");
  const [until, setUntil] = useState("");
  const [count, setCount] = useState("");
  const [shared, setShared] = useState(false);
  const [important, setImportant] = useState(false);

  if (!adding) {
    return <button style={S.addBtn} onClick={() => setAdding(true)} className="cd-add">+ Add block</button>;
  }

  const toggleWd = (i) => setWeekdays((w) => w.includes(i) ? w.filter((x) => x !== i) : [...w, i]);
  const unit = freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : "month(s)";
  const invalidEnd = freq !== "none" && ((endMode === "until" && !until) || (endMode === "count" && !count));

  const reset = () => { setTitle(""); setEnd(""); setNote(""); setTss(""); setFreq("none"); setIntervalN(1); setEndMode("never"); setUntil(""); setCount(""); setShared(false); setImportant(false); setAdding(false); };

  const submit = () => {
    if (!title.trim()) return;
    const base = { title: title.trim(), start, end, cat, note: note.trim(), shared, tss: cat === "training" && tss ? Number(tss) : null };
    if (freq === "none") {
      onAdd({ ...base, important });
    } else {
      onAddRecurring({
        ...base, dtstart: selectedDate, freq, interval: Number(interval) || 1,
        byweekday: freq === "weekly" ? (weekdays.length ? weekdays : [defaultWd]) : [],
        endMode, until: endMode === "until" ? until : "", count: endMode === "count" ? (Number(count) || null) : null,
      });
    }
    reset();
  };

  return (
    <div style={S.addPanel}>
      <input autoFocus placeholder="What?" value={title} onChange={(e)=>setTitle(e.target.value)} style={S.input} />
      <div style={S.addGrid}>
        <input type="time" value={start} onChange={(e)=>setStart(e.target.value)} style={S.input} />
        <input type="time" value={end} onChange={(e)=>setEnd(e.target.value)} style={S.input} />
      </div>
      <input placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} style={S.input} />
      {cat === "training" && (
        <input type="number" min="0" placeholder="Target TSS (optional — drives fuelling intensity)"
          value={tss} onChange={(e)=>setTss(e.target.value)} style={S.input} />
      )}
      <div style={S.catPick}>
        {Object.entries(CATS).map(([k, v]) => (
          <button key={k} onClick={() => setCat(k)}
            style={{ ...S.catChip, borderColor: v.dot, background: cat===k ? v.soft : "transparent", color: v.dot }}>
            {v.label}
          </button>
        ))}
      </div>

      <div style={S.repeatRow}>
        <span style={S.repeatLabel}>↻ Repeat</span>
        <select value={freq} onChange={(e)=>setFreq(e.target.value)} style={{ ...S.input, flex: 1 }}>
          <option value="none">Doesn't repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {freq !== "none" && (
        <div style={S.repeatPanel}>
          <div style={S.repeatInline}>
            <span style={S.repeatWord}>every</span>
            <input type="number" min="1" value={interval} onChange={(e)=>setIntervalN(e.target.value)} style={{ ...S.input, width: 60, flex: "0 0 auto" }} />
            <span style={S.repeatWord}>{unit}</span>
          </div>
          {freq === "weekly" && (
            <div style={S.wdPick}>
              {DAYS.map((d, i) => (
                <button key={i} onClick={() => toggleWd(i)}
                  style={{ ...S.wdChip, ...(weekdays.includes(i) ? S.wdChipOn : {}) }}>{d[0]}</button>
              ))}
            </div>
          )}
          <div style={S.repeatInline}>
            <span style={S.repeatWord}>ends</span>
            <select value={endMode} onChange={(e)=>setEndMode(e.target.value)} style={{ ...S.input, width: 120, flex: "0 0 auto" }}>
              <option value="never">never</option>
              <option value="until">on date</option>
              <option value="count">after N</option>
            </select>
            {endMode === "until" && <input type="date" value={until} onChange={(e)=>setUntil(e.target.value)} style={{ ...S.input, flex: "0 0 auto" }} />}
            {endMode === "count" && <input type="number" min="1" placeholder="N" value={count} onChange={(e)=>setCount(e.target.value)} style={{ ...S.input, width: 70, flex: "0 0 auto" }} />}
            {endMode === "count" && <span style={S.repeatWord}>times</span>}
          </div>
        </div>
      )}

      {freq === "none" && <StarToggle important={important} onToggle={() => setImportant((s) => !s)} />}
      <SharedToggle shared={shared} onToggle={() => setShared((s) => !s)} />

      <div style={S.addActions}>
        <button style={S.cancelBtn} onClick={reset}>Cancel</button>
        <button style={S.saveBtn} disabled={!title.trim() || invalidEnd} onClick={submit}>
          {freq === "none" ? "Add" : "Add repeating"}
        </button>
      </div>
    </div>
  );
}

// Toggle that stars an item so it surfaces in the "Month ahead" list.
function StarToggle({ important, onToggle }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={important}
      style={{ ...S.shareToggle, ...(important ? S.starToggleOn : {}) }}
      title="Starred events show in the Month-ahead list">
      <span>{important ? "★" : "☆"}</span>{important ? "Starred — in Month ahead" : "Star (show in Month ahead)"}
    </button>
  );
}

// Toggle that marks an item visible on both household decks.
function SharedToggle({ shared, onToggle }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={shared}
      style={{ ...S.shareToggle, ...(shared ? S.shareToggleOn : {}) }}
      title="Shared events show on both Berge's and Amanda's deck">
      <span>🔗</span>{shared ? "Shared with both decks" : "Make shared (both decks)"}
    </button>
  );
}

function ScopePopup({ mode, task, onThis, onFollowing, onAll, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const verb = mode === "edit" ? "Edit" : "Delete";
  const danger = mode === "delete" ? S.scopeBtnDanger : {};
  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={S.scopePanel} className="cd-ov-panel" onClick={(e)=>e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 style={S.scopeTitle}>{verb} repeating task</h3>
        <p style={S.scopeText}>“{task.title}” repeats. Apply this {mode} to:</p>
        <button style={S.scopeBtn} className="cd-ov-box" onClick={onThis}>
          This occurrence<span style={S.scopeSub}>{task.date} only</span>
        </button>
        <button style={S.scopeBtn} className="cd-ov-box" onClick={onFollowing}>
          This and following<span style={S.scopeSub}>from {task.date} onward</span>
        </button>
        <button style={{ ...S.scopeBtn, ...danger }} className="cd-ov-box" onClick={onAll}>
          All occurrences<span style={S.scopeSub}>the whole series</span>
        </button>
        <button style={S.scopeCancel} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function EditModal({ task, onSave, onClose }) {
  const [title, setTitle] = useState(task.title || "");
  const [start, setStart] = useState(task.start || "");
  const [end, setEnd] = useState(task.end || "");
  const [cat, setCat] = useState(task.cat || "work");
  const [note, setNote] = useState(task.note || "");
  const [tss, setTss] = useState(task.tss ? String(task.tss) : "");
  const [shared, setShared] = useState(!!task.shared);
  const [important, setImportant] = useState(!!task.important);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    if (!title.trim()) return;
    const fields = { title: title.trim(), start, end, cat, note: note.trim(), sport: task.sport || "", shared, tss: cat === "training" && tss ? Number(tss) : null };
    // Repeating series have no per-instance star; only stored one-off tasks do.
    if (!task.recurring) fields.important = important;
    onSave(fields);
  };

  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={S.editPanel} className="cd-ov-panel" onClick={(e)=>e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={S.ovHead}>
          <div>
            <div style={S.kicker}>Edit{task.recurring ? " · repeating ↻" : ""}</div>
            <h2 style={S.ovTitle}>Edit block</h2>
          </div>
          <button style={S.ovClose} className="cd-ov-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={S.addPanel}>
          <input autoFocus placeholder="What?" value={title} onChange={(e)=>setTitle(e.target.value)} style={S.input} />
          <div style={S.addGrid}>
            <input type="time" value={start} onChange={(e)=>setStart(e.target.value)} style={S.input} />
            <input type="time" value={end} onChange={(e)=>setEnd(e.target.value)} style={S.input} />
          </div>
          <input placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} style={S.input} />
          {cat === "training" && (
            <input type="number" min="0" placeholder="Target TSS (optional)" value={tss} onChange={(e)=>setTss(e.target.value)} style={S.input} />
          )}
          <div style={S.catPick}>
            {Object.entries(CATS).map(([k, v]) => (
              <button key={k} onClick={() => setCat(k)}
                style={{ ...S.catChip, borderColor: v.dot, background: cat===k ? v.soft : "transparent", color: v.dot }}>
                {v.label}
              </button>
            ))}
          </div>
          {!task.recurring && <StarToggle important={important} onToggle={() => setImportant((s) => !s)} />}
          <SharedToggle shared={shared} onToggle={() => setShared((s) => !s)} />
          <div style={S.addActions}>
            <button style={S.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={S.saveBtn} disabled={!title.trim()} onClick={save}>
              {task.recurring ? "Save…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeatherDetail({ day }) {
  if (!day || !day.hours?.length) {
    return <div style={S.wxNote}>{day ? "Hourly detail not available for this day." : "Tap a day for hourly detail."}</div>;
  }
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const currentHour = `${String(now.getHours()).padStart(2,"0")}:00`;
  return (
    <div style={S.wxDetail}>
      <div style={S.wxDetailScroll}>
        {day.hours.map((h) => {
          const isNow = day.date === todayStr && h.hour === currentHour;
          return (
            <div key={h.hour} style={{ ...S.wxHour, ...(isNow ? S.wxHourNow : {}) }}>
              <div style={S.wxHourTime}>{h.hour.slice(0,2)}</div>
              <div style={S.wxHourIcon}>{h.icon}</div>
              <div style={S.wxHourTemp}>{h.temp}°</div>
              <div style={S.wxHourPrecip}>{h.precip > 0 ? `${h.precip}mm` : "—"}</div>
              <div style={S.wxHourWind}>{h.wind} m/s</div>
            </div>
          );
        })}
      </div>
      <div style={S.wxLegend}>time · temp · precip · wind</div>
    </div>
  );
}

function MonthList({ imminent, later, today, onAdd, onRemove, onStar, onShare }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("social");
  const [important, setImportant] = useState(true);
  const [shared, setShared] = useState(false);
  const todayStr = (d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`;})(today);

  return (
    <div>
      {imminent.length > 0 && (
        <div style={S.imminentBox}>
          {imminent.map((m) => (
            <div key={m.id} style={S.imminentRow}>
              <span style={S.imminentWhen}>{m.date === todayStr ? "Today" : "Tomorrow"}</span>
              <span style={{ ...S.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={S.imminentTitle}>{m.shared ? <span title="Shared on both decks">🔗 </span> : null}{m.title}</span>
              {isStored(m.id) && (
                <button onClick={() => onRemove(m.id)} style={S.del} className="cd-del">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={S.monthList}>
        {imminent.length === 0 && later.length === 0 && (
          <div style={S.empty}>Nothing in the next 30 days. Add something below.</div>
        )}
        {later.map((m) => {
          const d = new Date(m.date + "T00:00:00");
          return (
            <div key={m.id} style={S.monthItem} className="cd-row">
              <div style={S.monthDate}>
                <span style={S.monthDay}>{d.getDate()}</span>
                <span style={S.monthMon}>{MONTHS[d.getMonth()].slice(0,3)}</span>
              </div>
              <span style={S.monthTimeCell}>{m.start || ""}</span>
              <span style={{ ...S.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={S.monthTitle}>{m.title}</span>
              {isStored(m.id)
                ? <button onClick={() => onShare(m.id, !m.shared)} style={{ ...S.starRow, color: m.shared ? accent : faint }}
                    title={m.shared ? "Shared on both decks — tap to unshare" : "Share with both decks"}>🔗</button>
                : <span />}
              {isStored(m.id)
                ? <button onClick={() => onStar(m.id, false)} style={S.starRow} title="Unstar — remove from Month ahead">★</button>
                : <span />}
              {isStored(m.id)
                ? <button onClick={() => onRemove(m.id)} style={S.del} className="cd-del">×</button>
                : <span />}
            </div>
          );
        })}
      </div>

      <div style={S.monthAdd}>
        <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} style={{ ...S.input, flex:"0 0 auto" }} />
        <input type="time" value={start} onChange={(e)=>setStart(e.target.value)} style={{ ...S.input, flex:"0 0 auto" }} title="Start (optional)" />
        <input type="time" value={end} onChange={(e)=>setEnd(e.target.value)} style={{ ...S.input, flex:"0 0 auto" }} title="End (optional)" />
        <input placeholder="e.g. Dentist" value={title} onChange={(e)=>setTitle(e.target.value)} style={S.input} />
        <select value={cat} onChange={(e)=>setCat(e.target.value)} style={S.input}>
          {Object.entries(CATS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button
          onClick={() => setImportant(v => !v)}
          title={important ? "Important — shows in Month ahead" : "Background — hidden from Month ahead"}
          style={{ ...S.starBtn, color: important ? "#d4a056" : faint, borderColor: important ? "#e6c98a" : line }}>
          {important ? "★" : "☆"}
        </button>
        <button
          onClick={() => setShared(v => !v)}
          title={shared ? "Shared — shows on both decks" : "Private to this deck"}
          style={{ ...S.monthShareBtn, ...(shared ? S.monthShareBtnOn : {}) }}>
          🔗
        </button>
        <button style={S.saveBtn} disabled={!date || !title.trim()}
          onClick={() => { if(!date||!title.trim()) return; onAdd({ date, start, end, title:title.trim(), cat, important, shared }); setDate(""); setStart(""); setEnd(""); setTitle(""); setImportant(true); setShared(false); }}>
          Add
        </button>
      </div>
    </div>
  );
}

const ink = "#20242e";
const muted = "#707887";
const faint = "#a6adba";
const paper = "#eef1f6";
const cardBg = "#fbfcfe";
const line = "#dde2ec";
// These resolve against the CSS variables published by the active profile
// (see themeVars), so every accent-colored element re-themes on profile switch.
const accent = "var(--accent)";
const accentSoft = "var(--accent-soft)";
const accentBorder = "var(--accent-border)";

// Power-zone palette: cool → warm as intensity climbs.
const ZONE_COLORS = ["#9fb6cf", "#6f9e6a", "#5b96cf", "#2f5d9e", "#d4a056", "#d98a5a", "#d96a8a"];

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Spline+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; }
  .cd-card { transition: transform .25s ease, box-shadow .25s ease; }
  .cd-card:hover { box-shadow: 0 18px 40px -24px rgba(30,40,70,0.45); }
  .cd-block { transition: transform .15s ease, opacity .2s ease; }
  .cd-block:hover { transform: translateX(2px); }
  .cd-weekday { transition: transform .15s ease, background .2s ease; }
  .cd-weekday:hover { transform: translateY(-3px); }
  .cd-del { opacity: 0; transition: opacity .2s ease; }
  .cd-row:hover .cd-del { opacity: 1; }
  .cd-add:hover { background: ${line}; }
  @keyframes rise { from { opacity:0; transform: translateY(10px);} to {opacity:1; transform:none;} }
  @keyframes ovFade { from { opacity:0; } to { opacity:1; } }
  @keyframes ovSlide { from { opacity:0; transform: translateY(24px) scale(.98); } to { opacity:1; transform:none; } }
  .cd-workout { cursor: pointer; }
  .cd-workout:hover { transform: translateY(-3px); box-shadow: 0 22px 46px -22px var(--accent-glow); }
  .cd-ov-backdrop { animation: ovFade .2s ease; }
  .cd-ov-panel { animation: ovSlide .28s cubic-bezier(.2,.8,.25,1); }
  .cd-ov-close:hover { background: ${line}; color: ${ink}; }
  .cd-ov-box:hover { transform: translateY(-2px); border-color: var(--accent-border); box-shadow: 0 12px 26px -18px var(--accent-glow); }
  @keyframes badgePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
  .cd-badge-live { animation: badgePulse 2.4s ease-in-out infinite; }
  .cd-push:hover { background: var(--accent-border); }
  .cd-cal-cell:hover { border-color: var(--accent); }
  @keyframes toastUp { from { opacity:0; transform: translate(-50%, 16px); } to { opacity:1; transform: translate(-50%, 0); } }
  .cd-toast { animation: toastUp .25s cubic-bezier(.2,.8,.25,1); }
  .cd-toast-undo:hover { background: rgba(255,255,255,0.16); }
`;

const S = {
  shell: { minHeight: "100vh", background: `radial-gradient(120% 80% at 0% 0%, #f4f7fc 0%, ${paper} 55%, #e7ecf5 100%)`,
           fontFamily: "'Spline Sans', sans-serif", color: ink, padding: "28px clamp(16px,4vw,48px) 48px", animation: "rise .5s ease" },
  loading: { fontFamily: "'Fraunces', serif", fontSize: 22, color: muted, padding: 60, textAlign: "center" },
  errorBanner: { maxWidth: 1200, margin: "0 auto 14px", padding: "8px 14px", borderRadius: 10,
                 background: "#fbeae3", color: "#7a3a1f", fontSize: 12.5, border: "1px solid #f0d4c4" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, maxWidth: 1200, marginInline: "auto" },
  kicker: { textTransform: "uppercase", letterSpacing: "0.22em", fontSize: 11, color: muted, fontWeight: 600 },
  profileBar: { display: "flex", gap: 6, marginBottom: 8 },
  profilePill: { padding: "5px 14px", borderRadius: 999, border: `1px solid ${line}`, background: cardBg, color: muted,
    fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em", cursor: "pointer", fontFamily: "inherit", transition: "all .18s ease" },
  shareToggle: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", borderRadius: 12,
    border: `1px dashed ${line}`, background: "transparent", color: muted, fontSize: 13, fontWeight: 600,
    fontFamily: "inherit", cursor: "pointer", transition: "all .18s ease" },
  shareToggleOn: { borderStyle: "solid", borderColor: accentBorder, background: accentSoft, color: accent },
  starToggleOn: { borderStyle: "solid", borderColor: "#e6c98a", background: "rgba(212,160,86,0.14)", color: "#a8761c" },
  toast: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 200,
    display: "flex", alignItems: "center", gap: 14, background: ink, color: "#fff",
    padding: "11px 12px 11px 18px", borderRadius: 14, boxShadow: "0 18px 44px -16px rgba(0,0,0,0.55)",
    fontSize: 14, fontWeight: 500, maxWidth: "min(92vw, 460px)" },
  toastMsg: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  toastUndo: { background: "transparent", border: "1px solid rgba(255,255,255,0.4)", color: "#fff",
    fontWeight: 700, fontSize: 13, padding: "5px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" },
  toastClose: { background: "transparent", border: "none", color: "rgba(255,255,255,0.65)", fontSize: 20,
    lineHeight: 1, cursor: "pointer", padding: "0 4px", flex: "0 0 auto" },
  h1: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "clamp(28px,4vw,42px)", margin: "4px 0 0", letterSpacing: "-0.01em", color: ink },
  headerDate: { textAlign: "right" },
  bigDay: { fontFamily: "'Fraunces', serif", fontSize: 40, fontWeight: 700, lineHeight: 1, color: accent },
  bigMonth: { fontSize: 13, color: muted, fontWeight: 500, letterSpacing: "0.04em" },
  grid: { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 18, maxWidth: 1200, marginInline: "auto", marginBottom: 18, alignItems: "start" },
  card: { background: cardBg, border: `1px solid ${line}`, borderRadius: 22, padding: "20px 22px",
          boxShadow: "0 10px 30px -26px rgba(30,40,70,0.4)", maxWidth: 1200, marginInline: "auto", width: "100%", marginBottom: 0 },
  weekCard: { marginBottom: 18 },
  cardHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12 },
  h2: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, margin: 0, color: ink },
  cardSub: { fontSize: 12.5, color: muted },
  timeline: { display: "flex", flexDirection: "column", gap: 0 },
  tlRow: { display: "grid", gridTemplateColumns: "50px 40px 1fr 24px", gap: 8, alignItems: "stretch" },
  tlTime: { fontSize: 12, color: muted, paddingTop: 14, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  tlNowTime: { color: accent, fontWeight: 700 },
  tlTimeEnd: { fontSize: 11, color: faint, marginTop: 2 },
  tlSpine: { position: "relative", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 9 },
  tlLineFull: { position: "absolute", top: 0, bottom: 0, left: "50%", marginLeft: -1, width: 2, background: line, zIndex: 0 },
  tlLineDash: { position: "absolute", top: 0, bottom: 0, left: "50%", marginLeft: -1, width: 0, borderLeft: `2px dashed ${line}`, zIndex: 0 },
  tlBadge: { position: "relative", zIndex: 1, width: 34, height: 34, borderRadius: "50%", display: "flex",
             alignItems: "center", justifyContent: "center", flex: "0 0 auto", background: "#fff" },
  tlBadgeGlyph: { fontSize: 16, lineHeight: 1 },
  tlBlock: { position: "relative", overflow: "hidden", textAlign: "left", border: `1px solid ${line}`, background: "#fff",
             borderRadius: 16, padding: 0, margin: "4px 0", cursor: "pointer", display: "block", width: "100%" },
  tlBlockActive: { border: `1.5px solid ${accent}`, boxShadow: "0 10px 24px -16px rgba(47,93,158,0.65)" },
  tlBlockInner: { position: "relative", zIndex: 1, padding: "11px 14px" },
  tlFill: { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 0, transition: "width .6s ease" },
  tlBlockTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  tlTitle: { fontSize: 15, fontWeight: 600, color: ink, lineHeight: 1.3 },
  tlRemaining: { fontSize: 12.5, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  tlNote: { fontSize: 12.5, color: muted, marginTop: 3, lineHeight: 1.4 },
  tlBlockCol: { minWidth: 0 },
  tlBlockOverdue: { borderColor: "#e6c3a8", borderStyle: "dashed" },
  pushBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 2px 6px", marginTop: -1 },
  pushHint: { fontSize: 11, color: "#b5642f", fontStyle: "italic" },
  pushBtn: { fontSize: 11.5, fontWeight: 600, color: accent, background: accentSoft, border: `1px solid ${accentBorder}`,
             borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" },
  pushDate: { fontSize: 11.5, padding: "2px 6px", borderRadius: 8, border: `1px solid ${accentBorder}`, fontFamily: "inherit", color: ink, background: "#fff" },
  tlGapRow: { display: "grid", gridTemplateColumns: "50px 40px 1fr 24px", gap: 8, alignItems: "stretch", minHeight: 30 },
  tlGap: { display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 12.5, color: faint, fontStyle: "italic" },
  tlGapIcon: { fontSize: 13, opacity: 0.75, fontStyle: "normal" },
  tlGapNow: { color: accent, fontWeight: 600, fontStyle: "normal" },
  tlEmpty: { fontSize: 13.5, color: muted, fontStyle: "italic", padding: "16px 2px", lineHeight: 1.5 },
  tlActions: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 },
  actBtn: { background: "none", border: "none", color: faint, fontSize: 15, lineHeight: 1, cursor: "pointer", padding: 0 },
  tag: { fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 7, display: "inline-block" },
  check: { width: 22, height: 22, borderRadius: "50%", border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center",
           color: "#fff", fontSize: 13, flex: "0 0 auto", fontWeight: 700 },
  del: { background: "none", border: "none", color: faint, fontSize: 20, cursor: "pointer", lineHeight: 1, alignSelf: "center", padding: 0 },
  empty: { fontSize: 13.5, color: muted, fontStyle: "italic", padding: "10px 2px" },
  addBtn: { marginTop: 12, width: "100%", padding: "11px", borderRadius: 12, border: `1px dashed ${line}`,
            background: "transparent", color: muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  addPanel: { marginTop: 14, padding: 14, borderRadius: 14, background: paper, display: "flex", flexDirection: "column", gap: 9 },
  addGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 },
  input: { padding: "9px 11px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 14, fontFamily: "inherit", background: "#fff", color: ink, width: "100%" },
  catPick: { display: "flex", gap: 7, flexWrap: "wrap" },
  catChip: { padding: "6px 12px", borderRadius: 20, border: "1.5px solid", fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "transparent", fontFamily: "inherit" },
  addActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 },
  cancelBtn: { padding: "8px 16px", borderRadius: 10, border: `1px solid ${line}`, background: "#fff", color: muted, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  saveBtn: { padding: "8px 18px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  workoutCard: { background: "var(--accent-grad)", border: "none", color: "#fff" },
  woTitle: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, lineHeight: 1.2 },
  woMeta: { fontSize: 13.5, opacity: 0.85, marginTop: 6, fontWeight: 500 },
  woNote: { fontSize: 13, opacity: 0.92, marginTop: 10, lineHeight: 1.45, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.22)" },
  woOpen: { fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" },
  // repeat controls (AddRow)
  repeatRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 2 },
  repeatLabel: { fontSize: 12.5, fontWeight: 600, color: muted, flex: "0 0 auto" },
  repeatPanel: { display: "flex", flexDirection: "column", gap: 9, padding: "10px 12px", background: "#fff", border: `1px solid ${line}`, borderRadius: 12 },
  repeatInline: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  repeatWord: { fontSize: 13, color: muted },
  wdPick: { display: "flex", gap: 5, flexWrap: "wrap" },
  wdChip: { width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${line}`, background: "transparent",
            color: muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  wdChipOn: { borderColor: accent, background: accentSoft, color: accent },

  // scope popup
  scopePanel: { width: "100%", maxWidth: 360, background: cardBg, borderRadius: 20, border: `1px solid ${line}`,
                boxShadow: "0 40px 90px -40px rgba(20,30,60,0.7)", padding: "20px 22px 18px", marginTop: "8vh" },
  editPanel: { width: "100%", maxWidth: 460, background: cardBg, borderRadius: 22, border: `1px solid ${line}`,
               boxShadow: "0 40px 90px -40px rgba(20,30,60,0.7)", padding: "20px 22px 22px", marginTop: "6vh" },
  scopeTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, margin: "0 0 6px", color: ink },
  scopeText: { fontSize: 13.5, color: muted, margin: "0 0 16px", lineHeight: 1.45 },
  scopeBtn: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", textAlign: "left",
              border: `1px solid ${line}`, background: "#fff", borderRadius: 12, padding: "11px 14px", marginBottom: 9,
              fontSize: 14.5, fontWeight: 600, color: ink, cursor: "pointer", fontFamily: "inherit" },
  scopeBtnDanger: { borderColor: "#e6b0b0", color: "#b5402f" },
  scopeSub: { fontSize: 11.5, fontWeight: 400, color: muted },
  scopeCancel: { width: "100%", border: "none", background: "transparent", color: muted, fontSize: 13.5, fontWeight: 600,
                 cursor: "pointer", padding: "6px", fontFamily: "inherit", marginTop: 2 },

  woFuel: { marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.22)" },
  woFuelHead: { fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", letterSpacing: "0.02em", marginBottom: 9 },
  woFuelChips: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
  woChip: { background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "9px 8px", textAlign: "center" },
  woChipNum: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 700, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  woChipIcon: { fontSize: 13, fontFamily: "'Spline Sans', sans-serif" },
  woChipLbl: { fontSize: 10.5, color: "rgba(255,255,255,0.8)", marginTop: 5, fontWeight: 500 },

  // --- Fitness overlay ---
  ovBackdrop: { position: "fixed", inset: 0, zIndex: 50, background: "rgba(24,32,52,0.42)", backdropFilter: "blur(3px)",
                display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(16px,5vh,64px) 16px", overflowY: "auto" },
  ovPanel: { position: "relative", width: "100%", maxWidth: 560, background: cardBg, borderRadius: 24, border: `1px solid ${line}`,
             boxShadow: "0 40px 90px -40px rgba(20,30,60,0.7)", padding: "22px 24px 26px", marginBottom: 32 },
  ovHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  ovTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 26, margin: "4px 0 0", color: ink, letterSpacing: "-0.01em" },
  ovClose: { border: `1px solid ${line}`, background: "#fff", borderRadius: "50%", width: 36, height: 36, fontSize: 22,
             lineHeight: 1, color: muted, cursor: "pointer", flex: "0 0 auto", transition: "background .2s ease, color .2s ease" },
  ovNext: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", background: accentSoft, border: `1px solid ${accentBorder}`,
            borderRadius: 14, padding: "10px 14px", marginBottom: 18 },
  ovNextLabel: { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent },
  ovNextTitle: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: ink },
  ovNextMeta: { fontSize: 12.5, color: muted, marginLeft: "auto" },
  ovLoading: { fontFamily: "'Fraunces', serif", fontSize: 17, color: muted, padding: "30px 0", textAlign: "center" },
  ovError: { fontSize: 13.5, color: "#7a3a1f", background: "#fbeae3", border: "1px solid #f0d4c4", borderRadius: 12, padding: "12px 14px" },
  ovStale: { fontSize: 12.5, color: "#7a5a1f", background: "#faf1de", border: "1px solid #ecdcb6", borderRadius: 12, padding: "9px 13px", marginBottom: 16 },
  ovBody: { display: "flex", flexDirection: "column", gap: 18 },
  ovSection: {},
  ovSectionHead: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: muted,
                   marginBottom: 11, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 },
  ovAsOf: { fontSize: 11, fontWeight: 500, textTransform: "none", letterSpacing: 0, color: faint },
  ovStats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 8 },
  ovStat: { background: paper, borderRadius: 14, padding: "11px 12px", textAlign: "left" },
  ovStatLabel: { fontSize: 11.5, color: muted, fontWeight: 600 },
  ovStatSub: { fontSize: 10, color: faint, fontWeight: 500 },
  ovStatValue: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  ovStatChip: { display: "inline-block", marginTop: 6, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20 },
  ovTssRow: { display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, fontSize: 12.5, color: muted },
  ovTssNum: { fontFamily: "'Fraunces', serif", fontSize: 15, color: ink, fontWeight: 700, margin: "0 3px", fontVariantNumeric: "tabular-nums" },
  ovZones: { display: "flex", flexDirection: "column", gap: 5 },
  ovZone: { display: "grid", gridTemplateColumns: "5px 1fr auto", gap: 10, alignItems: "center", padding: "5px 2px" },
  ovZoneBar: { width: 5, height: 18, borderRadius: 3 },
  ovZoneName: { fontSize: 13, fontWeight: 500, color: ink },
  ovZoneW: { fontSize: 12.5, color: muted, fontVariantNumeric: "tabular-nums" },
  ovRecent: { display: "flex", flexDirection: "column", gap: 1 },
  ovActRow: { display: "grid", gridTemplateColumns: "74px 1fr auto", gap: 10, alignItems: "center", padding: "7px 2px", borderBottom: `1px solid ${line}` },
  ovActDate: { fontSize: 11.5, color: faint, fontWeight: 600 },
  ovActName: { fontSize: 13.5, color: ink, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ovActMeta: { fontSize: 11.5, color: muted, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  ovFootHint: { fontSize: 12, color: faint, fontStyle: "italic", textAlign: "center", marginTop: 4 },

  // compact 7-day plan
  ovPlan: { display: "flex", flexDirection: "column", gap: 1 },
  ovPlanEmpty: { fontSize: 13, color: muted, fontStyle: "italic", background: paper, borderRadius: 12, padding: "12px 14px", lineHeight: 1.4 },
  ovPlanRow: { display: "grid", gridTemplateColumns: "58px 9px 1fr auto", gap: 10, alignItems: "center", padding: "7px 8px", borderRadius: 10 },
  ovPlanNext: { background: accentSoft, boxShadow: `inset 0 0 0 1px ${accentBorder}` },
  ovPlanDay: { fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em" },
  ovPlanDot: { width: 9, height: 9, borderRadius: "50%", background: CATS.training.dot },
  ovPlanTitle: { fontSize: 14, fontWeight: 500, color: ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ovPlanTime: { fontSize: 12, color: muted, fontVariantNumeric: "tabular-nums" },

  // threshold metric boxes
  ovBoxRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  ovBox: { textAlign: "left", border: `1px solid ${line}`, background: "#fff", borderRadius: 16, padding: "13px 15px", fontFamily: "inherit",
           transition: "transform .15s ease, box-shadow .2s ease, border-color .2s ease" },
  ovBoxLabel: { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: muted, display: "flex", justifyContent: "space-between", alignItems: "center" },
  ovBoxChevron: { color: faint, fontSize: 17, lineHeight: 1 },
  ovBoxValue: { fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 700, color: ink, lineHeight: 1.05, marginTop: 5, fontVariantNumeric: "tabular-nums" },
  ovBoxUnit: { fontSize: 14, fontWeight: 500, color: muted, fontFamily: "'Spline Sans', sans-serif" },
  ovBoxSub: { fontSize: 12, color: muted, marginTop: 3 },

  // calendar window
  calOpenBtn: { fontSize: 12.5, fontWeight: 600, color: accent, background: accentSoft, border: `1px solid ${accentBorder}`,
                borderRadius: 10, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit" },
  calNav: { display: "flex", alignItems: "center", gap: 7 },
  calNavBtn: { width: 36, height: 36, borderRadius: "50%", border: `1px solid ${line}`, background: "#fff",
               fontSize: 20, lineHeight: 1, color: muted, cursor: "pointer", flex: "0 0 auto", transition: "background .2s ease, color .2s ease" },
  calTodayBtn: { fontSize: 12, fontWeight: 600, color: accent, background: accentSoft, border: `1px solid ${accentBorder}`,
                 borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" },
  calWeekHead: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 6 },
  calWeekName: { fontSize: 11, color: muted, fontWeight: 600, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.04em" },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 },
  calCell: { minHeight: 58, border: `1px solid ${line}`, borderRadius: 12, background: "#fff", padding: "6px 3px 5px",
             display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: "inherit",
             transition: "border-color .15s ease, background .15s ease" },
  calCellOut: { background: paper, opacity: 0.5 },
  calCellToday: { borderColor: accent, boxShadow: "0 6px 18px -14px rgba(47,93,158,0.8)" },
  calCellSel: { background: accentSoft, borderColor: accentBorder },
  calNum: { fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  calNumToday: { color: accent, fontWeight: 700 },
  calDots: { display: "flex", gap: 2.5, flexWrap: "wrap", justifyContent: "center", minHeight: 7 },
  calDot: { width: 6, height: 6, borderRadius: "50%" },
  calFoot: { fontSize: 12, color: muted, textAlign: "center", marginTop: 14, fontStyle: "italic" },

  // recovery chart
  ovChart: { width: "100%", height: 132, display: "block" },
  ovChartTick: { fontSize: 9, fill: faint, fontFamily: "'Spline Sans', sans-serif", fontVariantNumeric: "tabular-nums" },
  ovRecCap: { display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 8, fontSize: 12.5, color: muted },

  // drill-in detail window
  ovDetail: { position: "absolute", inset: 0, background: cardBg, borderRadius: 24, padding: "22px 24px 26px", overflowY: "auto", zIndex: 2 },
  ovDetailHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 },
  ovBack: { border: `1px solid ${line}`, background: "#fff", borderRadius: "50%", width: 36, height: 36, fontSize: 22, lineHeight: 1,
            color: muted, cursor: "pointer", flex: "0 0 auto", transition: "background .2s ease, color .2s ease" },
  ovDetailTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, margin: 0, color: ink },
  ovDetailSub: { fontSize: 12.5, color: muted, marginTop: 2, fontVariantNumeric: "tabular-nums" },
  ovZoneRow: { display: "grid", gridTemplateColumns: "5px 1fr auto auto", gap: 12, alignItems: "center", padding: "8px 2px", borderBottom: `1px solid ${line}` },
  ovZonePct: { fontSize: 12, color: muted, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  ovZoneMain: { fontSize: 13, fontWeight: 600, color: ink, fontVariantNumeric: "tabular-nums", minWidth: 86, textAlign: "right" },
  wxRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  wxDay: { textAlign: "center", padding: "6px 2px", borderRadius: 10, border: "1px solid transparent",
           background: "transparent", cursor: "pointer", fontFamily: "inherit" },
  wxDayActive: { background: accentSoft, borderColor: accent },
  wxDetail: { marginTop: 12, paddingTop: 12, borderTop: `1px solid ${line}` },
  wxDetailScroll: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "thin" },
  wxHour: { flex: "0 0 56px", textAlign: "center", padding: "8px 4px", borderRadius: 10, background: paper },
  wxHourNow: { background: accentSoft, boxShadow: `inset 0 0 0 1.5px ${accent}` },
  wxHourTime: { fontSize: 11, color: muted, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  wxHourIcon: { fontSize: 18, margin: "3px 0" },
  wxHourTemp: { fontSize: 13, fontWeight: 700, color: ink },
  wxHourPrecip: { fontSize: 10.5, color: accent, marginTop: 3, fontVariantNumeric: "tabular-nums" },
  wxHourWind: { fontSize: 10, color: muted, marginTop: 1, fontVariantNumeric: "tabular-nums" },
  wxLegend: { fontSize: 10.5, color: muted, textAlign: "right", marginTop: 6, fontStyle: "italic" },
  wxName: { fontSize: 11, color: muted, fontWeight: 600 },
  wxIcon: { fontSize: 19, margin: "3px 0" },
  wxHi: { fontSize: 13, fontWeight: 700, color: ink },
  wxLo: { fontSize: 11.5, color: muted },
  wxPop: { fontSize: 10.5, color: accent, marginTop: 2, fontWeight: 600 },
  wxNote: { fontSize: 12, color: muted, marginTop: 12, lineHeight: 1.45, fontStyle: "italic" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 },
  weekDay: { border: `1px solid ${line}`, borderRadius: 16, padding: "12px 6px 10px", background: "#fff", cursor: "pointer", textAlign: "center", fontFamily: "inherit" },
  weekDayActive: { background: accentSoft, borderColor: accent, boxShadow: "0 8px 22px -16px rgba(47,93,158,0.7)" },
  weekName: { fontSize: 11.5, color: muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
  weekNum: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, margin: "3px 0 7px", color: ink },
  weekNumToday: { color: accent },
  weekDots: { display: "flex", justifyContent: "center", gap: 3, minHeight: 8, flexWrap: "wrap" },
  weekDot: { width: 7, height: 7, borderRadius: "50%" },
  weekCount: { fontSize: 11, color: muted, marginTop: 8, fontVariantNumeric: "tabular-nums" },
  imminentBox: { background: accentSoft, border: `1px solid ${accentBorder}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 },
  imminentRow: { display: "grid", gridTemplateColumns: "82px 10px 1fr 24px", gap: 12, alignItems: "center" },
  imminentWhen: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 700, color: accent, letterSpacing: "0.02em" },
  imminentTitle: { fontSize: 14.5, fontWeight: 600, color: ink },
  monthList: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 14, maxHeight: 260, overflowY: "auto" },
  monthItem: { display: "grid", gridTemplateColumns: "44px 42px 10px 1fr 20px 20px 24px", gap: 12, alignItems: "center", padding: "9px 4px", borderBottom: `1px solid ${line}` },
  monthTimeCell: { fontSize: 12.5, color: muted, fontWeight: 500, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  starBtn: { width: 38, height: 38, flex: "0 0 auto", borderRadius: 10, border: `1px solid ${line}`, background: "#fff",
             fontSize: 17, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  // Shared toggle in the month-add row — emoji ignores text color, so on/off is
  // signalled by a solid accent fill (on) vs a dim dashed chip (off).
  monthShareBtn: { width: 38, height: 38, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center",
    boxSizing: "border-box", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 16,
    border: `1px dashed ${line}`, background: "#fff", opacity: 0.45 },
  monthShareBtnOn: { border: "1px solid var(--accent)", background: "var(--accent-soft)", opacity: 1 },
  starRow: { background: "none", border: "none", color: "#d4a056", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 0 },
  monthDate: { textAlign: "center" },
  monthDay: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, display: "block", lineHeight: 1, color: accent },
  monthMon: { fontSize: 10.5, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" },
  monthDotEl: { width: 10, height: 10, borderRadius: "50%" },
  monthTitle: { fontSize: 14.5, fontWeight: 500 },
  monthAdd: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  footer: { textAlign: "center", fontSize: 12, color: muted, marginTop: 26, maxWidth: 1200, marginInline: "auto" },
};
