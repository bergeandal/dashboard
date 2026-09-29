import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

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

// Household profiles (one deck each) live on the server (/api/profiles) and can
// be added/removed from the UI. Shared events surface on every deck. This list
// is only the first-paint fallback before the server answers.
const DEFAULT_PROFILES = [
  { id: "berge", name: "Berge", theme: "denim" },
  { id: "amanda", name: "Amanda", theme: "rose" },
];

// Each profile picks a palette; the active one is published as CSS variables
// on the shell so the whole page re-themes on switch. Denim and rose are the
// original hand-tuned Berge/Amanda palettes; the rest derive from one base color.
const hexRgb = (hex) => hex.match(/\w\w/g).map((h) => parseInt(h, 16));
const mixHex = (hex, to, t) => {
  const b = hexRgb(to);
  return "#" + hexRgb(hex).map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
const derivePalette = (color) => {
  const dark = mixHex(color, "#000000", 0.22);
  return {
    color, dark, soft: mixHex(color, "#ffffff", 0.91), border: mixHex(color, "#ffffff", 0.76),
    glow: `rgba(${hexRgb(dark).join(",")},0.7)`,
    bg: `radial-gradient(120% 80% at 0% 0%, ${mixHex(color, "#ffffff", 0.95)} 0%, ${mixHex(color, "#ffffff", 0.9)} 55%, ${mixHex(color, "#ffffff", 0.82)} 100%)`,
  };
};
const PALETTES = {
  denim: { color: "#2f5d9e", soft: "#eef3fa", border: "#cdddef", dark: "#244b80", glow: "rgba(36,75,128,0.7)",
           bg: "radial-gradient(120% 80% at 0% 0%, #f4f7fc 0%, #eef1f6 55%, #e7ecf5 100%)" },
  rose:  { color: "#b5547e", soft: "#fbeef4", border: "#edccda", dark: "#8f3f63", glow: "rgba(143,63,99,0.7)",
           bg: "radial-gradient(120% 80% at 0% 0%, #fdf4f8 0%, #f9eaf1 55%, #f1dde7 100%)" },
  sage:  derivePalette("#5a8a55"),
  plum:  derivePalette("#7d5a9e"),
  amber: derivePalette("#b07a2a"),
  teal:  derivePalette("#2f8a88"),
  slate: derivePalette("#56637a"),
  coral: derivePalette("#c8604a"),
};
const paletteOf = (theme) => PALETTES[theme] || PALETTES.denim;
const themeVars = (theme) => {
  const t = paletteOf(theme);
  return { "--accent": t.color, "--accent-soft": t.soft, "--accent-border": t.border, "--accent-dark": t.dark, "--accent-glow": t.glow, "--app-bg": t.bg };
};
// Look up a profile in the list, falling back to the first one.
const profileIn = (profiles, id) => profiles.find((p) => p.id === id) || profiles[0];

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

// ── Coach prompt generator ────────────────────────────────────────
// Zero-API training planner. The app assembles a rich prompt from live
// intervals.icu data + the calendar window + this static brief; you paste it
// into a Claude chat (no API spend) and Claude returns a plan. The "## How to
// respond" block asks for a JSON array we'll later import straight back into
// the app. Edit COACH freely — it's the "who I am / how to plan for me" half;
// the live numbers are filled in at generate time. TODO: move COACH to settings.
const COACH = {
  athlete: [
    "Cycling-focused endurance athlete based in Bergen, Norway (hilly, wet — indoor trainer is fine).",
    "3 years of structured endurance training with a solid racing history across short and long events.",
    "Completed Bergen–Voss 2025 in 4:34 — that is the A-race target again next year; train to beat that time.",
    "Many years of strength training background — compound lifts are familiar, not new stimulus.",
    "Current capacity: can absorb high-volume weeks (10–15+ hours) and multi-hour rides without issue.",
    "Do NOT cap sessions at 45–60 min — rides of 2–4 h are normal and appropriate for this athlete.",
    "Primary goal: build aerobic base with high Zone-2 volume, plus some targeted high intensity (threshold / VO2).",
    "Secondary: compound strength 2×/week (squat, deadlift, press) and short mobility most days.",
  ].join(" "),
  rules: [
    "Polarized ~80/20 — most time easy in Z1–Z2, intensity in deliberate, well-spaced doses.",
    "Respect form (TSB): clearly negative → keep it easy / add recovery; fresh & positive → a harder block is fine.",
    "Ramp weekly TSS by at most ~5–8% over the recent 7-day load — don't spike it.",
    "Never two hard days back-to-back; follow a hard day with easy or rest.",
    "Schedule AROUND the existing calendar blocks below — never double-book work or social commitments.",
    "Strength 2×/week on easier-ride days; mobility 10–15 min on most days.",
    "For every ride give a concrete target: duration + zone (and target power or HR) + a TSS estimate.",
  ],
};

// Assemble the copy-paste training prompt. `tasks` is the in-memory allTasks
// list (the app already holds a 120-day window); we slice it to [start,end]
// for the "already on my calendar" section so Claude plans around commitments.
function buildCoachPrompt({ data, tasks, weather, start, end, notes }) {
  const load = data?.load || {}, ftp = data?.ftp || {}, hr = data?.hr || {}, wel = data?.wellness || {};
  const wkg = ftp.value && wel.weight ? (ftp.value / wel.weight).toFixed(1) : null;
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
  const L = [];

  L.push(`You are my cycling & strength coach. Build me a training plan from ${start} to ${end} (${days} days).`, "");

  L.push(`## Current state — intervals.icu, as of ${(data?.asOf || "").slice(0, 10)}`);
  L.push(`Fitness CTL ${load.ctl ?? "—"} · Fatigue ATL ${load.atl ?? "—"} · Form TSB ${load.form ?? "—"}`);
  L.push(`7-day load ${load.last7Tss ?? 0} TSS · 6-week load ${load.last42Tss ?? 0} TSS`);
  L.push(`FTP ${ftp.value ?? "—"} W${wkg ? ` (${wkg} W/kg)` : ""} · Threshold HR ${hr.lthr ?? "—"} bpm${hr.maxHr ? ` · max ${hr.maxHr}` : ""}`);
  L.push(`Sleep ${fmtSleep(wel.sleepSecs)} · HRV ${wel.hrv ?? "—"} ms · Resting HR ${wel.restingHR ?? "—"} bpm · Weight ${wel.weight ?? "—"} kg`);
  if (data?.staleDays != null && data.staleDays > 2) L.push(`(heads up: last activity was ${data.staleDays} days ago — numbers may lag)`);
  L.push("");

  if (data?.recent?.length) {
    L.push("Recent sessions:");
    data.recent.forEach((a) =>
      L.push(`- ${a.date} · ${a.type} · ${a.load ?? "?"} TSS${a.durationSec ? ` · ${fmtDur(a.durationSec)}` : ""}${a.avgHr ? ` · avg HR ${a.avgHr}` : ""}`));
    L.push("");
  }

  L.push("## Me & my preferences");
  L.push(COACH.athlete);
  if (ftp.zones?.length) L.push(`Power zones (W): ${ftp.zones.map((z) => `${z.name} ${z.from}${z.to ? `–${z.to}` : "+"}`).join(" · ")}`);
  if (hr.zones?.length) L.push(`HR zones (bpm): ${hr.zones.map((z) => `${z.name} ${z.from || "<"}${z.to ? `–${z.to}` : "+"}`).join(" · ")}`);
  L.push("");

  const inRange = (tasks || [])
    .filter((t) => t.date >= start && t.date <= end)
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  L.push(`## Already on my calendar, ${start} → ${end}`);
  if (!inRange.length) {
    L.push("(nothing scheduled — the days are open)");
  } else {
    let lastDate = "";
    inRange.forEach((t) => {
      if (t.date !== lastDate) {
        const d = new Date(t.date + "T00:00:00");
        L.push(`${DAYS[(d.getDay() + 6) % 7]} ${t.date}:`);
        lastDate = t.date;
      }
      const time = t.start ? `${t.start}${t.end ? `–${t.end}` : ""}` : "all-day";
      const cat = CATS[t.cat]?.label || t.cat || "";
      L.push(`  • ${time} ${t.title}${cat ? ` [${cat}]` : ""}`);
    });
  }
  L.push("");

  const wxDays = (weather?.days || []).filter((w) => w.date >= start && w.date <= end);
  if (wxDays.length) {
    L.push(`## Weather forecast — Bergen (YR.no, next ${wxDays.length} days)`);
    wxDays.forEach((w) => {
      const totalPrecip = w.hours.reduce((s, h) => s + (h.precip || 0), 0);
      const maxWind = w.hours.length ? Math.max(...w.hours.map((h) => h.wind)) : 0;
      const heavyRain = w.pop >= 70 || totalPrecip >= 5;
      let line = `${w.date} (${w.d}): ${w.icon} ${w.hi}/${w.lo}°C · rain ${w.pop}%`;
      if (totalPrecip > 0) line += ` · ${totalPrecip.toFixed(1)} mm`;
      if (maxWind >= 8) line += ` · wind ${maxWind} m/s`;
      if (heavyRain) line += " ← heavy rain: prefer run or indoor trainer over outdoor ride";
      L.push(line);
    });
    if (wxDays.length < Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1)) {
      L.push("(YR.no forecast only covers 7 days — plan remaining days based on typical Bergen conditions)");
    }
    L.push("");
  }

  L.push("## How to plan");
  COACH.rules.forEach((r) => L.push(`- ${r}`));
  L.push("");

  if (notes && notes.trim()) {
    L.push("## Extra notes for this block", notes.trim(), "");
  }

  L.push("## How to respond");
  L.push("1. A short day-by-day plan I can scan (date · session · target · why).");
  L.push("2. Then the SAME plan as a JSON array in a ```json code block, exactly this shape — I'll import it straight into my app:");
  L.push("```json");
  L.push('[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"Z2 endurance","sport":"Ride","tss":75,"note":"session detail incl. targets"}]');
  L.push("```");
  L.push(`Rules: dates within ${start}–${end}; 24-hour times (end optional); sport one of Ride / Run / Strength / Mobility / Swim / Other; tss an integer estimate (0 for mobility); note = the actual session prescription. Only include sessions you want added — leave rest days out.`);

  return L.join("\n");
}

// ── Plan import (Stage 2) ─────────────────────────────────────────
const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const padTime = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : String(s ?? "").trim();
};

// Pull a JSON array out of whatever got pasted: raw JSON, a ```json fenced
// block, or a whole Claude reply with prose wrapped around the array.
function extractJsonArray(text) {
  const t = (text || "").trim();
  if (!t) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(t);
  if (Array.isArray(v)) return v;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { v = tryParse(fence[1].trim()); if (Array.isArray(v)) return v; }
  const i = t.indexOf("["), j = t.lastIndexOf("]");
  if (i >= 0 && j > i) { v = tryParse(t.slice(i, j + 1)); if (Array.isArray(v)) return v; }
  return null;
}

// Parse + validate pasted plan text into normalized blocks. Returns either
// { error } or { blocks, skipped } (skipped = 1-based indices that failed).
function parsePlan(text) {
  const arr = extractJsonArray(text);
  if (!arr) return { error: "Couldn't find a JSON array. Paste the [ … ] block Claude gave you (the whole reply is fine)." };
  const blocks = [], skipped = [];
  arr.forEach((b, i) => {
    const date = String(b?.date ?? "").trim();
    const title = String(b?.title ?? "").trim();
    if (!PLAN_DATE_RE.test(date) || Number.isNaN(Date.parse(date)) || !title) { skipped.push(i + 1); return; }
    const start = b?.start ? padTime(b.start) : "";
    const end = b?.end ? padTime(b.end) : "";
    if ((start && !PLAN_TIME_RE.test(start)) || (end && !PLAN_TIME_RE.test(end))) { skipped.push(i + 1); return; }
    const tssNum = Number(b?.tss);
    blocks.push({
      date, start, end, title,
      sport: String(b?.sport ?? "").trim(),
      tss: Number.isFinite(tssNum) && tssNum > 0 ? Math.round(tssNum) : null,
      note: String(b?.note ?? "").trim(),
    });
  });
  if (!blocks.length) return { error: "No valid sessions found — each needs at least a date and a title." };
  return { blocks, skipped };
}

// Day-grouped preview of a parsed plan, shown before the user confirms import.
function ImportPreview({ blocks, skipped }) {
  const groups = [];
  let last = null;
  [...blocks].sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || ""))).forEach((b) => {
    if (!last || last.date !== b.date) { last = { date: b.date, items: [] }; groups.push(last); }
    last.items.push(b);
  });
  return (
    <div style={S.importPreview}>
      <div style={S.importPreviewHead}>
        {blocks.length} session{blocks.length === 1 ? "" : "s"}{skipped?.length ? ` · ${skipped.length} skipped` : ""}
      </div>
      {groups.map((g) => {
        const d = new Date(g.date + "T00:00:00");
        return (
          <div key={g.date} style={S.previewGroup}>
            <div style={S.previewDay}>{DAYS[(d.getDay() + 6) % 7]} {g.date}</div>
            {g.items.map((b, i) => (
              <div key={i} style={S.previewRow}>
                <span style={S.previewTime}>{b.start ? (b.end ? `${b.start}–${b.end}` : b.start) : "—"}</span>
                <span style={S.previewTitle}>{b.title}</span>
                <span style={S.previewMeta}>{[b.sport, b.tss ? `${b.tss} TSS` : null].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const REFRESH_MS = 5 * 60 * 1000;

// Unlock token for the PIN-protected profile open in this tab (null = none).
// Lives only in memory, so a reload locks the profile again.
let unlockToken = null;
const setUnlockToken = (t) => { unlockToken = t; };
const apiFetch = (url, opts = {}) =>
  fetch(url, unlockToken ? { ...opts, headers: { ...opts.headers, "X-Profile-Unlock": unlockToken } } : opts);

const jsonPost = (url, body) =>
  apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const jsonSend = (method, url, body) =>
  apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Last-known profile list, so the pills paint instantly on reload.
const readCachedProfiles = () => {
  try {
    const v = JSON.parse(localStorage.getItem("cd.profiles"));
    return Array.isArray(v) && v.length ? v : DEFAULT_PROFILES;
  } catch { return DEFAULT_PROFILES; }
};

export default function App() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const [calendarTasks, setCalendarTasks] = useState([]);
  const [birthdays, setBirthdays] = useState([]);
  const [weather, setWeather] = useState(null);
  const [localTasks, setLocalTasks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [doneIds, setDoneIds] = useState([]);
  const [places, setPlaces] = useState([]); // saved locations (work, gym, …)
  const [home, setHome] = useState(null);   // dedicated home anchor { address, lat, lon } | null
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
  const [profiles, setProfiles] = useState(readCachedProfiles);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // The stored pick may name a profile removed on another device; resolving it
  // through profileIn falls back to the first profile (the server does the same).
  const [profilePick, setProfile] = useState(() => localStorage.getItem("cd.profile") || "berge");
  const activeProfile = useMemo(() => profileIn(profiles, profilePick), [profiles, profilePick]);
  const profile = activeProfile.id;
  const theme = activeProfile.theme;

  // PINs: the device's owner profile (from its sign-in) opens freely; any
  // other profile with a PIN asks for it on every switch and re-locks when you
  // switch away. `pinPrompt` is the profile id currently asking for its PIN.
  const [owner, setOwner] = useState("");
  const [pinPrompt, setPinPrompt] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null); // profile id whose settings sheet is open
  const pendingSettings = useRef(null); // open this profile's settings once its PIN is entered
  const [unlocked, setUnlocked] = useState(null); // profile id unlockToken belongs to
  const needsPin = (id) => { const p = profiles.find((x) => x.id === id); return !!p?.hasPin && id !== owner; };

  const switchProfile = (p, { token } = {}) => {
    if (p === profile && !token) return;
    if (token) { setUnlockToken(token); setUnlocked(p); }
    else if (needsPin(p)) { setPinPrompt(p); return; }
    else { setUnlockToken(null); setUnlocked(null); }
    // Only profiles this device can open without a PIN become its default.
    if (!needsPin(p)) localStorage.setItem("cd.profile", p);
    setProfile(p);
  };

  const unlockProfile = async (id, pin, claim) => {
    const res = await jsonPost(`/api/profiles/${encodeURIComponent(id)}/unlock`, { pin, claim });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (claim) { setOwner(id); localStorage.setItem("cd.profile", id); }
    setPinPrompt(null);
    switchProfile(id, { token: body.unlock });
    if (pendingSettings.current === id) { pendingSettings.current = null; setProfilesOpen(false); setSettingsFor(id); }
  };

  // Long-press a pill (or tap a row in the Profiles sheet): a locked profile
  // asks for its PIN first, then its settings open.
  const openSettings = (id) => {
    if (needsPin(id) && unlocked !== id) { pendingSettings.current = id; setPinPrompt(id); return; }
    setProfilesOpen(false);
    setSettingsFor(id);
  };

  const profileError = (body, res) => (body.error === "locked" ? "Enter this profile's PIN first" : body.error || `HTTP ${res.status}`);

  const updateProfile = async (id, patch) => {
    const res = await jsonSend("PATCH", `/api/profiles/${encodeURIComponent(id)}`, patch);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(profileError(body, res));
    applyProfiles(profiles.map((p) => (p.id === id ? { ...p, name: body.name, theme: body.theme } : p)));
  };

  // Sign out every other device that belongs to this profile (and any open PIN
  // unlocks of it). This device stays in.
  const signOutOthers = async (id) => {
    const res = await jsonPost(`/api/profiles/${encodeURIComponent(id)}/signout`, {});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(profileError(body, res));
    if (body.unlock && id === unlocked) setUnlockToken(body.unlock);
  };

  // Where to go when a PIN prompt is dismissed: this device's own profile, or
  // any profile without a PIN. null = nowhere, so the prompt can't be dismissed.
  const pinFallback = (lockedId) =>
    [owner, ...profiles.filter((p) => !p.hasPin).map((p) => p.id)].find((id) => id && id !== lockedId && profiles.some((p) => p.id === id)) || null;

  const setPin = async (id, pin) => {
    const res = await jsonSend("PUT", `/api/profiles/${encodeURIComponent(id)}/pin`, { pin });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(profileError(body, res));
    applyProfiles(profiles.map((p) => (p.id === id ? { ...p, hasPin: body.hasPin } : p)));
    // Keep this tab in: a fresh PIN would otherwise lock us out of the profile.
    if (body.unlock && (id === profile || id === unlocked)) { setUnlockToken(body.unlock); setUnlocked(id); }
  };

  const applyProfiles = useCallback((list) => {
    setProfiles(list);
    try { localStorage.setItem("cd.profiles", JSON.stringify(list)); } catch { /* storage full/blocked */ }
  }, []);

  // The profile list is readable before sign-in (the login screen needs it).
  const loadProfiles = useCallback(async () => {
    try { const res = await apiFetch("/api/profiles"); if (res.ok) applyProfiles(await res.json()); }
    catch (e) { console.warn("profiles load failed", e); }
  }, [applyProfiles]);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const addProfile = async (draft) => {
    const res = await jsonPost("/api/profiles", draft);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    applyProfiles([...profiles, body]);
    return body;
  };

  const removeProfile = async (id) => {
    const res = await apiFetch(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(profileError(body, res));
    const rest = profiles.filter((p) => p.id !== id);
    applyProfiles(rest);
    if (id === profile) switchProfile(rest[0].id);
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

  const fetchData = useCallback(async (overrideProfile) => {
    try {
      const start = iso(today);
      const res = await apiFetch(`/api/data?start=${start}&days=120&profile=${overrideProfile || profile}`);
      if (res.status === 401) { setStatus("auth"); return; }
      if (res.status === 403) {
        // Profile is PIN-locked (e.g. a PIN was set elsewhere, or the unlock
        // expired): drop whatever was on screen and ask for the PIN.
        setCalendarTasks([]); setLocalTasks([]); setTodos([]);
        setPinPrompt(overrideProfile || profile);
        setStatus("ready");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalendarTasks(data.tasks || []);
      setBirthdays(data.birthdays || []);
      setLocalTasks(data.localTasks || []);
      setTodos(data.todos || []);
      setDoneIds(data.doneIds || []);
      setWeather(data.weather || null);
      setStatus("ready");
      setError("");
    } catch (e) {
      setStatus((s) => s === "ready" ? "ready" : "error");
      setError(String(e.message || e));
    }
  }, [today, profile]);

  // Trusted-device login: enter the shared passcode once + pick who this device
  // belongs to (its PIN too, if it has one). On success the server sets a
  // long-lived cookie and the chosen profile becomes this device's owner and
  // default. Returns an error message, or null on success.
  const login = useCallback(async (passcode, chosenProfile, pin) => {
    const res = await apiFetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ passcode, profile: chosenProfile, pin }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return body.pin ? body.error : "Wrong passcode — try again.";
    }
    setOwner(chosenProfile);
    localStorage.setItem("cd.profile", chosenProfile); setProfile(chosenProfile);
    setStatus("loading");
    fetchData(chosenProfile);
    return null;
  }, [fetchData]);

  // Which profile this device belongs to (opens without a PIN here).
  useEffect(() => {
    if (status !== "ready") return;
    apiFetch("/api/session").then((r) => (r.ok ? r.json() : null)).then((s) => s && setOwner(s.owner))
      .catch((e) => console.warn("session load failed", e));
  }, [status]);

  // --- To-dos: optimistic, like the done-state toggles ---
  const addTodo = async (title) => {
    const res = await jsonPost("/api/todos", { title, profile });
    if (res.ok) { const t = await res.json(); setTodos((prev) => [...prev, t]); }
  };
  const toggleTodo = (t) => {
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: t.done ? 0 : 1 } : x)));
    jsonSend("PATCH", `/api/todos/${encodeURIComponent(t.id)}`, { done: !t.done }).catch((e) => console.warn("todo toggle failed", e));
  };
  const removeTodo = (t) => {
    setTodos((prev) => prev.filter((x) => x.id !== t.id));
    apiFetch(`/api/todos/${encodeURIComponent(t.id)}`, { method: "DELETE" }).catch((e) => console.warn("todo delete failed", e));
    showToast(`Removed “${t.title}”`, () => addTodo(t.title));
  };
  const clearDoneTodos = () => {
    setTodos((prev) => prev.filter((x) => !x.done));
    jsonPost("/api/todos/clear", { profile }).catch((e) => console.warn("todo clear failed", e));
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // After a deploy, an app left open (especially from the home screen, which
  // has no reload button) keeps running the old code. The server reports its
  // build in /api/health. Coming back to the app with a new build waiting →
  // reload quietly, unless a sheet/form is open (don't lose typing); otherwise
  // offer an "update" bar. Coming back also refetches the day's data.
  const [updateReady, setUpdateReady] = useState(false);
  const loadedVersion = useRef(null);
  useEffect(() => {
    const check = async (foreground) => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const { version } = await res.json();
        if (!version) return;
        if (loadedVersion.current === null) { loadedVersion.current = version; return; }
        if (version === loadedVersion.current) return;
        const busy = document.querySelector(".cd-ov-backdrop") || document.activeElement?.matches?.("input, textarea, select");
        if (foreground && !busy) window.location.reload();
        else setUpdateReady(true);
      } catch { /* offline: try again next time */ }
    };
    check(false);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      check(true);
      fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => check(false), REFRESH_MS);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(id); };
  }, [fetchData]);

  // Saved locations + the home anchor back the commute travel blocks. Load once
  // we're past the auth gate; both geocode server-side and update state live.
  const loadPlaces = useCallback(async () => {
    try { const res = await apiFetch("/api/places"); if (res.ok) setPlaces(await res.json()); }
    catch (e) { console.warn("places load failed", e); }
  }, []);
  const loadHome = useCallback(async () => {
    try { const res = await apiFetch("/api/home"); if (res.ok) setHome(await res.json()); }
    catch (e) { console.warn("home load failed", e); }
  }, []);
  useEffect(() => { if (status === "ready") { loadPlaces(); loadHome(); } }, [status, loadPlaces, loadHome]);

  const addPlace = useCallback(async (label, address) => {
    const res = await jsonPost("/api/places", { label, address });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const created = await res.json();
    setPlaces((prev) => [...prev, created]);
    return created;
  }, []);
  const saveHome = useCallback(async (address) => {
    const res = await apiFetch("/api/home", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const h = await res.json();
    setHome(h);
    return h;
  }, []);

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
        for (const id of di) await apiFetch(`/api/done/${encodeURIComponent(id)}`, { method: "POST" });
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
    apiFetch(url, { method: wasDone ? "DELETE" : "POST" }).catch((e) => console.warn("toggle failed", e));
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

  // Import a Claude-generated plan (Stage-2 of the prompt flow). Blocks land as
  // source:"claude" training tasks; replaceRange (the plan's own date span) wipes
  // prior generated training there first so re-imports swap rather than stack.
  const importTasks = useCallback(async (blocks, replaceRange) => {
    const res = await jsonPost("/api/tasks/import", { blocks, profile, replaceRange });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const out = await res.json();
    await fetchData();
    return out; // { created, replaced }
  }, [profile, fetchData]);

  const removeTask = (id) => {
    if (!isStored(id)) return;
    const t = localTasks.find((x) => x.id === id);
    setLocalTasks((prev) => prev.filter(t => t.id !== id));
    apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => console.warn("delete failed", e));
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
    apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
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
    apiFetch(`/api/recurrences/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
      .then((r) => { if (r.ok) fetchData(); else console.warn("recurrence op failed", r.status); })
      .catch((e) => console.warn("recurrence op failed", e));

  const editLocalTask = async (id, fields) => {
    setLocalTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...fields } : t));
    const res = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
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
        apiFetch(`/api/recurrences/${sid}/skip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: task.date }) })
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
  const patchTask = (id, body, warn) => {
    setLocalTasks((prev) => prev.map(t => t.id === id ? { ...t, ...body } : t));
    apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch((e) => console.warn(warn, e));
  };

  const toggleImportant = (id, important) => {
    if (!isStored(id)) return;
    patchTask(id, { important: important ? 1 : 0 }, "star failed");
    // Unstarring removes it from Month ahead — offer a one-tap regret.
    if (!important) {
      const t = localTasks.find((x) => x.id === id);
      showToast(`Removed “${t?.title ?? "event"}” from Month ahead`, () => { dismissToast(); patchTask(id, { important: 1 }, "restar failed"); });
    }
  };

  const toggleShared = (id, shared) => {
    if (!isStored(id)) return;
    patchTask(id, { shared: shared ? 1 : 0 }, "share toggle failed");
    if (!shared) {
      const t = localTasks.find((x) => x.id === id);
      showToast(`Unshared “${t?.title ?? "event"}” from both decks`, () => { dismissToast(); patchTask(id, { shared: 1 }, "reshare failed"); });
    }
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
    // Timed calendar events already sit in the Today timeline, so only untimed
    // ones join the imminent box. Starred blocks always show: starring is an
    // explicit "put this in Month ahead", timed or not.
    return {
      imminent: all.filter(e => (e.date === todayStr || e.date === tomorrowStr) && (!e.start || isStored(e.id))),
      later: all.filter(e => e.date > tomorrowStr),
    };
  }, [localTasks, birthdays, calendarTasks, today]);

  if (status === "loading") {
    return <div className="cd-shell" style={{ ...S.shell, ...themeVars(theme) }}><style>{globalCss}</style><div style={S.loading}>Connecting to Command Deck…</div></div>;
  }

  if (status === "auth") {
    return <LoginScreen profiles={profiles} onLogin={login} />;
  }

  const dayProgress = (dateStr) => {
    const ts = dayTasks(dateStr);
    if (!ts.length) return 0;
    return Math.round((ts.filter((t) => t.done).length / ts.length) * 100);
  };

  return (
    <div className="cd-shell" style={{ ...S.shell, ...themeVars(theme) }}>
      <style>{globalCss}</style>
      <PullToRefresh color={paletteOf(theme).color} />

      <header style={S.header} className="cd-header">
        <div className="cd-header-main">
          <div style={S.profileBar} className="cd-profile-bar">
            {profiles.map((p) => (
              <ProfilePill key={p.id} p={p} on={p.id === activeProfile.id}
                locked={p.hasPin && p.id !== owner && p.id !== unlocked}
                onTap={() => switchProfile(p.id)} onLong={() => openSettings(p.id)} />
            ))}
            <button onClick={() => setProfilesOpen(true)} style={S.profileManage} className="cd-push"
              aria-label="Manage profiles" title="Add or edit profiles">+</button>
          </div>
          <h1 key={activeProfile.id} style={S.h1} className="cd-swap">Hei, {activeProfile.name} 👋</h1>
        </div>
        <div style={S.headerDate}>
          <div style={S.bigDay} className="cd-big-day">{today.getDate()}</div>
          <div style={S.bigMonth}>{MONTHS[today.getMonth()].slice(0,3)} {today.getFullYear()}</div>
        </div>
      </header>

      {updateReady && (
        <button style={S.updateBar} className="cd-push" onClick={() => window.location.reload()}>
          ✨ A new version is ready — tap to update
        </button>
      )}
      {error && status !== "loading" && (
        <div style={S.errorBanner}>Couldn't reach server — showing last fetch. ({error})</div>
      )}

      <section style={{ ...S.card, ...S.weekCard }} className="cd-card cd-week-card">
        <div style={S.cardHead}>
          <h2 style={S.h2}>Next 7 days</h2>
          <button style={S.calOpenBtn} className="cd-push" onClick={() => setCalendarOpen(true)}>📅 Calendar</button>
        </div>
        <div style={S.weekRow} className="cd-week-row">
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
                <div style={S.weekName} className="cd-week-name">{dname}</div>
                <div style={{ ...S.weekNum, ...(isTod ? S.weekNumToday : {}) }} className="cd-week-num">{d.getDate()}</div>
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

      <div style={S.grid} className="cd-grid">
        <section style={{ ...S.card, gridColumn: "1 / 2" }} className="cd-card">
          <div style={S.cardHead}>
            <h2 style={S.h2}>{isToday ? "Today" : DAYS[(selDate.getDay()+6)%7]}</h2>
            <span style={S.cardSub}>{selDate.getDate()} {MONTHS[selDate.getMonth()].slice(0,3)} · {dayProgress(selectedDate)}% done</span>
          </div>

          <AutoHeight>
            <Timeline tasks={selectedTasks} isToday={isToday} now={now} hasHome={!!home} onToggle={toggle} onEdit={handleEdit} onMove={moveTask} />

            <AddRow
              adding={adding} setAdding={setAdding}
              onAdd={addTask} onAddRecurring={createRecurrence}
              selectedDate={selectedDate}
              places={places} onAddPlace={addPlace} home={home} onSaveHome={saveHome}
            />
          </AutoHeight>
        </section>

        <div style={S.sideCol}>
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
          <AutoHeight>
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
          </AutoHeight>
        </section>

        <TodoCard todos={todos} onAdd={addTodo} onToggle={toggleTodo} onRemove={removeTodo} onClear={clearDoneTodos} />
        </div>
      </div>

      <div style={S.grid} className="cd-grid">
        <section style={S.card} className="cd-card">
          <div style={S.cardHead}><h2 style={S.h2}>Month ahead</h2><span style={S.cardSub}>next 30 days</span></div>
          <AutoHeight>
            <MonthList imminent={imminent} later={later} today={today} onAdd={addTask} onRemove={removeTask} onStar={toggleImportant} onShare={toggleShared} />
          </AutoHeight>
        </section>

        <section style={S.card} className="cd-card">
          <div style={S.cardHead}>
            <h2 style={S.h2}>{weather?.place || "Bergen"}</h2>
            <span style={S.cardSub}>{weather ? "Live from YR.no" : "Loading…"}</span>
          </div>
          {weather?.days?.length ? (
            <>
              <div style={S.wxRow} className="cd-wx-row">
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
              <AutoHeight>
                <WeatherDetail day={weather.days.find(d => d.date === openWeatherDate)} />
              </AutoHeight>
            </>
          ) : <div style={S.empty}>Weather unavailable.</div>}
        </section>
      </div>

      <footer style={S.footer}>
        v2 · everything synced via your home server · refreshes every 5 min
      </footer>

      {fitnessOpen && <FitnessOverlay nextWorkout={nextWorkout} upcoming={upcomingTraining} today={today} profile={profile} allTasks={allTasks} weather={weather} onImport={importTasks} onClose={() => setFitnessOpen(false)} />}
      {profilesOpen && (
        <ProfilesOverlay profiles={profiles} active={activeProfile.id} owner={owner}
          onAdd={async (draft) => { const p = await addProfile(draft); switchProfile(p.id); }}
          onEdit={openSettings} onClose={() => setProfilesOpen(false)} />
      )}
      {settingsFor && profiles.some((p) => p.id === settingsFor) && (
        <ProfileSettings key={settingsFor} profile={profileIn(profiles, settingsFor)} isOwnDevice={settingsFor === owner}
          canRemove={profiles.length > 1}
          onSave={(patch) => updateProfile(settingsFor, patch)}
          onSetPin={(pin) => setPin(settingsFor, pin)}
          onSignOutOthers={() => signOutOthers(settingsFor)}
          onRemove={async () => { await removeProfile(settingsFor); setSettingsFor(null); }}
          onClose={() => setSettingsFor(null)} />
      )}
      {pinPrompt && (
        <PinPrompt profile={profileIn(profiles, pinPrompt)}
          onUnlock={(pin, claim) => unlockProfile(pinPrompt, pin, claim)}
          onCancel={
            // Tapped a locked pill: cancelling just stays put. The open deck
            // itself is locked: cancelling moves to a deck that opens freely.
            pinPrompt !== profile ? () => { pendingSettings.current = null; setPinPrompt(null); }
              : pinFallback(pinPrompt) && (() => { setPinPrompt(null); switchProfile(pinFallback(pinPrompt)); })
          } />
      )}
      {calendarOpen && (
        <CalendarOverlay
          selectedDate={selectedDate} today={today} profile={profile}
          onPick={(ds) => { setSelectedDate(ds); setCalendarOpen(false); }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {editTask && (
        <EditModal task={editTask} onSave={saveEdit} onDelete={() => { const t = editTask; setEditTask(null); handleDelete(t); }} onClose={() => setEditTask(null)} places={places} onAddPlace={addPlace} home={home} onSaveHome={saveHome} />
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

function FitnessOverlay({ nextWorkout, upcoming, today, profile, allTasks, weather, onImport, onClose }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState(null); // null | "power" | "hr" | "coach"

  // Coach prompt panel state. Default to the next two weeks.
  const [coachStart, setCoachStart] = useState(() => iso(today));
  const [coachEnd, setCoachEnd] = useState(() => iso(addDays(today, 13)));
  const [coachNotes, setCoachNotes] = useState("");
  const [copied, setCopied] = useState(false);
  const coachPrompt = useMemo(
    () => (detail === "coach" && data
      ? buildCoachPrompt({ data, tasks: allTasks, weather, start: coachStart, end: coachEnd, notes: coachNotes })
      : ""),
    [detail, data, allTasks, coachStart, coachEnd, coachNotes],
  );
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(coachPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the textarea below is selectable as a fallback */ }
  };

  // Import sub-panel: paste or load Claude's JSON, preview, then confirm.
  const [coachTab, setCoachTab] = useState("generate"); // generate | import
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState("");
  const [importDone, setImportDone] = useState("");
  const [parsed, setParsed] = useState(null); // { blocks, skipped } | null
  const [replace, setReplace] = useState(true);
  const [importing, setImporting] = useState(false);

  const resetImport = (text) => { setImportText(text); setParsed(null); setImportErr(""); setImportDone(""); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try { resetImport(await file.text()); } catch { setImportErr("Couldn't read that file."); }
  };
  const doParse = () => {
    const r = parsePlan(importText);
    if (r.error) { setImportErr(r.error); setParsed(null); return; }
    setImportErr(""); setParsed(r);
  };
  const doImport = async () => {
    if (!parsed?.blocks?.length || importing) return;
    setImporting(true); setImportErr("");
    try {
      let replaceRange = null;
      if (replace) {
        const ds = parsed.blocks.map((b) => b.date).sort();
        replaceRange = { start: ds[0], end: ds[ds.length - 1] };
      }
      const out = await onImport(parsed.blocks, replaceRange);
      const n = out?.created?.length ?? parsed.blocks.length;
      setImportDone(`Added ${n} session${n === 1 ? "" : "s"}${out?.replaced ? ` · replaced ${out.replaced}` : ""}`);
      setParsed(null); setImportText("");
    } catch (e) {
      setImportErr(String(e.message || e));
    } finally { setImporting(false); }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/fitness?profile=${profile}`);
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

            <button style={S.coachBtn} className="cd-ov-box" onClick={() => setDetail("coach")}>
              <span>✨ Generate training prompt</span>
              <span style={S.coachBtnSub}>Build a copy-paste plan request from this data — paste into a Claude chat, no API cost</span>
            </button>
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

        {detail === "coach" && (
          <div style={S.ovDetail} className="cd-ov-panel">
            <div style={S.ovDetailHead}>
              <button style={S.ovBack} onClick={() => setDetail(null)} className="cd-ov-close" aria-label="Back">‹</button>
              <div>
                <h3 style={S.ovDetailTitle}>Training planner</h3>
                <div style={S.ovDetailSub}>Generate a prompt, then import Claude's plan — no API cost</div>
              </div>
            </div>
            <div style={S.coachTabs}>
              <button style={{ ...S.coachTab, ...(coachTab === "generate" ? S.coachTabOn : {}) }} onClick={() => setCoachTab("generate")}>1 · Generate prompt</button>
              <button style={{ ...S.coachTab, ...(coachTab === "import" ? S.coachTabOn : {}) }} onClick={() => setCoachTab("import")}>2 · Import plan</button>
            </div>

            {coachTab === "generate" && (
            <div style={S.coachForm}>
              <div style={S.coachDates}>
                <label style={S.coachField}>
                  <span style={S.coachLabel}>Start</span>
                  <input type="date" value={coachStart} max={coachEnd}
                    onChange={(e) => setCoachStart(e.target.value)} style={{ ...S.input, boxSizing: "border-box" }} />
                </label>
                <label style={S.coachField}>
                  <span style={S.coachLabel}>End</span>
                  <input type="date" value={coachEnd} min={coachStart}
                    onChange={(e) => setCoachEnd(e.target.value)} style={{ ...S.input, boxSizing: "border-box" }} />
                </label>
              </div>
              <label style={S.coachField}>
                <span style={S.coachLabel}>Notes (optional)</span>
                <textarea value={coachNotes} onChange={(e) => setCoachNotes(e.target.value)} rows={3}
                  placeholder="e.g. travelling Fri–Sun · legs feel cooked · easy week · race in 3 weeks…"
                  style={S.coachNotes} />
              </label>
              <div style={S.coachActions}>
                <button style={S.coachCopy} className="cd-ov-box" onClick={copyPrompt}>{copied ? "Copied ✓" : "Copy prompt"}</button>
                <span style={S.coachHint}>Review the prompt below before copying</span>
              </div>
              <textarea readOnly value={coachPrompt} onFocus={(e) => e.target.select()} style={S.coachOut} />
            </div>
            )}

            {coachTab === "import" && (
            <div style={S.coachForm}>
              <p style={S.importIntro}>Paste the JSON Claude replied with (the whole message is fine), or load a .json file.</p>
              <div style={S.coachActions}>
                <label style={S.fileBtn} className="cd-ov-box">
                  Choose .json file
                  <input type="file" accept=".json,application/json,text/plain" onChange={onFile} style={{ display: "none" }} />
                </label>
                <span style={S.coachHint}>or paste below</span>
              </div>
              <textarea value={importText} onChange={(e) => resetImport(e.target.value)}
                placeholder={'[{"date":"2026-06-05","start":"06:30","title":"Z2 endurance","sport":"Ride","tss":75,"note":"…"}]'}
                style={S.coachOut} />
              {importErr && <div style={S.importErr}>{importErr}</div>}
              {importDone && <div style={S.importDone}>{importDone} ✓</div>}
              {!parsed ? (
                <button style={{ ...S.coachCopy, opacity: importText.trim() ? 1 : 0.5 }} className="cd-ov-box"
                  onClick={doParse} disabled={!importText.trim()}>Preview plan</button>
              ) : (
                <>
                  <ImportPreview blocks={parsed.blocks} skipped={parsed.skipped} />
                  <label style={S.replaceRow}>
                    <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                    <span>Replace AI-generated training already in this range</span>
                  </label>
                  <div style={S.coachActions}>
                    <button style={{ ...S.coachCopy, opacity: importing ? 0.6 : 1 }} className="cd-ov-box" onClick={doImport} disabled={importing}>
                      {importing ? "Adding…" : `Add ${parsed.blocks.length} session${parsed.blocks.length === 1 ? "" : "s"}`}
                    </button>
                    <button style={S.fileBtn} className="cd-ov-box" onClick={() => setParsed(null)}>Back to edit</button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>
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

// Nobody is pre-selected: whoever signs in must tap their own name, so a
// shared/borrowed device can't slide into someone else's deck by default.
function LoginScreen({ profiles, onLogin }) {
  const [pick, setWho] = useState(null);
  const chosen = profiles.find((p) => p.id === pick);
  const who = chosen?.id ?? null;
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hasPin = !!chosen?.hasPin;
  const ready = who && code && (!hasPin || pin.length >= 4);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr("");
    const msg = await onLogin(code, who, hasPin ? pin : undefined);
    if (msg) { setErr(msg); setBusy(false); setPin(""); }
  };

  return (
    <div className="cd-shell" style={{ ...S.shell, ...themeVars(chosen?.theme), display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{globalCss}</style>
      <form onSubmit={submit} style={S.loginCard}>
        <div style={S.loginKicker}>Command Deck</div>
        <h1 style={S.loginTitle}>Trust this device</h1>
        <p style={S.loginSub}>Pick who’s using it, then enter the passcode once. This device stays signed in.</p>
        <div style={S.loginPills}>
          {profiles.map((p) => {
            const on = who === p.id;
            const c = paletteOf(p.theme).color;
            return (
              <button type="button" key={p.id} onClick={() => { setWho(p.id); setPin(""); setErr(""); }} aria-pressed={on}
                style={{ ...S.loginPill, ...(on ? { background: c, color: "#fff", borderColor: c } : {}) }}>
                {p.name}
              </button>
            );
          })}
        </div>
        <input type="password" autoFocus value={code} aria-label="Passcode"
          onChange={(e) => { setCode(e.target.value); setErr(""); }}
          placeholder="Passcode" style={{ ...S.input, ...(err ? S.loginInputErr : {}) }} />
        {hasPin && (
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin}
            aria-label={`${chosen.name}'s PIN`}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(""); }}
            placeholder={`${chosen.name}'s PIN`} style={S.input} />
        )}
        {err && <div style={S.loginErr}>{err}</div>}
        <button type="submit" disabled={!ready || busy} style={{ ...S.loginBtn, opacity: !ready || busy ? 0.6 : 1 }}>
          {busy ? "Checking…" : (chosen ? `Enter as ${chosen.name}` : "Tap your name above")}
        </button>
      </form>
    </div>
  );
}

function CalendarOverlay({ selectedDate, today, profile, onPick, onClose }) {
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
    apiFetch(`/api/data?start=${iso(gridStart)}&days=42&profile=${profile}`)
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
  }, [gridStart, profile]);

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

// --- Commute chaining ------------------------------------------------------
// One Location per event. locOf: "" = home (default), a place id = away,
// null/undefined (calendar/birthday rows) = transparent (doesn't move you).
// Travel legs are derived from location *changes*: an arrive-by leg before a
// committed away event, a depart-based leg on the way home. Same place twice in
// a row → no travel (you stay put).
const locOf = (t) => (t.location == null ? null : (t.location === "" ? "home" : t.location));
const isoLocal = (date, hhmm) => { const d = new Date(`${date}T${hhmm}`); return isNaN(+d) ? null : d.toISOString(); };

function planDay(tasks, hasHome) {
  const legs = [];
  const seq = [];
  let cur = "home";
  let awayEnd = null;   // ISO end-time of the away event we're currently at
  let lastAwayIdx = -1; // index in seq of the last away task

  tasks.forEach((t) => {
    const loc = locOf(t);
    if (loc === null) { seq.push({ kind: "task", t }); return; }

    if (loc !== cur && hasHome) {
      if (loc === "home") {
        if (awayEnd) {
          const key = `${cur}>home@d:${awayEnd}`;
          const leg = { kind: "travel", dir: "out", key, from: cur, to: "home", departAt: awayEnd };
          seq.push(leg); legs.push(leg);
        }
      } else {
        const arr = t.start ? isoLocal(t.date, t.start) : null;
        if (arr) {
          const key = `${cur}>${loc}@a:${arr}`;
          const leg = { kind: "travel", dir: "in", key, from: cur, to: loc, arriveBy: arr };
          seq.push(leg); legs.push(leg);
        }
      }
    }
    cur = loc;
    seq.push({ kind: "task", t });
    if (loc !== "home") { awayEnd = t.end ? isoLocal(t.date, t.end) : awayEnd; lastAwayIdx = seq.length - 1; }
  });

  // End of day: still away after the last located event → head home.
  if (cur !== "home" && hasHome && awayEnd && lastAwayIdx >= 0) {
    const key = `${cur}>home@d:${awayEnd}`;
    const leg = { kind: "travel", dir: "out", key, from: cur, to: "home", departAt: awayEnd };
    seq.splice(lastAwayIdx + 1, 0, leg); legs.push(leg);
  }
  return { legs, seq };
}

// Insert free-time breathers between consecutive task rows, subtracting travel
// time so the figure is honest. Arrive-by legs put the breather before the trip
// (free at the origin); homeward legs put it after (free once you're home).
function buildRows(seq, tripOf) {
  const rows = [];
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i];
    if (it.kind !== "task") { rows.push(it); continue; }
    rows.push(it);
    let j = i + 1; const between = [];
    while (j < seq.length && seq[j].kind !== "task") { between.push(seq[j]); j++; }
    if (j >= seq.length) continue;
    const eA = hm(it.t.end), sB = hm(seq[j].t.start);
    if (eA == null || sB == null) continue;
    let tMin = 0, dir = null;
    for (const leg of between) { dir = leg.dir; const tr = tripOf(leg.key); if (tr) tMin += tr.durationMin; }
    const free = sB - eA - tMin;
    if (free < 15) continue;
    if (dir === "out") {
      for (const leg of between) rows.push(leg);
      rows.push({ kind: "gap", from: eA + tMin, to: sB, mins: free });
      i = j - 1; // between rows already emitted
    } else {
      rows.push({ kind: "gap", from: eA, to: eA + free, mins: free });
    }
  }
  return rows;
}

// Smoothly animates a section's height when its content changes size — on
// add/remove of items and on profile switch. Observes the inner (natural)
// content height and tweens the outer box via the Web Animations API, which
// works on every modern browser incl. iPad Safari (CSS can't transition
// height:auto without Chrome-only interpolate-size). Overflow is clipped only
// mid-animation, so resting hover-lifts aren't cut. Width-driven (responsive)
// reflow snaps without a tween. Honors prefers-reduced-motion.
function AutoHeight({ children, style, duration = 320 }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const last = useRef(null);   // { h, w } of the last settled content size
  const anim = useRef(null);

  useLayoutEffect(() => {
    const innerEl = inner.current, outerEl = outer.current;
    if (!innerEl || !outerEl || typeof ResizeObserver === "undefined") return;
    const reduce = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ro = new ResizeObserver(() => {
      const h = innerEl.offsetHeight, w = innerEl.offsetWidth;
      if (last.current === null) { last.current = { h, w }; return; }
      if (h === last.current.h) { last.current.w = w; return; }
      const from = last.current.h, widthChanged = w !== last.current.w;
      last.current = { h, w };
      if (reduce || widthChanged) return; // don't tween a responsive reflow
      if (anim.current) anim.current.cancel();
      outerEl.style.overflow = "hidden";
      const a = outerEl.animate(
        [{ height: from + "px" }, { height: h + "px" }],
        { duration, easing: "cubic-bezier(.2,.8,.25,1)" }
      );
      anim.current = a;
      const settle = () => { if (anim.current === a) { outerEl.style.overflow = ""; anim.current = null; } };
      a.onfinish = settle; a.oncancel = settle;
    });
    ro.observe(innerEl);
    return () => { ro.disconnect(); if (anim.current) anim.current.cancel(); };
  }, [duration]);

  return (
    <div ref={outer} style={style}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

function Timeline({ tasks, isToday, now, hasHome, onToggle, onEdit, onMove }) {
  const plan = useMemo(() => planDay(tasks, hasHome), [tasks, hasHome]);
  const [trips, setTrips] = useState({}); // leg key -> trip | null (no route) | undefined (loading)
  const requested = useRef(new Set());

  // Hoisted travel fetch: one request per leg (deduped), so breathers can
  // subtract travel time and the whole timeline shares one source of truth.
  useEffect(() => {
    let alive = true;
    for (const leg of plan.legs) {
      if (requested.current.has(leg.key)) continue;
      requested.current.add(leg.key);
      const qs = new URLSearchParams({ from: leg.from, to: leg.to });
      if (leg.arriveBy) qs.set("arriveBy", leg.arriveBy);
      if (leg.departAt) qs.set("departAt", leg.departAt);
      apiFetch(`/api/travel?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setTrips((prev) => ({ ...prev, [leg.key]: d?.trip ?? null })); })
        .catch(() => { if (alive) setTrips((prev) => ({ ...prev, [leg.key]: null })); });
    }
    return () => { alive = false; };
  }, [plan]);

  if (!tasks.length) {
    return <div style={S.tlEmpty}>Nothing scheduled. Tap <b>+ Add block</b> to shape your day.</div>;
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rows = buildRows(plan.seq, (key) => trips[key]);

  return (
    <div style={S.timeline}>
      {rows.map((r, idx) => {
        if (r.kind === "travel") {
          return <TravelRow key={r.key} trip={trips[r.key]} dir={r.dir} isToday={isToday} now={now} />;
        }
        if (r.kind === "gap") {
          const nowHere = isToday && nowMin >= r.from && nowMin < r.to;
          return (
            <div key={`gap-${idx}`} style={S.tlGapRow} className="cd-tl-row">
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
        const editable = stored || t.recurring;

        return (
          <div key={t.id} style={S.tlRow} className="cd-row cd-tl-row">
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
                onClick={() => editable ? onEdit(t) : onToggle(t.id)}
                style={{ ...S.tlBlock, ...(inProgress ? S.tlBlockActive : {}), ...(overdue ? S.tlBlockOverdue : {}), opacity: t.done ? 0.62 : 1 }}
                className="cd-block"
                title={editable ? "Tap to edit" : "Tap to mark done"}
              >
                {inProgress && <div style={{ ...S.tlFill, width: `${Math.round(progress * 100)}%`, background: c.soft }} />}
                <div style={S.tlBlockInner}>
                  <div style={S.tlBlockTop}>
                    <span style={{ ...S.tlTitle, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                  </div>
                  {inProgress
                    ? <div style={S.tlRemaining}>{fmtRange(end - nowMin)} remaining</div>
                    : (t.note ? <div style={S.tlNote}>{t.note}</div> : null)}
                  {!inProgress && (
                    <span style={{ ...S.tag, color: c.dot }}>{c.label}{t.important ? " · ★" : ""}{t.recurring ? " · ↻" : ""}{t.shared ? " · 🔗" : ""}</span>
                  )}
                </div>
              </button>
              {canPush && <PushBar taskDate={t.date} onMove={(d) => onMove(t.id, d)} />}
            </div>

            <button
              onClick={() => onToggle(t.id)}
              style={S.checkBtn}
              title={t.done ? "Mark not done" : "Mark complete"}
              aria-pressed={t.done}
            >
              <span style={{ ...S.check, borderColor: c.dot, background: t.done ? c.dot : "transparent" }}>
                {t.done ? "✓" : ""}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Non-completable timeline row: a conservative public-transport estimate, prose
// only (no route, by design). `trip` is supplied by the Timeline (undefined =
// loading, null = no route). Inbound legs (arrive-by) lead with a live "leave in
// N min" countdown; homeward legs lead with the arrival ("🏠 Home by ~X"), since
// the realistic question on the way home is when you'll get there, not the minute
// you leave.
function TravelRow({ trip, dir, isToday, now }) {
  if (trip === null) return null;
  const inbound = dir === "in";
  const leaving = trip?.start ? trip.start.slice(11, 16) : "";   // ISO carries local offset
  const arriving = trip?.end ? trip.end.slice(11, 16) : "";

  let countdown = null;
  if (trip && isToday && inbound) {
    const mins = Math.round((Date.parse(trip.start) - now.getTime()) / 60000);
    if (mins >= 0 && mins <= 180) countdown = mins;
  }

  return (
    <div style={S.tlTravelRow} className="cd-tl-row">
      <div style={S.tlTime}>{leaving || "—"}</div>
      <div style={S.tlSpine}>
        <div style={S.tlLineDash} />
        <div style={S.tlTravelBadge}>🚆</div>
      </div>
      <div style={S.tlTravelBlock}>
        {trip === undefined ? (
          <span style={S.tlTravelMuted}>Estimating travel…</span>
        ) : inbound ? (
          <>
            <span style={S.tlTravelMain}>
              {countdown != null
                ? (countdown === 0 ? "Leave now" : `Leave in ${countdown} min`)
                : `Leave by ${leaving}`}
            </span>
            <span style={S.tlTravelSub}>~{trip.durationMin} min · arrive {arriving}</span>
          </>
        ) : (
          <>
            <span style={S.tlTravelMain}>🏠 Home by ~{arriving}</span>
            <span style={S.tlTravelSub}>~{trip.durationMin} min · leave ~{leaving}</span>
          </>
        )}
      </div>
      <div />
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

// Single "where does this happen" picker. Default 🏠 Home (value ""); other
// options are saved places. "+ Add place…" swaps to a label+address mini-form
// that geocodes + saves via onAddPlace, then selects it — so places are managed
// right where they're used, no settings screen. The timeline derives all travel
// by chaining these locations (stay if unchanged, return home at the end).
function LocationSelect({ value, places, onChange, onAddPlace }) {
  const [adding, setAdding] = useState(false);
  const [lab, setLab] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onSelect = (e) => {
    if (e.target.value === "__add__") { setAdding(true); return; }
    onChange(e.target.value);
  };
  const saveNew = async () => {
    if (!lab.trim() || !addr.trim()) return;
    setBusy(true); setErr("");
    try {
      const created = await onAddPlace(lab.trim(), addr.trim());
      onChange(created.id);
      setAdding(false); setLab(""); setAddr("");
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (adding) {
    return (
      <div style={S.placeAdd}>
        <input autoFocus placeholder="Label (e.g. Work)" value={lab} onChange={(e)=>setLab(e.target.value)} style={S.input} />
        <input placeholder="Address (e.g. Sandslikroken 140, Bergen)" value={addr} onChange={(e)=>setAddr(e.target.value)} style={S.input} />
        {err && <div style={S.placeErr}>{err}</div>}
        <div style={S.addActions}>
          <button style={S.cancelBtn} onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
          <button style={S.saveBtn} disabled={busy || !lab.trim() || !addr.trim()} onClick={saveNew}>{busy ? "Saving…" : "Save place"}</button>
        </div>
      </div>
    );
  }
  return (
    <div style={S.travelField}>
      <span style={S.travelLabel}>At</span>
      <select value={value || ""} onChange={onSelect} style={{ ...S.input, flex: 1 }}>
        <option value="">🏠 Home</option>
        {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="__add__">+ Add place…</option>
      </select>
    </div>
  );
}

// The dedicated Home anchor. Set once; shows as a small editable line afterwards.
// When unset it prompts inline (travel can't route home until it's set).
function HomeField({ home, onSaveHome }) {
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState(home?.address || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!addr.trim()) return;
    setBusy(true); setErr("");
    try { await onSaveHome(addr.trim()); setEditing(false); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (editing || !home) {
    return (
      <div style={S.placeAdd}>
        {!home && <div style={S.travelHint}>Set your home address so commutes can route home.</div>}
        <input autoFocus={!!editing} placeholder="Home address (e.g. Nattlandsveien 64, Bergen)"
          value={addr} onChange={(e)=>setAddr(e.target.value)} style={S.input} />
        {err && <div style={S.placeErr}>{err}</div>}
        <div style={S.addActions}>
          {home && <button style={S.cancelBtn} onClick={() => { setEditing(false); setErr(""); setAddr(home.address); }}>Cancel</button>}
          <button style={S.saveBtn} disabled={busy || !addr.trim()} onClick={save}>{busy ? "Saving…" : "Save home"}</button>
        </div>
      </div>
    );
  }
  return (
    <div style={S.homeLine}>
      <span>🏠 Home · {home.address}</span>
      <button style={S.homeEdit} onClick={() => { setAddr(home.address); setEditing(true); }}>edit</button>
    </div>
  );
}

// Location + home, shared by the add + edit forms. Pick a non-home location and
// a public-transport estimate appears in the daily timeline.
function TravelFields({ location, setLocation, places, onAddPlace, home, onSaveHome }) {
  return (
    <div style={S.travelBox}>
      <div style={S.travelHead}>📍 Location <span style={S.travelHint}>(for travel estimates)</span></div>
      <LocationSelect value={location} places={places} onChange={setLocation} onAddPlace={onAddPlace} />
      <HomeField home={home} onSaveHome={onSaveHome} />
    </div>
  );
}

function AddRow({ adding, setAdding, onAdd, onAddRecurring, selectedDate, places, onAddPlace, home, onSaveHome }) {
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
  const [location, setLocation] = useState("");

  if (!adding) {
    return <button style={S.addBtn} onClick={() => setAdding(true)} className="cd-add">+ Add block</button>;
  }

  const toggleWd = (i) => setWeekdays((w) => w.includes(i) ? w.filter((x) => x !== i) : [...w, i]);
  const unit = freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : "month(s)";
  const invalidEnd = freq !== "none" && ((endMode === "until" && !until) || (endMode === "count" && !count));

  const reset = () => { setTitle(""); setEnd(""); setNote(""); setTss(""); setFreq("none"); setIntervalN(1); setEndMode("never"); setUntil(""); setCount(""); setShared(false); setImportant(false); setLocation(""); setAdding(false); };

  const submit = () => {
    if (!title.trim()) return;
    const base = { title: title.trim(), start, end, cat, note: note.trim(), shared, tss: cat === "training" && tss ? Number(tss) : null, location };
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

      <TravelFields location={location} setLocation={setLocation} places={places} onAddPlace={onAddPlace} home={home} onSaveHome={onSaveHome} />

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
      title="Shared events show on every profile's deck">
      <span>🔗</span>{shared ? "Shared with every deck" : "Make shared (every deck)"}
    </button>
  );
}

// Asks for a profile's PIN before opening its deck. "Don't ask again" makes
// this device that profile's own (it then opens freely here).
function PinPrompt({ profile, onUnlock, onCancel }) {
  const [pin, setPin] = useState("");
  const [claim, setClaim] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true); setErr("");
    try { await onUnlock(pin, claim); }
    catch (x) { setErr(String(x.message || x)); setPin(""); setBusy(false); }
  };

  const c = paletteOf(profile.theme).color;
  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onCancel || undefined}>
      <form onSubmit={submit} style={{ ...S.scopePanel, textAlign: "left" }} className="cd-ov-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 style={S.scopeTitle}>🔒 {profile.name}</h3>
        <p style={S.scopeText}>Enter {profile.name}'s PIN to open their deck.</p>
        <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(""); }}
          placeholder="PIN" aria-label="PIN" style={{ ...S.input, ...S.pinInput, ...(err ? S.loginInputErr : {}) }} />
        {err && <div style={{ ...S.loginErr, marginTop: 8 }}>{err}</div>}
        <label style={S.pinClaim}>
          <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} style={{ accentColor: c }} />
          Don't ask again on this device (make it {profile.name}'s)
        </label>
        <button type="submit" disabled={pin.length < 4 || busy}
          style={{ ...S.loginBtn, width: "100%", background: c, opacity: pin.length < 4 || busy ? 0.6 : 1 }}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        {onCancel && <button type="button" style={S.scopeCancel} onClick={onCancel}>Cancel</button>}
      </form>
    </div>
  );
}

// Everyday reminders: a plain checklist per profile. Open items first, ticked
// ones sink to the bottom (struck through) until "Clear done".
function TodoCard({ todos, onAdd, onToggle, onRemove, onClear }) {
  const [text, setText] = useState("");
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  const submit = (e) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    onAdd(title);
    setText("");
  };

  return (
    <section style={S.card} className="cd-card">
      <div style={S.cardHead}>
        <h2 style={S.h2}>To-do</h2>
        {done.length > 0
          ? <button type="button" onClick={onClear} style={S.todoClear}>Clear done ({done.length})</button>
          : <span style={S.cardSub}>{open.length ? `${open.length} left` : ""}</span>}
      </div>
      <AutoHeight>
        {todos.length === 0 && <div style={S.empty}>Nothing to remember. Add a small reminder below.</div>}
        <div style={S.todoList}>
          {[...open, ...done].map((t) => (
            <div key={t.id} style={S.todoRow} className="cd-row">
              <button type="button" onClick={() => onToggle(t)} aria-pressed={!!t.done} aria-label={t.done ? "Mark not done" : "Mark done"}
                style={{ ...S.todoBox, ...(t.done ? S.todoBoxOn : {}) }}>{t.done ? "✓" : ""}</button>
              <span onClick={() => onToggle(t)} style={{ ...S.todoTitle, ...(t.done ? S.todoTitleDone : {}) }}>{t.title}</span>
              <button type="button" onClick={() => onRemove(t)} style={S.todoDel} aria-label={`Remove ${t.title}`}>×</button>
            </div>
          ))}
        </div>
        <form onSubmit={submit} style={S.todoAdd}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do…" maxLength={200}
            style={S.input} aria-label="New to-do" />
          <button type="submit" disabled={!text.trim()} style={{ ...S.saveBtn, opacity: text.trim() ? 1 : 0.5 }}>Add</button>
        </form>
      </AutoHeight>
    </section>
  );
}

const CAL_LABELS = [["training", "Training"], ["work", "Work"], ["social", "Social"], ["home", "Home"], ["event", "Events"]];

// Pull-to-refresh for the home-screen app. Browser tabs (Safari, Chrome) have
// their own, but a standalone home-screen app has none, so draw one there only.
// Pulling down from the very top past PULL_TRIGGER reloads the page: fresh data
// and, after a deploy, fresh app code.
const PULL_TRIGGER = 70; // px of (damped) pull needed to refresh
const PULL_MAX = 110;
const PULL_SLIDE = 0.6; // the page follows the finger at this fraction of the pull
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

function PullToRefresh({ color }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isStandalone()) return;
    let startY = null, startX = 0, dist = 0;
    // Slide the page with the finger, like a native pull. Written straight to
    // the DOM (no re-render per touchmove); cleared when idle so the shell never
    // keeps a transform (that would re-anchor its position:fixed children).
    const shell = () => document.querySelector(".cd-shell");
    const slide = (px, animate) => {
      const el = shell(); if (!el) return;
      el.style.transition = animate ? "transform .25s ease" : "none";
      el.style.transform = px ? `translateY(${px}px)` : "";
      // Hand `transition` back to the stylesheet (it animates profile-colour switches).
      if (!px) setTimeout(() => { if (!el.style.transform) el.style.transition = ""; }, 300);
    };
    const reset = () => { startY = null; if (dist) { dist = 0; setPull(0); slide(0, true); } };
    const onStart = (e) => {
      // Only from the top of the page, one finger, and not inside a sheet.
      if (window.scrollY > 0 || e.touches.length !== 1 || e.target.closest?.(".cd-ov-backdrop")) { startY = null; return; }
      startY = e.touches[0].clientY; startX = e.touches[0].clientX; dist = 0;
    };
    const onMove = (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
      // Scrolling up, or a sideways swipe (e.g. the profile names): not a pull.
      if (dy < 0 || (!dist && Math.abs(dx) > 8 && Math.abs(dx) > dy)) { reset(); return; }
      if (dy < 6) return;
      e.preventDefault(); // stop the page's own rubber-band while pulling
      dist = Math.min(PULL_MAX, dy * 0.5);
      setPull(dist);
      slide(dist * PULL_SLIDE, false);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (dist >= PULL_TRIGGER) {
        setRefreshing(true);
        setPull(PULL_TRIGGER);
        navigator.vibrate?.(10);
        window.location.reload();
      } else reset();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);

  if (!pull && !refreshing) return null;
  const ready = pull >= PULL_TRIGGER;
  // Portalled to <body>: inside the sliding page it would slide along with it.
  // Centred in the gap that opens above the page.
  const gap = pull * PULL_SLIDE;
  return createPortal(
    <div style={{ ...S.ptr, transform: `translate(-50%, ${gap / 2 - 20}px)`, opacity: Math.min(1, pull / 40) }}
      role="status" aria-label={refreshing ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}>
      <span className={refreshing ? "cd-ptr-spin" : ""}
        style={{ ...S.ptrIcon, transform: refreshing ? undefined : `rotate(${ready ? 180 : (pull / PULL_TRIGGER) * 180}deg)`,
                 color: ready || refreshing ? color : faint }}>
        {refreshing ? "↻" : "↓"}
      </span>
    </div>,
    document.body,
  );
}

// Swallow the one click the browser sends when a held finger lifts. By then
// the long-press has opened a sheet, so that click would land on the sheet's
// backdrop and close it straight away.
const swallowNextClick = () => {
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 800);
};

// Press-and-hold (touch) or right-click (mouse) → onLong; a normal tap → onTap.
function useLongPress(onLong, onTap, ms = 480) {
  const timer = useRef(null);
  const fired = useRef(false);
  const origin = useRef(null);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  const fire = () => { clear(); fired.current = true; navigator.vibrate?.(10); onLong(); };
  const fireHeld = () => { swallowNextClick(); fire(); };
  return {
    onPointerDown: (e) => {
      fired.current = false;
      if (e.button !== 0) return;
      origin.current = [e.clientX, e.clientY];
      clear();
      timer.current = setTimeout(fireHeld, ms);
    },
    onPointerMove: (e) => {
      if (timer.current && Math.hypot(e.clientX - origin.current[0], e.clientY - origin.current[1]) > 10) clear();
    },
    onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    onContextMenu: (e) => { e.preventDefault(); if (!fired.current) fire(); },
    onClick: (e) => { if (fired.current) { e.preventDefault(); fired.current = false; return; } onTap(); },
  };
}

function ProfilePill({ p, on, locked, onTap, onLong }) {
  const press = useLongPress(onLong, onTap);
  const c = paletteOf(p.theme).color;
  return (
    <button {...press} style={{ ...S.profilePill, ...(on ? { background: c, color: "#fff", borderColor: c } : {}) }}
      className="cd-push cd-nosel" aria-pressed={on} title="Hold for settings">
      {p.name}{locked && <span style={S.pillLock} aria-label="PIN protected">🔒</span>}
    </button>
  );
}

const useEscape = (onClose) => useEffect(() => {
  const onKey = (e) => { if (e.key === "Escape") onClose(); };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [onClose]);

// The "+" sheet: every profile (tap one to edit it) and a form to add another.
function ProfilesOverlay({ profiles, active, owner, onAdd, onEdit, onClose }) {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState(() => Object.keys(PALETTES).find((k) => !profiles.some((p) => p.theme === k)) || "denim");
  const [showCals, setShowCals] = useState(false);
  const [cals, setCals] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr("");
    try { await onAdd({ name: name.trim(), theme, calendars: cals }); onClose(); }
    catch (x) { setErr(String(x.message || x)); setBusy(false); }
  };

  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={{ ...S.ovPanel, maxWidth: 440, textAlign: "left" }} className="cd-ov-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={S.ovHead}>
          <h2 style={S.ovTitle}>Profiles</h2>
          <button style={S.ovClose} className="cd-ov-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={S.pfList}>
          {profiles.map((p) => {
            const n = p.calendars?.length || 0;
            const tags = [
              n ? `${n} Google calendar${n > 1 ? "s" : ""}` : "No Google calendars",
              p.hasPin && "🔒 PIN",
              p.id === owner && "this device's profile",
            ].filter(Boolean).join(" · ");
            return (
              <button key={p.id} type="button" style={S.pfRowBtn} className="cd-push" onClick={() => onEdit(p.id)}>
                <span style={{ ...S.pfSwatch, background: paletteOf(p.theme).color }} />
                <span style={{ minWidth: 0 }}>
                  <span style={S.pfName}>{p.name}{p.id === active && <span style={S.pfYou}> · open now</span>}</span>
                  <span style={S.pfMeta}>{tags}</span>
                </span>
                <span style={S.pfChevron}>›</span>
              </button>
            );
          })}
        </div>
        <div style={S.pfTip}>Tip: press and hold a name at the top of the page to open its settings.</div>

        <form onSubmit={add} style={S.addPanel}>
          <div style={S.pfFormHead}>Add a profile</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={30}
            style={S.input} aria-label="Profile name" />
          <ThemePicker value={theme} onChange={setTheme} />
          <button type="button" onClick={() => setShowCals((v) => !v)} style={S.pfCalToggle}>
            {showCals ? "▾" : "▸"} Google calendars (optional)
          </button>
          {showCals && (
            <>
              <div style={S.pfHint}>Paste each calendar's “Secret address in iCal format” from Google Calendar settings.</div>
              {CAL_LABELS.map(([cat, label]) => (
                <input key={cat} value={cals[cat] || ""} onChange={(e) => setCals((c) => ({ ...c, [cat]: e.target.value }))}
                  placeholder={`${label} — https://calendar.google.com/…/basic.ics`} style={S.input} aria-label={`${label} calendar URL`} />
              ))}
            </>
          )}
          {err && <div style={S.loginErr}>{err}</div>}
          <div style={S.addActions}>
            <button type="submit" disabled={!name.trim() || busy}
              style={{ ...S.saveBtn, background: paletteOf(theme).color, opacity: !name.trim() || busy ? 0.6 : 1 }}>
              {busy ? "Saving…" : "Add profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ThemePicker({ value, onChange }) {
  return (
    <div style={S.pfThemes}>
      {Object.entries(PALETTES).map(([key, pal]) => (
        <button type="button" key={key} onClick={() => onChange(key)} aria-pressed={value === key} aria-label={key} title={key}
          style={{ ...S.pfTheme, background: pal.color, boxShadow: value === key ? `0 0 0 2px ${cardBg}, 0 0 0 4px ${pal.color}` : "none" }} />
      ))}
    </div>
  );
}

// One profile's settings: name, colour, PIN, signing other devices out, removal.
function ProfileSettings({ profile, isOwnDevice, canRemove, onSave, onSetPin, onSignOutOthers, onRemove, onClose }) {
  const [name, setName] = useState(profile.name);
  const [theme, setTheme] = useState(profile.theme);
  const [pinEdit, setPinEdit] = useState(null); // null = closed, string = new PIN being typed
  const [armed, setArmed] = useState(null);     // "signout" | "remove" awaiting a second tap
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  useEscape(onClose);

  const run = async (fn, done) => {
    setBusy(true); setErr(""); setNote("");
    try { await fn(); if (done) setNote(done); } catch (x) { setErr(String(x.message || x)); }
    setBusy(false); setArmed(null);
  };
  const dirty = name.trim() && (name.trim() !== profile.name || theme !== profile.theme);
  const pinOk = /^\d{4,6}$/.test(pinEdit || "");
  const c = paletteOf(theme).color;

  return (
    <div style={S.ovBackdrop} className="cd-ov-backdrop" onClick={onClose}>
      <div style={{ ...S.ovPanel, maxWidth: 440, textAlign: "left", ...themeVars(theme) }} className="cd-ov-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={S.ovHead}>
          <h2 style={S.ovTitle}>{profile.name}</h2>
          <button style={S.ovClose} className="cd-ov-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={S.psSection}>
          <div style={S.pfFormHead}>Name & colour</div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} style={S.input} aria-label="Name" />
          <ThemePicker value={theme} onChange={setTheme} />
          {dirty && (
            <div style={S.addActions}>
              <button type="button" disabled={busy} style={{ ...S.saveBtn, background: c }}
                onClick={() => run(() => onSave({ name: name.trim(), theme }), "Saved.")}>Save</button>
            </div>
          )}
        </div>

        <div style={S.psSection}>
          <div style={S.pfFormHead}>PIN</div>
          <div style={S.pfHint}>
            {profile.hasPin
              ? `On. ${profile.name}'s deck asks for it on every device except ${isOwnDevice ? "this one" : "their own"}.`
              : `Off. Anyone with the household passcode can open ${profile.name}'s deck.`}
          </div>
          {pinEdit === null ? (
            <div style={S.psBtns}>
              <button type="button" disabled={busy} style={S.cancelBtn} onClick={() => { setPinEdit(""); setErr(""); }}>
                {profile.hasPin ? "Change PIN" : "Set a PIN"}
              </button>
              {profile.hasPin && (
                <button type="button" disabled={busy} style={S.deleteBtn} onClick={() => run(() => onSetPin(""), "PIN removed.")}>Remove PIN</button>
              )}
            </div>
          ) : (
            <form style={S.psBtns} onSubmit={(e) => { e.preventDefault(); if (pinOk) run(async () => { await onSetPin(pinEdit); setPinEdit(null); }, "PIN saved. Other devices signed in as " + profile.name + " must sign in again."); }}>
              <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={pinEdit}
                onChange={(e) => setPinEdit(e.target.value.replace(/\D/g, ""))}
                placeholder="New PIN (4–6 digits)" style={{ ...S.input, flex: "1 1 160px" }} aria-label="New PIN" />
              <button type="submit" disabled={busy || !pinOk} style={{ ...S.saveBtn, background: c, opacity: busy || !pinOk ? 0.6 : 1 }}>Save</button>
              <button type="button" style={S.cancelBtn} onClick={() => setPinEdit(null)}>Cancel</button>
            </form>
          )}
        </div>

        <div style={S.psSection}>
          <div style={S.pfFormHead}>Devices</div>
          <div style={S.pfHint}>
            {armed === "signout"
              ? `Every other phone or tablet signed in as ${profile.name} will be sent back to the sign-in screen. This device stays in.`
              : `Someone else got into ${profile.name}'s deck? Sign out the other devices, and set or change the PIN.`}
          </div>
          <div style={S.psBtns}>
            <button type="button" disabled={busy} style={{ ...S.cancelBtn, ...(armed === "signout" ? S.psArmed : {}) }}
              onClick={() => (armed === "signout" ? run(onSignOutOthers, "Other devices signed out.") : setArmed("signout"))}>
              {armed === "signout" ? "Confirm sign-out" : "Sign out other devices"}
            </button>
          </div>
        </div>

        {canRemove && (
          <div style={{ ...S.psSection, borderBottom: "none" }}>
            <div style={S.pfFormHead}>Remove profile</div>
            <div style={S.pfHint}>
              {armed === "remove" ? `Deletes ${profile.name}'s private events and to-dos for good. Shared events stay.` : `Removes ${profile.name} and their private data.`}
            </div>
            <div style={S.psBtns}>
              <button type="button" disabled={busy} style={{ ...S.deleteBtn, ...(armed === "remove" ? S.pfConfirm : {}) }}
                onClick={() => (armed === "remove" ? run(onRemove) : setArmed("remove"))}>
                {armed === "remove" ? `Yes, remove ${profile.name}` : "Remove profile"}
              </button>
            </div>
          </div>
        )}

        {err && <div style={S.loginErr}>{err}</div>}
        {note && <div style={S.psNote}>{note}</div>}
      </div>
    </div>
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

function EditModal({ task, onSave, onDelete, onClose, places, onAddPlace, home, onSaveHome }) {
  const [title, setTitle] = useState(task.title || "");
  const [start, setStart] = useState(task.start || "");
  const [end, setEnd] = useState(task.end || "");
  const [cat, setCat] = useState(task.cat || "work");
  const [note, setNote] = useState(task.note || "");
  const [tss, setTss] = useState(task.tss ? String(task.tss) : "");
  const [shared, setShared] = useState(!!task.shared);
  const [important, setImportant] = useState(!!task.important);
  const [location, setLocation] = useState(task.location || "");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    if (!title.trim()) return;
    const fields = { title: title.trim(), start, end, cat, note: note.trim(), sport: task.sport || "", shared, tss: cat === "training" && tss ? Number(tss) : null, location };
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
          <TravelFields location={location} setLocation={setLocation} places={places} onAddPlace={onAddPlace} home={home} onSaveHome={onSaveHome} />
          {!task.recurring && <StarToggle important={important} onToggle={() => setImportant((s) => !s)} />}
          <SharedToggle shared={shared} onToggle={() => setShared((s) => !s)} />
          <div style={S.editActions}>
            <button style={S.deleteBtn} onClick={onDelete}>{task.recurring ? "Delete…" : "Delete"}</button>
            <div style={S.addActions}>
              <button style={S.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={S.saveBtn} disabled={!title.trim()} onClick={save}>
                {task.recurring ? "Save…" : "Save"}
              </button>
            </div>
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
            <div key={m.id} style={S.imminentRow} className="cd-imminent-row">
              <span style={S.imminentWhen}>{m.date === todayStr ? "Today" : "Tomorrow"}{m.start ? <span style={S.imminentTime}> {m.start}</span> : null}</span>
              <span style={{ ...S.monthDotEl, background: CATS[m.cat]?.dot || "#888" }} />
              <span style={S.imminentTitle}>{m.shared ? <span title="Shared on both decks">🔗 </span> : null}{m.title}</span>
              {isStored(m.id) && (
                <button onClick={() => onRemove(m.id)} style={S.del} title="Delete">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={S.monthList} className="cd-month-list">
        {imminent.length === 0 && later.length === 0 && (
          <div style={S.empty}>Nothing in the next 30 days. Add something below.</div>
        )}
        {later.map((m) => {
          const d = new Date(m.date + "T00:00:00");
          return (
            <div key={m.id} style={S.monthItem} className="cd-row cd-month-item">
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
                ? <button onClick={() => onRemove(m.id)} style={S.del} title="Delete">×</button>
                : <span />}
            </div>
          );
        })}
      </div>

      <div style={S.monthAdd} className="cd-month-add">
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
  /* Accent vars typed as colors so they can interpolate; the shell transition
     morphs the whole palette on profile switch. Browsers without @property
     simply swap instantly (today's behavior) — graceful, no breakage. */
  @property --accent { syntax: '<color>'; inherits: true; initial-value: #2f5d9e; }
  @property --accent-soft { syntax: '<color>'; inherits: true; initial-value: #eef3fa; }
  @property --accent-border { syntax: '<color>'; inherits: true; initial-value: #cdddef; }
  @property --accent-dark { syntax: '<color>'; inherits: true; initial-value: #244b80; }
  .cd-shell { transition: --accent .5s ease, --accent-soft .5s ease, --accent-border .5s ease, --accent-dark .5s ease; }
  .cd-card { transition: transform .25s ease, box-shadow .25s ease; }
  .cd-block { transition: transform .15s ease, opacity .2s ease; }
  .cd-weekday { transition: transform .15s ease, background .2s ease; }
  .cd-del { opacity: 0; transition: opacity .2s ease; }
  @keyframes rise { from { opacity:0; transform: translateY(10px);} to {opacity:1; transform:none;} }
  @keyframes ovFade { from { opacity:0; } to { opacity:1; } }
  @keyframes ovSlide { from { opacity:0; transform: translateY(24px) scale(.98); } to { opacity:1; transform:none; } }
  @keyframes swap { from { opacity:0; transform: translateY(7px); } to { opacity:1; transform:none; } }
  .cd-swap { animation: swap .42s cubic-bezier(.2,.8,.25,1); }
  .cd-workout { cursor: pointer; transition: transform .2s ease, box-shadow .25s ease; }

  .cd-ov-backdrop { animation: ovFade .2s ease; }
  .cd-ov-panel { animation: ovSlide .28s cubic-bezier(.2,.8,.25,1); }

  @keyframes badgePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
  .cd-badge-live { animation: badgePulse 2.4s ease-in-out infinite; }

  @keyframes ptrSpin { to { transform: rotate(360deg); } }
  .cd-ptr-spin { animation: ptrSpin .7s linear infinite; }
  @keyframes toastUp { from { opacity:0; transform: translate(-50%, 16px); } to { opacity:1; transform: translate(-50%, 0); } }
  .cd-toast { animation: toastUp .25s cubic-bezier(.2,.8,.25,1); }
  /* Hover effects only for real mouse pointers. On touch screens a tap leaves
     :hover "stuck" on the last thing touched, which looked like a highlight
     that never went away. */
  @media (hover: hover) and (pointer: fine) {
    .cd-card:hover { box-shadow: 0 18px 40px -24px rgba(30,40,70,0.45); }
    .cd-block:hover { transform: translateX(2px); }
    .cd-weekday:hover { transform: translateY(-3px); }
    .cd-row:hover .cd-del { opacity: 1; }
    .cd-add:hover { background: ${line}; }
    .cd-workout:hover { transform: translateY(-3px); box-shadow: 0 22px 46px -22px var(--accent-glow); }
    .cd-ov-close:hover { background: ${line}; color: ${ink}; }
    .cd-ov-box:hover { transform: translateY(-2px); border-color: var(--accent-border); box-shadow: 0 12px 26px -18px var(--accent-glow); }
    .cd-push:hover { background: var(--accent-border); }
    .cd-cal-cell:hover { border-color: var(--accent); }
    .cd-toast-undo:hover { background: rgba(255,255,255,0.16); }
  }
  /* Touch: no hover to reveal delete buttons, so show them; brief press feedback instead. */
  @media (hover: none) {
    .cd-del { opacity: 1; }
    .cd-weekday:active, .cd-push:active, .cd-workout:active { transform: scale(0.97); }
  }
  button, [role="button"], input, select, label { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  :focus:not(:focus-visible) { outline: none; }
  .cd-nosel { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  /* Room for the iPhone notch/status bar when running from the home screen. */
  .cd-shell { padding-top: calc(env(safe-area-inset-top, 0px) + 28px) !important; }
  .cd-header-main { min-width: 0; text-align: left; }

  /* --- Tablet portrait & phones: one column, bottom-sheet dialogs --- */
  @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (max-width: 900px) {
    .cd-shell { padding: calc(env(safe-area-inset-top, 0px) + 16px) max(14px, env(safe-area-inset-right, 0px))
                         calc(env(safe-area-inset-bottom, 0px) + 28px) max(14px, env(safe-area-inset-left, 0px)) !important; }
    .cd-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 14px !important; margin-bottom: 14px !important; }
    .cd-week-card { margin-bottom: 14px !important; }
    .cd-month-list { max-height: none !important; }
    .cd-month-add > input, .cd-month-add > select { flex: 1 1 calc(50% - 8px) !important; min-width: 0; }
    .cd-ov-backdrop { align-items: flex-end !important; padding: 0 !important; }
    .cd-ov-panel { max-width: none !important; width: 100% !important; margin: 0 !important; max-height: 92vh; max-height: 92dvh;
                   overflow-y: auto; border-radius: 22px 22px 0 0 !important; border-bottom: none !important;
                   padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 22px) !important;
                   animation: sheetUp .28s cubic-bezier(.2,.8,.25,1) !important; }
    .cd-toast { bottom: calc(env(safe-area-inset-bottom, 0px) + 16px) !important; }
    /* iOS zooms the page when focusing any input under 16px. */
    input, select, textarea { font-size: 16px !important; }
  }
  @media (max-width: 600px) {
    .cd-header { align-items: flex-start !important; margin-bottom: 16px !important; gap: 10px; }
    .cd-header-main { flex: 1 1 auto; }
    .cd-profile-bar { overflow-x: auto; scrollbar-width: none; padding: 2px 0 4px; }
    .cd-profile-bar::-webkit-scrollbar { display: none; }
    .cd-profile-bar > button { flex: 0 0 auto; padding: 8px 14px !important; font-size: 13.5px !important; }
    .cd-big-day { font-size: 30px !important; }
    .cd-card { padding: 16px 14px !important; border-radius: 18px !important; }
    .cd-week-row { gap: 4px !important; }
    .cd-week-row > button { padding: 9px 0 8px !important; border-radius: 12px !important; min-width: 0; }
    .cd-week-name { font-size: 10px !important; letter-spacing: 0 !important; }
    .cd-week-num { font-size: 18px !important; margin: 2px 0 6px !important; }
    .cd-wx-row { gap: 2px !important; }
    .cd-tl-row { grid-template-columns: 40px 34px minmax(0, 1fr) 30px !important; gap: 6px !important; }
    .cd-month-item { grid-template-columns: 36px 36px 8px minmax(0, 1fr) 26px 26px 26px !important; gap: 8px !important; }
    .cd-imminent-row { gap: 8px !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cd-swap, .cd-toast, .cd-ov-panel, .cd-ov-backdrop, .cd-badge-live { animation: none; }
    .cd-shell { transition: none; }
  }
`;

// Styles that another style toggles by `borderColor`/`borderStyle` (active,
// selected, armed…) also spell those longhands out next to `border`. React
// *removes* a longhand when the toggle turns off, which resets the colour to
// currentColor (black) instead of the shorthand's grey: the "outline that
// never goes away" on previously tapped days/pills.
const S = {
  shell: { minHeight: "100vh", background: "var(--app-bg)",
           fontFamily: "'Spline Sans', sans-serif", color: ink, padding: "28px clamp(16px,4vw,48px) 48px", animation: "rise .5s ease" },
  loading: { fontFamily: "'Fraunces', serif", fontSize: 22, color: muted, padding: 60, textAlign: "center" },
  ptr: { position: "fixed", top: "env(safe-area-inset-top, 0px)", left: "50%", zIndex: 300,
    width: 40, height: 40, borderRadius: "50%", background: cardBg, border: `1px solid ${line}`,
    boxShadow: "0 10px 24px -12px rgba(20,30,60,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
    pointerEvents: "none" },
  ptrIcon: { fontSize: 20, fontWeight: 700, lineHeight: 1, display: "inline-block", transition: "color .15s ease" },
  updateBar: { display: "block", width: "100%", maxWidth: 1200, margin: "0 auto 14px", padding: "10px 14px", borderRadius: 12,
    border: `1px solid ${accentBorder}`, background: accentSoft, color: accent, fontSize: 13.5, fontWeight: 600,
    fontFamily: "inherit", cursor: "pointer", textAlign: "center" },
  errorBanner: { maxWidth: 1200, margin: "0 auto 14px", padding: "8px 14px", borderRadius: 10,
                 background: "#fbeae3", color: "#7a3a1f", fontSize: 12.5, border: "1px solid #f0d4c4" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, maxWidth: 1200, marginInline: "auto" },
  kicker: { textTransform: "uppercase", letterSpacing: "0.22em", fontSize: 11, color: muted, fontWeight: 600 },
  profileBar: { display: "flex", gap: 6, marginBottom: 8 },
  profilePill: { padding: "5px 14px", borderRadius: 999, border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: cardBg, color: muted,
    fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em", cursor: "pointer", fontFamily: "inherit", transition: "all .28s ease" },
  profileManage: { padding: "5px 11px", borderRadius: 999, border: `1px dashed ${line}`, background: "transparent", color: muted,
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .28s ease" },
  pfList: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 },
  pfRowBtn: { display: "grid", gridTemplateColumns: "14px 1fr auto", gap: 12, alignItems: "center", width: "100%", textAlign: "left",
    padding: "12px 6px", border: "none", borderBottom: `1px solid ${line}`, background: "transparent", cursor: "pointer",
    fontFamily: "inherit", borderRadius: 0 },
  pfChevron: { fontSize: 22, color: faint, lineHeight: 1 },
  pfTip: { fontSize: 12, color: faint, margin: "10px 2px 14px" },
  psSection: { display: "flex", flexDirection: "column", gap: 9, padding: "4px 0 16px", marginBottom: 14, borderBottom: `1px solid ${line}` },
  psBtns: { display: "flex", flexWrap: "wrap", gap: 8 },
  psArmed: { background: accent, color: "#fff", borderColor: accent },
  psNote: { fontSize: 13, color: "#3f7a45", fontWeight: 600 },
  imminentTime: { fontFamily: "'Spline Sans', sans-serif", fontSize: 12, fontWeight: 600, color: muted, marginLeft: 4 },
  pillLock: { marginLeft: 5, fontSize: 10 },
  pinInput: { fontSize: 22, letterSpacing: "0.4em", textAlign: "center" },
  pinClaim: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: muted, margin: "12px 0 14px", cursor: "pointer" },
  sideCol: { display: "flex", flexDirection: "column", gap: 18, minWidth: 0 },
  todoClear: { border: "none", background: "transparent", color: accent, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0 },
  todoList: { display: "flex", flexDirection: "column" },
  todoRow: { display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${line}` },
  todoBox: { width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${accentBorder}`, borderStyle: "solid", borderColor: accentBorder, background: "#fff", color: "#fff",
    fontSize: 13, fontWeight: 700, lineHeight: 1, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  todoBoxOn: { background: accent, borderColor: accent },
  todoTitle: { fontSize: 14, color: ink, cursor: "pointer", overflowWrap: "anywhere", textAlign: "left" },
  todoTitleDone: { color: faint, textDecoration: "line-through" },
  todoDel: { border: "none", background: "transparent", color: faint, fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 4px" },
  todoAdd: { display: "flex", gap: 8, marginTop: 12 },
  pfSwatch: { width: 14, height: 14, borderRadius: "50%" },
  pfName: { display: "block", fontSize: 15, fontWeight: 600, color: ink },
  pfYou: { fontSize: 12, fontWeight: 500, color: faint },
  pfMeta: { display: "block", fontSize: 12, color: muted, marginTop: 1 },
  pfConfirm: { background: "#b5483f", color: "#fff", borderColor: "#b5483f" },
  pfFormHead: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: muted },
  pfThemes: { display: "flex", gap: 10, flexWrap: "wrap", padding: "4px 2px" },
  pfTheme: { width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer", transition: "box-shadow .15s ease" },
  pfCalToggle: { alignSelf: "flex-start", border: "none", background: "transparent", color: muted, fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", padding: "2px 0" },
  pfHint: { fontSize: 12, color: muted, lineHeight: 1.45 },
  loginCard: { width: "100%", maxWidth: 360, background: cardBg, border: `1px solid ${line}`, borderRadius: 22,
    padding: "28px 26px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 30px 60px -30px rgba(30,40,70,0.45)" },
  loginKicker: { fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: accent },
  loginTitle: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, color: ink, margin: 0 },
  loginSub: { fontSize: 13.5, color: muted, margin: "0 0 4px", lineHeight: 1.5 },
  loginPills: { display: "flex", flexWrap: "wrap", gap: 10 },
  loginPill: { flex: "1 1 30%", padding: "10px 8px", borderRadius: 12, border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: cardBg, color: muted,
    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .18s ease" },
  loginInputErr: { borderColor: "#e0a3a3" },
  loginErr: { fontSize: 12.5, color: "#b5483f", fontWeight: 600 },
  loginBtn: { marginTop: 4, padding: "12px", borderRadius: 12, border: "none", background: accent, color: "#fff",
    fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  shareToggle: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", borderRadius: 12,
    border: `1px dashed ${line}`, borderStyle: "dashed", borderColor: line, background: "transparent", color: muted, fontSize: 13, fontWeight: 600,
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
  tlRow: { display: "grid", gridTemplateColumns: "50px 40px 1fr 38px", gap: 8, alignItems: "stretch" },
  tlTime: { fontSize: 12, color: muted, paddingTop: 14, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  tlNowTime: { color: accent, fontWeight: 700 },
  tlTimeEnd: { fontSize: 11, color: faint, marginTop: 2 },
  tlSpine: { position: "relative", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 9 },
  tlLineFull: { position: "absolute", top: 0, bottom: 0, left: "50%", marginLeft: -1, width: 2, background: line, zIndex: 0 },
  tlLineDash: { position: "absolute", top: 0, bottom: 0, left: "50%", marginLeft: -1, width: 0, borderLeft: `2px dashed ${line}`, zIndex: 0 },
  tlBadge: { position: "relative", zIndex: 1, width: 34, height: 34, borderRadius: "50%", display: "flex",
             alignItems: "center", justifyContent: "center", flex: "0 0 auto", background: "#fff" },
  tlBadgeGlyph: { fontSize: 16, lineHeight: 1 },
  tlBlock: { position: "relative", overflow: "hidden", textAlign: "left", border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: "#fff",
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
  tlGapRow: { display: "grid", gridTemplateColumns: "50px 40px 1fr 38px", gap: 8, alignItems: "stretch", minHeight: 30 },
  tlGap: { display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: 12.5, color: faint, fontStyle: "italic" },
  tlGapIcon: { fontSize: 13, opacity: 0.75, fontStyle: "normal" },

  // Travel estimate row (non-completable) + the from/to picker in the forms.
  tlTravelRow: { display: "grid", gridTemplateColumns: "50px 40px 1fr 38px", gap: 8, alignItems: "center", minHeight: 30 },
  tlTravelBadge: { position: "relative", zIndex: 1, width: 22, height: 22, borderRadius: "50%", display: "flex",
                   alignItems: "center", justifyContent: "center", fontSize: 11, background: cardBg,
                   border: `1px dashed ${line}`, boxShadow: `0 0 0 3px ${cardBg}` },
  tlTravelBlock: { display: "flex", flexDirection: "column", gap: 1, padding: "3px 2px" },
  tlTravelMain: { fontSize: 13, fontWeight: 600, color: accent },
  tlTravelSub: { fontSize: 12, color: muted },
  tlTravelMuted: { fontSize: 12.5, color: faint, fontStyle: "italic" },

  travelBox: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 11px", borderRadius: 12,
               background: "#fff", border: `1px solid ${line}` },
  travelHead: { fontSize: 12.5, fontWeight: 700, color: ink },
  travelHint: { fontWeight: 500, color: faint },
  travelField: { display: "flex", alignItems: "center", gap: 8 },
  travelLabel: { fontSize: 12.5, color: muted, width: 42, flex: "0 0 auto" },
  placeAdd: { display: "flex", flexDirection: "column", gap: 7, padding: "8px 0" },
  placeErr: { fontSize: 12, color: "#c0405a" },
  homeLine: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: muted },
  homeEdit: { border: "none", background: "transparent", color: accent, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0 },
  tlGapNow: { color: accent, fontWeight: 600, fontStyle: "normal" },
  tlEmpty: { fontSize: 13.5, color: muted, fontStyle: "italic", padding: "16px 2px", lineHeight: 1.5 },
  tlActions: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 },
  actBtn: { background: "none", border: "none", color: faint, fontSize: 15, lineHeight: 1, cursor: "pointer", padding: 0 },
  checkBtn: { background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", alignSelf: "stretch",
              display: "flex", alignItems: "center", justifyContent: "center" },
  tag: { fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 7, display: "inline-block" },
  check: { width: 22, height: 22, borderRadius: "50%", border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center",
           color: "#fff", fontSize: 13, flex: "0 0 auto", fontWeight: 700 },
  del: { background: "none", border: "none", color: faint, fontSize: 20, cursor: "pointer", lineHeight: 1, alignSelf: "center", padding: 0 },
  empty: { fontSize: 13.5, color: muted, fontStyle: "italic", padding: "10px 2px" },
  addBtn: { marginTop: 12, width: "100%", padding: "11px", borderRadius: 12, border: `1px dashed ${line}`,
            background: "transparent", color: muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  addPanel: { marginTop: 14, padding: 14, borderRadius: 14, background: paper, display: "flex", flexDirection: "column", gap: 9 },
  addGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 },
  input: { padding: "9px 11px", borderRadius: 10, border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, fontSize: 14, fontFamily: "inherit", background: "#fff", color: ink, width: "100%" },
  catPick: { display: "flex", gap: 7, flexWrap: "wrap" },
  catChip: { padding: "6px 12px", borderRadius: 20, border: "1.5px solid", fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "transparent", fontFamily: "inherit" },
  addActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 },
  editActions: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 },
  deleteBtn: { padding: "8px 14px", borderRadius: 10, border: "1px solid #e6c3c3", borderStyle: "solid", borderColor: "#e6c3c3", background: "#fff", color: "#b5483f", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  cancelBtn: { padding: "8px 16px", borderRadius: 10, border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: "#fff", color: muted, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  saveBtn: { padding: "8px 18px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  workoutCard: { background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%)", border: "none", color: "#fff" },
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
  wdChip: { width: 30, height: 30, borderRadius: "50%", border: `1.5px solid ${line}`, borderStyle: "solid", borderColor: line, background: "transparent",
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
              border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: "#fff", borderRadius: 12, padding: "11px 14px", marginBottom: 9,
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

  // coach prompt generator
  coachBtn: { width: "100%", textAlign: "left", border: `1px solid ${accentBorder}`, background: accentSoft, borderRadius: 16,
              padding: "13px 16px", fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, color: accent, cursor: "pointer",
              display: "flex", flexDirection: "column", gap: 3, transition: "transform .15s ease, box-shadow .2s ease, border-color .2s ease" },
  coachBtnSub: { fontSize: 12, fontWeight: 500, color: muted },
  coachForm: { display: "flex", flexDirection: "column", gap: 14 },
  coachDates: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  coachField: { display: "flex", flexDirection: "column", gap: 5 },
  coachLabel: { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: muted },
  coachNotes: { width: "100%", border: `1px solid ${line}`, borderRadius: 12, padding: "10px 12px", fontFamily: "inherit",
                fontSize: 14, color: ink, resize: "vertical", boxSizing: "border-box", background: "#fff" },
  coachActions: { display: "flex", alignItems: "center", gap: 12 },
  coachCopy: { border: `1px solid ${accent}`, background: accent, color: "#fff", borderRadius: 12, padding: "9px 18px",
               fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" },
  coachHint: { fontSize: 12, color: faint },
  coachOut: { width: "100%", minHeight: 300, border: `1px solid ${line}`, borderRadius: 12, padding: "12px 13px",
              fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 11.5, lineHeight: 1.5,
              color: ink, background: paper, resize: "vertical", boxSizing: "border-box", whiteSpace: "pre", overflowWrap: "normal" },

  // plan import (stage 2)
  coachTabs: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 },
  coachTab: { border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, background: "#fff", borderRadius: 12, padding: "9px 10px", fontFamily: "inherit",
              fontSize: 13, fontWeight: 700, color: muted, cursor: "pointer", transition: "background .15s ease, color .15s ease, border-color .15s ease" },
  coachTabOn: { background: accentSoft, borderColor: accentBorder, color: accent },
  fileBtn: { display: "inline-flex", alignItems: "center", border: `1px solid ${line}`, background: "#fff", borderRadius: 12,
             padding: "9px 16px", fontSize: 13.5, fontWeight: 600, color: ink, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" },
  importIntro: { fontSize: 13, color: muted, margin: 0, lineHeight: 1.45 },
  importErr: { fontSize: 13, color: "#7a3a1f", background: "#fbeae3", border: "1px solid #f0d4c4", borderRadius: 10, padding: "9px 12px" },
  importDone: { fontSize: 13, fontWeight: 600, color: "#2f6d3a", background: "#e6f3e8", border: "1px solid #c4e0c9", borderRadius: 10, padding: "9px 12px" },
  importPreview: { border: `1px solid ${line}`, borderRadius: 12, background: paper, padding: "10px 12px",
                   display: "flex", flexDirection: "column", gap: 9, maxHeight: 300, overflowY: "auto" },
  importPreviewHead: { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: muted },
  previewGroup: { display: "flex", flexDirection: "column", gap: 3 },
  previewDay: { fontSize: 12, fontWeight: 700, color: accent },
  previewRow: { display: "grid", gridTemplateColumns: "94px 1fr auto", gap: 8, alignItems: "baseline", fontSize: 13 },
  previewTime: { fontSize: 12, color: muted, fontVariantNumeric: "tabular-nums" },
  previewTitle: { color: ink, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  previewMeta: { fontSize: 11.5, color: faint, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  replaceRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: ink, cursor: "pointer" },

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
  calCell: { minHeight: 58, border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, borderRadius: 12, background: "#fff", padding: "6px 3px 5px",
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
  wxDay: { textAlign: "center", padding: "6px 2px", borderRadius: 10, border: "1px solid transparent", borderStyle: "solid", borderColor: "transparent",
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
  weekDay: { border: `1px solid ${line}`, borderStyle: "solid", borderColor: line, borderRadius: 16, padding: "12px 6px 10px", background: "#fff", cursor: "pointer", textAlign: "center", fontFamily: "inherit" },
  weekDayActive: { background: accentSoft, borderColor: accent, boxShadow: "0 8px 22px -16px rgba(47,93,158,0.7)" },
  weekName: { fontSize: 11.5, color: muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
  weekNum: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, margin: "3px 0 7px", color: ink },
  weekNumToday: { color: accent },
  weekDots: { display: "flex", justifyContent: "center", gap: 3, minHeight: 8, flexWrap: "wrap" },
  weekDot: { width: 7, height: 7, borderRadius: "50%" },
  weekCount: { fontSize: 11, color: muted, marginTop: 8, fontVariantNumeric: "tabular-nums" },
  imminentBox: { background: accentSoft, border: `1px solid ${accentBorder}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 },
  imminentRow: { display: "grid", gridTemplateColumns: "minmax(82px, auto) 10px 1fr 24px", gap: 12, alignItems: "center" },
  imminentWhen: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 700, color: accent, letterSpacing: "0.02em" },
  imminentTitle: { fontSize: 14.5, fontWeight: 600, color: ink, textAlign: "left", minWidth: 0 },
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
  monthTitle: { fontSize: 14.5, fontWeight: 500, textAlign: "left", minWidth: 0 },
  monthAdd: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  footer: { textAlign: "center", fontSize: 12, color: muted, marginTop: 26, maxWidth: 1200, marginInline: "auto" },
};
