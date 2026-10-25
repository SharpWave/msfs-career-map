# Arrow: distribution

Packaging, installing and releasing the desktop app, one of the three parts of the desktop grouping: the
server and desktop-shell bundles, the electron-builder NSIS installer and uninstaller with its include,
the release workflow, desktop development, the packaged smoke test and the installer round trip.

## Status

**MAPPED** — LLD and EARS specs written 2026-10-23, before any code (greenfield), with the
intent-narrowing edge audit's findings for the desktop group applied; not yet audited against code. What
it relies on is specified in app-shell, airports, live-tracking, logbook and simbrief, and the LLD's
Relies On cites each of those specs.

Built and tested (2026-10-25) — desktop development: the desktop build output `build/desktop/` (the page
copied in as `page/`, the server bundle `server.mjs` with its start-up worker `startup-worker.mjs`, the
desktop shell `main.cjs`, the seed airport lists with their download times, the icons with the tray
icons made from `assets/career-map.ico`, and an app manifest so `electron build/desktop` runs the
shell), `npm run desktop` and `npm run desktop:build`, the check that only the installed program runs
outside test mode, Electron and esbuild pinned, and the folders kept out of git.

Built and tested (2026-10-25) — packaging: electron-builder 26.18.0 and `electron-builder.json` (the
fixed names, the per-user NSIS installer, `release/`, every locale, the icons, the fuses), node-simconnect
and its dependencies shipped as files beside the program, `npm run package`; the packaged layout check
and the packaged smoke test passing on a real packaged build (`npm run test:packaged`); the include's
steps (`build/installer-steps.nsh`) passing their own tests (`npm run test:installer`), and the hooks
(`build/installer.nsh`) compiling inside electron-builder; the start's check for an install under way
(`src/desktop/install-mark.ts`, DESK-SHELL-CLI-020). Run end to end (2026-10-25) on a
`dry-run-v0.8.0` tag: the release workflow (`.github/workflows/release.yml`, `scripts/release/`) on
windows-latest — every check, both packagings, the packaged smoke test and the installer round trip
(the refused `/D=` folder, a silent install, the app started, a newer build installed over the running
app, a silent uninstall, the seeded logbook and backups untouched throughout) — making no draft. Not yet
seen: the wizard's pages and notices, a draft release, an older installer over a newer install.

## References

### HLD
- docs/high-level-design.md (Goals; Approach → A Windows app beside the sim; Success Metrics; Key
  Design Decisions → Shape of the app, Where the logbook lives, Which copy logs flights, When updates
  install, Testing)
- docs/intent/desktop/desktop-design.md (sub-HLD: names and folders, the platform, test mode, the
  Relies On the desktop parts share)

### LLD
- docs/intent/desktop/distribution/distribution-design.md

### EARS
- docs/intent/desktop/distribution/distribution-specs.md — 113 specs (prefix `DESK-DIST`), 84
  implemented, 26 active gaps, 3 deferred

### Tests
- tests/desktop/distribution/ — Vitest unit tests in the `desktop` project: desktop-build (the bundles,
  the start-up worker's address, the seed lists, the app manifest, Electron's command line for
  `npm run desktop`), tray-icons (the tray icons made from the mark), installed-program (only the
  installed program runs outside test mode), package (pinned versions, the npm commands, the folders
  kept out of git), packaging (the fixed names and electron-builder's configuration), release (the
  release scripts: the tag, the published-release check, the notes, the round trip's guard and seed),
  workflow (the release workflow's shape), test-packaged (the port message and Electron's environment);
  tests/desktop/shell/install-mark.test.ts (the mark's form and the start's check)
- tests/installer/ — `npm run test:installer`: the include's steps built into NSIS test programs run on
  temp folders (the install folder check, finding and closing a running copy, the mark and the start
  after an install, `--unregister`'s wait and the uninstaller's last page, the session-end hold)
- tests/packaged/ — `npm run test:packaged`: the packaged layout and the packaged smoke test
- scripts/release/round-trip.ts — the installer round trip, run only by the release workflow

### Code
- scripts/desktop-build.ts (the desktop build output: page, bundles, seed lists, icons, app manifest),
  scripts/tray-icons.ts (the tray icons from assets/career-map.ico), scripts/desktop.ts
  (`npm run desktop`), src/desktop/installed.ts (the installed program's path), tsconfig.desktop.json,
  the `desktop` and `desktop:build` npm commands, .gitignore
- electron-builder.json, build/installer.nsh (electron-builder's hooks), build/installer-steps.nsh (the
  include's steps), src/desktop/install-mark.ts (the install-under-way mark as a start sees it),
  scripts/test-packaged.ts, scripts/release/ (tag, published, notes, guard, seed, round-trip),
  .github/workflows/release.yml, the `package`, `test:packaged` and `test:installer` npm commands

## Architecture

**Purpose:** Make MSFS Career Map a Windows program that installs, updates and uninstalls like any
other without ever reaching the logbook, built and tested from the repository before each release.

**Key Components:**
1. Bundles — the desktop build output `build/desktop/` (the page build copied in from `dist/` as
   `page/`, laid out as in the program's resources, outside the app archive, beside the seed lists; the
   server as an ES module with its start-up worker as a second one and node-simconnect as separate
   files, the desktop shell as one CommonJS file, the seed airport lists with their download times, the
   icons with the tray icons made at build time, and an app manifest), electron-builder's output in
   `release/`, every Chromium locale, the fuses
2. Installer and uninstaller — electron-builder 26.18.0 NSIS per user, the fixed install folder, the
   include (closing a running copy through `--quit`, `--unregister` on a real uninstall, the last page,
   the session end held while installing, the install-under-way mark and the one start of the app at the
   end of an install)
3. Release workflow — GitHub Actions on a version tag, draft releases, fixed forward
4. Development — `npm run desktop` and `npm run desktop:build`; only the installed program runs
   outside test mode
5. Packaged smoke test and installer round trip

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Packaging | DESK-DIST-PKG-001 to 022 | 21 | 0 | 1 |
| Installer, closing a running copy and an install under way | DESK-DIST-INST-001 to 030 | 19 | 1 | 10 |
| Uninstaller | DESK-DIST-UNINST-001 to 015 | 8 | 0 | 7 |
| Releases | DESK-DIST-REL-001 to 018 | 10 | 2 | 6 |
| Development | DESK-DIST-DEV-001 to 007 (003 withdrawn) | 5 | 0 | 1 |
| The include's tests | DESK-DIST-INCL-001, 002 | 2 | 0 | 0 |
| Packaged smoke test | DESK-DIST-SMOKE-001 to 012 | 12 | 0 | 0 |
| Installer round trip | DESK-DIST-TRIP-001 to 008 | 8 | 0 | 0 |

**Summary:** 85 of 113 specs implemented; 25 gaps; 3 deferred (DESK-DIST-INST-017, REL-013, REL-014).
Built, not yet seen working: the wizard and what only it shows — INST-002, 012, 013, 018,
019, 026 (the include's take-up and choice of start are tested; the Finished page is not); UNINST-008
to 010 (the last page's texts are tested, the page is not); INST-006 and DEV-007 (the Start-menu entry
is made; its AppUserModelID and the shortcuts' empty command line are not checked); INST-011 is tested,
INST-027 is seen only on a real Windows shutdown; UNINST-001, 003, 011 (no running copy or start-list
entry at the round trip's uninstall, and its silence is not checked); REL-006 (a draft, made only by a
`v<version>` tag), REL-010 (a published release), REL-011 (an older installer over a newer install).
Built in part: PKG-007
(electron-updater with updates), INST-025 and INST-028 (the desktop shell's own mark before it hands
over, with updates), UNINST-012 (every uninstaller step seen working, waiting on UNINST-001, 003 and 008
to 011). Not code: REL-012 (the first release's gate, waiting on simbrief's SB-CARD-006 and
SB-CARD-009 to 011), REL-016 and REL-017 (the maintainer's rules, written into the README's Releasing).

## Key Findings

1. **Packaged, smoke-tested and round-tripped on a clean runner** — the installer and uninstaller never
   run on a developer's PC (they write the real install folder, HKCU and the Start menu); a
   `dry-run-v<version>` tag runs them in the release workflow's round trip. On windows-latest the
   workflow runs its steps in bash (Windows PowerShell drops the bare `--` of `npm run <script> --
   <flags>`), points TEMP at the runner's own temp folder on D: (SQLite commits on the C: drive were
   measured at up to 588 ms against 13 ms on D:, so the large import's wall-clock tests measured the
   disk), and runs those tests alone after the rest (`CAREER_MAP_TIMED_TESTS=apart`). Seen while
   building: electron-builder, finding no dependencies in `build/desktop/`, packs the repository's
   own production dependencies unless `files` excludes `node_modules`; and electron-builder's `.onInit`
   makes a `/D=` folder before any hook runs, so the include removes it again while empty. VS Code's
   extension host can hold open an `app.asar` under `release/` once a file tool has looked inside it,
   leaving `release/` undeletable until it restarts; `CAREER_MAP_RELEASE` then points the packaged tests
   at a build made with `--config.directories.output=<folder>`.
2. **Built on work other segments own**, each specified there and cited in the LLD's Relies On —
   app-shell: schema changes kept additive (APP-DATA-009; logbook's LOG-REC-013 and LOG-REC-015), so an
   older server runs on a newer logbook; no console launcher or shortcut script, its npm commands for
   development (APP-RUN-001, 002, 019); `npm run build` keeping the page build in `dist/` for source
   runs (APP-RUN-002, APP-SRV-003); the program folder laid out as `page/` beside the seed lists
   (APP-SRV-006), which packaging puts in the program's resources outside the app archive
   (DESK-DIST-PKG-008); a logbook's id kept in its database and carried in backup names, with pruning
   per logbook (APP-DATA-006, APP-BAK-004, APP-BAK-007), which the round trip seeds. airports: seeding
   only the lists missing from the data folder and importing them into a logbook that holds none
   (APT-DATA-017, 001, 002; the smoke test's fixture lists); each list's download time in
   `<list>.downloaded`, an ISO 8601 UTC time ending in `Z` (APT-DATA-018), which the build scripts write
   for the seed lists; airport downloads turned off by an input, set in test mode (APT-DATA-020).
   live-tracking: `sim-fake` taking its airports wherever they appear (LIVE-TOOL-003, for the
   `npm run desktop` example), a leg in the air kept as a pending leg when the sim disconnects
   (LIVE-LEG-008), a leg restored in the air at server start kept as a pending leg unless the sim
   resumes it (LIVE-LEG-016), and a fake-feed server that neither takes nor checks the PC-wide sim-link
   claim (LIVE-LINK-015; so `npm run desktop` and the smoke test run beside an installed app tracking a
   flight). simbrief: the OFP text shown as text and layout only (SB-CARD-006, SB-CARD-009 to 011).
   Shared with the other desktop parts, in the desktop design's Relies On: a server esbuild can bundle,
   with one version from `package.json` reported by `/api/status` (APP-API-005; smoke-test check 1),
   `/api/status`'s `ready` flag the smoke test waits on (APP-API-009), backup names carrying the
   logbook's id and a UTC time and pruning per logbook (the installer round trip), the README's install,
   repair and restore steps (app-shell's Docs This Segment Owns), pending legs kept in a list
   (LIVE-HOP-003), and the PC-wide sim-link claim, which a copy run from source takes only when started
   with `--sim=link` (`npm run dev:sim`; the reason the LLD keeps no launcher or shortcut for one).
   The HLD's segment graph and index.yaml have no airports → distribution edge, though distribution
   relies on airports' seeding, download times and downloads input.
   Of these, built and tested: the npm commands for development, `npm run build` into `dist/` and a
   page served from `<program>/page` (APP-RUN-001, 002, 019; APP-SRV-003, 006); the server's
   bundled entry, `src/server/bundled.ts`, which takes every input from its arguments, and a version
   that the bundle's built-in value replaces when defined and that `/api/status` reports
   (APP-API-005's version half); `/api/status`'s `ready` flag, true once the start-up work and the
   preparation at start have ended (APP-API-009 but for a daily check's repeat); `--sim=fake`
   giving the fake feed and `--airport-downloads=off` downloading nothing; `sim-fake`'s airports
   (LIVE-TOOL-003); a leg kept when the sim disconnects in flight and the restored-leg rule
   (LIVE-LEG-008, 016); pending legs in a list (LIVE-HOP-003); seeding a data folder from the program
   folder's lists and their download times (APT-DATA-017, 018); the logbook's id and backup names with
   pruning per logbook (APP-DATA-006, APP-BAK-004, APP-BAK-007). The sim-link claim (live-tracking) is
   built and tested, a fake-feed server neither taking nor checking it (LIVE-LINK-015).
3. **Before the first release** — the SimBrief OFP text shown as text and layout only (SB-CARD-006,
   SB-CARD-009 to 011), the open part of DESK-DIST-REL-012, whose live-tracking items (pending legs
   kept in a list, LIVE-HOP-003; a leg in the air kept when the sim disconnects, LIVE-LEG-008; a leg
   restored in the air kept as a pending leg unless the sim resumes it, LIVE-LEG-016) are
   implemented and tested — and a start by the Store edition
   of MSFS checked by hand on a real Store install (an open question in the desktop design: the folders,
   the single-instance lock, outliving MSFS). The uninstaller's steps (DESK-DIST-UNINST-012) and the
   handling of a start made during an install (DESK-DIST-INST-028) ship in the first release, since an
   install over a copy runs that copy's uninstaller and its desktop shell hands over.
4. **Built on its siblings** — the desktop shell's `--quit` (DESK-SHELL-CLI-008: a backup and a clean
   shutdown before the installer goes ahead), `--unregister` (DESK-SHELL-CLI-009, DESK-SHELL-NOTE-017)
   and the start lists' clean-up with its exit codes (DESK-START-UNREG-001 to 006: 0 nothing left, 1 an
   `EXE.xml`, 2 Windows' start-up keys, 3 both; the uninstaller's last page, DESK-DIST-UNINST-009,
   names each start list that still holds the entry or could not be checked), the tray icon's dots
   (DESK-SHELL-TRAY-013) and the test-mode rules the smoke test and `npm run desktop` stand on. Which
   start the desktop shell asks for after an install is its own — `--updated` after **Restart to
   update**, `--background` after a quiet-moment install, none after a Quit (DESK-SHELL-UPD-011,
   DESK-SHELL-UPD-012, DESK-SHELL-UPD-028) — and it writes that request into the install-under-way mark
   before its last look for starts handed over (DESK-SHELL-UPD-031). Distribution owns the mark — its
   form, written once and then only appended to, a start's appended line and second look, and taking it
   up by renaming it aside before reading it (DESK-DIST-INST-025, INST-029, INST-030) — the include's one start at the end of an install with the
   command line that shows the most, a start made during the install included (DESK-DIST-INST-026,
   used by DESK-SHELL-CLI-020), and no start of electron-updater's own.
5. **Platform behaviour not yet seen working** — electron-updater's own path on published releases
   (checked by hand on the first pair, the quiet-moment relaunch with `--background` and a start left
   in the mark among them), and the include's use of electron-builder 26.18.0's templates: the
   `--updated` mark every install over an installed copy gives that copy's uninstaller
   (DESK-DIST-INST-023, UNINST-015), the hidden window holding the session end while installing
   (DESK-DIST-INST-027; the README's repair is the fallback should NSIS not allow it), and the one start
   at the end of an install with the Launch box folded in, to be run for an update, a repair and an
   older installer before the first release.
   Not yet measured: the installer's size and the app's memory with the map page loaded (an open
   question in the desktop design).
6. **Known behaviour** — a test-mode copy of the installed program is matched by the installer's and
   uninstaller's running-copy check but never reached by their `--quit`, so it is ended once the 90 s
   wait is over (DESK-DIST-INST-011, INST-016; recorded in the LLD's Decisions & Alternatives).
7. **Open with the user** — the licence and code signing.

## Work Required

### Must Fix
1. Add the airports → distribution edge to the HLD's graph and index.yaml once approved.
2. Run the wizard by hand on a test machine (never the development PC) for the Finished pages, the
   uninstaller's last page and the notices, and an older installer over a newer install.

### Should Fix
3. The start lists' `--unregister` and the desktop shell's updates and notifications (the shell's mark
   before it hands over); the first release after SB-CARD-006 and SB-CARD-009 to 011 are closed and a
   start by the Store edition of MSFS has been checked by hand.

### Nice to Have
4. Settle the licence and code signing.
