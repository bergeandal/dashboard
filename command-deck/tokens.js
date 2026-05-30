/* ============================================================
   Command Deck UI kit — tokens, category system, seed data
   Plain JS globals (no JSX). Loaded before the components.
   Palette = the cool / denim-blue scheme.
   ============================================================ */

window.CATS = {
  work:     { label: "Work",     dot: "#2f5d9e", soft: "rgba(47,93,158,0.12)" },
  training: { label: "Training", dot: "#5b96cf", soft: "rgba(91,150,207,0.12)" },
  home:     { label: "Home",     dot: "#6f9e6a", soft: "rgba(111,158,106,0.12)" },
  social:   { label: "Social",   dot: "#b07ec2", soft: "rgba(176,126,194,0.12)" },
  birthday: { label: "Birthday", dot: "#d96a8a", soft: "rgba(217,106,138,0.14)" },
};

window.COLORS = {
  ink: "#20242e", muted: "#707887", faint: "#a6adba",
  paper: "#eef1f6", card: "#fbfcfe", line: "#dde2ec",
  accent: "#2f5d9e", accentSoft: "#eef3fa", accentBorder: "#cdddef",
  workout: "linear-gradient(135deg, #2f5d9e 0%, #244b80 100%)",
  shell: "radial-gradient(120% 80% at 0% 0%, #f4f7fc 0%, #eef1f6 55%, #e7ecf5 100%)",
};

window.DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
window.MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

window.iso = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
window.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* ---- Seed data, generated relative to "today" so the kit always
        looks populated no matter when it's opened. ---------------- */
(function seed() {
  const base = new Date(); base.setHours(0,0,0,0);
  const D = (n) => window.iso(window.addDays(base, n));
  let n = 0; const id = (p) => `${p}:${n++}`;

  window.SEED_TASKS = [
    // Today
    { id: id("g"), date: D(0), start: "07:00", end: "07:45", cat: "training", title: "Easy run by the fjord", note: "Loop around Store Lungegårdsvann" },
    { id: id("g"), date: D(0), start: "09:00", end: "10:30", cat: "work", title: "Sprint planning", note: "Bring the roadmap doc · Room 2" },
    { id: id("g"), date: D(0), start: "13:00", end: "",      cat: "work", title: "1:1 with Marit" },
    { id: id("g"), date: D(0), start: "17:30", end: "",      cat: "home", title: "Groceries", note: "Fish + bread for the weekend" },
    { id: id("g"), date: D(0), start: "19:30", end: "",      cat: "social", title: "Dinner with Astrid" },
    // Tomorrow
    { id: id("g"), date: D(1), start: "09:00", end: "",      cat: "work", title: "Standup" },
    { id: id("g"), date: D(1), start: "18:00", end: "19:00", cat: "training", title: "Strength session", note: "Push day — focus on form" },
    // +2
    { id: id("g"), date: D(2), start: "10:00", end: "12:00", cat: "work", title: "Deep work block" },
    { id: id("g"), date: D(2), start: "20:00", end: "",      cat: "home", title: "Call the landlord" },
    // +3
    { id: id("g"), date: D(3), start: "08:00", end: "10:00", cat: "training", title: "Long run", note: "Build base — keep it slow" },
    // +4
    { id: id("g"), date: D(4), start: "12:30", end: "",      cat: "social", title: "Lunch with the team" },
    // +5
    { id: id("g"), date: D(5), start: "09:00", end: "",      cat: "work", title: "Quarterly review" },
  ];

  window.SEED_BIRTHDAYS = [
    { id: id("b"), date: D(5),  cat: "birthday", title: "Mamma sin bursdag" },
    { id: id("b"), date: D(14), cat: "birthday", title: "Henrik sin bursdag" },
  ];

  window.SEED_MONTH = [
    { id: id("m"), date: D(2),  cat: "home",   title: "Dentist, 14:00" },
    { id: id("m"), date: D(9),  cat: "social", title: "Cabin trip with the crew" },
    { id: id("m"), date: D(21), cat: "social", title: "Ola & Kari — housewarming" },
  ];

  // Weather: 7 days, Bergen-appropriate (lots of rain).
  const wdays = [
    { icon: "🌧️", hi: 9,  lo: 4, pop: 80 },
    { icon: "⛅️", hi: 11, lo: 5, pop: 30 },
    { icon: "☀️", hi: 13, lo: 6, pop: 10 },
    { icon: "🌦️", hi: 10, lo: 5, pop: 55 },
    { icon: "🌧️", hi: 8,  lo: 3, pop: 75 },
    { icon: "⛅️", hi: 10, lo: 4, pop: 35 },
    { icon: "☁️", hi: 9,  lo: 5, pop: 40 },
  ];
  const hourIcons = ["☁️","🌧️","🌧️","⛅️","⛅️","☀️","🌦️","🌧️"];
  window.SEED_WEATHER = {
    place: "Bergen",
    days: wdays.map((w, i) => {
      const d = window.addDays(base, i);
      return {
        date: window.iso(d),
        d: i === 0 ? window.DAYS[(d.getDay()+6)%7] : window.DAYS[(d.getDay()+6)%7],
        icon: w.icon, hi: w.hi, lo: w.lo, pop: w.pop,
        hours: i === 0 ? Array.from({ length: 8 }).map((_, h) => {
          const hr = 6 + h*2;
          return {
            hour: `${String(hr).padStart(2,"0")}:00`,
            icon: hourIcons[h],
            temp: Math.round(w.lo + (w.hi-w.lo) * Math.sin((hr/24)*Math.PI)),
            precip: [0.4,1.2,0.8,0,0,0,0.2,0.6][h],
            wind: [4,6,5,3,3,2,4,5][h],
          };
        }) : [],
      };
    }),
  };
})();
