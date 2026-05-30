# Project: "Command Deck" — personal weekly planner dashboard

## What I'm building

A self-hosted weekly planning dashboard inspired by the Structured app, to run on
a home server and be accessed from my phone, PC, and iPad (the iPad is the main
always-on display). I'm in Bergen, Norway.

## The dashboard has four core sections

1. TODAY — a Structured-style vertical timeline: time on the left, a connected
   dot-and-line spine, soft category-colored task blocks, tap to check off.
2. NEXT WORKOUT — small card showing my soonest upcoming training session + short note.
3. BERGEN WEATHER — 7-day outlook strip (high/low/precip %), fetched live from YR.no.
4. THIS WEEK — 7-day snapshot with per-day category dots and done/total count;
   tapping a day zooms the TODAY panel into that day.
5. MONTH AHEAD — short dated list for birthdays / invitations / key dates.

Categories: work, training, home, social — each with its own color.

## What already exists (v1)

I have a working single-file React component (Dashboard.jsx) built in a previous
Claude chat. It implements all five sections above with a polished look:

- Fonts: Fraunces (display) + Spline Sans (body)
- Warm paper palette (#f4efe9 bg, #c2724f terracotta accent), category color system
- Persists data to local browser storage (this won't carry to the new stack)
- Currently uses HARDCODED seed data for my schedule and a STATIC weather panel
  I'll paste this file into the project — please use it as the UI starting point.

## Key technical constraints we already discovered (don't re-learn these)

- YR.no / MET Norway locationforecast API CANNOT be called from the browser:
  CORS blocks custom User-Agent, and requests from localhost/local IPs risk being
  throttled or blacklisted. So weather MUST be fetched server-side, with a proper
  identifying User-Agent header, and cached (respect the Expires header).
- Google Calendar likewise can't be read directly from the browser.

## v2 goal — what I want to build now

Turn v1 into a real client/server app on my home server:

- BACKEND (I'm open to Python or Node — recommend one and explain why):
  * Fetches my Google Calendars via their SECRET iCal (.ics) URLs — read-only,
    no OAuth. Parses .ics into the task/event model the UI uses.
  * Fetches YR.no weather server-side (Bergen, lat/lon, compact endpoint) with a
    proper User-Agent, caches per the Expires header.
  * Serves merged data to the frontend over a small JSON API.
- FRONTEND: reuse the v1 React UI, swap hardcoded data for API calls.
- Runs on my home server; reachable from phone/PC/iPad on the LAN at http://`<ip>`:`<port>`.
- Because all devices read from one server, the data is effectively in sync.

## Decisions I want help thinking through

1. Read-only vs two-way: I lean toward READ-ONLY first (Google Calendar stays the
   source of truth, dashboard just displays it). Confirm this keeps it simple and
   avoids OAuth, and flag what I'd lose.
2. Where do dashboard-only tasks live? (Tasks I add in the dashboard that aren't in
   Google Calendar — local DB? a dedicated Google calendar? Suggest an approach.)
3. Recommended minimal stack + how to run it persistently on a home server.

## How I'd like to work

Start by proposing the project structure and the backend stack with reasoning,
then we build incrementally — backend data layer first (calendar + weather feeding
a JSON API I can curl), then wire the existing UI to it. Ask me for my .ics URLs
and home-server details (OS, what's already running) when you need them.
