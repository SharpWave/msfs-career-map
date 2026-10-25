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
  the logbook's id, the sim mode, the start-up step, the airport-data report, `ready` and the counts;
- the start-up work in a worker thread with its own connection, `/api/status` answering within 1 s
  throughout: a logbook brought in swapped into place, the logbook opened, a restored backup's icons
  put back with a new id, an id given to a logbook without one, and, when opening it is a schema
  upgrade, a backup first (into the data folder when the backups folder cannot be written; exit 1
  when neither can) and the schema step as one transaction (APP-SRV-010, 014; APP-DATA-004 to 006,
  009; APP-BAK-009 to 011; APP-IMP-004, 005);
- backups: SQLite's online backup with the icons in `backup_icons`, named by UTC time, kind and
  logbook id, one at a time, pruned per logbook, with short and full failure reasons; taken over the
  private channel (`backup`, with progress) and by `POST /api/backups`; Documents looked up in the
  registry at each backup (APP-BAK-001 to 008; APP-SRV-022);
- bringing in a logbook: the offer, the refusals, the copy with its icons and the merged tracker
  state marked complete, tracking paused, 202 and exit 12, the shutdown left to the test on a test
  server (APP-IMP-001 to 003; APP-SRV-015, 023);
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
  (APP-RUN-001, 004, 012, 017, 019 to 021);
- airport preparation with airports: seeding from the program folder its inputs give, progress in
  `/api/status` with the rows imported out of the total, the daily checks handed a check of whether
  the pilot is in the sim (`pilotInSim`), and the airport work stopped at shutdown right after the
  tracker's final checkpoint (APP-SRV-001, 008, 012, 016; APP-API-008 to 010);
- one User-Agent, `MSFSCareerMap/<version> (+https://github.com/SharpWave/msfs-career-map)`, on every
  request the server makes to an outside service;
- the page's side: its version built in; "Starting… (step)" while the server's start-up work answers
  503; the airport-data notice; reloading itself, sending no further change, for a server of another
  version (once per version, then a notice) or holding another logbook; the hand-off fragment acted on
  only on fresh state; **Back up now**; the **Bring in a logbook** drawer, opened at load when anything
  is offered, waiting for the server to come back with the logbook; every control reachable in a
  window below 800 × 600 (APP-UI-030 to 042, APP-API-005).

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
- tests/app-shell/server-start.test.ts — APP-SRV-001, 003, 005, 006, 007, 009, 015, 021; APP-DATA-001, 007; APP-API-004, 008, 009; LIVE-LINK-012, 013, LIVE-API-013 (server processes: the start order through a held stale-lock check, listening on 127.0.0.1 alone, the inputs in each form, the page, no log file; the start-up work, airport preparation and exit 12 are server-logbook's and server-airports')
- tests/app-shell/server-exits.test.ts — APP-SRV-006, 013, 014, 020; LIVE-LINK-012 (inputs missing or empty, a port in use, a data folder or database it cannot use, an error outside the handlers; APP-SRV-014 without the backup before an upgrade)
- tests/app-shell/stand-in.test.ts — APP-SRV-008, 009; APP-API-004, 008, 009, 011, 012 (`createStandIn` in process)
- tests/app-shell/status.test.ts — APP-API-004, 005, 008, 009, 010; APP-SRV-023 (a test server's `/api/status`: from memory, `ready` computed on each call, a failed preparation with downloads off; seeding, progress and a repeated preparation are airports' tests)
- tests/app-shell/request-checks.test.ts — APP-API-011, 012; APP-SRV-005 (the checks on a test server, and its 127.0.0.1-only bind)
- tests/app-shell/data-lock.test.ts — APP-DATA-007, 008; APP-SRV-014 (`takeLock` and `liveHolder` in process, two processes taking one stale lock, and server processes refused or taking over)
- tests/app-shell/server-airports.test.ts — APP-SRV-001, 008, 016; APP-API-008, 009, 010 with airports' APT-DATA-001, 002, 017, 018, 020 to 023, 025, 026 (server processes: seeding a new data folder, a failed preparation, the status through a large import, a shutdown mid-import, leftovers)
- tests/app-shell/user-agent.test.ts — APP-API-005 (the User-Agent on OurAirports, aviationweather.gov, Wikipedia, Open-Meteo and SimBrief requests)
- tests/app-shell/code-paths.test.ts — APP-SRV-008 (no path worked out from the code's own location but a copy run from source's defaults)
- tests/app-shell/pilot-in-sim.test.ts — APP-SRV-012 (the check handed to the refresh, from the tracker's status)
- tests/app-shell/page-server.test.tsx — APP-UI-004, 030, 031, 036, 042; APP-API-005, 009; LIVE-API-005; PLAN-RUN-006, 007 (the page with a stand-in map and stream: starting, the airport notice, the version and logbook checks, a reconnect's reload)
- tests/app-shell/page-fragment.test.tsx — APP-UI-032 to 035; PANEL-OPEN-009 to 011; LIVE-CARD-015 (the hand-off fragment)
- tests/app-shell/page-logbook.test.tsx — APP-UI-037 to 040; APP-BAK-008; APP-IMP-002, 005 (**Back up now**, the **Bring in a logbook** drawer)
- tests/e2e/page-server.spec.ts — APP-UI-032, 034, 035, 036, 037, 041; APP-API-005; APP-BAK-002 (in a browser: `#hop=`, **Back up now**, no version reload, windows of 700 × 520 and 480 × 360)
- tests/app-shell/shutdown.test.ts — APP-SRV-016, 018, 019, 022; LIVE-LINK-011, LIVE-SAVE-004, 005, LIVE-CASUAL-013 (`shutDown`, `installStopSignals`, `serveChannel` and `privateChannel` in process with stand-in parts and hosts, the airport work stopped right after the final checkpoint; the start-up work, a backup or a logbook copy at shutdown and the channel's `backup` are the process tests')
- tests/app-shell/channel.test.ts — APP-SRV-011, 016, 018, 019, 022; LIVE-SAVE-004, 005, LIVE-CASUAL-013, 015 (bundled server processes over Node's IPC channel, standing in for Electron's `parentPort`; copy-run-from-source processes for the stop signals, emitted inside the process)
- tests/app-shell/harness.test.ts — APP-SRV-023; APP-DATA-001, 002; APP-RUN-001, 002, 004, 011 to 017, 019 to 021 (the per-file data folders, the fetch guard, the npm scripts, `.gitignore`, the launch guard of the server-process helper, the browser-test servers and the wait for `ready`)
- tests/app-shell/logbook-schema.test.ts — APP-DATA-004, 005, 006, 009; APP-API-004 (upgrade detection, the schema step as one transaction, the logbook id, on logbook files made for each test)
- tests/app-shell/backups.test.ts — APP-BAK-003, 004, 006, 007, 008, 009 (`takeBackup`, `pruneBackups`, `backupFailure`, `backupsFolder` with Documents stubbed, `backupWithFallback`)
- tests/app-shell/backup-api.test.ts — APP-BAK-002, 004, 005, 008 (`POST /api/backups` on a test server; `BackupQueue`)
- tests/app-shell/startup-work.test.ts — APP-SRV-001, 014; APP-DATA-004, 006; APP-BAK-009, 010, 011; APP-IMP-004, 005 (`runStartupWork` in process)
- tests/app-shell/logbook-import.test.ts — APP-IMP-001, 002, 003, 005; APP-SRV-023; APP-DATA-007; LIVE-API-015, LIVE-LINK-017, LIVE-SAVE-009 (a test server)
- tests/app-shell/server-logbook.test.ts — APP-SRV-001, 010, 014, 015, 016, 022; APP-API-004, 008; APP-BAK-001, 004, 005, 008, 009, 010, 011; APP-DATA-005, 006; APP-IMP-003, 004, 005; LIVE-CASUAL-013 (server processes: the status during a 60 MB upgrade, backups over the channel, a shutdown during the start-up work, a logbook brought in end to end)
- tests/support/logbooks.ts — logbook files for tests (no specs of its own)
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
- src/server/db.ts — pragmas, the schema step run as it opens, a test server's logbook id, the counts kept in memory
- src/server/schema.ts — `applySchema` (one transaction), `holdsAppTables`, `upgradeNeeded`, `TABLES_SQL`, `ADDED_COLUMNS`
- src/server/logbook-id.ts — `newLogbookId`, `readLogbookId`, `writeNewLogbookId`
- src/server/startup-work.ts, startup-worker.ts — `runStartupWork` (finishing an import, `restoreIcons`, the id, the backup and upgrade), the worker's entry; `runStartupWorker` in server.ts
- src/server/backup.ts — names, `copyLogbook`, `takeBackup`, `pruneBackups`, `backupFailure`, `backupsFolder`, `backupWithFallback`; documents.ts — `documentsFolder`; backup-queue.ts — `BackupQueue`; backup-service.ts — the server's `backupQueue`
- src/server/logbook-import.ts, incoming.ts — `offer`, `bringIn`, `abandonImport`, the outcome kept in memory
- src/server/routes.ts — helpers (28-62), `/status` (885), error handlers (887-903)
- src/server/airports.ts — the server's `airportWork` on its inputs' data and program folders, `ensureReferenceData({ downloads })`; airport-data.ts is airports'
- src/server/tracking.ts — `pilotInSim`, the check handed to airports' daily checks (APP-SRV-012)
- src/server/version.ts — `VERSION`, `USER_AGENT`; airport-data.ts, airports.ts, hazards.ts, terrain.ts, simbrief.ts and ofp.ts send it (APP-API-005)
- src/client/api.ts — `req`, `freezeChanges`, the status, backup and logbook calls
- src/client/version.ts, navigation.ts, notices.ts — the page's version, reloading and the fragment, the starting, airport and version texts and polling times
- src/client/components/BringIn.tsx — the **Bring in a logbook** drawer
- src/client/App.tsx — the page's layout, hand-offs to the drawers (`openDrawer`), loading and starting, error banner, notices, the version and logbook checks, a reconnect's reload, the fragment route, **Back up now**
- src/client/layout.ts — panel sizes, the clear part of the map (`clearInsets`), the left column's reducer
- src/client/prefs.ts — `readPref`, `writePref`, `prefersReducedMotion`
- src/client/components/Sidebar.tsx — the live and planner cards, collapsing, the live card opened for a `#pending=` hand-off
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
   work behind the stand-in, airport preparation, then tracking and the daily airport checks; the private channel and the stop
   signals attached before it listens; `index.ts` and `bundled.ts` the entries
2. Inputs (`inputs.ts`) — the bundled server's required arguments, a copy run from source's defaults,
   `currentInputs()` for the test servers and tools
3. `createStandIn` (`standin.ts`) and `createApp` (`app.ts`) — the request checks first; the page,
   icons and `/api/status` from both; 503 for the rest of the API until the start-up work is done,
   the full API after
4. `/api/status` (`status.ts`) — answered from memory in every mode
5. `dataLocations` / `db.ts` / `schema.ts` — data folder, SQLite with WAL and foreign keys, in-place upgrades as one transaction
6. The data-folder lock (`lock.ts`) — exclusive creation, stale judged by evidence, taken over by one
   server only
7. Start-up worker (`startup-work.ts`) — the swap of a logbook brought in, opening, a restored backup's icons
   and the logbook's id, upgrade detection, the backup before an upgrade
8. Shutdown order (`shutdown.ts`) — reading each part as it reaches its step, exiting once within 5 s,
   tested in process with stand-in parts
9. Private channel (`channel.ts`) — Electron's `parentPort`, Node's IPC channel standing in for it in
   tests; `save`, `backup` and `shutdown` and their answers, matched by id
10. Backups and bringing in a logbook (`backup.ts`, `logbook-import.ts`) — online backup with icons, names by logbook id,
    pruning, short and full failure reasons, the offer, the copy and merged tracker state
11. API helpers and error handlers; client `req`
12. `App` / `Sidebar` / `Menu` / `LeftColumn` / `ErrorBoundary` — layout and contained failures; the
    starting state, airport-data notice, hand-off fragment, version and logbook checks, **Back up now**
    and the **Bring in a logbook** drawer (`BringIn`)
13. Development scripts and the icon tool
14. Test harness — per-file data folders, fetch guard, browser-test servers, server processes started
    through a launch guard that keeps them off the pilot's folders, ports and sim

## Spec Coverage

| Category | Spec IDs | Specs | Implemented | Deferred | Gaps |
|----------|----------|-------|-------------|----------|------|
| Server | APP-SRV-001 to 016, 018 to 023 | 22 | 22 | 0 | 0 |
| Data and database | APP-DATA-001 to 009 | 9 | 9 | 0 | 0 |
| Backups | APP-BAK-001 to 011 | 11 | 11 | 0 | 0 |
| Bringing in a logbook | APP-IMP-001 to 005 | 5 | 5 | 0 | 0 |
| API conventions | APP-API-001 to 012 | 12 | 12 | 0 | 0 |
| Page: layout, menu and drawers, covered map, look, starting, hand-offs, reloading | APP-UI-001 to 042 | 42 | 42 | 0 | 0 |
| Shared formatting | APP-FMT-001 to 003 | 3 | 3 | 0 | 0 |
| Development scripts and tests | APP-RUN-001 to 004, 010 to 021 | 16 | 16 | 0 | 0 |

**Summary:** all 120 specs implemented; none deferred. 115 have tests, and APP-RUN-003 is checked by
`npm run typecheck`; APP-DATA-003, APP-UI-003, APP-UI-008 and APP-RUN-010 have none.

## Key Findings

1. **The monthly refresh has not yet run against the real OurAirports lists** — its tests answer the
   downloads from fixtures; the refresh is held while this server's sim link is connected, so a copy
   run from source with `--sim=link` refreshes only while MSFS is closed.
2. **Seen working only in tests** — the stop signals are emitted inside the server's own process;
   Windows delivering Ctrl+C, Ctrl+Break and a closed console window to it (APP-SRV-018) is checked
   by hand. The private channel is tested over Node's IPC channel, standing in for Electron's
   `parentPort`, whose branch is tested in process with a stand-in host; the link starting only
   after preparation is seen through its log line, since no test runs `--sim=link`. The start-up
   worker runs under `tsx` from source and, from the desktop build's second entry
   (`startup-worker.mjs` beside `server.mjs`), in Electron 45's utility process, its start-up work
   done in about 0.3 s on a fresh data folder — the LLD's Open Questions 2 is answered
   and can be closed there. The Documents lookup is stubbed in tests and not
   yet checked against a Documents folder OneDrive has moved, nor Controlled folder access's error
   code (Open Questions 1, 3). The page's reconnect, version and logbook checks are tested with a
   stand-in event stream; a real server restart under an open tab is checked by hand.
3. **A copy run from source's first start on this code backs its logbook up.** A logbook from before
   the logbook id, the sim-clock columns and the airports' `unlisted` column is an upgrade: the start
   takes `upgrade-<version>` into `data/backups/` (about the logbook's size) before the schema step,
   then gives it its id.
4. **Below 800 × 600 the flight panel scrolls whole, its header included** — in a window as small as
   480 × 360 the left column leaves it about 100 px of width, enough to reach every control but not
   to read comfortably.
5. **Implemented specs without tests** — APP-DATA-003, APP-UI-003, APP-UI-008, APP-RUN-010.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Remove `start.cmd` and `scripts/install-shortcut.ps1` once the installed app exists.
2. Bring the README and CLAUDE.md in line with the LLD's Docs This Segment Owns — documentation
   obligations, checked by reading the files before each release, with no specs or tests.

### Nice to Have
3. Tests for the implemented specs listed in Key Findings 5.
4. Check the Documents lookup against a Documents folder OneDrive has moved, and Controlled folder
   access's error code (Key Findings 2); close the LLD's Open Questions 2 (the start-up worker, now seen
   in Electron's utility process from the desktop build).
