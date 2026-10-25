# Arrow: app-shell

What holds the server and the page together, installed and run from source: the server's inputs,
start order, `/api/status`, the private channel, shutdown, exits and errors; the data folder, the
database and its upgrades, the logbook's id, one server per data folder, backups and bringing in a
logbook; API conventions and the request checks that keep other sites' pages out; the page layout,
its starting state, hand-off fragment and failure handling; shared formatting; the development
scripts; the test harness behind `npm test` and `npm run test:e2e`; and the README and CLAUDE.md.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield LLD with partly inferred
rationale, cascaded from the desktop app's HLD, the desktop design and its shell, start-lists and
distribution LLDs, and the desktop edge audit. What the README and CLAUDE.md cover is a
documentation obligation listed in the LLD and checked before each release, not a spec.

Built and tested — the server process, in both its forms (`bundled.ts` for the desktop app,
`index.ts` for a copy run from source, both through `runServer` in `server.ts`):
- its inputs: the bundled server's start-up arguments, each required and none read from the
  environment, and a copy run from source's defaults from `CAREER_DB`, `PORT`, `TRACKER_FAKE` and
  the repository, every file found through them (APP-SRV-006, 007; APP-DATA-001);
- listening first, on 127.0.0.1 alone, with the start-up stand-in answering `/api/status`, the page
  and the icons and 503 for the rest of the API until the start-up work is done; then the data
  folder's lock, the database, the tracker restored with the fresh-run input, airport preparation
  and, last, tracking (APP-SRV-003, 005, 009, 011; APP-DATA-007, 008);
- `/api/status` from memory, with the version from `package.json`, the process id, the data folder,
  the sim mode, the start-up step, the airport-data report, `ready` and the counts;
- the request checks on `Host`, `Sec-Fetch-Site` and `Origin`, in front of the stand-in and the app
  (APP-API-011, 012);
- the exits: 10 and 11 for a port, 1 with the reason as the last line for an input, data folder,
  database or held lock, 1 at once for an error outside the request handlers, no log file
  (APP-SRV-013, 020, 021);
- the private channel's `save` and `shutdown`, and the shutdown order within 5 s, also run by a copy
  run from source's stop signals with casual mode left as it is (APP-SRV-018, 019);
- the development scripts and harness: `npm run dev` with no `--sim`, `npm run dev:sim`, Node 22.16,
  `/data/` kept out of git, the browser tests on 127.0.0.1 with the fake feed, downloads off and a
  wait for `ready`, and every test server or process kept off the pilot's folders, ports and sim
  (APP-RUN-001, 004, 012, 017, 019 to 021).

Not built yet: the start-up worker that opens the logbook off the event loop; the logbook's id,
schema-upgrade detection in one transaction, backups and bringing in a logbook, with their steps in
the start-up and shutdown orders, the `backup` request and exit 12; airport preparation in detail
(seeding, progress, a daily check and the monthly refresh's check); the User-Agent; and the page's
starting state, airport-data notice, hand-off fragment, **Back up now**, **Bring in a logbook** and
reloads (APP-UI-030 to 042). The specs that span both keep `[ ]` until their remaining part lands
(Spec Coverage).

Each server's sim mode is live-tracking's (LIVE-LINK-012, 013), and the live card's part of the
`#pending=` hand-off is too (LIVE-CARD-015); app-shell's specs cite them rather than restate them
(APP-SRV-006, 007, 023; APP-RUN-001, 019; APP-UI-033). The console launcher and desktop-shortcut
script are retired, their five APP-RUN specs deleted and their IDs never reused; `start.cmd` stays as
the pilot's launcher until the installed app exists — it starts a copy run from source with
`--sim=link` and waits for the start-up to be done — and `scripts/install-shortcut.ps1` remains until
both are removed. The server's own shutdown when its private channel to the desktop shell closes is
retired, its spec deleted and its ID never reused: Electron 45 gives the server no way to see the
desktop shell end, so a shell that crashes or is ended takes the server with it, and the write-ahead
log, the tracker's checkpoint, the next run's fresh-run input and the stale lock's takeover keep the
logbook and the leg (the LLD's Shutting Down and Decisions & Alternatives).

The program folder's layout (APP-SRV-006; the LLD's The Program Folder) is an interface with desktop
distribution, which packages the page build as `page/` beside the seed lists, outside the app archive.

## References

### HLD
- docs/high-level-design.md (Approach, Target Users, System Design → the server, 127.0.0.1, the data
  folder and backups, development beside an installed copy, one sim link per PC; Segments → app-shell;
  Key Design Decisions → Where the logbook lives, Which copy logs flights, Testing)

### LLD
- docs/intent/app-shell/app-shell-design.md

### EARS
- docs/intent/app-shell/app-shell-specs.md (120 specs)

### Tests
- tests/app-shell/inputs.test.ts — APP-SRV-006, 007, 008, 023; APP-DATA-001; APP-API-005; LIVE-LINK-012, 013 (`readInputs` in both forms, `currentInputs`, the version; APP-SRV-008 and 023 as far as the page, database, icons and lists and the test servers' inputs; APP-API-005 without the User-Agent)
- tests/app-shell/server-start.test.ts — APP-SRV-001, 003, 005, 006, 007, 009, 015, 021; APP-DATA-001, 007; APP-API-004, 008, 009; LIVE-LINK-012, 013, LIVE-API-013 (server processes: the start order through a held stale-lock check, listening on 127.0.0.1 alone, the inputs in each form, the page, no log file; APP-SRV-001 and 015 without the 1c and 1d steps and exit 12)
- tests/app-shell/server-exits.test.ts — APP-SRV-006, 013, 014, 020; LIVE-LINK-012 (inputs missing or empty, a port in use, a data folder or database it cannot use, an error outside the handlers; APP-SRV-014 without the backup before an upgrade)
- tests/app-shell/stand-in.test.ts — APP-SRV-008, 009; APP-API-004, 008, 009, 011, 012 (`createStandIn` in process)
- tests/app-shell/status.test.ts — APP-API-004, 005, 008, 009, 010; APP-SRV-023 (a test server's `/api/status`: from memory, `ready` computed on each call, a failed preparation with downloads off; without the logbook's id, seeding, progress or a repeated preparation)
- tests/app-shell/request-checks.test.ts — APP-API-011, 012; APP-SRV-005 (the checks on a test server, and its 127.0.0.1-only bind)
- tests/app-shell/data-lock.test.ts — APP-DATA-007, 008; APP-SRV-014 (`takeLock` and `liveHolder` in process, two processes taking one stale lock, and server processes refused or taking over)
- tests/app-shell/shutdown.test.ts — APP-SRV-016, 018, 019, 022; LIVE-LINK-011, LIVE-SAVE-004, 005, LIVE-CASUAL-013 (`shutDown`, `installStopSignals`, `serveChannel` and `privateChannel` in process with stand-in parts and hosts; APP-SRV-016 without the 1c and 1d steps, APP-SRV-022 without `backup`)
- tests/app-shell/channel.test.ts — APP-SRV-011, 016, 018, 019, 022; LIVE-SAVE-004, 005, LIVE-CASUAL-013, 015 (bundled server processes over Node's IPC channel, standing in for Electron's `parentPort`; copy-run-from-source processes for the stop signals, emitted inside the process)
- tests/app-shell/harness.test.ts — APP-SRV-023; APP-DATA-001, 002; APP-RUN-001, 002, 004, 011 to 017, 019 to 021 (the per-file data folders, the fetch guard, the npm scripts, `.gitignore`, the launch guard of the server-process helper, the browser-test servers and the wait for `ready`)
- tests/app-shell/api.test.ts — APP-SRV-002, 004; APP-API-001, 002, 003, 004; APP-DATA-002; APP-RUN-011
- tests/app-shell/api-client.test.tsx — APP-API-006, 007 (the page's request helper)
- tests/app-shell/format.test.ts — APP-FMT-001, 002, 003
- tests/app-shell/error-boundary.test.tsx — APP-UI-005
- tests/app-shell/fetch-guard.test.tsx — APP-RUN-011, 014
- tests/app-shell/layout.test.ts — APP-UI-002, 009, 013, 014, 020
- tests/app-shell/menu.test.tsx — APP-UI-002, 012, 013, 016
- tests/app-shell/left-column.test.tsx — APP-UI-002, 013, 014, 015, 017, 018
- tests/app-shell/sidebar.test.tsx — APP-UI-001, 029
- tests/app-shell/page.test.tsx — APP-UI-001, 002, 012, 013, 014, 015, 016, 017, 018, 019, 020
- tests/app-shell/icons.test.tsx — APP-UI-026
- tests/tour-map/fit.test.ts — APP-UI-020
- tests/tour-map/map-toolbar.test.tsx — APP-UI-016
- tests/fleet/fleet-list.test.tsx — APP-UI-026
- tests/flight-panel/flight-panel.test.tsx — APP-UI-005
- tests/live-tracking/casual-api.test.ts — APP-API-001
- tests/live-tracking/tracker-api.test.ts — APP-API-001 (the tracker routes: a refusal answered 400 or 409, a failed write 500 and written out)
- tests/e2e/smoke.spec.ts — APP-RUN-012, 017, 018; APP-UI-001, 012
- tests/e2e/layout.spec.ts — APP-UI-006, 007, 009, 010, 011, 020, 021, 022, 023, 024, 025, 027, 028
- tests/e2e/global-setup.ts — APP-RUN-017 (the check itself)
- tests/support/test-server.ts (APP-SRV-005, 023), e2e-server.ts (APP-RUN-012, 015, 018, 021), server-process.ts (APP-RUN-021: the launch guard), setup-node.ts, run-folder.ts, fetch-guard.ts — the harness, annotated where it carries a spec; server-guard.ts, server-preload.ts, lock-contender.ts, raw-http.ts, event-stream.ts, page-data.ts and tests/e2e/seed.ts — helpers (no specs of their own)
- APP-RUN-003 is verified by `npm run typecheck`; APP-RUN-016 also by hand (a taken port fails the run in about a second)

### Code
- src/server/server.ts — `runServer`, `startServer`: the start order, the parts handed to the shutdown order as each comes to exist
- src/server/index.ts, src/server/bundled.ts — the two entries (a copy run from source; the desktop app's server, bundled by esbuild in the desktop build)
- src/server/inputs.ts — `readInputs`, `useInputs`, `currentInputs`
- src/server/version.ts — `VERSION`, `APP_NAME`
- src/server/status.ts — `/api/status` from memory: `serverStatus`, `setStartup`, `setAirportData`, `setCounts`, `statusRoute`
- src/server/checks.ts — `requestChecks`
- src/server/standin.ts — `createStandIn`; `servePage` and `serveImages`, which `createApp` shares
- src/server/lock.ts — `takeLock`, `liveHolder`, `FolderInUse`
- src/server/channel.ts — `privateChannel`, `serveChannel`
- src/server/shutdown.ts — `shutDown`, `shutdownBegun`, `installStopSignals`
- src/server/app.ts — `createApp`
- src/server/locations.ts — data locations
- src/server/db.ts — pragmas, `addColumnIfMissing`, the counts kept in memory
- src/server/routes.ts — helpers (28-62), `/status` (885), error handlers (887-903)
- src/server/airports.ts — `ensureReferenceData({ downloads })` and its report; airports.ts, hazards.ts, terrain.ts, simbrief.ts and ofp.ts — the User-Agent each sends (APP-API-005)
- src/client/api.ts — `req`
- src/client/App.tsx — the page's layout, hand-offs to the drawers (`openDrawer`), loading, error banner
- src/client/layout.ts — panel sizes, the clear part of the map (`clearInsets`), the left column's reducer
- src/client/prefs.ts — `readPref`, `writePref`, `prefersReducedMotion`
- src/client/components/Sidebar.tsx — the live and planner cards, collapsing; passes the live card App's `onOpenPending`, a no-op until flight-panel's PANEL-OPEN-002
- src/client/components/Menu.tsx — menu button, count line, sidebar toggle
- src/client/components/Drawer.tsx — `LeftColumn` and the drawers
- src/client/components/useDismiss.ts — closing the menus on Esc and outside clicks
- src/client/components/Icon.tsx — icon set, `IconButton`
- src/client/components/MapView.tsx — `PopupPadding`
- src/client/components/ErrorBoundary.tsx
- src/client/format.ts — shared formatters
- src/client/styles.css, src/client/index.html, src/client/main.tsx
- package.json, vite.config.ts, tsconfig.json, tsconfig.server.json, tsconfig.test.json, .gitignore
- vitest.config.ts, playwright.config.ts, tests/support/
- scripts/make-ico.mjs
- README.md, CLAUDE.md (the docs the segment owns)
- Retired, to be removed: start.cmd (the pilot's launcher until the installed app exists), scripts/install-shortcut.ps1 (no `@spec` annotations)

## Architecture

**Purpose:** Run the app as one local server and one page — bundled into the desktop app, or from
source — keep its data in one folder, back it up and bring a logbook in without ever losing a hop,
answer only the PC's own pages, and test it without touching the real logbook, its backups, the sim
or the internet.

**Key Components:**
1. `runServer` / `startServer` (`server.ts`) — inputs, listening first on 127.0.0.1, the start-up
   work behind the stand-in, airport preparation, then tracking; the private channel and the stop
   signals attached before it listens; `index.ts` and `bundled.ts` the entries
2. Inputs (`inputs.ts`) — the bundled server's required arguments, a copy run from source's defaults,
   `currentInputs()` for the test servers and tools
3. `createStandIn` (`standin.ts`) and `createApp` (`app.ts`) — the request checks first; the page,
   icons and `/api/status` from both; 503 for the rest of the API until the start-up work is done,
   the full API after
4. `/api/status` (`status.ts`) — answered from memory in every mode
5. `dataLocations` / `db.ts` — data folder, SQLite with WAL and foreign keys, in-place upgrades
6. The data-folder lock (`lock.ts`) — exclusive creation, stale judged by evidence, taken over by one
   server only
7. Start-up worker (planned) — the swap of a logbook brought in, opening, a restored backup's icons
   and the logbook's id, upgrade detection, the backup before an upgrade
8. Shutdown order (`shutdown.ts`) — reading each part as it reaches its step, exiting once within 5 s,
   tested in process with stand-in parts
9. Private channel (`channel.ts`) — Electron's `parentPort`, Node's IPC channel standing in for it in
   tests; `save` and `shutdown` (with `backup` planned) and their answers, matched by id
10. Backups and bringing in a logbook (planned) — online backup with icons, names by logbook id,
    pruning, short and full failure reasons, the offer, the copy and merged tracker state
11. API helpers and error handlers; client `req`
12. `App` / `Sidebar` / `Menu` / `LeftColumn` / `ErrorBoundary` — layout and contained failures; the
    starting state, airport-data notice, hand-off fragment, version and logbook checks and **Bring in
    a logbook** drawer (planned)
13. Development scripts and the icon tool
14. Test harness — per-file data folders, fetch guard, browser-test servers, server processes started
    through a launch guard that keeps them off the pilot's folders, ports and sim

## Spec Coverage

| Category | Spec IDs | Specs | Implemented | Deferred | Gaps |
|----------|----------|-------|-------------|----------|------|
| Server | APP-SRV-001 to 016, 018 to 023 | 22 | 13 | 0 | 9 |
| Data and database | APP-DATA-001 to 009 | 9 | 5 | 0 | 4 |
| Backups | APP-BAK-001 to 011 | 11 | 0 | 0 | 11 |
| Bringing in a logbook | APP-IMP-001 to 005 | 5 | 0 | 0 | 5 |
| API conventions | APP-API-001 to 012 | 12 | 7 | 0 | 5 |
| Page: layout, menu and drawers, covered map, look, starting, hand-offs, reloading | APP-UI-001 to 042 | 42 | 29 | 0 | 13 |
| Shared formatting | APP-FMT-001 to 003 | 3 | 3 | 0 | 0 |
| Development scripts and tests | APP-RUN-001 to 004, 010 to 021 | 16 | 16 | 0 | 0 |

**Summary:** 73 of 120 specs implemented; 47 gaps; none deferred. 67 implemented specs have tests,
and APP-RUN-003 is checked by `npm run typecheck`; APP-DATA-003, APP-UI-003, APP-UI-004, APP-UI-008
and APP-RUN-010 have none. Tests also cite 12 gaps, checking the part built so far: APP-SRV-001, 008,
014, 015, 016, 022, 023; APP-API-004, 005, 008, 009, 010.

The 47 gaps by what they wait for:
- **The logbook's id, backups and bringing in a logbook** (28): APP-SRV-010 (the start-up worker),
  014 (a logbook that could not be backed up before upgrading), 015 (exit 12), 016 (abandoning a
  backup or copy, finishing a swap, an upgrade rolling back), 022 (the `backup` request), 023 (the
  import's shutdown left to the test); APP-DATA-004, 005, 006, 009; APP-BAK-001 to 011; APP-IMP-001
  to 005; APP-API-004 and 008 (the logbook's id).
- **Airport data** (4): APP-SRV-012 (the monthly refresh's check), APP-API-005 (the User-Agent),
  APP-API-009 (a preparation a daily check repeats), APP-API-010 (seeding, `rows` and `total`, a
  repeated preparation's report).
- **Both of those** (2): APP-SRV-001 (the start-up steps for a logbook brought in, the icons and id,
  the backup and upgrade; preparation in detail) and APP-SRV-008 (the seed lists and backups found
  through the inputs).
- **The page** (13): APP-UI-030 to 042.

## Key Findings

1. **The database opens on the event loop.** `db.ts` opens the logbook and runs the schema step as
   it loads, inside the start-up work; `/api/status` answers before and after but not during a long
   open or WAL recovery (APP-SRV-010). The start-up worker moves it off the event loop.
2. **No backups, no logbook id, no way to bring a logbook in** (APP-BAK-001 to 011; APP-DATA-004 to
   006; APP-IMP-001 to 005); every start runs the schema step with no check of whether it changes
   anything, and not as one transaction; `/api/status` reports `logbookId` null. The start-up and
   shutdown orders keep empty steps where this work goes.
3. **The User-Agent names an old version and no contact** — "0.6 (personal flight-sim logbook; local
   use)" in four modules, none on the OurAirports downloads and the SimBrief plan fetch, while
   `/api/status` reports the one version from `package.json` (APP-API-005).
4. **Airport preparation reports only its step** — `waiting`, `downloading`, `importing`, `done` or
   `failed` — with no seeding, progress or repeated preparation; it runs once after the start-up
   work, and a failure is written out and the server goes on (APP-API-010; airports' APT-DATA-001,
   002, 017 to 026).
5. **The page has no starting state, fragment hand-off, version check or logbook check** — a 503 at
   first load would show "Server error", `#hop=`/`#pending=` do nothing, a browser tab outliving an
   update keeps running the old page, and one left open while another logbook is brought in or a
   backup restored keeps the old logbook's state (APP-UI-030 to 036, 042).
6. **Seen working only in tests** — the stop signals are emitted inside the server's own process;
   Windows delivering Ctrl+C, Ctrl+Break and a closed console window to it (APP-SRV-018) is checked
   by hand. The private channel is tested over Node's IPC channel, standing in for Electron's
   `parentPort`, whose branch is tested in process with a stand-in host; the link starting only
   after preparation is seen through its log line, since no test runs `--sim=link`.
7. **Implemented specs without tests** — APP-DATA-003, APP-UI-003, APP-UI-004, APP-UI-008,
   APP-RUN-010; and APP-DATA-009, which today's additive-only schema step already keeps, has no test
   to close it.

## Work Required

### Must Fix
The desktop app's first release relies on these; tests first, the server process tests among them.
1. The start-up worker: opening, recovery, the backup and the upgrade off the event loop, the
   modules holding the database loaded only after it (APP-SRV-010), with `/api/status` answering
   within 1 s throughout.
2. Schema upgrade detection in one transaction, the logbook's id given before the upgrade check and
   kept in memory for `/api/status`, and a test that an older server opens a newer logbook unchanged
   (APP-DATA-004 to 006, 009; APP-API-004, 008).
3. Backups: online backup with icons (an empty `backup_icons` table when there are none), names,
   kinds, folder lookup, pruning per logbook, short and full reasons, fallback into the data folder,
   the backup before an upgrade, a restored backup's icons and new id, and the private channel's
   `backup` request (APP-BAK-001 to 011; APP-SRV-014, 022).
4. Bringing in a logbook through a restart and an ordered swap with its recovery, exit 12, the
   shutdown order's steps for a backup or copy under way, a swap and an upgrade, and the import's
   shutdown left to the test (APP-IMP-001 to 005; APP-SRV-001, 015, 016, 023), with live-tracking's
   pause and merged tracker state (LIVE-LINK-017, LIVE-SAVE-008), and the page's **Bring in a
   logbook** drawer with its reload on a new process id (APP-UI-038 to 040).
5. Airport preparation in detail with airports: seeding, progress, a repeated preparation and its
   report, the monthly refresh's check (APP-SRV-001, 008, 012; APP-API-009, 010; APT-DATA-001, 002,
   017, 021, 022).
6. One User-Agent naming the project, with the version, on every outside request (APP-API-005).
7. The page's starting state, airport-data notice, hand-off fragment acted on only on fresh state,
   and reload for a new version or another logbook (APP-UI-030 to 036, 042), the last two with
   live-tracking's reload on a reconnect (LIVE-API-005) and the reload for another logbook ahead of
   planner's PLAN-RUN-006 and 007.

### Should Fix
8. **Back up now** in the menu (APP-UI-037; APP-BAK-002) and the page below 800 × 600 (APP-UI-041).
9. Remove `start.cmd` and `scripts/install-shortcut.ps1` once the installed app exists.
10. Bring the README and CLAUDE.md in line with the LLD's Docs This Segment Owns — documentation
    obligations, checked by reading the files before each release, with no specs or tests.

### Nice to Have
11. Tests for the implemented specs listed in Key Findings 7.
