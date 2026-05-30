/* ============================================================
   Command Deck UI kit — interactive App
   Local-only recreation: seed data + localStorage done-state.
   Demonstrates: check off tasks, switch days, add a block,
   expand weather, see Next-workout / Month-ahead update live.
   ============================================================ */
(function () {
const { useState, useMemo } = React;

function App() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const [calendarTasks] = useState(window.SEED_TASKS);
  const [birthdays] = useState(window.SEED_BIRTHDAYS);
  const [month] = useState(window.SEED_MONTH);
  const [weather] = useState(window.SEED_WEATHER);
  const [localTasks, setLocalTasks] = useState([]);
  const [doneIds, setDoneIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cdkit.done") || "[]"); } catch { return []; }
  });
  const [selectedDate, setSelectedDate] = useState(iso(today));
  const [openWeatherDate, setOpenWeatherDate] = useState(window.SEED_WEATHER.days[0].date);
  const [adding, setAdding] = useState(false);

  const persistDone = (next) => { setDoneIds(next); try { localStorage.setItem("cdkit.done", JSON.stringify(next)); } catch {} };
  const doneSet = useMemo(() => new Set(doneIds), [doneIds]);

  const allTasks = useMemo(() => {
    const merged = [...calendarTasks, ...birthdays, ...localTasks].map((t) => ({ ...t, done: doneSet.has(t.id) }));
    return merged.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  }, [calendarTasks, birthdays, localTasks, doneSet]);

  const toggle = (id) => persistDone(doneSet.has(id) ? doneIds.filter(x => x !== id) : [...doneIds, id]);

  const addLocalTask = (task) => {
    const created = { ...task, id: `local:${Date.now()}`, date: selectedDate };
    setLocalTasks((prev) => [...prev, created]);
  };
  const removeTask = (id) => setLocalTasks((prev) => prev.filter(t => t.id !== id));

  const dayTasks = (dateStr) => allTasks.filter((t) => t.date === dateStr);
  const selectedTasks = dayTasks(selectedDate);
  const selDate = new Date(selectedDate + "T00:00:00");
  const isToday = selectedDate === iso(today);

  const dayProgress = (dateStr) => {
    const ts = dayTasks(dateStr);
    if (!ts.length) return 0;
    return Math.round((ts.filter((t) => t.done).length / ts.length) * 100);
  };

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
      .filter(b => { const k = `${b.date}|${b.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const all = [...month, ...bdays]
      .filter(e => e.date >= todayStr && e.date <= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      imminent: all.filter(e => e.date === todayStr || e.date === tomorrowStr),
      later: all.filter(e => e.date > tomorrowStr),
    };
  }, [month, birthdays, today]);

  const todayTitle = isToday ? "Today" : DAYS[(selDate.getDay()+6)%7];
  const todaySub = `${selDate.getDate()} ${MONTHS[selDate.getMonth()].slice(0,3)} · ${dayProgress(selectedDate)}% done`;

  return (
    <div style={K.shell}>
      <Header today={today} />
      <div style={K.grid}>
        <TodayTimeline
          title={todayTitle} sub={todaySub} tasks={selectedTasks}
          onToggle={toggle} onRemove={removeTask}
          adding={adding} setAdding={setAdding} onAdd={addLocalTask}
        />
        <div style={K.rightCol}>
          <WorkoutCard workout={nextWorkout} today={today} />
          <WeatherStrip weather={weather} openDate={openWeatherDate} setOpenDate={setOpenWeatherDate} />
        </div>
      </div>
      <WeekStrip today={today} selectedDate={selectedDate} setSelectedDate={setSelectedDate} dayTasks={dayTasks} />
      <MonthAhead imminent={imminent} later={later} today={today} />
      <footer style={K.footer}>v2 · everything synced via your home server · refreshes every 5 min</footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
})();