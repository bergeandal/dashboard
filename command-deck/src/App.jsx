import React, { useState, useEffect, useMemo, useCallback } from "react";

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

const stripBursdag = (s) => s.replace(/\s*sin\s+bursdag\s*$/i, "").trim();

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const iso = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

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
  const [month, setMonth] = useState([]);
  const [selectedDate, setSelectedDate] = useState(iso(today));
  const [openWeatherDate, setOpenWeatherDate] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [fitnessOpen, setFitnessOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const start = iso(today);
      const res = await fetch(`/api/data?start=${start}&days=60`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalendarTasks(data.tasks || []);
      setBirthdays(data.birthdays || []);
      setLocalTasks(data.localTasks || []);
      setDoneIds(data.doneIds || []);
      setMonth(data.month || []);
      setWeather(data.weather || null);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus((s) => s === "ready" ? "ready" : "error");
      setError(String(e.message || e));
    }
  }, [today]);

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
        for (const e of m) await jsonPost("/api/month", e);
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

  const addLocalTask = async (task) => {
    const res = await jsonPost("/api/tasks", { ...task, date: selectedDate });
    if (res.ok) {
      const created = await res.json();
      setLocalTasks((prev) => [...prev, created]);
    }
  };

  const removeTask = (id) => {
    if (!id.startsWith("local:")) return;
    setLocalTasks((prev) => prev.filter(t => t.id !== id));
    fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => console.warn("delete failed", e));
  };

  const addMonth = async (ev) => {
    const res = await jsonPost("/api/month", ev);
    if (res.ok) {
      const created = await res.json();
      setMonth((prev) => [...prev, created]);
    }
  };

  const removeMonth = (id) => {
    setMonth((prev) => prev.filter(m => m.id !== id));
    fetch(`/api/month/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => console.warn("month delete failed", e));
  };

  const dayTasks = (dateStr) =>
    allTasks.filter((t) => t.date === dateStr);

  const selectedTasks = dayTasks(selectedDate);
  const selDate = new Date(selectedDate + "T00:00:00");
  const isToday = selectedDate === iso(today);

  const nextWorkout = useMemo(() => {
    const todayStr = iso(today);
    return allTasks
      .filter((t) => t.cat === "training" && !t.done && t.date >= todayStr)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0] || null;
  }, [allTasks, today]);

  const { imminent, later } = useMemo(() => {
    const todayStr = iso(today);
    const tomorrowStr = iso(addDays(today, 1));
    const cutoffStr = iso(addDays(today, 30));
    const seen = new Set(month.map(m => `${m.date}|${m.title}`));
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
    const all = [...month, ...bdays, ...events]
      .filter(e => e.date >= todayStr && e.date <= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      imminent: all.filter(e => e.cat !== "event" && (e.date === todayStr || e.date === tomorrowStr)),
      later: all.filter(e => e.date > tomorrowStr),
    };
  }, [month, birthdays, calendarTasks, today]);

  if (status === "loading") {
    return <div style={S.shell}><style>{globalCss}</style><div style={S.loading}>Connecting to Command Deck…</div></div>;
  }

  const dayProgress = (dateStr) => {
    const ts = dayTasks(dateStr);
    if (!ts.length) return 0;
    return Math.round((ts.filter((t) => t.done).length / ts.length) * 100);
  };

  return (
    <div style={S.shell}>
      <style>{globalCss}</style>

      <header style={S.header}>
        <div>
          <div style={S.kicker}>Command Deck</div>
          <h1 style={S.h1}>Hei, Berge 👋</h1>
        </div>
        <div style={S.headerDate}>
          <div style={S.bigDay}>{today.getDate()}</div>
          <div style={S.bigMonth}>{MONTHS[today.getMonth()].slice(0,3)} {today.getFullYear()}</div>
        </div>
      </header>

      {error && status !== "loading" && (
        <div style={S.errorBanner}>Couldn't reach server — showing last fetch. ({error})</div>
      )}

      <div style={S.grid}>
        <section style={{ ...S.card, gridColumn: "1 / 2" }} className="cd-card">
          <div style={S.cardHead}>
            <h2 style={S.h2}>{isToday ? "Today" : DAYS[(selDate.getDay()+6)%7]}</h2>
            <span style={S.cardSub}>{selDate.getDate()} {MONTHS[selDate.getMonth()].slice(0,3)} · {dayProgress(selectedDate)}% done</span>
          </div>

          <div style={S.timeline}>
            {selectedTasks.length === 0 && <div style={S.empty}>Nothing scheduled. Tap + to add a block.</div>}
            {selectedTasks.map((t, i) => (
              <div key={t.id} style={S.tlRow} className="cd-row">
                <div style={S.tlTime}>{t.start || "—"}{t.end ? <div style={S.tlTimeEnd}>{t.end}</div> : null}</div>
                <div style={S.tlMid}>
                  <div style={{ ...S.tlDot, background: CATS[t.cat].dot }} />
                  {i < selectedTasks.length - 1 && <div style={S.tlLine} />}
                </div>
                <button
                  onClick={() => toggle(t.id)}
                  style={{ ...S.tlBlock, background: CATS[t.cat].soft, opacity: t.done ? 0.55 : 1 }}
                  className="cd-block"
                >
                  <div style={S.tlBlockTop}>
                    <span style={{ ...S.tlTitle, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                    <span style={{ ...S.check, borderColor: CATS[t.cat].dot, background: t.done ? CATS[t.cat].dot : "transparent" }}>
                      {t.done ? "✓" : ""}
                    </span>
                  </div>
                  {t.note && <div style={S.tlNote}>{t.note}</div>}
                  <span style={{ ...S.tag, color: CATS[t.cat].dot }}>{CATS[t.cat].label}</span>
                </button>
                {t.id.startsWith("local:") && (
                  <button onClick={() => removeTask(t.id)} style={S.del} title="Delete" className="cd-del">×</button>
                )}
              </div>
            ))}
          </div>

          <AddRow
            adding={adding} setAdding={setAdding}
            onAdd={addLocalTask}
          />
        </section>

        <div style={S.rightCol}>
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
                  {nextWorkout.date === iso(today) ? "Today" : DAYS[(new Date(nextWorkout.date+"T00:00:00").getDay()+6)%7]} · {nextWorkout.start}
                </div>
                {nextWorkout.note && <div style={S.woNote}>{nextWorkout.note}</div>}
              </>
            ) : <div style={{ ...S.empty, color: "rgba(255,255,255,0.8)" }}>No upcoming training scheduled.</div>}
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
      </div>

      <section style={S.card} className="cd-card">
        <div style={S.cardHead}><h2 style={S.h2}>Next 7 days</h2><span style={S.cardSub}>tap a day to open it</span></div>
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

      <section style={S.card} className="cd-card">
        <div style={S.cardHead}><h2 style={S.h2}>Month ahead</h2><span style={S.cardSub}>next 30 days</span></div>
        <MonthList imminent={imminent} later={later} today={today} onAdd={addMonth} onRemove={removeMonth} />
      </section>

      <footer style={S.footer}>
        v2 · everything synced via your home server · refreshes every 5 min
      </footer>

      {fitnessOpen && <FitnessOverlay nextWorkout={nextWorkout} onClose={() => setFitnessOpen(false)} />}
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

function FitnessOverlay({ nextWorkout, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/fitness");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (alive) { setData(j); setState("ready"); }
      } catch (e) {
        if (alive) { setErr(String(e.message || e)); setState("error"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const load = data?.load;
  const ftp = data?.ftp;
  const wel = data?.wellness;
  const band = formBand(load?.form);

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

        {nextWorkout && (
          <div style={S.ovNext}>
            <span style={S.ovNextLabel}>Next up</span>
            <span style={S.ovNextTitle}>{nextWorkout.title}</span>
            <span style={S.ovNextMeta}>
              {nextWorkout.date === iso(new Date()) ? "Today" : DAYS[(new Date(nextWorkout.date + "T00:00:00").getDay() + 6) % 7]}
              {nextWorkout.start ? ` · ${nextWorkout.start}` : ""}
            </span>
          </div>
        )}

        {state === "loading" && <div style={S.ovLoading}>Reading intervals.icu…</div>}
        {state === "error" && <div style={S.ovError}>Couldn't load fitness data. ({err})</div>}

        {state === "ready" && data && (
          <div style={S.ovBody}>
            {data.staleDays !== null && data.staleDays > 2 && (
              <div style={S.ovStale}>
                Last activity {data.staleDays} days ago — intervals.icu may still be syncing.
              </div>
            )}

            {/* Training load */}
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

            {/* FTP + zones */}
            <div style={S.ovSection}>
              <div style={S.ovSectionHead}>Power
                <span style={S.ovAsOf}>{ftp?.value ? `FTP ${ftp.value} W` : "no FTP set"}{ftp?.lthr ? ` · LTHR ${ftp.lthr}` : ""}{ftp?.maxHr ? ` · max HR ${ftp.maxHr}` : ""}</span>
              </div>
              {ftp?.zones?.length ? (
                <div style={S.ovZones}>
                  {ftp.zones.map((z, i) => (
                    <div key={i} style={S.ovZone}>
                      <span style={{ ...S.ovZoneBar, background: ZONE_COLORS[i] || accent }} />
                      <span style={S.ovZoneName}>{z.name}</span>
                      <span style={S.ovZoneW}>{z.from}{z.to ? `–${z.to}` : "+"} W</span>
                    </div>
                  ))}
                </div>
              ) : <div style={S.empty}>No power zones configured.</div>}
            </div>

            {/* Recovery / health */}
            <div style={S.ovSection}>
              <div style={S.ovSectionHead}>Recovery{wel?.date ? <span style={S.ovAsOf}>as of {relDay(wel.date)}</span> : null}</div>
              <div style={S.ovStats}>
                <Stat label="Sleep" value={fmtSleep(wel?.sleepSecs)} sub={wel?.sleepScore != null ? `score ${wel.sleepScore}` : ""} />
                <Stat label="HRV" sub="ms" value={wel?.hrv ?? "—"} />
                <Stat label="Resting HR" sub="bpm" value={wel?.restingHR ?? "—"} />
                <Stat label="Weight" sub="kg" value={wel?.weight ?? "—"} />
              </div>
            </div>

            {/* Recent activities */}
            {data.recent?.length > 0 && (
              <div style={S.ovSection}>
                <div style={S.ovSectionHead}>Recent activities</div>
                <div style={S.ovRecent}>
                  {data.recent.map((a) => (
                    <div key={a.id} style={S.ovActRow}>
                      <span style={S.ovActDate}>{relDay(a.date)}</span>
                      <span style={S.ovActName}>{a.name}</span>
                      <span style={S.ovActMeta}>{fmtDur(a.durationSec)}{a.load != null ? ` · ${a.load} TSS` : ""}{a.avgHr ? ` · ${a.avgHr}♥` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={S.ovFootHint}>Workout-plan generator coming next — this is the data it'll use.</div>
          </div>
        )}
      </div>
    </div>
  );
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

function AddRow({ adding, setAdding, onAdd }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("");
  const [cat, setCat] = useState("work");
  const [note, setNote] = useState("");

  if (!adding) {
    return <button style={S.addBtn} onClick={() => setAdding(true)} className="cd-add">+ Add block</button>;
  }
  return (
    <div style={S.addPanel}>
      <input autoFocus placeholder="What?" value={title} onChange={(e)=>setTitle(e.target.value)} style={S.input} />
      <div style={S.addGrid}>
        <input type="time" value={start} onChange={(e)=>setStart(e.target.value)} style={S.input} />
        <input type="time" value={end} onChange={(e)=>setEnd(e.target.value)} style={S.input} />
      </div>
      <input placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} style={S.input} />
      <div style={S.catPick}>
        {Object.entries(CATS).map(([k, v]) => (
          <button key={k} onClick={() => setCat(k)}
            style={{ ...S.catChip, borderColor: v.dot, background: cat===k ? v.soft : "transparent", color: v.dot }}>
            {v.label}
          </button>
        ))}
      </div>
      <div style={S.addActions}>
        <button style={S.cancelBtn} onClick={() => { setAdding(false); setTitle(""); }}>Cancel</button>
        <button style={S.saveBtn} disabled={!title.trim()}
          onClick={() => { if(!title.trim()) return; onAdd({ title: title.trim(), start, end, cat, note: note.trim() }); setTitle(""); setEnd(""); setNote(""); setAdding(false); }}>
          Add
        </button>
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

function MonthList({ imminent, later, today, onAdd, onRemove }) {
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("social");
  const todayStr = (d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`;})(today);

  return (
    <div>
      {imminent.length > 0 && (
        <div style={S.imminentBox}>
          {imminent.map((m) => (
            <div key={m.id} style={S.imminentRow}>
              <span style={S.imminentWhen}>{m.date === todayStr ? "Today" : "Tomorrow"}</span>
              <span style={{ ...S.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={S.imminentTitle}>{m.title}</span>
              {m.id.startsWith("m:") && (
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
              <span style={{ ...S.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={S.monthTitle}>{m.title}</span>
              {m.id.startsWith("m:") ? (
                <button onClick={() => onRemove(m.id)} style={S.del} className="cd-del">×</button>
              ) : <span />}
            </div>
          );
        })}
      </div>

      <div style={S.monthAdd}>
        <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} style={{ ...S.input, flex:"0 0 auto" }} />
        <input placeholder="e.g. Mom's birthday" value={title} onChange={(e)=>setTitle(e.target.value)} style={S.input} />
        <select value={cat} onChange={(e)=>setCat(e.target.value)} style={S.input}>
          {Object.entries(CATS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button style={S.saveBtn} disabled={!date || !title.trim()}
          onClick={() => { if(!date||!title.trim()) return; onAdd({ date, title:title.trim(), cat }); setDate(""); setTitle(""); }}>
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
const accent = "#2f5d9e";
const accentSoft = "#eef3fa";
const accentBorder = "#cdddef";

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
  .cd-workout:hover { transform: translateY(-3px); box-shadow: 0 22px 46px -22px rgba(36,75,128,0.7); }
  .cd-ov-backdrop { animation: ovFade .2s ease; }
  .cd-ov-panel { animation: ovSlide .28s cubic-bezier(.2,.8,.25,1); }
  .cd-ov-close:hover { background: ${line}; color: ${ink}; }
`;

const S = {
  shell: { minHeight: "100vh", background: `radial-gradient(120% 80% at 0% 0%, #f4f7fc 0%, ${paper} 55%, #e7ecf5 100%)`,
           fontFamily: "'Spline Sans', sans-serif", color: ink, padding: "28px clamp(16px,4vw,48px) 48px", animation: "rise .5s ease" },
  loading: { fontFamily: "'Fraunces', serif", fontSize: 22, color: muted, padding: 60, textAlign: "center" },
  errorBanner: { maxWidth: 1200, margin: "0 auto 14px", padding: "8px 14px", borderRadius: 10,
                 background: "#fbeae3", color: "#7a3a1f", fontSize: 12.5, border: "1px solid #f0d4c4" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, maxWidth: 1200, marginInline: "auto" },
  kicker: { textTransform: "uppercase", letterSpacing: "0.22em", fontSize: 11, color: muted, fontWeight: 600 },
  h1: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "clamp(28px,4vw,42px)", margin: "4px 0 0", letterSpacing: "-0.01em", color: ink },
  headerDate: { textAlign: "right" },
  bigDay: { fontFamily: "'Fraunces', serif", fontSize: 40, fontWeight: 700, lineHeight: 1, color: accent },
  bigMonth: { fontSize: 13, color: muted, fontWeight: 500, letterSpacing: "0.04em" },
  grid: { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 18, maxWidth: 1200, marginInline: "auto", marginBottom: 18, alignItems: "start" },
  rightCol: { display: "flex", flexDirection: "column", gap: 18 },
  card: { background: cardBg, border: `1px solid ${line}`, borderRadius: 22, padding: "20px 22px",
          boxShadow: "0 10px 30px -26px rgba(30,40,70,0.4)", maxWidth: 1200, marginInline: "auto", width: "100%", marginBottom: 0 },
  cardHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12 },
  h2: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, margin: 0, color: ink },
  cardSub: { fontSize: 12.5, color: muted },
  timeline: { display: "flex", flexDirection: "column", gap: 2 },
  tlRow: { display: "grid", gridTemplateColumns: "52px 18px 1fr 24px", gap: 6, alignItems: "stretch" },
  tlTime: { fontSize: 12.5, color: muted, paddingTop: 12, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  tlTimeEnd: { fontSize: 11, color: faint, marginTop: 2 },
  tlMid: { display: "flex", flexDirection: "column", alignItems: "center" },
  tlDot: { width: 12, height: 12, borderRadius: "50%", marginTop: 13, flex: "0 0 auto", boxShadow: "0 0 0 4px rgba(255,255,255,0.7)" },
  tlLine: { width: 2, flex: 1, background: line, marginTop: 2, marginBottom: -2 },
  tlBlock: { textAlign: "left", border: "none", borderRadius: 14, padding: "11px 13px", margin: "5px 0", cursor: "pointer", display: "block", width: "100%" },
  tlBlockTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  tlTitle: { fontSize: 15, fontWeight: 600, color: ink, lineHeight: 1.3 },
  tlNote: { fontSize: 12.5, color: muted, marginTop: 3, lineHeight: 1.4 },
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
  workoutCard: { background: "linear-gradient(135deg, #2f5d9e 0%, #244b80 100%)", border: "none", color: "#fff" },
  woTitle: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, lineHeight: 1.2 },
  woMeta: { fontSize: 13.5, opacity: 0.85, marginTop: 6, fontWeight: 500 },
  woNote: { fontSize: 13, opacity: 0.92, marginTop: 10, lineHeight: 1.45, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.22)" },
  woOpen: { fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" },

  // --- Fitness overlay ---
  ovBackdrop: { position: "fixed", inset: 0, zIndex: 50, background: "rgba(24,32,52,0.42)", backdropFilter: "blur(3px)",
                display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(16px,5vh,64px) 16px", overflowY: "auto" },
  ovPanel: { width: "100%", maxWidth: 560, background: cardBg, borderRadius: 24, border: `1px solid ${line}`,
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
  monthList: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 },
  monthItem: { display: "grid", gridTemplateColumns: "46px 10px 1fr 24px", gap: 12, alignItems: "center", padding: "9px 4px", borderBottom: `1px solid ${line}` },
  monthDate: { textAlign: "center" },
  monthDay: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, display: "block", lineHeight: 1, color: accent },
  monthMon: { fontSize: 10.5, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" },
  monthDotEl: { width: 10, height: 10, borderRadius: "50%" },
  monthTitle: { fontSize: 14.5, fontWeight: 500 },
  monthAdd: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  footer: { textAlign: "center", fontSize: 12, color: muted, marginTop: 26, maxWidth: 1200, marginInline: "auto" },
};
