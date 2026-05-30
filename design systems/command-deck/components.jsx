/* ============================================================
   Command Deck UI kit — presentational components
   Depends on window: CATS, COLORS, DAYS, MONTHS, iso, addDays
   Exports all components to window for App.jsx.
   ============================================================ */
(function () {
const { useState } = React;

const stripBursdag = (s) => s.replace(/\s*sin\s+bursdag\s*$/i, "").trim();

/* ---------- Header ------------------------------------------ */
function Header({ today }) {
  return (
    <header style={K.header}>
      <div>
        <div style={K.kicker}>Command Deck</div>
        <h1 style={K.h1}>Hei, Berge 👋</h1>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={K.bigDay}>{today.getDate()}</div>
        <div style={K.bigMonth}>{MONTHS[today.getMonth()].slice(0,3)} {today.getFullYear()}</div>
      </div>
    </header>
  );
}

/* ---------- Today timeline ---------------------------------- */
function TodayTimeline({ title, sub, tasks, onToggle, onRemove, adding, setAdding, onAdd }) {
  return (
    <section style={K.card} className="cd-card">
      <div style={K.cardHead}>
        <h2 style={K.h2}>{title}</h2>
        <span style={K.cardSub}>{sub}</span>
      </div>
      <div style={K.timeline}>
        {tasks.length === 0 && <div style={K.empty}>Nothing scheduled. Tap + to add a block.</div>}
        {tasks.map((t, i) => (
          <div key={t.id} style={K.tlRow} className="cd-row">
            <div style={K.tlTime}>{t.start || "—"}{t.end ? <div style={K.tlTimeEnd}>{t.end}</div> : null}</div>
            <div style={K.tlMid}>
              <div style={{ ...K.tlDot, background: CATS[t.cat].dot }} />
              {i < tasks.length - 1 && <div style={K.tlLine} />}
            </div>
            <button onClick={() => onToggle(t.id)}
              style={{ ...K.tlBlock, background: CATS[t.cat].soft, opacity: t.done ? 0.55 : 1 }} className="cd-block">
              <div style={K.tlBlockTop}>
                <span style={{ ...K.tlTitle, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                <span style={{ ...K.check, borderColor: CATS[t.cat].dot, background: t.done ? CATS[t.cat].dot : "transparent" }}>
                  {t.done ? "✓" : ""}
                </span>
              </div>
              {t.note && <div style={K.tlNote}>{t.note}</div>}
              <span style={{ ...K.tag, color: CATS[t.cat].dot }}>{CATS[t.cat].label}</span>
            </button>
            {t.id.startsWith("local:") && (
              <button onClick={() => onRemove(t.id)} style={K.del} title="Delete" className="cd-del">×</button>
            )}
          </div>
        ))}
      </div>
      <AddRow adding={adding} setAdding={setAdding} onAdd={onAdd} />
    </section>
  );
}

function AddRow({ adding, setAdding, onAdd }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("");
  const [cat, setCat] = useState("work");
  const [note, setNote] = useState("");
  if (!adding) {
    return <button style={K.addBtn} onClick={() => setAdding(true)} className="cd-add">+ Add block</button>;
  }
  return (
    <div style={K.addPanel}>
      <input autoFocus placeholder="What?" value={title} onChange={(e)=>setTitle(e.target.value)} style={K.input} />
      <div style={K.addGrid}>
        <input type="time" value={start} onChange={(e)=>setStart(e.target.value)} style={K.input} />
        <input type="time" value={end} onChange={(e)=>setEnd(e.target.value)} style={K.input} />
      </div>
      <input placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} style={K.input} />
      <div style={K.catPick}>
        {Object.entries(CATS).map(([k, v]) => (
          <button key={k} onClick={() => setCat(k)}
            style={{ ...K.catChip, borderColor: v.dot, background: cat===k ? v.soft : "transparent", color: v.dot }}>
            {v.label}
          </button>
        ))}
      </div>
      <div style={K.addActions}>
        <button style={K.cancelBtn} onClick={() => { setAdding(false); setTitle(""); }}>Cancel</button>
        <button style={K.saveBtn} disabled={!title.trim()}
          onClick={() => { if(!title.trim()) return; onAdd({ title: title.trim(), start, end, cat, note: note.trim() }); setTitle(""); setEnd(""); setNote(""); setAdding(false); }}>
          Add
        </button>
      </div>
    </div>
  );
}

/* ---------- Next workout ------------------------------------ */
function WorkoutCard({ workout, today }) {
  return (
    <section style={{ ...K.card, ...K.workoutCard }} className="cd-card">
      <div style={K.cardHead}><h2 style={{ ...K.h2, color: "#fff" }}>Next workout</h2></div>
      {workout ? (
        <>
          <div style={K.woTitle}>{workout.title}</div>
          <div style={K.woMeta}>
            {workout.date === iso(today) ? "Today" : DAYS[(new Date(workout.date+"T00:00:00").getDay()+6)%7]} · {workout.start}
          </div>
          {workout.note && <div style={K.woNote}>{workout.note}</div>}
        </>
      ) : <div style={{ ...K.empty, color: "rgba(255,255,255,0.85)" }}>No upcoming training scheduled.</div>}
    </section>
  );
}

/* ---------- Weather ----------------------------------------- */
function WeatherStrip({ weather, openDate, setOpenDate }) {
  return (
    <section style={K.card} className="cd-card">
      <div style={K.cardHead}>
        <h2 style={K.h2}>{weather?.place || "Bergen"}</h2>
        <span style={K.cardSub}>{weather ? "Live from YR.no" : "Loading…"}</span>
      </div>
      {weather?.days?.length ? (
        <>
          <div style={K.wxRow}>
            {weather.days.map((w) => {
              const open = w.date === openDate;
              return (
                <button key={w.date} onClick={() => setOpenDate(open ? null : w.date)}
                  style={{ ...K.wxDay, ...(open ? K.wxDayActive : {}) }} className="cd-weekday">
                  <div style={K.wxName}>{w.d}</div>
                  <div style={K.wxIcon}>{w.icon}</div>
                  <div style={K.wxHi}>{w.hi}°</div>
                  <div style={K.wxLo}>{w.lo}°</div>
                  <div style={K.wxPop}>{w.pop}%</div>
                </button>
              );
            })}
          </div>
          <WeatherDetail day={weather.days.find(d => d.date === openDate)} />
        </>
      ) : <div style={K.empty}>Weather unavailable.</div>}
    </section>
  );
}

function WeatherDetail({ day }) {
  if (!day || !day.hours?.length) {
    return <div style={K.wxNote}>{day ? "Hourly detail not available for this day." : "Tap a day for hourly detail."}</div>;
  }
  return (
    <div style={K.wxDetail}>
      <div style={K.wxDetailScroll}>
        {day.hours.map((h, i) => (
          <div key={h.hour} style={{ ...K.wxHour, ...(i === 1 ? K.wxHourNow : {}) }}>
            <div style={K.wxHourTime}>{h.hour.slice(0,2)}</div>
            <div style={K.wxHourIcon}>{h.icon}</div>
            <div style={K.wxHourTemp}>{h.temp}°</div>
            <div style={K.wxHourPrecip}>{h.precip > 0 ? `${h.precip}mm` : "—"}</div>
            <div style={K.wxHourWind}>{h.wind} m/s</div>
          </div>
        ))}
      </div>
      <div style={K.wxLegend}>time · temp · precip · wind</div>
    </div>
  );
}

/* ---------- Week strip -------------------------------------- */
function WeekStrip({ today, selectedDate, setSelectedDate, dayTasks }) {
  return (
    <section style={K.card} className="cd-card">
      <div style={K.cardHead}><h2 style={K.h2}>Next 7 days</h2><span style={K.cardSub}>tap a day to open it</span></div>
      <div style={K.weekRow}>
        {Array.from({ length: 7 }).map((_, i) => {
          const d = addDays(today, i);
          const dateStr = iso(d);
          const dname = i === 0 ? "Today" : DAYS[(d.getDay()+6)%7];
          const ts = dayTasks(dateStr);
          const active = dateStr === selectedDate;
          return (
            <button key={dateStr} onClick={() => setSelectedDate(dateStr)}
              style={{ ...K.weekDay, ...(active ? K.weekDayActive : {}) }} className="cd-weekday">
              <div style={K.weekName}>{dname}</div>
              <div style={{ ...K.weekNum, ...(i === 0 ? { color: COLORS.accent } : {}) }}>{d.getDate()}</div>
              <div style={K.weekDots}>
                {ts.slice(0, 5).map((t, j) => (
                  <span key={j} style={{ ...K.weekDot, background: CATS[t.cat].dot, opacity: t.done ? 0.4 : 1 }} />
                ))}
              </div>
              <div style={K.weekCount}>{ts.length ? `${ts.filter(t=>t.done).length}/${ts.length}` : "—"}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Month ahead ------------------------------------- */
function MonthAhead({ imminent, later, today }) {
  const todayStr = iso(today);
  return (
    <section style={K.card} className="cd-card">
      <div style={K.cardHead}><h2 style={K.h2}>Month ahead</h2><span style={K.cardSub}>next 30 days</span></div>
      {imminent.length > 0 && (
        <div style={K.imminentBox}>
          {imminent.map((m) => (
            <div key={m.id} style={K.imminentRow}>
              <span style={K.imminentWhen}>{m.date === todayStr ? "Today" : "Tomorrow"}</span>
              <span style={{ ...K.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={K.imminentTitle}>{m.title}</span>
            </div>
          ))}
        </div>
      )}
      <div style={K.monthList}>
        {imminent.length === 0 && later.length === 0 && (
          <div style={K.empty}>Nothing in the next 30 days.</div>
        )}
        {later.map((m) => {
          const d = new Date(m.date + "T00:00:00");
          return (
            <div key={m.id} style={K.monthItem} className="cd-row">
              <div style={{ textAlign: "center" }}>
                <span style={K.monthDay}>{d.getDate()}</span>
                <span style={K.monthMon}>{MONTHS[d.getMonth()].slice(0,3)}</span>
              </div>
              <span style={{ ...K.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={K.monthTitle}>{m.title}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

Object.assign(window, {
  Header, TodayTimeline, AddRow, WorkoutCard,
  WeatherStrip, WeatherDetail, WeekStrip, MonthAhead, stripBursdag,
});
})();
