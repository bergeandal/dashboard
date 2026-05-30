# Command Deck — UI kit

A high-fidelity, **interactive recreation** of the Command Deck dashboard, re-toned
to the cool / denim-blue scheme. It runs entirely in the browser on seed data — no
server, no API — so you can click around the real interactions.

Open **`index.html`**.

## What's interactive
- **Check off tasks** — tap any block in the Today timeline; it dims, strikes through,
  and fills the category check. Done-state persists to `localStorage` (`cdkit.done`).
- **Switch days** — tap a tile in *Next 7 days*; the Today panel re-targets that day
  and the title/progress update.
- **Add a block** — *+ Add block* opens the inline composer (title, start/end, note,
  category chips). Added blocks land on the currently-selected day and can be removed.
- **Expand weather** — tap a day in the Bergen strip to open/close its hourly detail.
- **Live-derived panels** — *Next workout* and *Month ahead* recompute from the task
  set (e.g. checking off the next run advances the workout card).

## Files
| File | Role |
|------|------|
| `index.html` | Shell — loads fonts, React/Babel, and the scripts below; holds the hover/entrance CSS. |
| `tokens.js` | Plain-JS globals: `CATS`, `COLORS`, date helpers, and the seed data (`SEED_TASKS`, `SEED_BIRTHDAYS`, `SEED_MONTH`, `SEED_WEATHER`), generated relative to *today* so it's always populated. |
| `styles.js` | The `window.K` style-object system (the product's inline-style approach, re-toned). |
| `components.jsx` | Presentational components: `Header`, `TodayTimeline` (+ `AddRow`), `WorkoutCard`, `WeatherStrip` (+ `WeatherDetail`), `WeekStrip`, `MonthAhead`. Exported to `window`. |
| `App.jsx` | State + layout: merges tasks, derives next-workout / month-ahead, owns selected day and done-state. |

## Notes & fidelity
- The component structure, class names (`cd-card`, `cd-block`, `cd-weekday`, …),
  spacing, radii, shadows, and motion mirror the source `App.jsx` from
  [`bergeandal/dashboard`](https://github.com/bergeandal/dashboard). The **only**
  intentional divergence is the palette pivot from warm terracotta to cool denim blue.
- Each Babel script is wrapped in an IIFE so top-level `const { useState } = React`
  declarations don't collide across files — keep that pattern if you split further.
- This is a **cosmetic recreation**, not production code: no real calendar/weather
  fetching, no two-way sync. Swap `SEED_*` for an API to make it live.
- The shell uses a one-shot `rise` entrance animation (fade + 10px up). If you embed
  it somewhere that loads while hidden, the content may sit at opacity 0 until the tab
  is focused — remove the `animation` on `K.shell` if that's a problem.
