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
- the page: the full-window map with panels floating over it, the sidebar, the menu and its
  drawers, which part of the map the panels cover, loading and error states, error boundaries
  ([App.tsx](../../../src/client/App.tsx), [layout.ts](../../../src/client/layout.ts),
  [Sidebar.tsx](../../../src/client/components/Sidebar.tsx),
  [Menu.tsx](../../../src/client/components/Menu.tsx), [Drawer.tsx](../../../src/client/components/Drawer.tsx),
  [ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx), [index.html](../../../src/client/index.html));
- the look: glass panels, colors, typefaces, icons, focus and motion
  ([styles.css](../../../src/client/styles.css), [Icon.tsx](../../../src/client/components/Icon.tsx),
  [main.tsx](../../../src/client/main.tsx));
- shared formatting of durations, distances, heights, dates and aircraft names ([format.ts](../../../src/client/format.ts));
- npm scripts, the Windows launcher, the desktop shortcut and the icon tool
  ([package.json](../../../package.json), [start.cmd](../../../start.cmd), [scripts/](../../../scripts/)).

The cards, layers and endpoints themselves belong to their segments: the live card and tracker
(live-tracking), the hop form and hop lists (logbook), the planner card (planner), the fleet list
(fleet), the map, its toolbar and the Layers menu (tour-map), the flight panel (flight-panel). The
shell decides where they sit and how they look.

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

**Layout** ([App.tsx](../../../src/client/App.tsx)). The map fills the window, and everything else
floats over it, so the map stays the main view and shows around and through the panels:

| Where | What |
|---|---|
| Top left | The **menu button** — the app's airplane mark and "Career Map" — with the **sidebar toggle** beside it |
| Left, under the top bar | The **left column**: the **sidebar** (**Live from the sim** above **Plan next hop**), or the open **drawer** in its place |
| Top right | The map toolbar (tour-map): **Layers**, the hazard count while any hazard toggle is on, **Fit all**, and **Clear highlight** / **Clear plan** while they apply |
| Bottom | The flight panel (flight-panel) while a flight is open, from the left column's right edge — the window's edge when the column is hidden — to the right edge, 40% of the window's height and at least 260 px |

The top bar is the row holding the menu button and the toolbar. Panels keep a 12 px gutter from the
window's edges and from each other. The layout is designed for windows from 800 × 600 px up.

**The sidebar** ([Sidebar.tsx](../../../src/client/components/Sidebar.tsx)) holds what a session uses
again and again: what the sim is doing, then where to go next, both in view at once. It is 400 px
wide (340 px in a window narrower than 960 px) and runs from under the top bar to the bottom of the
window.

Each card collapses to its header and opens again. Collapsing hides a card's body without
discarding it, so typed values, a SimBrief preview or a half-filled pending leg are still there when
it opens. The page remembers in the browser whether each card was left open or collapsed; on a
first visit both are open.

The live card takes the height it needs, up to half the sidebar, and scrolls inside beyond
that; the planner card takes the rest and scrolls inside, its candidate list included, so there is
never a scroller inside a scroller. When the sidebar is too short to give the planner card 240 px,
the whole sidebar scrolls instead. The gaps between the cards and the space below them let clicks
through to the map.

**Menu and drawers** ([Menu.tsx](../../../src/client/components/Menu.tsx),
[Drawer.tsx](../../../src/client/components/Drawer.tsx)). What a session needs only now and then sits
behind the menu button. The menu shows the count line — "N aircraft · N hops · N airports · N
runways" — and two entries, **Log a hop** and **Fleet**. The menu button and the sidebar toggle
show from the start; until the map state has loaded, the menu leaves out the count line and its
entries are disabled.

- The menu closes when an entry is chosen, when its button is clicked again, on Esc, and when the
  pointer goes down anywhere outside it — that click still does whatever it lands on. The menu and
  the Layers menu close each other.
- Choosing an entry opens it as a **drawer**: a panel headed by its title and a close button,
  shown in the left column instead of the sidebar. A drawer has the sidebar's width, so the left
  column keeps one right edge and the flight panel beside it never shifts. It is as tall as what
  it holds, up to the column's full height, and scrolls inside beyond that, so a short form does
  not hide a column of map.
- One drawer is open at a time; choosing the other replaces it, and choosing the open one leaves it
  open. Closing the drawer shows the sidebar again.
- Opening a drawer moves the keyboard focus into it — to the field a hand-off fills, else to its
  close button. Closing it returns the focus to the control that opened it.
- The drawer stays open after a hop is logged or an aircraft saved from it, so the form's own
  confirmation shows and the next one can follow.

**The left column** shows the open drawer, else the sidebar, unless it is hidden. The sidebar toggle
hides and shows the column, whichever it shows; hiding it closes an open drawer. Opening a drawer,
from the menu or a hand-off, shows the column. Whether the column is hidden is not remembered
between visits.

**Hand-offs.** Other parts of the page open a drawer when they hand work to it:

| From | Opens | At |
|---|---|---|
| The planner's **Use** on a candidate (LOG-FORM-004) | Log a hop | The hop form, with the planned aircraft, its parked airport and the picked destination |
| The live card's **+ New** (FLEET-SIM-003) | Fleet | A new-aircraft form prefilled from the sim aircraft |
| The planner's **Edit aircraft** (PLAN-FORM-003) | Fleet | That aircraft's edit form |

The drawer scrolls to its own form once it is showing. A hand-off wins over what the drawer held:
**Use** replaces the aircraft, From and To of a half-filled hop and keeps its times and notes;
**+ New** and **Edit aircraft** replace an open aircraft form. Highlighting an aircraft switches the
Log a hop form to it whether or not the drawer is showing (LOG-FORM-003).

**Kept while hidden.** The sidebar mounts with the page and each drawer the first time it opens;
after that, all of them stay mounted while hidden. A half-filled hop, an expanded aircraft card, a
planner form or the live card's SimBrief preview is as the user left it when its panel shows again
(unless a hand-off has changed it). A hidden panel is inert: out of the tab order, not read out,
and none of its fields can take the focus.

**The covered part of the map.** The panels hide part of the map, so the page works out which part
is clear: right of the left column (or of the window's edge gutter when the column is hidden),
below the top bar, and above the flight panel. It works this out from which panels are open and
their set sizes, at the moment of each zoom — so a hop opened together with the flight panel is
fitted above the panel that opens with it.

- Every zoom keeps to the clear part (MAP-ZOOM-007): fitting points, flying to a single point, the
  live card's **Zoom** and the `?view=` option all centre in it, and fitting keeps its 60 px padding
  inside it. When the clear part is smaller than 240 × 160 px, a zoom uses the whole window.
- Map popups pan the map to open inside the clear part.
- The map's attribution sits just above the flight panel.
- Opening or closing a panel never moves the map; it only changes where the next zoom lands.

**Stacking**, from the bottom: the map with its popups and tooltips; the "Nothing on the map yet"
card; the left column and the flight panel; the top bar; the menu and the Layers menu; the toast;
the error banner. The toast, the error banner and the empty-map card are centred across the clear
part, the toast and banner just above the flight panel while it is open.

**Loading and errors.** Until the map state loads, the window reads "Loading…". If it fails, a
banner reads "Server error: message" with **Retry**. A part of the page that fails to render — the
live card, the flight panel, the planned routes, the live aircraft — shows "<part> failed: message"
with **Retry** in its place, and the rest of the page keeps working. A failed flight panel keeps its
place and its close button; a failed map layer (planned routes, live aircraft) shows its message
as a notice at the top of the clear part.

**Page title and icon**: "MSFS Career Map", with an orange airplane icon.

## The Look

A glass cockpit at night: dark, translucent instrument panels over a moving map, with one warm
accent. The map is the picture; the panels are the instruments laid over it.

**Glass panels.** Every panel over the map — the menu button, sidebar cards, drawers, toolbar,
menus, flight panel, map popups and tooltips, toast and banner — is frosted glass: a dark tint over
a blur of the map behind it, a hairline light edge and a soft shadow. The tint is set so text keeps
its contrast on any basemap: thicker in the drawers, whose forms are dense, and thicker on every
panel while the Light basemap is shown, since a light tint over white tiles turns grey. Fields
inside a panel are a shade darker than the panel. Nothing inside a panel is glass again: what pops
up within one — airport suggestions, the profile chart's readout — is solid.

The page shares the GPU with the sim, and the panels are recomposited on every pan, zoom and live
redraw, so the blur is capped at 12 px. While the browser asks for reduced transparency, the panels
are solid: the same tint, fully opaque, with no blur.

**Colors**, defined once as variables in `:root` ([styles.css](../../../src/client/styles.css)):

| Role | Value | Used for |
|---|---|---|
| Accent | `#ff6b35` orange | The app mark, primary buttons, the chosen option in a group, focus rings |
| Text | `#e8edf2` | Body text |
| Muted | `#93a1b3` | Labels and secondary lines |
| Ok | `#3bceac` green | Connected, on the ground, a logged hop |
| Caution | `#fbbf24` amber | Paused, in menus, a leg waiting to be logged |
| Airborne | `#7cc4ff` blue | Airborne, landed, live |
| Danger | `#ff5c5c` red | Errors and destructive actions |

Status colors follow the cockpit convention — green normal, amber caution, red warning — and the
accent never stands for a status. Each aircraft's own color (fleet) and the flight-category and
hazard colors (planner, tour-map) are data, not theme.

**Type.** B612, the typeface Airbus drew for cockpit displays, sets the interface; B612 Mono sets
airport codes, times and numeric readouts, so figures line up. Both are packaged with the app
(`@fontsource/b612`, `@fontsource/b612-mono`), so the page loads no font from the internet. Body
text is 13 px; secondary lines 11.5 px; card and drawer titles 13 px bold in sentence case; the
"Career Map" wordmark 15 px bold.

**Icons** ([Icon.tsx](../../../src/client/components/Icon.tsx)). One set of line icons, drawn as
inline SVG in the text color at 16 px: menu, close, sidebar toggle, layers, fit, chevrons, eye and
eye-off, pencil, trash can, link, arrow up and down, moon. Every button that shows only an icon has an
accessible name, the same words as its tooltip. Arrows inside text ("KBOS → KPVD") are content and
stay text; the landing-rating icons belong to flight-panel.

**Shape.** Panels have 14 px corners, fields and buttons 8 px, pills and chips are fully round.

**Hints and warnings** under form fields share one style wherever they appear — muted for a hint,
red for a warning — including the planner's cruise-altitude warning.

**Focus and motion.** Any control reached by keyboard shows an accent focus ring. A drawer slides in
from the left; the menu and the Layers menu fade in; the toast rises. While the browser asks for
reduced motion, nothing on the page animates: the live marker does not pulse, and the map jumps to
a zoom's view instead of flying there (MAP-ZOOM-007).

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
| Page layout | The map fills the window; panels float over it | A sidebar docked beside a smaller map; an icon rail opening one panel at a time | The map is the main view and stays whole behind the panels. A rail would keep the live card and the planner from being open together, which a session between flights wants. |
| What the sidebar holds | Live from the sim above Plan next hop; Log a hop and Fleet behind the menu | Every card in one scrolling sidebar; Fleet first | The sim logs flights and the fleet changes rarely, so the hand-logging form and the fleet list are occasional; keeping them in the sidebar pushed the planner below the fold and the fleet to the bottom. |
| Where a drawer opens | Over the sidebar, in its place | From the right edge; a modal dialog | It opens where the menu is, and the map stays visible beside it — the fleet list highlights aircraft and opens hops on the map, which a modal would hide. |
| Hidden panels and collapsed cards | Stay mounted, hidden | Unmount when closed or collapsed | A half-typed hop, a pending leg being filled in, an expanded aircraft card or a planner form survives switching panels or collapsing a card. |
| Card open or collapsed | Remembered in the browser per card; open on a first visit | Always open on load; always collapsed | The live card's status strip lets a pilot keep it small for good, and reopening it on every load would undo that. |
| Column width | One width for the sidebar and the drawers, 400 px | A slimmer sidebar and wider drawers | With one width the flight panel's left edge and the clear part of the map stay put when a drawer opens or closes; 400 px fits the hop form's two date-time fields side by side. |
| Panels over the map | The map keeps its full size; zooms fit into the part the panels leave clear | Shrink the map to the uncovered area | The glass needs the map behind it, and a map that resized whenever a panel opened would jump under the user. |
| Working out the clear part | From which panels are open and their set sizes, at zoom time | Measuring the panels' boxes after layout | Opening a hop opens the flight panel and asks for the zoom in one update; a measurement taken then would miss the panel that is opening and fit the hop under it. |
| Left column | One column showing the open drawer, else the sidebar; the toggle hides whichever it shows | A drawer layered over a visible sidebar; separate toggles | Glass over glass would blur the sidebar's cards through the drawer, and one column gives the clear part one left edge. |
| Glass tint | Thicker in drawers and over the Light basemap | One tint everywhere | Text has to stay legible over white tiles and in dense forms; the dark and satellite basemaps allow a lighter tint. |
| Blur | Capped at 12 px; none while reduced transparency is asked for | A stronger blur; blur always | The page shares the GPU with the sim, and the panels are recomposited on every pan and live redraw. |
| Typeface | B612 and B612 Mono, packaged with the app | The system font; Barlow with B612 Mono; fonts from a font service | Drawn for legibility on cockpit displays, which suits a flight-sim instrument panel; packaging them keeps the app keyless, local and working offline and in tests. |
| Icons | One inline SVG set | Emoji and unicode glyphs; an icon library | Glyphs render differently by font and platform and mix styles; a dozen icons do not need a dependency. |
| Keyboard | Esc closes the menu and the Layers menu; no shortcuts that open panels | Single-key shortcuts for each panel; Esc closing drawers and the flight panel | Esc on an open menu is what menus do. Single-key shortcuts would have to be kept out of every field where airport codes are typed, and the panels close with their own buttons. |
| Contained failures | Error boundaries around the live card, flight panel and planned routes | One for the whole page | A bad record or plan should not blank the map. |
| Theme | Dark only | Light and dark | Map-first and used beside a sim, often at night; the dark basemap is the default, and the glass panels are tuned dark over every basemap. |
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
2. **Stale build after an update** — the launcher builds only when no build exists and reuses a
   running server whatever its version.
3. **Two duration styles** — the page's "1h 05m" and the tracker's "1 h 05 min".
4. **The README restates behaviour** — its API table and tracking rules will drift as gaps close
   (it already says closing the sim mid-flight drops the leg, which LIVE-LEG-008 changes).

## References

- Code: [src/server/index.ts](../../../src/server/index.ts), [src/server/app.ts](../../../src/server/app.ts)
  (`createApp`), [src/server/locations.ts](../../../src/server/locations.ts) (data locations),
  [src/server/db.ts](../../../src/server/db.ts) (pragmas, `addColumnIfMissing`), [src/server/routes.ts](../../../src/server/routes.ts)
  (helpers 28-62, `/status` 813-815, error handlers 818-828), [src/client/api.ts](../../../src/client/api.ts)
  (`req`), [src/client/App.tsx](../../../src/client/App.tsx) (layout, hand-offs to the drawers
  (`openDrawer`), loading, error banner), [src/client/layout.ts](../../../src/client/layout.ts) (panel
  sizes, covered part of the map (`clearInsets`), the left column's reducer),
  [src/client/prefs.ts](../../../src/client/prefs.ts) (`readPref`, `writePref`, `prefersReducedMotion`),
  [src/client/components/Sidebar.tsx](../../../src/client/components/Sidebar.tsx) (the
  sidebar's cards), [src/client/components/Menu.tsx](../../../src/client/components/Menu.tsx) (menu
  button, count line, sidebar toggle), [src/client/components/Drawer.tsx](../../../src/client/components/Drawer.tsx)
  (`LeftColumn` and the drawers), [src/client/components/useDismiss.ts](../../../src/client/components/useDismiss.ts)
  (closing the menus), [src/client/components/Icon.tsx](../../../src/client/components/Icon.tsx) (icon set,
  `IconButton`), [src/client/components/MapView.tsx](../../../src/client/components/MapView.tsx)
  (`PopupPadding`), [src/client/components/ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx),
  [src/client/format.ts](../../../src/client/format.ts) (shared formatters), [src/client/styles.css](../../../src/client/styles.css)
  (the look, layout), [src/client/index.html](../../../src/client/index.html), [src/client/main.tsx](../../../src/client/main.tsx) (font imports),
  [package.json](../../../package.json), [vite.config.ts](../../../vite.config.ts), `tsconfig*.json`,
  [start.cmd](../../../start.cmd), [scripts/install-shortcut.ps1](../../../scripts/install-shortcut.ps1),
  [scripts/make-ico.mjs](../../../scripts/make-ico.mjs), [README.md](../../../README.md)
- Tests: [vitest.config.ts](../../../vitest.config.ts), [playwright.config.ts](../../../playwright.config.ts),
  [tsconfig.test.json](../../../tsconfig.test.json), [tests/support/](../../../tests/support/) (shared setup,
  fetch guard, data folders, test servers), [tests/fixtures/](../../../tests/fixtures/),
  [tests/app-shell/](../../../tests/app-shell/), [tests/e2e/](../../../tests/e2e/)
