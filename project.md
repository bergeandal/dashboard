# Command Deck

A self-hosted weekly planning dashboard. Calm, Structured-inspired. One deck per household
profile (Berge, Amanda, …); profiles are added/removed from the "+" pill in the header.
Live at **https://command-deck-berge.fly.dev** (Fly.io, Stockholm region).

## Stack

- **Frontend**: React 19 + Vite, single-file `command-deck/src/App.jsx` with inline-style objects
- **Backend**: Node 22 + TypeScript + Fastify, in `server/src/`
- **Data**: SQLite (better-sqlite3) on a Fly volume mounted at `/app/data/deck.db`
- **Deploy**: One Docker image (multi-stage: builds frontend, builds server, bundles both),
  one Fly app `command-deck-berge`, served from a single origin (`/` → React, `/api/*` → Fastify) (fly deploy)
- **Repo**: github.com/bergeandal/dashboard, branch `main`

## Layout

```
Dashboard/
├── project.md             (this file)
├── Dockerfile             (multi-stage build, repo root)
├── fly.toml               (mounts deck_data volume to /app/data)
├── command-deck/          (Vite frontend)
│   ├── index.html         (PWA meta tags, light color-scheme forced)
│   └── src/App.jsx        (whole UI — single file, inline styles)
├── server/                (Fastify backend)
│   ├── birthdays.ics      (committed; exported from Google Contacts)
│   ├── .env               (local dev only; secrets in Fly in prod)
│   └── src/
│       ├── index.ts       (routes + static serving)
│       ├── config.ts      (env loading)
│       ├── db.ts          (SQLite init + prepared statements)
│       ├── calendar/      (.ics fetch + RRULE expansion)
│       └── weather/yr.ts  (YR.no compact endpoint, Expires cache)
└── design systems/        (reference UI kit — not built or served)
```

## Data sources

| Source                                                 | How                                                     | Notes                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Google calendars: training, work, social, home, event  | Secret `.ics` URLs (read-only, no OAuth)              | Env vars `ICS_TRAINING`/`ICS_WORK`/`ICS_SOCIAL`/`ICS_HOME`/`ICS_EVENTS`; Fly secrets in prod            |
| Birthdays (from Google Contacts)                       | Static file `server/birthdays.ics` bundled into image | Contacts birthdays have no shareable iCal URL on Google's side. Re-export + commit + redeploy to update. **Berge's deck only** (`birthdaysFor` in config.ts). |
| Bergen weather                                         | YR.no `locationforecast/2.0/compact`, server-side     | Required `User-Agent` (`YR_USER_AGENT` env). Honors `Expires` header. Bergen lat/lon hardcoded in `.env`. |
| Dashboard-only tasks, done-state, manual month entries | SQLite on Fly volume                                    | Synced across all devices that hit the URL                                                                        |

## API surface

- `GET /api/health` → `{ ok: true }`
- `GET /api/data?start=YYYY-MM-DD&days=N` → bundled `{ tasks, birthdays, localTasks, doneIds, month, weather, fetchedAt }`. Frontend hits this on load and every 5 min.
  - `tasks` is calendar events (all 5 URL-sourced calendars) within window
  - `birthdays` is next 365 days, deduped to next occurrence per person (empty for profiles other than berge)
- `GET /api/weather` → standalone weather payload (YR `complete` endpoint: `compact` has no rain probability)
- `POST /api/tasks` / `DELETE /api/tasks/:id` — dashboard-added blocks
- `POST /api/done/:id` / `DELETE /api/done/:id` — check off any task (calendar OR local)
- `POST /api/month` / `DELETE /api/month/:id` — manual Month-ahead entries
- `GET /api/profiles` (open pre-login, for the login screen; never returns calendar URLs) /
  `POST /api/profiles` `{ name, theme, calendars? }` / `DELETE /api/profiles/:id`
  - Profiles live in the SQLite `profiles` table (seeded with Berge + Amanda). Id is a slug of the name.
  - Removing a profile deletes its private tasks + recurring series; shared ones stay. The last profile can't be removed.
  - Calendars: URLs saved on the profile win; else env `ICS_*` (berge) / `ICS_<ID>_*` (others, e.g. `ICS_AMANDA_WORK`).
  - intervals.icu fitness stays tied to the `berge` id.
- `POST /api/login` `{ passcode, profile, pin? }` — the chosen profile becomes the device's **owner** (stored in the signed cookie)
- `GET /api/session` → `{ owner }`
- `PATCH /api/profiles/:id` `{ name?, theme? }` — rename / recolour
- `PUT /api/profiles/:id/pin` `{ pin }` (`""` removes; a new PIN also signs out the profile's other devices) / `POST /api/profiles/:id/unlock` `{ pin, claim? }` → `{ unlock }`
- `POST /api/profiles/:id/signout` — sign out every other device that belongs to the profile (bumps `profiles.session_epoch`, which is baked into device cookies and unlock tokens)
- `POST /api/todos` / `PATCH /api/todos/:id` `{ done }` / `DELETE /api/todos/:id` / `POST /api/todos/clear` — per-profile checklist (returned as `todos` in `/api/data`)

## Auth: passcode + profile PINs

- The shared `DECK_PASSCODE` trusts a device (400-day signed cookie), as before.
- Each profile can have an optional 4–6 digit PIN (scrypt-hashed in `profiles.pin_hash`).
- A PIN profile opens freely on its **owner** device. Anywhere else it asks every time you switch
  to it; the unlock token (12 h, header `X-Profile-Unlock`) lives only in page memory, so a reload locks it again.
- Checked server-side in one `preHandler` hook (`touchedProfile` in `index.ts`): **any new route that
  reads or writes profile data must be added there.**
- 5 wrong PINs → that profile refuses attempts for 5 min (in-memory, resets on restart).
- The sign-in screen never pre-selects a profile (people used to tap straight through as Berge).
- Devices trusted before PINs existed have no owner; ticking "Don't ask again on this device"
  in the PIN prompt claims the device.

## Frontend sections (top to bottom)

1. **Header** — "Hei, Berge 👋" + big date
2. **Today** (left, 1.4fr) — vertical timeline for the selected day; tap a block to toggle done
3. **Next workout** (right) — soonest upcoming `cat:"training"`, denim gradient card
   - **To-do** (right, under it) — per-profile checklist; ticked items sink + strike through until "Clear done"
4. **Bergen weather** (right) — 7-day strip; tap a day to expand hourly detail (~48h horizon from YR)
5. **Next 7 days** — rolling 7-day strip starting today; per-day category dots + done/total
6. **Month ahead** — `Today/Tomorrow` highlighted box up top, then list out to day 30. Birthdays + manual entries fill it; `cat:"event"` items appear only in the later list (they're already in the timeline).
7. **Footer** — small status line

## Design tokens

- **Palette**: cool denim-blue. ink `#20242e`, paper `#eef1f6`, card `#fbfcfe`, line `#dde2ec`, accent `#2f5d9e`
- **Categories**: work `#2f5d9e` · training `#5b96cf` · home `#6f9e6a` · social `#b07ec2` · birthday `#d96a8a` · event `#d4a056`
- **Fonts**: Fraunces (display serif) for headers/numbers, Spline Sans (body) for text
- **`design systems/command-deck/`** holds the reference UI kit (interactive HTML mock) — not built or served

## Hard-won constraints (don't re-derive)

- YR.no must be called **server-side** with a real `User-Agent`. Browser-side fetches get blocked.
- Google Calendar `.ics` URLs cannot be fetched from the browser (CORS).
- Birthdays from Google Contacts cannot be exposed as an iCal URL — only as a one-shot file export.
- Done-state is dashboard-only. Google Calendar has no "done" concept. Lives only in SQLite.
- All times rendered in **Europe/Oslo** regardless of server TZ (uses `Intl.DateTimeFormat`).
- All-day events from Google export get `start: ""` / `end: ""`; they sort first in the timeline.

## Environment

Local dev `.env` (gitignored) holds the real .ics URLs. In production these live as Fly secrets.

```
PORT=3001                             # local; Fly uses 8080 internally
ICS_TRAINING=...                      # 5 secret iCal URLs from Google Calendar
ICS_WORK=...
ICS_SOCIAL=...
ICS_HOME=...
ICS_EVENTS=...
LAT=60.3913                           # Bergen
LON=5.3221
YR_USER_AGENT=CommandDeck/0.1 bergeandal@gmail.com
DB_PATH=./data/deck.db                # local; prod is /app/data/deck.db (Fly volume)
BIRTHDAYS_FILE=./birthdays.ics        # default; usually omit
```

## Dev / deploy

```powershell
# Local dev (two terminals)
cd server && npm run dev               # :3001
cd command-deck && npm run dev         # :5173, proxies /api → :3001

# Deploy (from repo root)
fly deploy                             # rebuilds, redeploys, ~3 min
fly secrets set ICS_X="..." -a command-deck-berge   # secret updates also trigger restart
```

## Known limitations / open work

- **Home-screen app**: `public/manifest.webmanifest` + PNG icons (`icon.svg` rendered to 180/192/512) make Add to Home Screen open standalone on Android and iOS. Untested on a real device's standalone mode.

## Mobile / touch

- Responsive rules live in `globalCss` (App.jsx) keyed on `cd-*` class names: ≤900px = one column + bottom-sheet dialogs; ≤600px = phone tweaks.
- All `:hover` effects sit inside `@media (hover: hover) and (pointer: fine)`. On touch, :hover sticks after a tap.
- Press-and-hold (or right-click) a profile pill → that profile's settings sheet (`useLongPress`). It swallows the click that follows the hold, or the click would close the sheet via its backdrop.
- Inputs are forced to 16px on small screens so iOS doesn't zoom on focus. `src/index.css` is a minimal reset (it used to be Vite's template, which broke mobile).
- **Pull to refresh** (`PullToRefresh`) runs only in home-screen (standalone) mode; browser tabs have their own. It reloads the page. The page slides with the finger via a direct DOM transform on `.cd-shell`, and the indicator is portalled to `<body>`.
- **Auto-update**: `/api/health` returns `version` (Fly's `FLY_IMAGE_REF`). An open app that sees a new version reloads when it comes back to the foreground (unless a sheet/input is active), otherwise shows a "tap to update" bar. Returning to the app also refetches data.
- **No write-back to Google Calendar** — adding a block on the dashboard creates a SQLite row, doesn't appear in Google. Three options were sketched (OAuth-based write, URL-trick `?action=TEMPLATE`, status-quo). Currently status-quo.
- **Birthdays update** requires manual re-export from Google Contacts → replace `server/birthdays.ics` → push → deploy.

## How I work on this

Direct, terse, no preamble. Edits over recreations. I'm new to home-server / backend
work — explain the *why* of choices when they're not obvious. Bergen, Norway; Windows 11
main PC; iPad is the always-on display.
