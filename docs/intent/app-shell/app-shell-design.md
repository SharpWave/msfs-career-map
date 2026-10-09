---
parent: high-level-design
prefix: APP
---

# App Shell

## Context and Design Philosophy

The app is a local, single-user tool: one Node process on the user's own PC serves the API and the
web page, keeps everything in one SQLite file, and talks to the sim on the same machine. There is
no account, no cloud service of its own and no install beyond Node. The shell is what holds that
together — starting the server, where data lives, how the API reports errors, the page layout the
segments' cards and layers sit in, shared formatting, and the scripts that run, build and launch
the app.

This segment owns:

- server startup and static serving ([index.ts](../../../src/server/index.ts));
- data locations, opening the database and in-place schema upgrades ([db.ts](../../../src/server/db.ts));
  each table's meaning belongs to the segment that uses it;
- API conventions: error responses, ids, the status endpoint, the browser's request helper
  ([routes.ts:28-62](../../../src/server/routes.ts#L28-L62), [818-828](../../../src/server/routes.ts#L818-L828),
  [api.ts](../../../src/client/api.ts));
- the page: sidebar and map area, card order, loading and error states, error boundaries, theme
  ([App.tsx](../../../src/client/App.tsx), [Sidebar.tsx](../../../src/client/components/Sidebar.tsx),
  [ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx), [styles.css](../../../src/client/styles.css),
  [index.html](../../../src/client/index.html));
- shared formatting of durations, distances, heights, dates and aircraft names ([format.ts](../../../src/client/format.ts));
- npm scripts, the Windows launcher, the desktop shortcut and the icon tool
  ([package.json](../../../package.json), [start.cmd](../../../start.cmd), [scripts/](../../../scripts/)).

The cards, layers and endpoints themselves belong to their segments: the live card and tracker
(live-tracking), the hop form and hop lists (logbook), the planner card (planner), the fleet list
(fleet), the map and its toolbar controls (tour-map), the flight panel (flight-panel).

## Server

**Startup** ([index.ts:46-72](../../../src/server/index.ts#L46-L72)): make sure the airport and runway
tables are filled (airports), start live tracking unless disabled or faked (live-tracking), then
listen on `PORT` (default 3080), logging the address and the database in use.

**Serving.**

- `/api` — the API, accepting JSON bodies up to 8 MB (icon uploads arrive as data URLs).
- `/images` — uploaded aircraft icons, cached by the browser for a year (each upload's address
  carries a new `?v=` stamp, so a replaced icon is fetched fresh).
- With a client build in `dist/`, the page itself, with every other path answered by `index.html`.
  Without one, `/` answers in plain text that the API is running and how to get the page
  (`npm run dev`, or build and restart).

## Data and Database

([db.ts:1-19](../../../src/server/db.ts#L1-L19))

| What | Where |
|---|---|
| Database | `CAREER_DB` when set, else `data/career.db` |
| Uploaded icons | `data/images/` |
| OurAirports lists | `data/airports.csv`, `data/runways.csv` |

The database uses write-ahead logging and enforces foreign keys. Every table is created if missing
at startup, and a column added in a later version is added to an existing table in place
(`addColumnIfMissing`), so an older database upgrades without losing anything.

`CAREER_DB` exists so a copy of the database can be tested against (for example with `sim-fake`).
Uploaded icons are meant to live beside whichever database is in use, so a test copy cannot touch
the real one's icons. Today they always go to `data/images/`, and since a copy has the same aircraft
ids, uploading an icon while testing overwrites the real aircraft's icon
([db.ts:9](../../../src/server/db.ts#L9)).

## API Conventions

- **Errors**: a known failure answers with its status and `{"error": "message"}`; anything else is
  logged and answered `500` with its message. An unknown `/api` path is `404 {"error": "not found"}`.
  A path id that is not a positive whole number is `400 "invalid id"`.
- **Status**: `GET /api/status` returns `ok`, the airport and runway counts and the app version; the
  launcher uses it to tell whether the server is up.
- **Version**: one version for the app, from `package.json`, is meant to be reported by `/api/status`
  and sent in the User-Agent of every request the server makes to an outside service —
  `MSFSCareerMap/<version> (personal flight-sim logbook; local use)` — OurAirports,
  aviationweather.gov, Wikipedia, Open-Meteo and SimBrief. Today `/api/status` hard-codes "0.8.0",
  four User-Agents say "0.6", and the OurAirports downloads and SimBrief plan fetch send none
  ([routes.ts:813-815](../../../src/server/routes.ts#L813-L815), [airports.ts:306](../../../src/server/airports.ts#L306),
  [hazards.ts:7](../../../src/server/hazards.ts#L7), [terrain.ts:7](../../../src/server/terrain.ts#L7),
  [simbrief.ts:5](../../../src/server/simbrief.ts#L5)).
- **Browser helper** ([api.ts:20-30](../../../src/client/api.ts#L20-L30)): JSON in and out; `204` is
  no content; a failed call raises the server's `error` message, or the status and its text.

## The Page

**Layout** ([App.tsx:315-450](../../../src/client/App.tsx#L315-L450)): the sidebar on the left and the
map area on the right, with the flight panel across the bottom of the map area when open. The map
toolbar's **◀ / ▶** hides and shows the sidebar.

**Sidebar** ([Sidebar.tsx:60-170](../../../src/client/components/Sidebar.tsx#L60-L170)): the title
"Career Map" with the app's airplane mark and a count line — "N aircraft · N hops · N airports · N
runways" — then, in order, **Live from the sim**, **Log a hop**, **Plan next hop** and **Fleet**. The
order follows a session: see what the sim is doing, log what was flown, plan what is next, manage
the aircraft.

**Loading and errors.** Until the map state loads, the map area reads "Loading…". If it fails, a
banner reads "Server error: message" with **Retry**. A part of the page that fails to render — the
live card, the flight panel, the planned routes — shows "<part> failed: message" with **Retry** in
its place, and the rest of the page keeps working.

**Theme.** One dark theme, its colors defined once as variables. Hints and warnings under form
fields are meant to look the same everywhere; today the hint style only applies inside the airport
input, so the planner's cruise-altitude warning shows unstyled
([styles.css:307-320](../../../src/client/styles.css#L307-L320), [Planner.tsx:200](../../../src/client/components/Planner.tsx#L200)).

**Page title and icon**: "MSFS Career Map", with an orange airplane icon.

## Shared Formatting

([format.ts](../../../src/client/format.ts))

| Value | Written as |
|---|---|
| Duration | "45m" under an hour, "1h 05m" from an hour |
| Distance | "1,234 nm", rounded |
| Height | "6,500 ft", rounded |
| Date and time | The browser's locale and time zone: month, day, year, hour and minute; short form without the year |
| Aircraft | "Name · Livery", or "Name" without a livery |

Hop-time conversions and the derived hop duration are logbook's; airport labels and runway summaries
are airports'. The tracker's own messages write durations as "1 h 05 min".

## Running and Launching

| Command | Does |
|---|---|
| `npm run dev` | Server on :3080 restarting on change, and the page on :5173 with `/api` and `/images` passed to the server |
| `npm run build` | Builds the page into `dist/` |
| `npm start` | Runs the server, which serves the build |
| `npm run typecheck` | Checks the page and the server (with the scripts) against their TypeScript settings |

Node 22.13 or later is required, for its built-in SQLite.

**Launcher** ([start.cmd](../../../start.cmd)), for double-clicking:

1. Stop with a message if Node is not installed.
2. Install dependencies if they are missing. Build if there is no build, or if any page source or
   build setting is newer than the build — so updating the code needs no manual rebuild.
3. If a server already answers `/api/status`: when it reports the same version as the code, open
   the browser on it and exit; when it reports another version, say that an older server is still
   running and that its window must be closed first, and exit without opening the browser. (That
   server belongs to another launcher window, which the launcher does not close for the user.)
4. Otherwise start the server in the window, wait up to 60 s for `/api/status`, and open the
   browser (skipped with `CAREER_NO_BROWSER=1`). The window stays open as the server's console;
   closing it stops the server.

Today the launcher builds only when there is no build at all, so after updating the code the user
must rebuild by hand, and a server still running the old version is reused.

**Desktop shortcut** — `powershell -File scripts\install-shortcut.ps1` creates or refreshes "MSFS
Career Map" on the desktop, running the launcher minimised with the app icon. **Icon tool** —
`node scripts/make-ico.mjs out.ico a.png …` packs PNGs into one `.ico`.

**Tests** (the approach is the HLD's). `npm test` runs the Vitest suites — logic, the API against a
temporary database, and component tests — and `npm run test:e2e` runs the Playwright browser tests
against a server on a temporary database fed by the synthetic sim feed. Neither ever opens the real
logbook. Today there is no test suite and neither command exists.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Shape of the app | One local Node server serving API and page, one SQLite file | Desktop app (Electron); hosted service | Nothing to host or sign into; the sim link needs a process on the same PC anyway; the browser is the UI. |
| Database | Node's built-in `node:sqlite` | better-sqlite3; a server database | No native modules to compile on Windows; one file to back up or copy. |
| Running TypeScript | `tsx` at runtime, no server build step | Compile the server to JS | One less build; the server starts straight from source. |
| Schema changes | Create-if-missing plus additive column upgrades in place | Versioned migration files | Older databases keep working with no migration step; changes so far have all been additive. |
| Error shape | `{"error": message}` with a meaningful status | Error codes; HTML errors | The page shows the message as is. |
| Card order | Live, Log a hop, Plan, Fleet | Fleet first | Follows a session from the sim to the next plan. |
| Contained failures | Error boundaries around the live card, flight panel and planned routes | One for the whole page | A bad record or plan should not blank the map. |
| Theme | Dark only | Light and dark | [inferred] Map-first and used beside a sim, often at night; the dark basemap is the default. |
| Launcher | A `.cmd` that installs, builds, starts and opens the browser | Manual commands; an installer | Double-click start on Windows for a hobby tool. |
| Launcher after an update | Rebuild a stale build; refuse to reuse a server of another version, telling the user to close it | Rebuild by hand; stop the old server automatically | Updating should need no extra steps, and a page from one version against a server from another misbehaves. Stopping a process another window owns is left to the user. |
| Images beside the database | A test copy gets its own image folder | One shared folder | A copy made for testing must not change the real logbook in any way. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Images ignore `CAREER_DB`** — a test copy writes over the real aircraft's icons ([db.ts:9](../../../src/server/db.ts#L9)).
2. **Version in five places** — "0.8.0" hard-coded in `/api/status` and "0.6" in four User-Agents.
3. **Hint style scoped to the airport input** ([styles.css:307-320](../../../src/client/styles.css#L307-L320)).
4. **Stale build after an update** — the launcher builds only when no build exists and reuses a
   running server whatever its version.
5. **No test suite** — no runner, no `npm test` or `npm run test:e2e`.
6. **Two duration styles** — the page's "1h 05m" and the tracker's "1 h 05 min".
7. **The README restates behaviour** — its API table and tracking rules will drift as gaps close
   (it already says closing the sim mid-flight drops the leg, which LIVE-LEG-008 changes).

## References

- Code: [src/server/index.ts](../../../src/server/index.ts), [src/server/db.ts](../../../src/server/db.ts)
  (paths, pragmas, `addColumnIfMissing`), [src/server/routes.ts](../../../src/server/routes.ts)
  (helpers 28-62, `/status` 813-815, error handlers 818-828), [src/client/api.ts](../../../src/client/api.ts)
  (`req`), [src/client/App.tsx](../../../src/client/App.tsx) (layout, sidebar toggle, loading, error
  banner), [src/client/components/Sidebar.tsx](../../../src/client/components/Sidebar.tsx) (header,
  card order), [src/client/components/ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx),
  [src/client/format.ts](../../../src/client/format.ts) (shared formatters), [src/client/styles.css](../../../src/client/styles.css)
  (theme, layout), [src/client/index.html](../../../src/client/index.html), [src/client/main.tsx](../../../src/client/main.tsx),
  [package.json](../../../package.json), [vite.config.ts](../../../vite.config.ts), `tsconfig*.json`,
  [start.cmd](../../../start.cmd), [scripts/install-shortcut.ps1](../../../scripts/install-shortcut.ps1),
  [scripts/make-ico.mjs](../../../scripts/make-ico.mjs), [README.md](../../../README.md)
