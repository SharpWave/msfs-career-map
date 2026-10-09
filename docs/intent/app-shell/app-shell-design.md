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

**Serving.** One function, `createApp` ([app.ts](../../../src/server/app.ts)), builds what the server
serves, and building it starts nothing (no listening, no sim link, no data loading). Startup and the
API tests both use it.

- `/api` — the API, accepting JSON bodies up to 8 MB (icon uploads arrive as data URLs).
- `/images` — uploaded aircraft icons, cached by the browser for a year (each upload's address
  carries a new `?v=` stamp, so a replaced icon is fetched fresh).
- With a client build in `dist/`, the page itself, with every other path answered by `index.html`.
  Without one, `/` answers in plain text that the API is running and how to get the page
  (`npm run dev`, or build and restart).

## Data and Database

([locations.ts](../../../src/server/locations.ts), [db.ts:1-19](../../../src/server/db.ts#L1-L19))

| What | Where |
|---|---|
| Database | `CAREER_DB` when set, else `data/career.db` |
| Uploaded icons | `images/` in the database's folder |
| OurAirports lists | `airports.csv` and `runways.csv` in the database's folder |

The database uses write-ahead logging and enforces foreign keys. Every table is created if missing
at startup, and a column added in a later version is added to an existing table in place
(`addColumnIfMissing`), so an older database upgrades without losing anything.

`CAREER_DB` exists so a copy of the database can be tested against (for example with `sim-fake`), and
the test suites run on databases of their own. Everything the app keeps lives in the database's
folder (`data/` for the default database), so a copy elsewhere has its own icons and lists and never
reads or changes the real ones. A copy shows no uploaded icons unless its `images/` folder is copied
with it, and a reimport on a copy reads the lists beside it (downloading them when missing).

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
| `npm run dev` | Server on :3080 restarting on change, and the page on :5173 with `/api/` and `/images/` passed to the server on `PORT` (default 3080); the trailing slash keeps the page's own `/api.ts` module on the page server |
| `npm run build` | Builds the page into `dist/` |
| `npm start` | Runs the server, which serves the build |
| `npm run typecheck` | Checks the page and the server (with the scripts and tests) against their TypeScript settings |
| `npm test` | Runs the Vitest suites once (see Tests) |
| `npm run test:e2e` | Runs the Playwright browser tests (see Tests) |

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

## Tests

The approach is the HLD's: Vitest for the logic and for the API against a temporary database,
Testing Library component tests for the page, and a few Playwright browser tests for the main
flows. Every test runs against data made for it. No test opens the real logbook, changes anything
in its folder, or reaches a service on the internet.

**Layout.**

| Folder | Holds |
|---|---|
| `tests/<segment>/` | Vitest tests for that arrow segment: `*.test.ts` run in Node, `*.test.tsx` are component tests run in a simulated browser (jsdom) |
| `tests/e2e/` | Playwright browser tests (`*.spec.ts`) |
| `tests/fixtures/` | A small set of real OurAirports rows in the lists' own CSV format, and canned answers from outside services |
| `tests/support/` | The setup every Vitest file shares, the browser-test server's startup, and helpers that build aircraft, hops and sim samples |

Each test names the specs it verifies with an `@spec` comment. Vitest has its own config at the
project root, leaving the page's Vite config as it is. Tests are type-checked under their own
settings, which accept both the page's and the server's import styles.

**A data folder per test file.** A run makes one folder in the system's temp directory. For each
Node test file, the shared setup makes a folder inside it with a copy of the fixture lists and
points `CAREER_DB` at a new database there, so the file's icons and lists sit beside its database as
they do for any database (see Data and Database). The setup does this before any app module loads,
because `db.ts` opens the database, and upgrades its tables, the moment it is first imported. So the
setup and the Vitest config import nothing from `src/server` statically, and the setup checks that
`CAREER_DB` names this file's own folder before its first import of app code. It then loads the
fixture lists with the same step that fills a new logbook at startup. Each test file runs in a fresh
process, so no module or open database carries over from one file to the next.

Tests inside one file share their database and any module state that outlives a test, such as the
tracker or the METAR, hazard and terrain caches. A test that depends on such state builds its own
instance or gets its own file. The run's folder is deleted when the run ends. Leftovers that a
crashed run or a locked file left behind are deleted by a later run once they are a day old, so two
runs at the same time never delete each other's data.

**Fixture airports.** The fixture lists are real OurAirports rows for southern New England — towered
and untowered fields, grass strips, a seaplane base, a heliport and a closed airport, with runway
headings — and grow as tests need more. They are fixed, so a test's expected result does not change
when the user refreshes their own airport lists, and a fresh checkout runs the tests without
downloading anything.

**API tests** run the app built by the same function the server uses at startup (`createApp`: the
API with its JSON limit and error handlers, `/images`, and the page when built) on a free local
port, and call it over HTTP. Building the app starts nothing else: no listening, no sim link, no
reference-data step. Closing a test server first closes its open connections, such as the live
event stream, which would otherwise hold it open.

**Outside services.** The shared setup replaces `fetch` so that any request except to the test's
own server fails the test, unless the test has supplied the answer. Another local port is no
exception, since the user's own server may be running there. Tests of OurAirports downloads, METARs,
terrain, hazards, Wikipedia and SimBrief give their answers from fixtures, which also lets them
cover failures and odd shapes the live services rarely produce.

**Component tests** render one part of the page with Testing Library. They open no database: each
test supplies the answers to the page's `/api` calls and a stand-in for the live event stream.

**Browser tests.** `npm run test:e2e` starts two servers and stops them after the run:

1. The app server on port 3180, started by a script in `tests/support/`. The script makes a data
   folder for the run as the Vitest setup does, and refuses outside requests except those it answers
   from fixtures. Only then does it start the app as `npm start` would, with `TRACKER_FAKE=1` so
   the synthetic sim feed (`POST /api/tracker/sample`, the feed `sim-fake` uses) drives the tracker.
2. The page's dev server on port 5183, with `PORT=3180`, so it passes `/api` and `/images` to the
   test server.

Neither server falls back to another port. If one is taken, the run fails. Before any test, the run
checks that `/api/status`, asked through port 5183, reports the fixture lists' airport count. That
proves the page reaches the test server and not one holding real data.

The tests run one at a time, since they share one server and one tracker. Each starts by discarding
any live and pending leg, works with aircraft it creates under its own names, and asserts nothing
that depends on what earlier tests left. They run in Chromium. The page's own requests to the
internet (map tiles and outside links) are blocked, so the map draws without a basemap. A first run
needs `npx playwright install chromium`. The run's data folder is left for a later run to delete,
since the server may still hold it open when the run ends.

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
| Data beside the database | Icons and OurAirports lists in the database's folder | Fixed `data/` paths; a separate setting per path | One variable moves everything, so a copy or a test database never changes the real logbook's files; the default database keeps the `data/` layout. |
| Building the app | One function builds the Express app, used by startup and by the API tests | Tests assemble their own app from the router | API tests meet the same JSON limit, static paths and error handlers as the page, and importing the app starts nothing. |
| Test layout | `tests/<segment>/`, with `tests/e2e/`, `tests/fixtures/` and `tests/support/` | Beside the source (`tracker.test.ts` next to `tracker.ts`) | Groups tests the way the arrow groups specs, so a segment's tests are one folder; the source folders stay as they are. |
| Test databases | A data folder per test file, in a temp folder for the run | One shared test database; in-memory databases | Files cannot leak data into each other; a folder keeps a database's icons and lists beside it and can be opened after a failure; the browser-test server needs a file it can be started on. |
| Browser tests in sequence | One at a time against one server | Parallel workers with a server each | They share one tracker; the suite is a few flows, so one server keeps the run simple. |
| Reference data in tests | A fixed subset of real OurAirports rows | The full lists in `data/` | Expected results do not move when the lists are refreshed; a fresh checkout needs no download. |
| Outside services in tests | Refused unless the test supplies the answer; the browser-test server answers from fixtures | Call the live services | Tests pass offline and give the same result every run; failure cases can be tested; free services are not loaded by test runs. |
| Page in browser tests | The Vite dev server on its own port, passing the API to the test server | Build into `dist/` and let the test server serve it | Leaves the build the launcher serves alone and skips a build per run. |
| Browser-test ports | Fixed (3180 and 5183), failing when taken | Any free port; reuse a server already running | The runner waits on a known address; refusing a taken port means a test can never reach a server holding real data. |
| Browser | Chromium as installed by Playwright | The installed Edge | The browser's version moves with Playwright's, not with Windows updates. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Version in five places** — "0.8.0" hard-coded in `/api/status` and "0.6" in four User-Agents.
2. **Hint style scoped to the airport input** ([styles.css:307-320](../../../src/client/styles.css#L307-L320)).
3. **Stale build after an update** — the launcher builds only when no build exists and reuses a
   running server whatever its version.
4. **Two duration styles** — the page's "1h 05m" and the tracker's "1 h 05 min".
5. **The README restates behaviour** — its API table and tracking rules will drift as gaps close
   (it already says closing the sim mid-flight drops the leg, which LIVE-LEG-008 changes).

## References

- Code: [src/server/index.ts](../../../src/server/index.ts), [src/server/app.ts](../../../src/server/app.ts)
  (`createApp`), [src/server/locations.ts](../../../src/server/locations.ts) (data locations),
  [src/server/db.ts](../../../src/server/db.ts) (pragmas, `addColumnIfMissing`), [src/server/routes.ts](../../../src/server/routes.ts)
  (helpers 28-62, `/status` 813-815, error handlers 818-828), [src/client/api.ts](../../../src/client/api.ts)
  (`req`), [src/client/App.tsx](../../../src/client/App.tsx) (layout, sidebar toggle, loading, error
  banner), [src/client/components/Sidebar.tsx](../../../src/client/components/Sidebar.tsx) (header,
  card order), [src/client/components/ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx),
  [src/client/format.ts](../../../src/client/format.ts) (shared formatters), [src/client/styles.css](../../../src/client/styles.css)
  (theme, layout), [src/client/index.html](../../../src/client/index.html), [src/client/main.tsx](../../../src/client/main.tsx),
  [package.json](../../../package.json), [vite.config.ts](../../../vite.config.ts), `tsconfig*.json`,
  [start.cmd](../../../start.cmd), [scripts/install-shortcut.ps1](../../../scripts/install-shortcut.ps1),
  [scripts/make-ico.mjs](../../../scripts/make-ico.mjs), [README.md](../../../README.md)
- Tests: [vitest.config.ts](../../../vitest.config.ts), [playwright.config.ts](../../../playwright.config.ts),
  [tsconfig.test.json](../../../tsconfig.test.json), [tests/support/](../../../tests/support/) (shared setup,
  fetch guard, data folders, test servers), [tests/fixtures/](../../../tests/fixtures/),
  [tests/app-shell/](../../../tests/app-shell/), [tests/e2e/](../../../tests/e2e/)
