# Arrow: distribution

Packaging, installing and releasing the desktop app, one of the three parts of the desktop grouping: the
server and desktop-shell bundles, the electron-builder NSIS installer and uninstaller with its include,
the release workflow, desktop development, the packaged smoke test and the installer round trip.

## Status

**MAPPED** — LLD and EARS specs written 2026-10-23, before any code (greenfield), with the
intent-narrowing edge audit's findings for the desktop group applied; not yet audited against code. No
tests or code yet. What it relies on is specified in app-shell, airports, live-tracking, logbook and
simbrief, and the LLD's Relies On cites each of those specs.

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
- docs/intent/desktop/distribution/distribution-specs.md — 110 specs (prefix `DESK-DIST`), none
  implemented, 3 deferred

### Tests
- None yet. Planned: tests/packaged/ (the packaged smoke test), unit tests in tests/desktop/distribution/
  (the packaging names, and the check that only the installed program runs outside test mode), and the
  installer round trip in the release workflow

### Code
- None yet. Planned: build/installer.nsh (the NSIS include), electron-builder's configuration, the
  server and desktop bundle scripts writing to build/desktop/, electron-builder's output in release/,
  .github/workflows/release.yml; assets/career-map.ico exists and is reused

## Architecture

**Purpose:** Make MSFS Career Map a Windows program that installs, updates and uninstalls like any
other without ever reaching the logbook, built and tested from the repository before each release.

**Key Components:**
1. Bundles — the desktop build output `build/desktop/` (the page build copied in from `dist/` as
   `page/`, laid out as in the program's resources, outside the app archive, beside the seed lists; the
   server as one ES module with node-simconnect as separate files, the desktop shell as one CommonJS
   file, the seed airport lists with their download times), electron-builder's output in `release/`,
   every Chromium locale, the fuses
2. Installer and uninstaller — electron-builder 26.18.0 NSIS per user, the fixed install folder, the
   include (closing a running copy through `--quit`, `--unregister` on a real uninstall, the last page,
   the session end held while installing, the install-under-way mark and the one start of the app at the
   end of an install)
3. Release workflow — GitHub Actions on a version tag, draft releases, fixed forward
4. Development — `npm run desktop`; only the installed program runs outside test mode
5. Packaged smoke test and installer round trip

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Packaging | DESK-DIST-PKG-001 to 022 | 0 | 0 | 22 |
| Installer, closing a running copy and an install under way | DESK-DIST-INST-001 to 030 | 0 | 1 | 29 |
| Uninstaller | DESK-DIST-UNINST-001 to 015 | 0 | 0 | 15 |
| Releases | DESK-DIST-REL-001 to 017 | 0 | 2 | 15 |
| Development | DESK-DIST-DEV-001 to 007 (003 withdrawn) | 0 | 0 | 6 |
| Packaged smoke test | DESK-DIST-SMOKE-001 to 012 | 0 | 0 | 12 |
| Installer round trip | DESK-DIST-TRIP-001 to 008 | 0 | 0 | 8 |

**Summary:** 0 of 110 specs implemented; 107 gaps; 3 deferred (DESK-DIST-INST-017, REL-013, REL-014).
No tests yet.

## Key Findings

1. **Greenfield** — the LLD and specs exist; tests and code do not.
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
   (LIVE-LEG-008, 016); pending legs in a list (LIVE-HOP-003). Still to come: the seed lists in the
   program folder and their download times, seeding (airports), the logbook's id and backup names
   (app-shell's backups). The sim-link claim (live-tracking) is built and tested, a fake-feed server
   neither taking nor checking it (LIVE-LINK-015).
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
1. Review the LLD and specs with the segments they cite; add the airports → distribution edge to the
   HLD's graph and index.yaml once approved.

### Should Fix
2. Tests first: the packaging-names and program-path unit tests, then the packaged smoke test once the
   desktop shell runs.
3. The installer, its include and the release workflow; the first release after SB-CARD-006 and
   SB-CARD-009 to 011 are closed and a start by the Store edition of MSFS has been checked by hand.

### Nice to Have
4. Settle the licence and code signing.
