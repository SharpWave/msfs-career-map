# MSFS Career Map — project notes

Map-centric logbook for a home-spun MSFS 2024 career mode. See README.md for the user-facing
description, API table and roadmap.

## Stack

- Node 22.16+ with the built-in `node:sqlite` (no native modules). Server is Express 4 in TypeScript
  run via `tsx`; the schema step lives in `src/server/schema.ts` (`applySchema`, one transaction),
  run by `db.ts` as it opens the database.
- The server's entries are `src/server/index.ts` (a copy run from source) and `bundled.ts` (the
  desktop app's); both only call `runServer` in `src/server/server.ts`, which reads the inputs
  (`inputs.ts`) and holds the start order. The start-up work on the logbook (finishing a logbook
  brought in, a restored backup's icons, the logbook id in `settings`, the backup before an upgrade)
  runs in a worker thread (`startup-worker.ts` → `startup-work.ts`) before `db.ts` loads. The
  shutdown order is in `shutdown.ts`, and `tracking.ts` starts the sim link, the fake feed or
  nothing by the `--sim` mode. Backups are `backup.ts` (taken one at a time by `backup-service.ts`),
  bringing in a logbook `logbook-import.ts`.
- Client is Vite + React 18 + react-leaflet 4. Vite root is `src/client`, build output is `dist/`,
  which the server serves when present. The page is built with the app's version
  (`__MSFS_CAREER_MAP_VERSION__`, defined in vite.config.ts and vitest.config.ts; `src/client/version.ts`).
  App.tsx holds what the page does with its server: the starting state and airport notice
  (`notices.ts`, whose `PAGE_TIMING` tests shrink), the reload of the map and lists on each reconnect
  of the tracker stream (`LiveState.connection`), reloading itself for another version or logbook
  (`api.freezeChanges()` first), and the `#hop=` / `#pending=` hand-off (`navigation.ts`), acted on
  only on fresh state. Component tests stub `reloadPage` from navigation.ts.
- Airport and runway data are the OurAirports CSVs in the data folder (each with a `.downloaded`
  time), imported into `airports` / `runways`. Everything that writes them is
  `src/server/airport-data.ts`: seeding from the program folder, bounded downloads under `.partial`
  names, the import in batches into `*_staging` tables and one short swap (`stageList`, `swapIn`),
  and `AirportWork` (preparation at start, the daily checks with the monthly refresh held while the
  pilot is in the sim — `pilotInSim` in tracking.ts — and re-imports, one at a time). The swap keeps
  airports a hop references that the lists drop (`airports.unlisted = 1`), which nearest-airport
  and planner queries leave out. `airport_rwy` is a per-airport summary (longest runway, surfaces,
  paved/lit flags) rebuilt by every runway swap; airport queries LEFT JOIN it. Surface free-text
  is normalised by `surfaceClass()`. Queries, METAR and Wikipedia stay in `src/server/airports.ts`.
- Every request to an outside service sends `USER_AGENT` from `src/server/version.ts`.
- Schema changes only ever add: a table to `TABLES_SQL` or a column to `ADDED_COLUMNS` in
  `src/server/schema.ts` (nullable or with a default), so older databases upgrade in place and an
  older server still opens a newer one. A logbook that needs an addition is backed up first.
- Live tracking: `src/server/simconnect.ts` wraps node-simconnect (pure TypeScript, no SDK DLL)
  and only produces position samples and system events; `src/server/tracker.ts` is the
  sim-independent state machine (`feed(sample)`), checkpointed to the `tracker_state` row so a
  leg survives a server restart; a checkpoint it cannot read is set aside in
  `tracker_state_aside`. Pending legs are a list, each addressed by a UUID
  (`/api/tracker/pending/:id`). The client subscribes to `/api/tracker/events` (SSE).
  Casual mode (`setCasual`) suspends leg detection; its switch and since time are checkpointed,
  its `path` of segments never is (memory only, empty after a restart).
- Landing rating thresholds (`rateLanding`) live in `src/server/tracker.ts`; the client only
  maps a rating to icon/word/color in `src/client/landing.ts`. The per-frame touchdown watcher
  is in `simconnect.ts`; the tracker makes a provisional landing from 1 Hz data and replaces it
  when the frame-accurate one arrives within 6 s.
- SimBrief: `src/server/ofp.ts` fetches `xml.fetcher.php?...&json=v2` by alias or pilot ID (the
  only setting, in the `settings` table) and parses both the v2 and the older all-strings shape.
  Briefings are archived whole (raw JSON + OFP HTML + summary) in `briefings`, linked from
  `hops.briefing_id`. The tracker holds one "current" briefing that the next logged hop consumes.
- Desktop shell: `src/desktop/` (Electron 45). Its modules are pure logic driven through the stand-ins
  in `ports.ts` — clock, server launcher, local HTTP, Windows facts, known folders, opener, message
  boxes, window, tray, the start lists' file calls (`EditorFs`), Windows' start-up keys
  (`StartupKeys`), notifications and their registrations, the updater (`UpdaterPort`) — with `FakeClock`
  in tests (`tests/desktop/support/`). Updates are `updates.ts` (`Updates`: the 1 min / 4 h checks,
  downloads held while the sim is in use, the state and the tray's version line; `QuietMoment`, the 5
  unbroken minutes) and `updater.ts` (the port on electron-updater, whose `autoUpdater` main.ts passes in);
  the three installs (Quit, Restart to update, a quiet moment), their backup, the mark written before the
  handover and leaving the quitting state when one goes no further are in `shell.ts`. Notifications are `notifications.ts` (the `Notifier`: what is shown, when,
  in whose words), `toast.ts` (toast XML, the click's launch string, the clean-up's commands) and
  `registrations.ts` (AppUserModelID, the fixed ToastActivatorCLSID from `identity.ts`, the Start-menu
  shortcut); clicks come through Electron's `Notification.handleActivation`. The start lists (Start with
  MSFS 2024, Start with Windows, `--unregister`) are `exe-xml.ts` (the `EXE.xml` editor, edits as text,
  parsed with `saxes`), `msfs-start.ts`, `windows-start.ts` + `startup-keys.ts` (reg.exe, Electron's
  login item), `start-lists.ts` (the two tray items) and `unregister.ts`; their tests and `EXE.xml`
  fixtures are in `tests/desktop/start-lists/`. `main.ts` is the only
  Electron glue and the only module that loads `electron`; nothing in `src/desktop` imports
  `src/server`, and no module touches `child_process`, `net`, `http` or `electron` at load. The
  desktop build (`scripts/desktop-build.ts`, tray icons from `assets/career-map.ico` by
  `scripts/tray-icons.ts`) writes `build/desktop/`: `page/`, `server.mjs` + `startup-worker.mjs`,
  `main.cjs`, node-simconnect and its dependencies in `node_modules/` (left out of the server
  bundle), the seed lists, `icons/` and an app `package.json`.
- Packaging: `electron-builder.json` packages `build/desktop/` into `release/` (only `main.cjs` and
  `package.json` in `app.asar`; everything else under `resources/`, the program folder). The
  per-user NSIS installer's own steps are `build/installer.nsh` (electron-builder's hooks) and
  `build/installer-steps.nsh` (plain NSIS macros the hooks and `tests/installer/` call). A start of
  the installed app during an install leaves its command line in the install-under-way mark
  (`src/desktop/install-mark.ts`, UTF-16LE lines in `%LOCALAPPDATA%\msfs-career-map-updater`), whose
  form every release must keep. The release workflow is `.github/workflows/release.yml` with
  `scripts/release/` (a `dry-run-v<version>` tag rehearses without a draft).
- Charts follow the dataviz skill: no dual axes; the profile chart indexes each series to its own
  range and shows real values in the legend and crosshair. Palette validated for the dark surface.

## Commands

- `npm run dev` — server on `PORT` (default :3080, tsx watch, tracking off) + Vite on
  127.0.0.1:5173 with `/api/` and `/images/` proxied to it.
- `npm run dev:sim` — the same, with the server on the sim link (`--sim=link`).
- `npm run build` then `npm start` — production-style single server on :3080; add
  `-- --sim=link` to track flights.
- `npm run desktop` — builds the page and bundles into `build/desktop/`, then starts Electron
  unpackaged in test mode on `.desktop-dev\` (server on :3280, fake feed, airport downloads off);
  drive it with `npm run sim-fake -- --base http://127.0.0.1:3280 KBOS KPVD`. `npm run desktop:build`
  builds without starting Electron; either takes `-- --fresh` to download the seed lists again.
- `npm run typecheck` — client, server, test and desktop tsconfigs.
- `npm test` — Vitest: Node tests (`tests/<segment>/*.test.ts`, each file on its own temp data
  folder with the fixture airports), component tests (`*.test.tsx`, jsdom) and the `desktop`
  project (`tests/desktop/`, no Electron, no database). Outside requests fail the test unless
  answered with `answerFetch()` (`tests/support/fetch-guard.ts`); in the `desktop` project the guard
  (`tests/desktop/support/guard.ts`) fails any test reaching `child_process`, `net`, `http`,
  `https`, `dgram`, `electron`, `process.kill` or `fetch`, with decoy `LOCALAPPDATA`, `APPDATA` and
  `USERPROFILE`. `CAREER_MAP_TIMED_TESTS=apart` leaves the large import's wall-clock tests out of the
  node project (the release workflow runs them alone after the rest; Vitest's `--exclude` does not
  reach a project's files).
- `npm run test:e2e` — Playwright on its own servers (:3180 app on `--sim=fake`, :5183 page)
  and a temp data folder; first run needs `npx playwright install chromium`. Browser tests run one
  at a time and import `test` from `tests/e2e/fixtures.ts`.
- `npm run package` — the desktop build, then electron-builder into `release/` (`win-unpacked/`
  and the installer). Never run the installer or uninstaller on a development PC: they write the
  real install folder, HKCU and the Start menu; the release workflow's round trip
  (`scripts/release/round-trip.ts`, refused off its runner) tries them.
- `npm run test:packaged` — after `npm run package`: Playwright on `release/win-unpacked` in test mode
  (port 3280 must be free; `tests/packaged/`). VS Code's extension host can hold an `app.asar` under
  `release/` open once a file tool has looked inside it; then package with
  `--config.directories.output=<folder>` and set `CAREER_MAP_RELEASE=<folder>` for the tests.
- `npm run test:installer` — the include's steps compiled into small NSIS programs with
  electron-builder's NSIS and run on temp folders (`tests/installer/`, `vitest.installer.config.ts`).
- `npm run import-airports [-- --fresh]` — re-import (optionally re-download) airports.
- `npm run sim-probe` — print what a running sim reports, without touching the database.
- `npm run dev:server -- --sim=fake` (or `TRACKER_FAKE=1 npm run dev`) then
  `npm run sim-fake -- KBOS KPVD [--touch-and-go] [--start-airborne] [--fpm 320 --g 2.1]
  [--base http://127.0.0.1:<port>]` — drive the tracker with a synthetic flight; test
  against a copy of the database (`CAREER_DB=...`) so fake hops never land in the real logbook.
  Put the copy in a folder of its own: icons and airport lists live beside whichever database is
  in use, so a copy inside `data/` shares the real ones (copy `images/` along to see the icons).
  Copy `career.db` with `-wal`/`-shm` or after a checkpoint, or recent rows are missing.

## Conventions

- Hops are ordered per aircraft by `seq`; the server renumbers after deletes/reorders.
- Airport codes are resolved server-side to the canonical OurAirports `ident` before storage.
- Timestamps are stored as ISO UTC strings; the client converts to/from `datetime-local`.
- `hops.track` is a JSON array of `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts,
  fuel_lb]` (0.7 rows have four fields), written only by the tracker (one sample per 5 s).
  `parseTrack()` in `src/client/tracker.ts` reads it and `paths.ts` draws it in place of the
  great circle, with the airport positions prepended/appended. `hops.landings` and `hops.stats`
  are JSON too (`Landing[]`, `HopStats`); readers must tolerate null for hand-logged hops.
- Aircraft rows carry `sim_title` / `sim_livery` (the sim's `TITLE` and `LIVERY NAME`); the
  tracker matches on both, with a blank `sim_livery` meaning any livery.
- Map geometry (great circles, placing shapes across the antimeridian, parked-aircraft positions) is
  computed in `src/client/paths.ts` and shared by the map and the zoom-to-fit logic. Keep those in
  sync. The map wraps: every layer is drawn on every world copy in view (`copyShifts` with the copies
  from `WorldCopies.tsx`), so a new layer must do the same.
- Panels float over a full-window map. Their sizes (column width, top bar, flight panel height)
  live in `src/client/layout.ts` and are mirrored in `styles.css`; zooms fit into the part of the
  map the panels leave clear, worked out from `layout.ts`, so keep the two in step.
- Data locations come from `dataLocations()` in `src/server/locations.ts`, given the database the
  server's inputs name: `currentInputs().dbPath` in `src/server/inputs.ts`, which is `--data`'s
  `career.db`, else `CAREER_DB`, else `data/career.db`. `images/`, `airports.csv`, `runways.csv`
  the server's `career.db.lock` and, for a copy run from source, `backups/` sit beside it. The app itself is built by `createApp()` in
  `src/server/app.ts`, which starts nothing; tests must not import `src/server/index.ts` or
  `bundled.ts` (they start them as processes, `tests/support/server-process.ts`; an entry
  listens, takes the data folder's lock, and links to the sim when started with `--sim=link`).
- Writing files with bash heredocs failed in this environment; use the Write tool for new files.

## LID
- Mode: Full
- Version: 1.3.0

## Linked-Intent Development (MANDATORY)

**Consult the `linked-intent-dev` skill for ALL code changes.** All changes flow through the arrow of intent in one direction:

```
HLD → LLDs → EARS → Tests → Code
```

- **New features and refactors**: full six-phase workflow (HLD check → LLD check/draft → EARS → intent-narrowing edge audit → tests-first → code).
- **Bug fixes**: walk the arrow like any other change — find where behavior diverged from intent and cascade from there. No short-circuit.
- **If unsure**: use the full workflow.

Stop after each phase for user review. **Docs carry current intent, written to be read cold** — write each doc as if authored fresh today, from current intent alone: no narration of how it changed, no meaning that needs the conversation that produced it, no rebuttals to questions only a past discussion raised. Rationale, considered alternatives, and constraints a fresh author would independently write stay; record rejected alternatives and why in the LLD's Decisions & Alternatives table, not as asides in body prose.

**Memory vs. intent.** Before saving durable project knowledge to agent or tool memory, test whether it is project *intent* — would a fresh agent, in any tool, next session, need it to build this system correctly? If yes, record it in the arrow (HLD / LLD / EARS / decision doc), which travels and cascades — not in private, per-tool memory, where intent escapes the arrow. Knowledge about the user or how they like to work stays in memory.

### Navigation

| What you need | Where to look |
|---|---|
| High-level design | `docs/high-level-design.md` |
| Design tree (sub-HLDs, LLDs, their specs) | `docs/intent/` — one folder per node |
| EARS specs | beside each design doc as `{node}-specs.md` in the node's folder under `docs/intent/` |
| Decision docs | `docs/decisions/` (project-level) and `docs/intent/<segment>/decisions/` |
| Arrow of intent overlay | `docs/arrows/index.yaml` and per-segment docs in `docs/arrows/` |

### Terminology

- **HLD**: High-Level Design — single project-level doc at `docs/high-level-design.md`.
- **LLD**: Low-Level Design — detailed component design doc in `docs/intent/`. The design layer is a recursive tree: the root is the HLD, leaf LLDs own EARS, and a component deep enough to outgrow one doc becomes a sub-HLD (HLD-shaped, owns no EARS) with children beneath it. "HLD" and "LLD" are roles by position; depth-2 (one HLD over flat leaf LLDs) is the default.
- **EARS**: Easy Approach to Requirements Syntax — structured one-line requirements beside each design doc as `{node}-specs.md` in the node's folder under `docs/intent/`. IDs are path-concatenated — the root-to-leaf path of the owning segment plus a number — so a prefix grep gathers a subtree. Markers: `[x]` implemented, `[ ]` active gap, `[D]` deferred.
- **Arrow**: the unidirectional chain from vision to code (HLD → LLDs → EARS → Tests → Code). Strictly a DAG of intent.
- **Arrow segment**: the territory owned by one leaf LLD — the LLD itself plus the specs, tests, and code that cite its EARS IDs. The boundary is the leaf prefix. Within-segment cascade is free; across-segment cascade pauses.
- **Cascade**: propagating a change downstream through the arrow so adjacent levels stay coherent.

### Code annotations

Annotate code and tests with `@spec` comments citing EARS IDs:

```
// @spec AUTH-UI-001, AUTH-UI-002
```

Place the annotation at the *entry point of the behavior's implementation graph* — the topmost function or module owning the specified behavior, not every helper. When a behavior spans multiple subsystems (UI + API + database, for example), annotate at the entry point in each subsystem. Tests follow the same rule: annotate the test that directly exercises the spec, not every inner assertion.
