# Arrow: shell

The desktop shell at run time, one of the three parts of the desktop grouping: the server's process and
keeping it running, the window and its address rules, the tray, the single running copy and its command
line, staying out of the way, Windows sign-out, first run, notifications and updates.

## Status

**MAPPED** — LLD and EARS specs written 2026-10-23, before any code (greenfield), with the
intent-narrowing edge audit's findings for the desktop group applied; not yet audited against code. The
server work it relies on is specified in app-shell, live-tracking, airports, logbook, fleet and
simbrief, and the LLD's Relies On cites each of those specs.

Built and tested (2026-10-25) — a desktop shell without notifications, updates or start lists, run
unpackaged by `npm run desktop`: the server in a utility process with its inputs, readiness, start-up
work, restarts, held ports, leftovers, the checks for a server that stops answering, the event stream
and shutdown; daily and `--quit` backups; the logs and settings; the window with its address rules,
screens, settings and remembered place; the tray's status line, dot, tooltip and menu (version line
"Version X" only); one running copy and its command line; the sim in use; Windows sign-out; the look
for a copy run from source. Every module but `main.ts` (the Electron glue) is pure logic driven through
the stand-ins in `ports.ts`, unit-tested under Vitest's `desktop` project, whose guard fails any test
reaching a child process, the network, Electron or `fetch`. Seen by hand on Electron 45: a main process
ended by `taskkill /F` took its server's utility process and every child with it within a second
(DESK-SHELL-SRV-003, SRV-040, WIN-031 stay open until the packaged smoke test cites them).

## References

### HLD
- docs/high-level-design.md (Approach → A Windows app beside the sim; Tenets; System Design; Segments →
  desktop; Key Design Decisions → Shape of the app, Which copy logs flights, When updates install,
  Closing the window, Flying outside the career, Testing)
- docs/intent/desktop/desktop-design.md (sub-HLD: the process model, when the sim is in use, names and
  folders, the platform, test mode, the Relies On the desktop parts share)

### LLD
- docs/intent/desktop/shell/shell-design.md

### EARS
- docs/intent/desktop/shell/shell-specs.md — 226 specs (prefix `DESK-SHELL`): 153 implemented, 72
  active gaps, 1 deferred

### Tests
- tests/desktop/shell/ — Vitest unit tests of the desktop shell's logic in the `desktop` project, on
  `FakeClock` and the stand-ins of tests/desktop/support/fakes.ts: the supervisor
  (supervisor-start, -failures, -health, -ports, -shutdown), shell-start and shell-quit, backups and
  daily-backups, logs, settings, errors, cli and start, first-run, server-inputs, sim-in-use, sse and
  tracker-feed, tray-model, address, page-window, screens, window-options, window-place,
  windows-facts (the pure parsers), glue-wiring (static checks of main.ts) and guard
- tests/desktop/support/guard.ts — the project's setup file: fails a test that reaches
  `child_process`, `net`, `http`, `https`, `dgram`, `electron`, `process.kill` or `fetch`, with decoy
  `LOCALAPPDATA`, `APPDATA` and `USERPROFILE`
- Planned: the packaged smoke test (distribution, tests/packaged/) runs it end to end, the Electron
  glue in main.ts included

### Code
- src/desktop/ — main.ts (the only Electron glue and the only module that loads `electron`); shell.ts
  (the run: start, quitting, the tray's clicks, handed-over starts); supervisor.ts (the server's
  utility process); ports.ts (the stand-in interfaces: clock, launcher, local HTTP, Windows facts, known
  folders, opener, message boxes, window, tray); clock.ts, timing.ts; local-http.ts, sse.ts,
  tracker-feed.ts; backups.ts, daily-backups.ts; logs.ts, settings.ts, errors.ts; cli.ts, start.ts,
  installed.ts; first-run.ts, server-inputs.ts, sim-in-use.ts, windows-facts.ts; tray-model.ts;
  address.ts, page-window.ts, screens.ts, window-options.ts, window-place.ts; version.ts. Nothing in
  src/desktop imports src/server, and no module touches `child_process`, `net`, `http` or `electron`
  at load
- The start-list tray items through start-lists' StartLists (shell.ts, tray-model.ts, main.ts)
- Planned: notifications and updates (electron-updater)

## Architecture

**Purpose:** Keep tracking with the window closed, keep the server running and shut it down cleanly,
show the page in a window that keeps to the page's own origin, and stay out of the pilot's way — never
taking focus or asking anything unprompted, and holding updates and keeping notifications silent while
the sim is in use — while the page stays the same web page the browser tests cover.

**Key Components:**
1. Server host — starts the bundled server in an Electron utility process with explicit inputs (a
   run's first starts telling the tracker to start with casual mode off), takes
   readiness only from its own server's `/api/status` (by process id) and start-up work as done only
   when the status says so, restarts it (giving up only on one that keeps failing as it starts, ending
   one that stops answering, restarting at once one that asks to be started again to finish bringing in
   a logbook), tells a leftover server of its own from another holder of the port, subscribes to the
   event stream again whenever it ends, asks for the daily and pre-update backups (bounded by 60 s
   without progress, a failing daily backup retried after an hour and then daily) and for the tracker's
   state saved at sign-out and suspend, shuts it down cleanly, writes the logs and its own settings
2. Window — the page from `http://127.0.0.1:3380/` only, its settings stated outright, outside links to
   the default browser, the start, failure and quitting screens, a non-2xx main-frame answer taken as a
   failed load, size and place remembered, discarded on close
3. Tray — status line and dot from the tracker's status, the menu (a backups-failing line, **Restart to
   update without a backup** while an update waits on a failed backup), Quit asking from a fresh read of
   the tracker, the one-time notice saying where the icon is, and the one quitting state every quit
   shares (a Quit or `--quit` during an update held, a start-list change under way finished first)
4. Single running copy and command line — `--background`, `--updated`, `--quit`, `--test-data`, a
   notification click, and `--unregister` run before the lock; a start that hands over writes nothing; a
   start during an install leaves its command line in the install-under-way mark for the installer; only
   the installed program runs outside test mode
5. Session watcher — a hidden window that hears Windows sign-out
6. Notifications — pending leg, logged hop, update ready (once per version), stopped tracking, backups
   failing; clicks open the page at a fragment, held for the first load when the app is still starting;
   pending legs remembered across server restarts
7. Updates — electron-updater from GitHub Releases, gated on the sim not being in use
   (docs/intent/desktop/desktop-design.md › The sim is in use: this copy's link, another copy connected,
   or an MSFS 2024 or MSFS 2020 process whatever the server's state), one ready update at a time, backup
   first, installed by Quit, **Restart to update** or by itself at a quiet moment (MSFS closed, window
   shut, no leg in progress, casual mode off, no backup before an update failed in the last hour),
   coming back in the tray; the install-under-way mark written before the last look for starts handed
   over, naming the start asked for afterwards
8. Test mode — the folders, port, single running copy, fake feed and airport downloads off that
   `--test-data` chooses; no update checks, logbook offer or notification registrations, and
   notifications written to `desktop.log`

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Server process: start, readiness, private channel, event stream, shutdown, restarts, sleep and the clock | DESK-SHELL-SRV-001 to 045 | 42 | 0 | 3 |
| Quitting state | DESK-SHELL-QUIT-001 to 012 | 7 | 0 | 5 |
| Backups | DESK-SHELL-BAK-001 to 008 | 7 | 0 | 1 |
| Logs | DESK-SHELL-LOG-001 to 009 | 9 | 0 | 0 |
| Settings | DESK-SHELL-SET-001 to 006 | 6 | 0 | 0 |
| Window | DESK-SHELL-WIN-001 to 032 | 30 | 0 | 2 |
| Tray | DESK-SHELL-TRAY-001 to 027 | 22 | 0 | 5 |
| One running copy and command line | DESK-SHELL-CLI-001 to 022 | 19 | 0 | 3 |
| Staying out of the way | DESK-SHELL-AWAY-001 to 005 | 4 | 0 | 1 |
| Windows sign-out and shutdown | DESK-SHELL-OS-001 to 003 | 3 | 0 | 0 |
| First run | DESK-SHELL-FIRST-001 to 005 | 5 | 0 | 0 |
| Notifications | DESK-SHELL-NOTE-001 to 019 | 0 | 0 | 19 |
| Updates | DESK-SHELL-UPD-001 to 032 | 0 | 1 | 31 |
| Unit-test harness | DESK-SHELL-TEST-001 | 1 | 0 | 0 |

**Summary:** 155 of 226 specs implemented; 70 gaps; 1 deferred (DESK-SHELL-UPD-021, a prerelease
channel). Of the gaps outside notifications and updates: built in part, waiting on notifications,
or updates — DESK-SHELL-SRV-039 (the update check on resume), QUIT-002 (the page's
confirm dialogs and update work while quitting), BAK-005 (the backup before an update; the `--quit`
backup is built), WIN-001 (a notification click's fragment held for the first load), TRAY-015 (the
update items; the start-list items are built), TRAY-016 (update states on the version line), CLI-009 (`--unregister`'s
notification clean-up; its start-list clean-up is built); built and seen by hand but cited by no test until the packaged smoke test —
SRV-003, SRV-040, WIN-031; not begun, belonging to
updates, notifications or an install under way — QUIT-007, QUIT-009 to 011,
TRAY-017, TRAY-023, TRAY-027, CLI-021, CLI-022, AWAY-004. CLI-020 (a start during an install left in the install-under-way mark) is built with distribution's include.

## Key Findings

1. **Built without notifications, updates or start lists** — the desktop shell runs unpackaged
   (`npm run desktop`) and its logic is unit-tested through injected stand-ins; the Electron glue
   (main.ts) is checked only as text until the packaged smoke test runs it.
2. **Built on server work other segments own**, each specified there and cited in the LLD's Relies On.
   app-shell: explicit server inputs and the program folder (APP-SRV-006 to 008, 011), listening only
   on 127.0.0.1 with the Host check and the `Sec-Fetch-Site`/`Origin` rule (APP-SRV-005, APP-API-011,
   012), one `/api/status` contract in every mode (APP-API-004, 008 to 010), start-up work off the event
   loop behind a stand-in answering 503 (APP-SRV-009, 010; the page's retry, APP-UI-030), exit codes and
   when the server exits by itself (APP-SRV-013 to 015, 020), the shutdown order and the private
   channel's typed messages (APP-SRV-016, 019, 022), backups — kinds, progress, short and full
   reasons, names with the logbook's id, pruning per logbook, the data-folder fallback (APP-BAK-001 to
   010) — bringing in a logbook (APP-IMP-001 to 004, APP-UI-038 to 040), the User-Agent (APP-API-005),
   the fragment route (APP-UI-032 to 035), the page below 800 × 600 (APP-UI-041) and the README's steps
   (app-shell's Docs This Segment Owns, which no EARS spec carries). live-tracking: the status and
   `link_holder` (LIVE-API-001, 013), the PC-wide sim-link claim and the sim mode `--sim` gives
   (LIVE-LINK-010, 012 to 015, LIVE-TOOL-004), stopping the link with no disconnect (LIVE-LINK-011), the
   `hop` and `pending` payloads (LIVE-API-014, LIVE-HOP-006), pending-leg ids never reused
   (LIVE-HOP-003), saves and checkpoints (LIVE-SAVE-004 to 007), the merged checkpoint of a logbook
   brought in (LIVE-SAVE-008, 010, 011), casual mode surviving a run's restarts and ending at Shut down,
   MSFS quitting cleanly or a run's first server start (LIVE-CASUAL-011, 013 to 015), and the page's
   reload on reconnecting (LIVE-API-005). logbook: hop ids never given twice in a logbook (LOG-REC-014). airports:
   the popup's official-site link (APT-POP-007) and airport downloads (APT-DATA-020). simbrief: links
   from a plan kept only to other origins (SB-CARD-009). fleet: icon addresses (FLEET-REC-018).
   Shared with the other desktop parts, in the desktop design's Relies On: a server esbuild can
   bundle, with one version from `package.json` (APP-API-005), `/api/status`'s `ready` flag for the test
   harnesses, kept apart from the desktop shell's own readiness, what keeps the logbook and the leg when
   a desktop shell that crashes takes the server with it (the checkpoint, the fresh run and the stale
   lock's takeover), seeding a data folder from the program folder's airport lists and the input that
   turns airport downloads off, a backup before every schema upgrade, the README, and pending legs kept
   in a list (LIVE-HOP-003).
   Of these, all of app-shell's and live-tracking's are built and tested: the bundled server's inputs,
   the start-up worker behind the stand-in's 503, `/api/status` from memory with the logbook's id and
   airport preparation's detail, the exit codes 1, 10, 11 and 12, the data-folder lock, the private
   channel's `save`, `backup` and `shutdown`, backups and bringing in a logbook, seeding and airport
   downloads off, the User-Agent, the sim-link claim and `link_holder`, the merged checkpoint, and the
   page's starting state, fragment route, reloads and layout below 800 × 600. The server bundle and its
   start-up worker run in Electron 45's utility process (`npm run desktop`). Still to come: airports'
   official-site link (APT-POP-007), simbrief's links kept to other origins (SB-CARD-009) and fleet's
   icon addresses (FLEET-REC-018).
3. **Platform behaviour not yet seen working** — notification clicks with no window, the registry keys
   notifications write and the switch Electron 45's notification activation adds to a start; session end
   on a hidden window; Windows 11 hiding a new program's tray icon and the Settings path the one-time
   notice quotes; and a start by the Store edition of MSFS (an open question in the desktop design,
   checked by hand before the first release). Seen: a main process ended outright, by `taskkill /F` or
   `process.kill`, takes its server's utility process with it within a second. A real `Tray` makes
   Explorer record an entry for the program under `HKCU\Control Panel\NotifyIconSettings` (`electron.exe`
   when unpackaged), so `npm run desktop` and the smoke test leave one; the unit tests make no `Tray`.
4. **Cited by other segments** — links that ask for a new window open in the pilot's default browser
   from the installed app's window (DESK-SHELL-WIN-007, which APT-POP-004, APT-POP-007, PLAN-LIST-008,
   SB-CARD-007 and SB-CARD-009 cite and MAP-VIEW-008's attribution links rely on), choices kept per origin under the installed app's fixed
   port (APP-UI-029, MAP-VIEW-002), and confirm dialogs shown as message boxes (DESK-SHELL-WIN-013, cited
   by FLEET-FORM-003). Since the page's own outside links all ask for a new window, a navigation of the
   window (DESK-SHELL-WIN-006) is a guard only, and the smoke test makes one itself
   (DESK-DIST-SMOKE-005).
5. **Shared with its siblings** — the desktop shell cites, rather than restates, what the other desktop
   parts specify: the start-list tray items, message boxes, retry bounds and test-mode rules (DESK-START),
   the packaging names, shortcuts, the desktop build output and the rule that only the installed program
   runs outside test mode (DESK-DIST). Its own process check for "the sim is in use" counts MSFS 2024 and
   MSFS 2020, while Start with MSFS 2024 keeps its 2024-only check (DESK-START-MSFS-004). Its tray clicks
   are ignored while quitting, as every tray item but Open and Show log is (DESK-SHELL-QUIT-003). The
   `--updated` relaunch after **Restart to update**, the `--background` relaunch after a quiet-moment
   install and no relaunch after a Quit that installs are the desktop shell's (DESK-SHELL-UPD-011,
   DESK-SHELL-UPD-012, DESK-SHELL-UPD-028), and it writes that request into the install-under-way mark
   before its last look for starts handed over, taking the mark up again when the install goes no
   further (DESK-SHELL-UPD-031). The mark itself — its form, written once and then only appended to,
   and taken up by renaming it aside before reading it — what counts as an install under way, and the
   installer's one start of the app at the end with the command line that shows the most, a start left
   during the install included, are distribution's (DESK-DIST-INST-025, DESK-DIST-INST-026,
   DESK-DIST-INST-030; used by DESK-SHELL-CLI-020).
6. **Not yet in the HLD's graph** — the desktop shell relies on simbrief (SB-CARD-009), but neither the
   HLD's segment graph nor index.yaml has a simbrief → shell edge. tour-map's open question on basemap
   tiles in a distributed app (its LLD Open Questions 1) may change what the window loads
   (DESK-SHELL-WIN-011, DESK-SHELL-WIN-012).

## Work Required

### Must Fix
1. Add the simbrief → shell edge to the HLD's graph and index.yaml once approved.
2. The packaged smoke test (distribution) runs the Electron glue end to end and cites
   DESK-SHELL-SRV-003, SRV-040 and WIN-031, which are built and seen by hand.

### Should Fix
3. Notifications and updates, test-first, alongside distribution's installer, its include and the
   release workflow (NOTE-*, UPD-*, the rest of QUIT, TRAY, CLI and AWAY-004, BAK-005, SRV-039,
   WIN-001).
