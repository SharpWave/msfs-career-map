---
parent: desktop
prefix: DESK-DIST
---

# Distribution

## Context and Design Philosophy

Distribution turns the repository into the Windows program the pilot installs and keeps installed
copies current: the packaged program, its installer and uninstaller (built by electron-builder, with an
NSIS include of the app's own, `build/installer.nsh`), the release workflow that builds, tests and
drafts each version, and the harness that runs the desktop shell from source and the packaged app end
to end. It meets the HLD's goal that installing, updating and uninstalling work like any
Windows program and never delete or overwrite the logbook. What the program does once installed is the
[desktop shell](../shell/shell-design.md)'s.

## Packaging

The tools and their pinned versions are in [Desktop › Platform](../desktop-design.md#platform), and the
names and folders that never change in
[Desktop › Names and folders](../desktop-design.md#names-and-folders).

The installer target is NSIS (Decisions & Alternatives: Packaging).

**The build folders.** The desktop build scripts build into the **desktop build output**, `build/desktop/`,
a folder apart from the page build in `dist/` that nothing but those scripts empties. It holds the page
build, copied in from `dist/` as `page/` after Vite has built it there, the server and desktop-shell bundles,
the seed airport lists and the icons, laid out exactly as packaging lays them out in the program folder,
and an app manifest of its own — a `package.json` naming the package `msfs-career-map`, the product
MSFS Career Map and the desktop-shell bundle `main.cjs` as its entry — so `electron build/desktop` runs
the desktop shell unpackaged. electron-builder
packages from it and writes its own output — the unpacked build and the installer — to `release/`, set
in its configuration rather than left at electron-builder's default, `dist/`. Both folders are kept out
of git; the NSIS include, `build/installer.nsh`, is kept in it (Decisions & Alternatives: The build
folders). `npm run build` and `npm start` keep building and serving the page from `dist/` for a copy run
from source (app-shell, APP-RUN-002).

**What the program holds**:

- **The page**: the Vite build, as `page/` in the program's resources, outside the app archive
  (`app.asar`, the read-only file holding the app's code), beside the seed airport lists: the program
  folder app-shell's server reads, laid out as it gives (APP-SRV-003, APP-SRV-006; Decisions &
  Alternatives: The page outside the app archive).
- **The server**: `src/server` bundled by esbuild into an ES module, `server.mjs`, with its start-up
  worker beside it as a second one, `startup-worker.mjs` (the start-up work runs in a worker thread,
  which loads a module file of its own), each with a `require` shim for its CommonJS dependencies and
  the version from `package.json` built in, so `/api/status` and every User-Agent report it (app-shell,
  APP-API-005). node-simconnect and its own dependencies are not bundled: they ship
  as separate files outside the app archive, with node-simconnect's LGPL-3.0 licence, so the library can
  be replaced as its licence expects.
- **The desktop shell**: `src/desktop` bundled by esbuild into one CommonJS file, `main.cjs`, with the
  version built in.
- **The seed airport lists**: OurAirports' `airports.csv` and `runways.csv` (public domain), put in the
  desktop build output by the desktop build scripts, and from there into the program's resources. Each
  carries the time it was downloaded, recorded beside it in the form airports reads (`<list>.downloaded`,
  an ISO 8601 UTC time ending in `Z`, APT-DATA-018), so the monthly refresh of a data folder seeded from
  them counts from the release's download rather than from the first start (airports, APT-DATA-003,
  APT-DATA-017). The scripts download them only when the desktop build output lacks one or its
  download time, keeping lists already there so a rebuild needs no connection; run with `--fresh` they
  download both again, as the release workflow always does (Decisions & Alternatives: When the build
  downloads the seed lists). They sit in the desktop build output laid out exactly as packaging lays
  them out in the program folder, so `npm run desktop`, whose program folder is the desktop build
  output, seeds a fresh data folder from them just as the installed app does (Development).
- Nothing used only to build or develop: tsx, Vite and the page's libraries stay out of the package.
- Every Chromium locale, so dates and numbers follow the pilot's Windows language as they do in a
  browser.
- The icons: `career-map.ico` for the program, installer and shortcuts, holding a 256 px image; and the
  tray icons — the plain mark with no dot, and the mark with each of the tray's status dots
  ([Shell › The Tray](../shell/shell-design.md#the-tray)) — each holding 16, 20, 24 and 32 px images.
  The repository keeps only `assets/career-map.ico`: the desktop build scripts copy it into the desktop
  build output's `icons/` and make the tray icons there from it (`scripts/tray-icons.ts`), the same mark
  always giving the same files (Decisions & Alternatives: The tray icons).

**Fuses** — switches built into the Electron program when it is packaged: RunAsNode and `NODE_OPTIONS`
are off, so neither variable can change what the installed program runs. The inspect switches stay on:
the packaged smoke test drives the app through them, and a per-user install is writable by its own user
anyway.

## Installer and Uninstaller

**The wizard** installs for the current Windows user only, needing no administrator rights, and offers
no folder choice:

1. The licence, shown only once the repository has one.
2. Installing.
3. Finished. On a first install it has two boxes, both ticked: "Create a desktop shortcut" and "Launch
   MSFS Career Map now". Over an installed copy it has only the Launch box, ticked.

electron-builder's page asking whether to install for everyone or only the current user is skipped,
the include choosing the current user. A first install adds the Start-menu entry "MSFS Career Map",
carrying the AppUserModelID, and the desktop shortcut when ticked. A silent first install creates the
Start-menu entry and the desktop shortcut and does not start the app. Every install writes the uninstall
entry in Windows' Apps list.

**Installing over an installed copy** — an update, silently from electron-updater or by the pilot
running a newer installer, a repair with the same version's installer, or an older installer run by
hand — keeps the Start-menu entry and the desktop shortcut as the pilot left them, neither recreating one
the pilot deleted nor removing one the pilot kept; its Finished page therefore offers no shortcut box
(Decisions & Alternatives: Shortcuts over an installed copy). Uninstalling and installing again brings
both back. Every such install, with its wizard or silently, first runs the installed copy's uninstaller
silently with `--updated` on its command line: the mark electron-builder's installer gives that
uninstaller, by which it knows the run is not a real uninstall (The uninstaller, below).

**Starting the app after an install over an installed copy.** At the end of every install over an
installed copy, the include takes up the install-under-way mark (below) and then starts the app at
most once, with the command line that shows the most — no switch, then `--updated`, then
`--background` — among:

- the start the desktop shell asked for in the mark when it handed over to the installer
  ([Shell › Updates](../shell/shell-design.md#updates)), the last it added counting: `--updated` after
  **Restart to update**, `--background` after an update installed at a quiet moment, so the app comes
  back in the tray, and none after a Quit that installs or a quiet-moment install during which the pilot
  chose Quit, before or after the mark was written;
- each start made while the install ran, left in the mark;
- run with its wizard, "Launch MSFS Career Map now" when ticked, a start with no switch, which is then
  that one start.

With none of these it starts nothing: the pilot's own silent install (`/S`) leaves the app stopped, even
when it closed a running copy to install, unless a start was made meanwhile. The desktop shell asks
electron-updater for no start of its own after the install (Decisions & Alternatives: A start during an
install).

**An install under way.** A start made while an install runs — MSFS through `EXE.xml`, Windows sign-in,
a notification click or the pilot — would otherwise find the program half replaced, or start the old
copy that the install then sends `--quit` and leaves stopped. The **install-under-way mark**, a file
`install-under-way` in electron-updater's download folder (`%LOCALAPPDATA%\msfs-career-map-updater`),
outside the install folder the install replaces, says an install is running. It is written whole once
and from then on only appended to, a line at a time, never rewritten, so writers at the same moment
never lose each other's lines:

- The desktop shell writes it as it hands over to the installer — at the end of a Quit, a **Restart to
  update** or a quiet-moment install — before its last look for starts handed over and before it
  releases the single-instance lock, naming its own process and the start it asks for afterwards. A Quit
  held after that, during a quiet-moment install, adds a requested start of none; the last requested
  start counts. When that install then goes no further, the desktop shell takes the mark up and takes
  each start left in it as a start handed over ([Shell › Quitting](../shell/shell-design.md#quitting)).
- The include marks the install at the start of every install over an installed copy, before it closes
  a running copy, naming the installer's own process: when the installer was started from the download
  folder, as electron-updater starts it, it appends that line to the mark in place, keeping all it
  holds; otherwise it writes a new mark in place of any other, so an installer the pilot runs by hand,
  with its wizard or silently, is marked too.
- An install counts as under way while the mark is in place and a process it names, or an installer
  started from the download folder, runs for this Windows user. A mark with neither running — left by an
  install that a session end or a crash cut off — is ignored.
- A start outside test mode that finds an install under way takes no single-instance lock, appends its
  command line to the mark — opening it for appending only, never creating it — and looks again: with
  the mark still in place it exits, and with the mark gone, taken up meanwhile, it starts as usual
  ([Shell › One Running Copy](../shell/shell-design.md#one-running-copy)). A line is then never lost: it
  is either read by whoever took the mark up or met by its start's second look; should both happen, the
  app is started twice, and the second start only hands its command line over to the first.
- Whoever takes the mark up — the include at the end of the install, or the desktop shell when the
  install goes no further — renames it aside first, then reads and deletes the renamed file. The include
  does so before it starts the app, so that start never finds the install still under way.

A start made during an install runs whichever program is then in the install folder, the old one as
often as the new, and the desktop shell that hands over is the version already installed; the check for
an install under way and the mark therefore ship in the first release, as the uninstaller's steps do (The
uninstaller, below).

**A session end while installing.** From the start of an install over an installed copy until it is done
or stops, the include holds the end of the Windows session with the reason "Installing an update to MSFS
Career Map": a hidden window of its own refuses Windows' query to end the session, so Windows' shutdown
screen names the app and waits unless the pilot forces it. A session ended between the installed copy's
uninstaller removing the program and the new files landing would leave no program for MSFS, Windows
sign-in or the Start menu to start. The usual cases are a pilot who quits the app, which installs a ready
update, and then shuts Windows down, and one who shuts Windows down while a ready update installs by
itself at a quiet moment ([Shell › Updates](../shell/shell-design.md#updates)). The hold belongs to the
installer being run, the new release's own, so unlike the uninstaller's steps (The uninstaller, below)
it protects installs from the release that brings it (Decisions & Alternatives: A session end while
installing; Open Questions 5 and 6).

**Install folder.** The program is always installed in `%LOCALAPPDATA%\Programs\MSFS Career Map`. A
different folder given on the installer's command line (`/D=`) stops the installer before it writes
anything, so the uninstaller, which removes the install folder and everything in it, can never reach
the data folder, the backups folder or Electron's own folder.

**Closing a running copy.** electron-builder's hook for this, `customCheckAppRunning`, replaces its own
check entirely, so the include does all of it, for the installer and the uninstaller alike. It matches
processes by their path inside the install folder — the desktop shell and its server's utility process
alike — so a copy running from elsewhere, such as a smoke-test build, is left alone; it never locks the
installed files.

1. When such a process is running for this Windows user, the wizard says, with OK and Cancel, that MSFS
   Career Map will be closed — the installer's adding that it records nothing until it starts again,
   while the uninstaller's, which runs with its wizard only for a real uninstall, says no more — and
   Cancel stops the wizard. A silent run asks nothing.
2. It runs the installed program with `--quit`
   ([Shell › One Running Copy](../shell/shell-design.md#one-running-copy)), so the running copy takes its
   backup and shuts its server down cleanly.
3. It waits up to 90 s for every such process to end, then ends any left, as electron-builder's own
   check would.

A test-mode copy of the installed program (`--test-data=<folder>`) runs from the install folder too, so
the check matches it. The `--quit` reaches only the copy holding the installed app's single-instance
lock, never a test-mode copy, whose lock is in its own folder
([Desktop › Test mode](../desktop-design.md#test-mode)); a test-mode copy is therefore ended once the
90 s wait is over (Decisions & Alternatives: A test-mode copy when installing).

**The uninstaller** runs for a real uninstall, when the pilot uninstalls the app, and also as the
installed copy's uninstaller that every install over it runs first (an update, a repair or an older
installer); run that way, it leaves everything the pilot keeps from one version to the next. It takes a
run with `--updated` on its command line as one by an install over the installed copy, and any other run
as a real uninstall. It:

- closes a running copy as above;
- on a real uninstall, runs the program with `--unregister`
  ([Start lists › Unregistering](../start-lists/start-lists-design.md#unregistering)) before removing it,
  waiting up to 30 s and then going ahead regardless, so the app's entries leave `EXE.xml` and both of
  Windows' start-up keys, and its notification registrations go; run by an install over the installed
  copy, it skips this step;
- removes the program folder and the Apps entry, whichever way it runs;
- on a real uninstall, also removes the Start-menu entry, the desktop shortcut and electron-updater's
  download folder (`%LOCALAPPDATA%\msfs-career-map-updater`), which holds no logbook data; run by an
  install over the installed copy, it leaves all three — the shortcuts as the pilot left them, and the
  download folder because electron-updater's running installer is inside it;
- itself writes, changes or deletes nothing in the data folder, the backups folder or Electron's own
  folder; what lands there during an uninstall is the app's own doing: the backup the running copy takes
  at `--quit`, and `--unregister`'s `desktop.log` entries, start-up list backups and its one change to
  the settings;
- on a real uninstall run with its wizard, ends on a page naming the data folder, the backups folder and
  Electron's own folder as a whole (`%APPDATA%\MSFS Career Map`: the settings, logs, caches and the
  start-up list backups), saying they were kept and can be deleted by hand. `--unregister`'s
  exit code says which start lists still hold the app's entry or could not be checked — 0 neither, 1 an
  `EXE.xml`, 2 Windows' start-up keys, 3 both
  ([Start lists › Unregistering](../start-lists/start-lists-design.md#unregistering)). For each one the
  code names, the page says it still holds the app's entry or could not be checked, and names where the
  entry "MSFS Career Map" can be removed by hand: both editions' `EXE.xml` folders for an `EXE.xml`, and
  Windows' Run key for the start-up keys (the Run key alone, since a value left under StartupApproved
  with none in Run starts nothing). When `--unregister` cannot be started, does not exit within
  the 30 s, or exits with a code the uninstaller does not know, the page says the start lists could not
  be checked, and names both editions' `EXE.xml` folders and Windows' Run key as places where an entry
  named "MSFS Career Map" may need deleting by hand.

A silent uninstall shows nothing and writes no log of its own: `--unregister`'s outcome is in
`desktop.log`, and the README and the release notes name the data and backups folders.

Every install over an installed copy runs that copy's uninstaller, so a change to the uninstaller's
steps takes effect one release late. The steps above therefore ship in the first release.

## Releases

A release is built by a GitHub Actions workflow on `windows-latest` when a tag `v<version>` is pushed.
A tag whose version differs from `package.json`'s fails the workflow before it builds anything, and no
draft is made. For a matching tag the workflow runs:

1. `npm ci`, the type checks, the Vitest suites and the Playwright browser tests.
2. Build the page, the server bundle and the desktop-shell bundle; download the seed airport lists
   afresh (`--fresh`).
3. Package the app, unpacked and as the installer.
4. Run the packaged smoke test against the unpacked build, and the installer round trip (Tests).
5. Publish a draft GitHub release holding the installer, its blockmap (which lets electron-updater
   download only the changed parts) and `latest.yml`, with release notes giving the installer's SHA-256
   and naming the data and backups folders.

The workflow uses only its own GitHub token. The maintainer publishes the draft by hand; installed
copies see a release only once it is published. Releases are not code-signed (Open Questions): Windows
SmartScreen warns when a downloaded installer is first run, and on a PC with Smart App Control on,
Windows may block the unsigned program and its updates outright, whoever starts them. Updates the app
installs itself carry no download mark, so SmartScreen does not prompt for them. A release ships at
least every six months, to stay on a supported Electron, and sooner when Chromium has security fixes.

A broken release is fixed by publishing a higher version; a published release is never deleted,
retagged or replaced. An older installer run by hand over a newer install is not refused: its server
runs on the newer logbook, since schema changes are additive and an older server ignores what it does
not know (app-shell, APP-DATA-009; logbook, LOG-REC-013, LOG-REC-015), and the updater offers the newer release again at its next check.

The first release requires:

- pending legs kept in a list (LIVE-HOP-003), since with the window closed a second pending leg must
  never replace the first;
- a leg in the air when the sim disconnects kept as a pending leg (LIVE-LEG-008), since a sim that
  stops in flight must not lose the leg, and with the window closed a dropped leg would go unseen
  where a pending one reaches the pilot;
- a leg restored in the air at server start continuing only when the sim resumes it, and kept as a
  pending leg otherwise (LIVE-LEG-016), since in the desktop app the server often stops together with
  the sim — Windows shutting down overnight, a sign-out, the installer's `--quit` — and the next session
  must neither discard the leg nor log a guessed hop;
- the SimBrief plan's OFP text shown as text and layout only — cleaned through an allowlist
  (SB-CARD-006), its links kept only to other origins (SB-CARD-009), nothing in it loading from any
  address (SB-CARD-010) and drawn inside its own box (SB-CARD-011) — since it runs on the page's own
  origin, where markup could do anything the page can.

## Development

- `npm run dev` runs the server and page from source on ports 3080 and 5173 against the repository's
  `data/` folder (app-shell, APP-RUN-001). It is how the server and page are developed. It links to the
  sim only when started as `npm run dev:sim` (`--sim=link`, APP-RUN-019, LIVE-LINK-013), and never while
  another server holds the PC-wide sim-link claim
  ([Desktop › Relies On](../desktop-design.md#relies-on)), so it runs beside the installed app without
  taking its flights.
- `npm run desktop` builds the page with Vite into `dist/` and copies it into the desktop build output
  (`build/desktop/`, Packaging), builds the server and the desktop shell there, puts the seed airport
  lists there, and starts Electron unpackaged in test mode
  ([Desktop › Test mode](../desktop-design.md#test-mode)) on `.desktop-dev\` in the repository, kept out
  of git, with DevTools available. Its program folder is the desktop build output, so a fresh
  `.desktop-dev\` is seeded from those lists as an installed app's first data folder is, and its first
  start needs no connection (Decisions & Alternatives: Seed lists for `npm run desktop`). Its server
  runs on the fake feed, which never takes the PC-wide sim-link claim, so it runs beside an installed
  app tracking a flight (Relies On). A synthetic flight drives it with `npm run sim-fake -- --base http://127.0.0.1:3280 KBOS KPVD`, its option before
  the airports (Relies On).
- `npm run desktop:build` builds the page and the desktop build output as `npm run desktop` does, and
  starts nothing. Either takes `--fresh` to download the seed lists again.
- Only the installed program runs outside test mode. A desktop shell started without `--test-data`
  whose own program path, fully resolved and compared without regard to case, is not `MSFS Career
  Map.exe` in `%LOCALAPPDATA%\Programs\MSFS Career Map` — unpackaged, or packaged and run from anywhere
  else, such as the unpacked build in `release/` — says on the console it was started from that it runs
  only in test mode, with no message box, and exits before it sets either folder or asks for the
  single-instance lock. No build but the installed one can therefore open the installed app's logbook,
  take its single-instance lock or point its notification registration at itself (Decisions &
  Alternatives: A build outside the install folder).
- `npm run test:packaged` first checks that port 3280 is free, and when it is held fails at once with a
  plain message naming `npm run desktop`, which uses the same port, as the likely holder; a smoke-test
  copy finding the port held by another folder's server would otherwise give up at once with a reason
  that reads like a fault of the app.
- Some hosts, VS Code's among them, set `ELECTRON_RUN_AS_NODE`, which makes Electron run as plain Node;
  the desktop scripts clear it. A packaged build ignores it (Fuses).
- Electron's binary downloads on first use; CI fetches it with `npx install-electron`.
- The installer's Start-menu entry and desktop shortcut start the installed app; `npm run dev` runs the
  server and page from source.

## Tests

Unit tests (`tests/desktop/distribution/`, Vitest in Node, no Electron) read the packaging names from the
electron-builder configuration, and cover the check that only the installed program runs outside test
mode: the program in the install folder runs, its path written in another case or not yet fully
resolved included; an unpackaged Electron, a packaged build in `release/` and a copy of the program
anywhere else are refused before either folder is set or the lock asked for.

**The packaged smoke test** (`tests/packaged/`, `npm run test:packaged`) runs the unpacked packaged build
in `release/` through Playwright's Electron support, once port 3280 is found free (Development), in test
mode ([Desktop › Test mode](../desktop-design.md#test-mode)) on a temporary folder whose data folder
holds the fixture airport lists before the app starts — the app's seeding copies in only the lists a
data folder lacks and imports those already there, and with airport downloads off in test mode nothing
replaces them (Relies On) — with the window's outside requests blocked. It checks, for the
[desktop shell](../shell/shell-design.md) and the [start lists](../start-lists/start-lists-design.md),
that:

1. the window shows the page from `http://127.0.0.1:3280`, titled "MSFS Career Map", and, once
   `/api/status` reports its `ready` flag (the server's start-up work done and airport preparation
   ended, APP-API-009), `/api/status` reports the fixture airport count and `package.json`'s version;
2. a synthetic sample shows the live aircraft — the server, tracker, event stream and `node:sqlite`
   working in Electron's Node — and the tray icon exists, its status line, read through the main
   process, following that sample;
3. an outside link opens no window in the app and reaches the default-browser call, and a navigation of
   the window to an outside address, made by the test, leaves the page in place — no link of the page's
   own navigates there, since its outside links all ask for a new window
   ([Shell › The Window](../shell/shell-design.md#the-window));
4. closing the window leaves the tray icon and the server tracking — a sample sent afterwards is
   recorded — and a second start on the same folder opens the window in the first copy;
5. a server ended from outside is started again and the page reconnects; a port held by a program that
   gives no HTTP answer leaves the failure screen with that reason after the retries; and a second
   test-mode copy on another folder, finding the port held by the first, gives up at once with its own
   reason, naming port 3280;
6. Quit, with the leg in progress landed so that it asks nothing, ends the server cleanly, its process
   gone and its port free, and the next start restores that leg;
7. the sim's `EXE.xml` files, both of Windows' start-up keys (Run and StartupApproved), the
   ToastActivatorCLSID's keys under `HKCU\Software\Classes` and the Start-menu shortcut are byte for
   byte the same after the run as before; and the installed app's folders — the data folder, Electron's
   own folder, `MSFS Career Map` in Documents and electron-updater's download folder — are still absent
   after the run where absent before, as on the release workflow's clean runner. Where one exists, as on
   a developer's PC, it is compared file for file before and after only when no process of the
   installed app runs at either time; otherwise the comparison is skipped and the reason written to the
   test's output, since an installed app that runs changes its own folders.

**The installer round trip** runs only in the release workflow, on a clean runner, never on a developer's
PC. It seeds and installs over the real data and backups folders, so started anywhere but the release
workflow's runner it refuses to run and touches nothing. Its steps: install silently, start the app,
install a newer build over the running app, then uninstall. Before the install over the running app it
deletes the desktop shortcut the first install made and makes electron-updater's download folder with a
file in it; after that install the Start-menu entry is still there, the desktop shortcut still absent
and the download folder still holds its file, and the uninstall then removes the entry and the folder.
These are the uninstaller's two ways of running, which must ship correct in the first release, since a
mistake in them would show only a release later. The seeded logbook carries a logbook id of the round
trip's own, written into the seeded database where app-shell keeps it, and the seeded backups folder
holds two daily backups of that logbook and no other backup, each named as the server names its own,
with that id and a UTC time ending in `Z` (app-shell, APP-DATA-006, APP-BAK-004). The server prunes only the backups of the logbook
it holds, keeping its seven newest daily backups and three newest others and never a **Back up now**
copy or the newest backup taken before an upgrade: the steps add at most one daily backup, which leaves
both seeded ones within the seven kept, and the others they add — at each `--quit`, before an upgrade —
cannot prune a daily one (APP-BAK-007). Backups named with no id, or another, would lie outside that pruning and prove
nothing. After each step the seeded logbook holds the same hops and both
seeded backups are still there, unchanged; the uninstall leaves no program folder, shortcut, Apps
entry, Run or StartupApproved value, ToastActivatorCLSID registration, or electron-updater download
folder. An install with `/D=` naming another folder is refused and writes nothing.

## Relies On

What distribution needs from other segments, recorded here as cascade notes; each segment's own
design and specs say how. What the desktop parts share from other segments is in
[Desktop › Relies On](../desktop-design.md#relies-on).

**app-shell**:

- Schema changes stay additive, so an older server runs on a newer logbook, ignoring what it does not
  know (APP-DATA-009; a hop it logs there stored with the newer columns left at their defaults, and one
  it edits keeping them, logbook, LOG-REC-015, LOG-REC-013) (Releases).
- app-shell keeps no console launcher or shortcut script (`start.cmd`, `scripts/install-shortcut.ps1`);
  its npm commands are for development (APP-RUN-001, APP-RUN-002, APP-RUN-019).
- `npm run build` keeps building the page into `dist/`, which `npm start` serves for a copy run from
  source (APP-RUN-002, APP-SRV-003); the desktop build output is a folder apart (Packaging).
- The program folder the server reads holds the page build as `page/` beside the seed airport lists and
  their download times (APP-SRV-006; app-shell's The Program Folder), which packaging lays out in the
  program's resources, outside the app archive, and the same way in the desktop build output
  (Packaging).
- A logbook's id is kept in its database (APP-DATA-006) and every backup's name carries it
  (APP-BAK-004), so the installer round trip can seed a logbook with an id of its own and name its
  seeded backups with it, as the server names its own; pruning counts only the backups of the logbook
  being backed up (APP-BAK-007) (Tests).
- The bundled server reports `package.json`'s version in `/api/status` (APP-API-005), and its `ready`
  flag once its start-up work is done and airport preparation has ended (APP-API-009), which the smoke
  test waits on (Tests).

**airports**:

- Seeding copies in from the program folder only the airport lists (`airports.csv`, `runways.csv`)
  missing from the data folder, keeping any already there (APT-DATA-017), and imports the lists into a
  logbook that holds none (APT-DATA-001, APT-DATA-002): the packaged smoke test makes the data folder
  itself and puts its fixture lists there before the first start (Tests).
- Each list carries the time it was downloaded, recorded beside it as `<list>.downloaded`, an ISO 8601
  UTC time ending in `Z` (APT-DATA-018), and the monthly refresh counts from that time (APT-DATA-003);
  the desktop build scripts record it with the seed lists in that form, which carry it into the program
  folder (Packaging).
- An input of the server's (`--airport-downloads`, APP-SRV-006) turns airport downloads off — the
  monthly refresh and any download at start (APT-DATA-020); test mode sets it, so the smoke test's
  fixture lists are never replaced.

**live-tracking**:

- `npm run sim-fake` takes as its two airports the first two arguments that are neither options nor
  option values, wherever they appear (LIVE-TOOL-003), so the Development example can give `--base`
  before the airports.
- A leg in the air when the sim disconnects is kept as a pending leg ending at its last sample, with no
  destination (LIVE-LEG-008). The first release waits for it (Releases).
- A leg restored in the air at server start continues only when the first sample of a sim connection
  shows the same aircraft, airborne, within the jump bound. Otherwise — a new flight loaded, another
  aircraft, a jump, or the aircraft on the ground — the tracker keeps it as a pending leg ending at its
  last sample, with no destination, never discarding it or closing it as a hop. The first release waits
  for it (LIVE-LEG-016; Releases).
- A server on the fake feed neither takes nor checks the PC-wide sim-link claim (LIVE-LINK-015;
  [Desktop › Relies On](../desktop-design.md#relies-on)), so `npm run desktop` and the packaged smoke
  test run beside an installed app tracking a flight, and the smoke test's tray status line follows its
  own samples whatever that app is doing (Development, Tests).

**simbrief**:

- The SimBrief card shows a plan's OFP text as text and layout only — cleaned through an allowlist
  (SB-CARD-006), its links kept only to other origins (SB-CARD-009), nothing in it loading from any
  address (SB-CARD-010) and drawn inside its own box (SB-CARD-011) — since it runs on the page's own
  origin; the first release waits for all four (Releases).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| A broken release | Fixed by a higher version; published releases never deleted, retagged or replaced; an older installer run by hand not refused | Pulling or replacing the release; refusing to install over a newer version | Installed copies and the update chain may already hold a published release, and a replaced file under the same version breaks the blockmap and hashes they rely on. A pilot running an older installer has chosen it, the logbook stays readable to it, and the updater offers the newer release again. |
| Packaging | electron-builder 26.18.0: an NSIS wizard, per user | Electron Forge with Squirrel, WiX MSI or MSIX; Inno Setup | A conventional wizard, uninstall entry and in-place updates through electron-updater. Forge has no NSIS maker of its own, and electron-builder's `electron-forge-maker-nsis` would bring electron-builder in anyway; Squirrel installs silently into `%LOCALAPPDATA%\<name>`, which could be the data folder; WiX v3 is out of support; MSIX needs signing and deletes app data it redirected when uninstalled; Inno Setup would need an updater of its own. |
| Who it installs for | The current user only, the install-for-everyone page skipped | electron-builder's choice page; a per-machine install | A per-user install needs no administrator rights to install or update, like the other sim companions on the pilot's PC (Volanta, Navigraph Hub). A per-machine install asks for them at every update, so it could not install one by itself at a quiet moment, and its installer's **Launch** would start the app as administrator, at a different integrity level from the sim and from the copy MSFS starts. |
| The install folder | Always `%LOCALAPPDATA%\Programs\MSFS Career Map`; another folder given with `/D=` refused | Accepting any folder; refusing only a folder that is or holds the data folder | The uninstaller removes the install folder and everything in it. A fixed folder is one it can be shown never to share with the logbook, its backups or Electron's folder, whatever else the pilot keeps on the disk. |
| Shortcuts over an installed copy | Kept as the pilot left them by every install over an installed copy (update, repair, older installer); its Finished page offers only Launch | Offering "Create a desktop shortcut" on every wizard run; recreating the shortcuts at each install; recreating only a missing Start-menu entry | Whether to keep a desktop shortcut is the pilot's choice, made at the first install; an update or repair that brought a deleted one back would undo it, and a box on every run would ask again what was already answered. The Start-menu entry, which every first install makes, is the pilot's to remove in the same way. Notification clicks are routed through it ([Shell › Notifications](../shell/shell-design.md#notifications)), so a pilot who deletes it may leave a click on a notification without its way to the app; uninstalling and installing again brings it back. |
| A test-mode copy when installing | Matched by the running-copy check and ended once the 90 s wait is over | Sending it a `--quit` of its own; leaving it running | Running from the install folder, it would hold installed files open if left. Its `--quit` would need its folder, which the include could learn only by reading each process's command line; a test-mode copy works on a test folder, never the logbook, so ending it costs only the wait. |
| Building the server | One esbuild bundle and its start-up worker, node-simconnect left as separate files | `tsx` at runtime; compiling with `tsc`; bundling node-simconnect too; inlining the worker as a `data:` module | `tsx` works through its register API, but compiles the sources as they load and ships esbuild's native binary unpacked beside the app archive; Node's own type stripping rejects the parameter properties the server uses (`routes.ts`, `tracker.ts`). A bundle starts fastest. The start-up work runs in a worker thread, which needs a module file of its own: a `data:` module resolves no relative or bare import and has no file URL for the `require` shim. Separate files let node-simconnect be replaced, as its LGPL-3.0 licence expects. |
| The desktop shell's module format | One CommonJS bundle | An ES module | An ES-module main process that waits for Electron's ready event at top level hangs, and electron-updater is CommonJS. |
| Locales | All of Chromium's | English only, about 51 MB smaller | Dates and numbers follow the pilot's Windows language, as in a browser tab. |
| Fuses | RunAsNode and `NODE_OPTIONS` off; inspect switches on | Every fuse off | Neither variable can change what the program runs. The smoke test needs the inspect switches, and turning them off guards nothing in a per-user install its own user can rewrite. |
| A build outside the install folder | Test mode only: any desktop shell whose resolved program path is not `MSFS Career Map.exe` in the install folder exits when started without `--test-data` | Holding only unpackaged builds to test mode; the installed app's folders for any build | A packaged build run from anywhere else — the smoke test's unpacked build double-clicked, a local package — would take the installed app's lock, open the pilot's logbook and upgrade it with unreleased code, and point the notification registration at a folder the next build empties. Comparing the program's own resolved path with the install folder catches every such build, packaged or not, with nothing to configure. |
| The page outside the app archive | The page build as `page/` in the program's resources (electron-builder's `extraResources`), beside the seed airport lists, and laid out the same in the desktop build output | The page inside `app.asar`, given to the server as an input of its own | app-shell's program folder is then one input holding everything the server reads from the program, laid out the same packaged and unpackaged, and the server reads plain files as it does from `dist/`, needing nothing of Electron's archive support (app-shell's The Program Folder). |
| The build folders | `build/desktop/` for the desktop build output, emptied only by its own scripts; electron-builder's output set to `release/` | Building into the page build's `dist/`; electron-builder's default output, also `dist/` | Vite empties `dist/` at every page build, so a page build would delete the seed lists, making a rebuild need a connection again, and the unpacked build the smoke test runs; and `npm start` would serve whatever else lay there. |
| Seed lists for `npm run desktop` | Downloaded by the desktop build scripts into the desktop build output, laid out as packaging lays them out in the program folder | Copying the lists `npm run dev` keeps in `data/`; leaving the server to download them at first start | One source and one layout for the packaged and the unpackaged build, so `npm run desktop` runs the seeding the installed app relies on. `data/` may hold no lists or older ones, and a download at first start is what seeding exists to avoid. |
| When the build downloads the seed lists | Only when the desktop build output lacks one or its download time; `--fresh` downloads both again, and the release workflow always uses it | Downloading at every build; downloading once and never refreshing | A rebuild, `npm run desktop` included, needs no connection and does not fetch OurAirports' files again each time, while each release, built on a clean runner, ships the current lists. Lists only ever kept would age with no way to refresh them short of deleting the desktop build output. |
| The tray icons | Made by the desktop build scripts from `assets/career-map.ico`, the mark with each status dot drawn on at 16, 20, 24 and 32 px | Drawn by hand and kept in `assets/`; drawn by the desktop shell at run time | One mark to keep: a change to it reaches every tray icon at the next build, with no set of hand-made files to fall out of step. Made at build time, the icons are plain files the tray loads, with no drawing in the desktop shell and nothing made but kept in git. |
| Console launcher and shortcut script | None: the installer's shortcuts start the app, `npm run dev` runs it from source | Keeping `start.cmd` for running from source; keeping the shortcut script | `npm run dev` covers development, and the installer makes the shortcuts. A copy run from source links to the sim only when started with `--sim=link` (`npm run dev:sim`), and never while another server holds the PC-wide sim-link claim ([Desktop › Relies On](../desktop-design.md#relies-on)), so a shortcut to one would start a copy that records no flight; the installed app's shortcuts are the only ones a pilot needs. |
| A start during an install | The install-under-way mark in electron-updater's download folder, written by the desktop shell before it hands over or by the include for an installer run by hand, then only appended to; a start that finds it appends its command line there, looks again and exits; the mark taken up by renaming it aside before it is read; the include starts the app once at the end with the one that shows the most, the desktop shell's own request included | A separate process left waiting for the installer to end; holding Quit's install while the sim is in use; electron-updater's own start after the install; each start rewriting the mark; reading the mark in place and then deleting it | The installer runs to the end regardless, so it can start the app itself with no other process left behind, and the download folder lies outside the install folder the install replaces. Two starts at once — MSFS and Windows sign-in — each rewriting the mark would lose one, and a line added between a read in place and the delete would be lost; appending only, renaming aside before reading, and a start's second look lose none. Holding Quit's install while the sim is in use would only make installs rarer, and Quit is a moment the app stops anyway. electron-updater's own start after an install carries only `--updated`: it could neither bring the app back in the tray after a quiet-moment install nor carry a start made during the install, and two starters would start the app twice. |
| A session end while installing | The include's hidden window holds the session end with a reason until the install is done | A RunOnce entry that resumes the install at the next sign-in; nothing beyond the README's repair | Windows' shutdown screen then names the app and waits unless the pilot forces it, so a shutdown soon after a Quit, or while an update installs at a quiet moment, does not cut the install off between the old program's removal and the new one's arrival. The installer being run is the new release's, so the hold needs no release's delay. A RunOnce entry would add the app to Windows' start-up list without the pilot asking (A guest in the sim's house). Where electron-builder 26.18.0's NSIS cannot hold the session end, running the release's installer again repairs the install, as the README says. |
| Releases | Draft releases built by GitHub Actions on a version tag, tested, with SHA-256 hashes; unsigned | Built on the maintainer's PC; signed | Builds are repeatable from the repository and tested before publishing, and nothing reaches installed copies until the draft is published. Signing is open (below). |

## Open Questions & Future Decisions

### Open

1. **Licence** — the repository has none. MIT is the suggestion; the installer's licence page appears
   once one exists, and free code signing through SignPath requires an OSI licence.
2. **Code signing** — releases are unsigned. Windows SmartScreen shows "Windows protected your PC" when a
   downloaded installer is first run, until that version builds reputation, and Smart App Control blocks
   unsigned programs without reputation. Updates the app installs itself get no SmartScreen prompt, but
   Smart App Control checks every program it runs, so where it is on an unsigned update can be blocked
   like the first install; an unsigned update is also only as trustworthy as the GitHub account
   publishing it. While releases stay unsigned, Defender or Smart App Control can quarantine or block an
   update installed on Quit or at a quiet moment with nothing left running to say so; running the release's installer again
   repairs the install, as the README's troubleshooting says. Signing has consequences for the update
   chain: the first signed release fixes the publisher name electron-updater checks, a change of
   publisher needs a transition release listing both names, and every release after the first signed
   one must be signed. The options: SignPath Foundation (free for open source; an OSI licence, builds
   from the repository, approval of each release, and "SignPath Foundation" shown as publisher), Azure
   Artifact Signing (about $9.99 a month, for individuals only in the US and Canada), or an OV
   certificate (about $150–300 a year, on a hardware key).
3. **The desktop-shortcut box** is not part of electron-builder's wizard; the include adds it to the
   last page of a first install, and keeps it off that page over an installed copy.
4. **Playwright's Electron support** is marked experimental.
5. **Skipping the install-for-everyone page** (the include's `customInstallMode`, choosing the current
   user), refusing a `/D=` folder, and the install folder's name are read from electron-builder
   26.18.0's templates and not yet run. Whether its uninstaller already removes the update downloads
   folder is also still to be seen; where it does not, the include does. So is the `--updated` mark the
   installer gives the installed copy's uninstaller (Installer and Uninstaller): before the first
   release, the build's installer is run over an installed copy of a lower version, of the same version
   and of a higher version, each with its wizard and silently, to confirm that every one passes it, and
   electron-updater's own run is checked with the first pair of published releases (question 6). A
   missing mark would remove the shortcuts and the update downloads folder and run `--unregister` at an
   ordinary update, and a fix to the uninstaller's reading of it takes effect only a release later. Also
   still to be run: the include holding the session end while it installs — Windows takes a reason only
   from a top-level window, which a silent NSIS run does not make, so the include makes a hidden one,
   through NSIS's System plugin, that refuses the query to end the session; should electron-builder
   26.18.0's NSIS not allow it, that is recorded here and the README's repair step stays the remedy —
   and the include starting the app at the end of an install, once, with "Launch MSFS Career Map now"
   folded in.
6. **electron-updater's own path** ([Shell › Updates](../shell/shell-design.md#updates)) — finding a
   published release, downloading it, the backup, installing on Quit, **Restart to update** starting the
   app with `--updated`, a quiet-moment install starting it with `--background`, a start made during the
   install left in the install-under-way mark and started afterwards, and the session end held while
   installing — is never run by the release workflow, which works before the draft is published. It is
   checked by hand on the first pair of published releases; whether to automate it, for example against
   a local generic provider in CI, is decided after that.

### Deferred

1. **electron-builder 27** signs update manifests with an Ed25519 key it requires by default; moving to
   it means keeping that key for good.
2. **A winget listing** — it needs a licence value. A package manager would run the installer silently
   over a live copy, which nothing else does; before a listing, a silent run that finds the app's running
   copy with [the sim in use](../desktop-design.md#the-sim-is-in-use) leaves that copy running and exits
   with an "application in use" code.

## References

- Parent: [Desktop](../desktop-design.md) — names and folders, the platform, test mode
- HLD: [docs/high-level-design.md](../../../high-level-design.md) — Goals, Approach (a Windows app
  beside the sim), Success Metrics, and the decisions Shape of the app, Where the logbook lives, Which
  copy logs flights, When updates install and Testing
- Siblings: [Shell](../shell/shell-design.md) (what the packaged program does, `--quit`),
  [Start lists](../start-lists/start-lists-design.md) (`--unregister` and its exit codes)
- Related designs: [app-shell](../../app-shell/app-shell-design.md) (the server bundle, logbook ids,
  the README), [airports](../../airports/airports-design.md) (seeding a data folder, the lists' download
  times, airport downloads turned off), [live-tracking](../../live-tracking/live-tracking-design.md)
  (first-release gates, `npm run sim-fake`, the fake feed and the sim-link claim) and [simbrief](../../simbrief/simbrief-design.md) (a
  first-release gate)
- Code: the desktop build scripts writing to `build/desktop/` (`scripts/desktop-build.ts`,
  `scripts/tray-icons.ts`, `scripts/desktop.ts`), `tests/desktop/distribution/`,
  [assets/career-map.ico](../../../../assets/career-map.ico)
- Code (planned): `build/installer.nsh` (the NSIS include), electron-builder's configuration,
  electron-builder's output in `release/`, `.github/workflows/release.yml`, `tests/packaged/`
- External: Electron (fuses), electron-builder (NSIS target and include hooks)
