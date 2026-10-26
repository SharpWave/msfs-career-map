---
parent: high-level-design
prefix: APP
---

# App Shell

## Context and Design Philosophy

The app is a local, single-user program: one server on the pilot's own PC serves the API and the
page, keeps the logbook in one SQLite file, and talks to the sim on the same machine. There is no
account and no cloud service of its own. Installed, the server runs bundled into the desktop app, in
a process the desktop shell starts, supervises and stops ([Desktop](../desktop/desktop-design.md)); in
development, the same server and page run from source with npm and a browser tab. app-shell is what
holds the server and the page together in both: the server's inputs, start and shutdown, the data
folder with its backups and logbook import, how the API answers and whom it answers, the page layout
the segments' cards and layers sit in, shared formatting, the development scripts and the test
harness.

This segment owns:

- the server: its inputs, its start order and start-up work, `/api/status`, the private channel's
  requests, shutting down, exits and errors, and serving the API, icons and page
  ([server.ts](../../../src/server/server.ts) with its two entries [index.ts](../../../src/server/index.ts)
  and [bundled.ts](../../../src/server/bundled.ts), [inputs.ts](../../../src/server/inputs.ts),
  [status.ts](../../../src/server/status.ts), [checks.ts](../../../src/server/checks.ts),
  [standin.ts](../../../src/server/standin.ts), [channel.ts](../../../src/server/channel.ts),
  [shutdown.ts](../../../src/server/shutdown.ts), [app.ts](../../../src/server/app.ts));
- the data folder and the database: where they are, opening and in-place schema upgrades, the
  logbook's id, one server per data folder, backups, and bringing in a logbook from another data
  folder or a backup ([locations.ts](../../../src/server/locations.ts), [db.ts](../../../src/server/db.ts),
  [lock.ts](../../../src/server/lock.ts));
  each table's meaning belongs to the segment that uses it;
- API conventions: error responses, ids, the request checks that keep other sites' pages out, the
  status endpoint, the version and the User-Agent, the page's request helper
  ([routes.ts:28-62](../../../src/server/routes.ts#L28-L62), [842-857](../../../src/server/routes.ts#L842-L857),
  [api.ts](../../../src/client/api.ts));
- the page: the full-window map with panels floating over it, the sidebar, the menu and its drawers,
  which part of the map the panels cover, loading, starting and error states, error boundaries, the
  hand-off fragment, bringing in a logbook and **Back up now**, reloading for a new version or another
  logbook ([App.tsx](../../../src/client/App.tsx), [layout.ts](../../../src/client/layout.ts),
  [Sidebar.tsx](../../../src/client/components/Sidebar.tsx),
  [Menu.tsx](../../../src/client/components/Menu.tsx), [Drawer.tsx](../../../src/client/components/Drawer.tsx),
  [ErrorBoundary.tsx](../../../src/client/components/ErrorBoundary.tsx), [index.html](../../../src/client/index.html));
- the look: glass panels, colors, typefaces, icons, focus and motion
  ([styles.css](../../../src/client/styles.css), [Icon.tsx](../../../src/client/components/Icon.tsx),
  [main.tsx](../../../src/client/main.tsx));
- shared formatting of durations, distances, heights, dates and aircraft names ([format.ts](../../../src/client/format.ts));
- the development scripts and the icon tool ([package.json](../../../package.json), [scripts/make-ico.mjs](../../../scripts/make-ico.mjs)),
  and the test harness behind `npm test` and `npm run test:e2e`;
- the README and the project notes in CLAUDE.md, as far as they describe running, installing and
  looking after the app ([Docs This Segment Owns](#docs-this-segment-owns)).

The cards, layers and endpoints themselves belong to their segments: the live card and tracker
(live-tracking), the hop form and hop lists (logbook), the planner card (planner), the fleet list
(fleet), the map, its toolbar and the Layers menu (tour-map), the flight panel (flight-panel),
preparing airport data (airports). app-shell decides where they sit and how they look. The desktop
app — the window, the tray, the single running copy, keeping the server running, deciding when and
where the logbook is backed up, which logbook to offer on a first run, packaging, installing and
updating — is the desktop group's ([Desktop](../desktop/desktop-design.md)); it relies on what this
segment's server does, as its Relies On sections say.

## Server

### Where It Runs

| Mode | How the server runs | Started by |
|---|---|---|
| **The installed app** | Bundled by esbuild into one file, in an Electron utility process; the private channel to the desktop shell open | The desktop shell, with start-up arguments |
| **The desktop app's test mode** (`--test-data=<folder>`) | As installed, with the values test mode gives ([Desktop › Test mode](../desktop/desktop-design.md#test-mode)) | The desktop shell, with start-up arguments |
| **A copy run from source** | From the TypeScript sources with `tsx`, on the system's Node; no private channel | `npm run dev`, `npm run dev:sim`, `npm start`, the browser-test server |
| **The test servers** | The app `createApp` builds, on a free port, inside a Vitest test file | The API tests |

### Inputs

The server is told everything about where it runs. The bundled server takes its inputs only from
its start-up arguments: when one it needs is missing it writes "Cannot start: no <input> given" and
exits, so a start that forgets the data folder can never create a logbook inside the program's own
folder, where the next update would replace it. A copy run from source accepts the same arguments
and takes anything they leave out from its environment and the repository.

| Input | Start-up argument | A copy run from source, when the argument is left out |
|---|---|---|
| Data folder | `--data=<folder>`; the database is its `career.db` | The folder of `CAREER_DB` when set, else the repository's `data/`; the database is `CAREER_DB`'s file, else `data/career.db` |
| Program folder: the built page and the seed airport lists, laid out as The Program Folder (below) gives | `--program=<folder>` | None: the page from `dist/`, no seed lists |
| Port | `--port=<n>` | `PORT`, else 3080 |
| Backups folder | `--backups=<folder>`, a literal path; or `--backups-documents=<path>`, a path under Windows' Documents known folder, looked up at each backup | The data folder's `backups` folder |
| Sim | `--sim=link`, `--sim=fake` or `--sim=off`; the sim mode each gives is live-tracking's (LIVE-LINK-012) | The sim mode live-tracking gives a copy run from source (LIVE-LINK-013, and LIVE-LINK-002 for a sim on another PC), which links to the sim only when `--sim=link` is given, as `npm run dev:sim` gives it |
| Airport downloads (airports' monthly refresh and any download at start) | `--airport-downloads=on` or `off` | On |
| Logbook to offer (a copy run from source the desktop shell found) | `--offer=<folder>`, optional | None |
| Fresh run (the tracker to start with casual mode off) | `--fresh-run`, optional | Never given |

The installed app's values and test mode's are the desktop design's; the desktop shell passes them
and strips from the server's environment every variable a copy run from source reads, so nothing left
in the environment can point the installed server at another logbook, port or sim. The bundled
server reads none of them either (live-tracking, LIVE-LINK-012, for the sim's).

**The test servers** take their inputs as a copy run from source given no arguments does: the
database from `CAREER_DB`, which the shared setup points at the test file's own data folder, that
folder's `backups` folder, and the sim mode live-tracking takes from `TRACKER_FAKE`
(LIVE-LINK-013). A `PORT` that is not a port number gives them, and the tools that open the
database the same way (`npm run import-airports`), the default port rather than an error: they
listen on none, and their database is found apart from it. Airport downloads are off through a
parameter of the preparation step the shared setup runs (Tests). They do no start-up work and take no
lock — the database opens as the modules load — so their `startup` is `done` from the start, and
`airportData` and `ready` report the setup's preparation. A test server that accepts a logbook to
bring in leaves the shutdown that follows to the test that built it, so the test's own process goes
on.

The server finds every file through these inputs and never through a path worked out from where its
own code lies, beyond a copy run from source's defaults. So the same code runs from the sources and
bundled into one file, which the desktop build makes with the version from `package.json` built in
([Distribution › Packaging](../desktop/distribution/distribution-design.md#packaging)).

### The Program Folder

The program folder is an interface between this segment and desktop distribution: the server reads
it, and distribution lays it out — in the packaged program's resources, outside the app archive
(`app.asar`), and the same way in the desktop build output, `build/desktop/`, which `npm run desktop`
gives as its program folder. The server never writes to it.

| Path in the program folder | What |
|---|---|
| `page/`, with `page/index.html` | The page build, Vite's output |
| `airports.csv`, `airports.csv.downloaded` | The seed airport list and the time it was downloaded (airports) |
| `runways.csv`, `runways.csv.downloaded` | The seed runway list and the time it was downloaded (airports) |

A program folder without the lists seeds nothing (airports).

### Starting

In every mode but the test servers, the server starts in this order:

1. **Listen** on 127.0.0.1 at its port, and answer `/api/status` with its start-up step `opening`.
   It writes to its output the address, the data folder, the sim and the version. A port in use, or
   one Windows refuses, ends the server with an exit code of its own (Exits and errors).
2. **Start-up work on the logbook**, each step named in `/api/status` as it runs:
   - take the data folder's lock (One server per data folder) — `opening`;
   - finish bringing in a logbook, when a complete copy waits beside the database — `bringing-in`;
   - open the database; put a restored backup's icons in place (Backups › Restoring), and give the
     logbook its id when it is a restored backup or has none (The Logbook's Id) — `opening`;
   - when opening it is a schema upgrade, back it up, named with that id — `backing-up` — and upgrade
     it — `upgrading`;
   - have the tracker restore its checkpoint, passing it the fresh-run argument when given
     (live-tracking).

   Then the step is `done`, the API answers, and backups the private channel asked for meanwhile are
   taken.
3. **Prepare airport data**: airports seeds, downloads and imports the lists as it says, reporting
   its progress in `/api/status`.
4. **Start the sim link**, when the sim input is the sim link, once airport preparation has ended,
   succeeded or failed (live-tracking). The monthly refresh of the airport lists starts then too, with
   a check handed to it — this server's sim link connected, or the tracker holding a leg in
   progress, both from the tracker's status — and a notice whenever either changes, so airports
   waits for the sim without reading the tracker.

`/api/status` reports `ready` once the start-up work is done and airport preparation has ended. The
test harnesses wait for it before they read the airport count. It stays `true` for as long as the
server runs: when a daily check repeats a preparation that failed (airports), `airportData` reports
the repeated preparation step by step in place of the earlier report, while `ready` does not change —
`ready` says the start is over, and `airportData` what the server is doing with its airport data. The desktop shell judges readiness
differently: its server is ready when `/api/status` answers at all with this app's name and the
process id it started, and the start-up work done when `startup` says `done`
([Shell › Ready](../desktop/shell/shell-design.md#ready)).

**While the start-up work runs** the server's start-up stand-in (Serving) serves the page's own
files, uploaded icons and `/api/status`, and answers every other `/api` request with 503,
`Retry-After: 1` and `{"error": "MSFS Career Map is starting (<step>)"}`, applying the same request
checks as the full app (Requests From Other Sites). The page takes a 503 at its first load as the
server starting (The Page › Starting).

**Off the event loop.** `node:sqlite` works synchronously, and opening a logbook can mean recovering
its write-ahead log, backing it up and upgrading it — work that grows with the logbook. So the
start-up work's opening, recovery, backup, upgrade and swap run in a worker thread with a database
connection of its own, and `/api/status` keeps answering within a second throughout. The server's
own connection, and every module that prepares statements on it as it loads (routes, airports,
tracker, simbrief), are loaded only once that work is done; by then the schema step finds nothing
left to change. `createApp` builds the full app — it is what the server loads at that point and what
the API tests build directly, with the database opened as the module loads (Serving).

### `/api/status`

One contract in every mode — the installed app, test mode, a copy run from source and the test
servers — answered from the moment the server listens, from what the server holds in memory, never
reading the database:

| Field | Value |
|---|---|
| `ok` | `true` |
| `app` | `"msfs-career-map"`, the package name, which never changes |
| `version` | The app version (API Conventions) |
| `pid` | The server's process id |
| `dataFolder` | The data folder, as an absolute path |
| `logbookId` | The logbook's id (The Logbook's Id), the id its backups are named with, kept in memory once the start-up work has given or read it; `null` before |
| `sim` | `"link"`, `"fake"` or `"off"` |
| `startup` | `"opening"`, `"bringing-in"`, `"backing-up"`, `"upgrading"` or `"done"` |
| `airportData` | Airport preparation: `state` — `"waiting"` until the start-up work is done, then `"seeding"`, `"downloading"`, `"importing"`, `"done"` or `"failed"`; `list` (`"airports"` or `"runways"`) while downloading or importing; `rows` and `total` while importing; `error` once failed. A preparation a daily check repeats after a failure (airports) replaces the earlier report from the moment it starts |
| `ready` | `true` once `startup` is `"done"` and airport preparation at start has ended, succeeded or failed, and from then on for as long as the server runs, through a repeated preparation too |
| `airports`, `runways` | The counts, kept in memory once the logbook is open and after each import; `null` before |

Readers: the desktop shell (readiness, the start-up step it shows in the tray, its look for a copy
run from source, a held port); the page (Starting; the airport-data notice; bringing in a logbook; a
new version or another logbook); the test harnesses and the packaged smoke test (`ready`, the
airport count, the version). The desktop shell's look for a copy run from source
([Shell › First Run](../desktop/shell/shell-design.md#first-run)) counts a copy on the fake feed as a
test run, never a logbook to offer, which is why `sim` is part of the contract. `logbookId` tells a
page left open which logbook the server holds: a server started again on another logbook — one
brought in, or a backup restored by hand — keeps its data folder but reports another id, and the page
reloads itself (The Page › A new version or another logbook).

In the test servers, `startup` is `done` from the start, since they do no start-up work, and
`airportData` and `ready` report the preparation the shared setup runs (Inputs).

### Requests From Other Sites

The server listens only on 127.0.0.1, in every mode, so nothing off the PC reaches it. Two checks
keep other sites' pages, running in the pilot's own browser, from acting through it:

- **Host.** A request whose `Host` names anything but `127.0.0.1` or `localhost` (any port), or none,
  is answered 403 and acted on in no way, so another site's name pointed at 127.0.0.1 reaches nothing.
- **Changes.** A request other than GET, HEAD or OPTIONS is refused with 403 `{"error": "refused: a
  change asked for by another site"}` when it carries a `Sec-Fetch-Site` other than `same-origin` or
  `none`, or, without that header, an `Origin` other than the server's own — `http://127.0.0.1:<port>`
  or `http://localhost:<port>`, the port the request arrived on — `Origin: null` included. A request
  with neither header is a program's, not a page's — the desktop shell's probes, `sim-fake`, the tests,
  curl — and is allowed; any program on the PC can do what the pilot can.

A simple cross-site POST needs no CORS preflight, so these checks, not CORS, are what stop another
site's page from logging, discarding or switching anything. The page's own requests carry
`Sec-Fetch-Site: same-origin`, in the window, in a browser tab, and through the page's dev server,
whose proxy passes that header on while it rewrites only `Host`.

### The Private Channel

Installed and in test mode, the server's utility process has a message channel only the desktop
shell holds ([Desktop › Processes](../desktop/desktop-design.md#processes)). It carries three requests,
and none of them is offered over HTTP, where any web page or program on the PC could stop tracking.

Each message is an object with a `type`. Each request but Shut down carries an `id` the desktop
shell picks, and every answer to it repeats that id: backups queue one behind another, and a save
can be answered while a backup still runs, so answers do not arrive in the order asked.

| Request (desktop shell → server) | The server | Answers (server → desktop shell) |
|---|---|---|
| `{type: "backup", id, kind, version}` — `kind` `"daily"`, `"update"` or `"quit"` (at the installer's or uninstaller's `--quit`); `version`, the version about to install, with `"update"` only | Takes the backup (Backups) | `{type: "backup-progress", id}` at least every 2 s while it copies; then `{type: "backup-done", id, file}`, `file` the backup's full path, or `{type: "backup-failed", id, short, reason}`, the short and full reasons (Backups › Failures) |
| `{type: "save", id}` | Has the tracker write its checkpoint, changing nothing else | `{type: "saved", id}` once it is written — at once while the tracker has not yet restored its checkpoint |
| `{type: "shutdown"}` | Shuts down (below) | None: its process exiting is the answer |

A message of any other shape is written to the server's output and otherwise ignored.

### Shutting Down

The server shuts down in an order that keeps the leg exactly as it was:

1. Stop taking samples and stop the sim link, with no disconnect reaching the tracker (live-tracking).
2. Switch casual mode off (live-tracking) — only when the app is quitting (below).
3. Write the tracker's final checkpoint.
4. Stop any airport-data work (airports) and abandon any backup or logbook copy under way, deleting its
   unfinished file.
5. Close the event streams and stop listening.
6. Checkpoint and close the database.
7. Remove the data folder's lock, and exit with code 0.

It runs on the private channel's Shut down, which the desktop shell sends only when the app is set to
quit, with casual mode switched off, since no server is left to hear MSFS close. A copy run from source
runs it on a stop signal — SIGINT (Ctrl+C), SIGBREAK (Ctrl+Break), SIGHUP (its console window
closed), or SIGTERM where the system delivers one, which Windows never does — with casual mode left as
it is, since it has no app to quit (Decisions & Alternatives). On Windows a server under `tsx watch`
(`npm run dev`, `npm run dev:sim`) never runs the order: the watcher ends its process outright, with
no handler run, as a crash does — when it restarts on a change and when Ctrl+C stops it alike — and so
does the browser tests' teardown. The tracker's last checkpoint holds the leg, the next start takes
over the lock left behind as stale, and SQLite's write-ahead log keeps every committed write. A copy
run with `npm start` runs the order on a stop signal.
A shutdown asked for during the start skips the steps the start has not reached; a swap of the
logbook under way finishes, and an upgrade under way rolls back. The server exits within 5 s of the
request whether or not every step has finished — leaving margin inside the desktop shell's 10 s wait —
since every write is already committed by then.

When the desktop shell ends without sending Shut down — its process crashes or is ended — the server
cannot see it happen and runs no shutdown: Electron ends the utility process with the desktop shell
(Decisions & Alternatives). What that leaves is already safe: SQLite's write-ahead log keeps every
committed write; the tracker's checkpoint is a few seconds old at most and is written at once at every
change of leg (live-tracking); the next run's first server start switches casual mode off (the
fresh-run input, Inputs); and the data folder's lock is stale and taken over at the next start (One
Server per Data Folder).

The order is kept in a module of its own (`shutdown.ts`), apart from the start order (`server.ts`)
and the two entries that start a server as they load (`index.ts` for a copy run from source,
`bundled.ts` for the desktop app), and is handed the sim link, the tracker, the listening server, the
database and the lock it acts on as each comes to exist, so a test can run it in process with stand-in
parts (Tests).

### Exits and Errors

| Exit code | When |
|---|---|
| 0 | Shut down cleanly |
| 1 | It cannot start — an input missing, a data folder or database it cannot use, a data folder another server holds, a logbook it could not back up before upgrading it — or an error escaped its request handlers |
| 10 | Its port is in use |
| 11 | Windows refuses it the port (an excluded port range) |
| 12 | To finish bringing in a logbook: start it again (Bringing In a Logbook) |

Each exit but 0 and 12 follows a plain error line, the last the server writes. Once its start-up work is
done, the server exits on its own only to finish bringing in a logbook, when shut down, or on an
error outside its handlers. An error inside a request handler is answered (API Conventions) and the
server keeps running; an uncaught exception or unhandled rejection is written out with its stack and
ends the server at once, without a final save — its state may no longer be sound, and the tracker's
last checkpoint, a few seconds old, holds the leg; the desktop shell starts a new server.

The server writes its log only to its output and error streams: the desktop shell keeps them in its
own `server.log`, and a copy run from source writes them to its console. Nothing in the data folder
is a log.

### Serving

Once the start-up work is done, the server serves what one function, `createApp`
([app.ts](../../../src/server/app.ts)), builds, and building it starts nothing (no listening, no sim
link, no data loading). The server and the API tests both use it, and the request checks above are
part of it.

Until then a **start-up stand-in** serves in its place: the page's own files, `/images` and
`/api/status`, with the same request checks, and 503 for every other `/api` request (Starting). It
loads no module that opens the server's own database connection, which is why it is apart from
`createApp`, and the server hands every request to the full app once the start-up work is done.

- `/api` — the API, accepting JSON bodies up to 8 MB (icon uploads arrive as data URLs).
- `/images` — uploaded aircraft icons, cached by the browser for a year (each upload's address
  carries a new `?v=` stamp, so a replaced icon is fetched fresh).
- The built page — from the program folder's `page` folder, or `dist/` in a copy run from source —
  with every other path answered by its `index.html`. A copy run from source without a build
  answers `/` in plain text that the API is running and how to get the page (`npm run dev`, or
  `npm run build` and start again).

## Data and Database

([locations.ts](../../../src/server/locations.ts), [db.ts:1-19](../../../src/server/db.ts#L1-L19))

### The Data Folder

The installed app's and test mode's folders are the values the desktop design gives
([Desktop › Names and folders](../desktop/desktop-design.md#names-and-folders),
[Desktop › Test mode](../desktop/desktop-design.md#test-mode)); the others are this segment's.

| Mode | Data folder | Backups folder |
|---|---|---|
| The installed app | `%LOCALAPPDATA%\MSFS Career Map` | `MSFS Career Map\Backups` in Documents, looked up at each backup |
| The desktop app's test mode | `<folder>\data` | `<folder>\Backups` |
| A copy run from source | `data/` in the repository, or the folder of `CAREER_DB` | `backups` in the data folder |
| A Vitest test file, the browser-test server | A folder of its own in the run's temporary folder | `backups` in that data folder |

| In the data folder | What |
|---|---|
| `career.db` (with `-wal` and `-shm`) | The logbook database; in a copy run from source, `CAREER_DB`'s file |
| `career.db.lock` | The running server's lock |
| `images/` | Uploaded icons (fleet) |
| `airports.csv`, `runways.csv` and their `.downloaded` times | The OurAirports lists (airports) |
| `backups/` | A copy run from source's and a test's backups |
| `career.db.incoming`, `career.db.incoming.json` | A logbook being brought in, until the next start |
| `career.before-import-<time>.db`, `images.before-restore-<time>` | What bringing in a logbook, or restoring a backup, replaced |
| `career.before-update-<version>.db`, `career.before-<version>.db` | The backup before an update, or before an upgrade, when the backups folder could not be written |

When a copy run from source's `CAREER_DB` names a file other than `career.db`, that file is the
database and every other name stays as listed: the lock and a logbook being brought in belong to
the data folder, and a logbook brought in takes the place of the database in use.

The database uses write-ahead logging and enforces foreign keys. Everything the app keeps lives in
the data folder, so a copy elsewhere (`CAREER_DB` for testing with `sim-fake`, each test file's own)
has its own icons, lists and backups and never reads or changes the real ones. A copy shows no
uploaded icons unless its `images/` folder is copied with it, and a reimport on a copy reads the lists
beside it (downloading them when missing). The repository keeps all of `data/` out of git.

### Opening and Upgrading

Every table is created if missing, and a column added in a later version is added to an existing
table in place (the schema step, [schema.ts](../../../src/server/schema.ts)), so an older database upgrades without losing anything. The
schema only ever gains tables and columns — none is removed, renamed or retyped — so an older server
run on a logbook a newer one upgraded (an older installer run by hand) finds nothing to change and
leaves what it does not know as it is.

Opening a database is a **schema upgrade** only when it already holds the app's tables and the schema
step would add a table or column, decided — once the logbook has its id (The Logbook's Id) and before
the schema step changes anything — by comparing the tables and their columns with those the schema
step creates. A new database, or one already current, is no upgrade:
restarts, crash restarts and test databases take no backup. A schema upgrade is backed up first
(Backups), and the schema step runs as one transaction, so an upgrade cut short leaves the logbook
as it was.

### The Logbook's Id

Each live logbook has an id — 16 random lowercase hexadecimal characters, kept in the `settings`
table under `logbook_id`. The start-up work gives a logbook its id as soon as it has opened it, and
before it decides whether opening it is a schema upgrade:

- a restored backup — a logbook holding a `backup_icons` table, a logbook brought in among them —
  gets a new one as its icons are put in place (Backups › Restoring);
- a logbook from an earlier version without one gets a new one, written at once — the `settings`
  table, which the schema step would add anyway, created first in a logbook from before it had one;
- a new database gets one once the schema step has created it.

So no two live logbooks share an id: not a logbook and its own restored copy, nor the logbooks of two
PCs whose Backups folder OneDrive keeps in step. Every backup is named with the id of the logbook it
holds, which is what pruning and the first-run offer go by; and since the id is in place before the
backup before an upgrade is taken, that backup is named with the id the logbook keeps, and pruned
with that logbook's other backups. The installer round trip seeds a logbook with an id of its own the
same way ([Distribution › Tests](../desktop/distribution/distribution-design.md#tests)).

### One Server per Data Folder

A server started as a process — the installed app, test mode, a copy run from source; the test
servers take no lock — holds its data folder with `career.db.lock` beside the database, naming its
process id and port, created exclusively once the server listens and removed when it shuts down. A lock is
**stale** only on evidence that its holder is gone or is not a server on this folder: its process no
longer runs; its port refuses the connection or nothing listens on it; its `/api/status` answers
naming another app, another process id or another data folder; or it names the server's own process.
A holder whose process runs and whose port accepts the connection but has not answered within 2 s is
**live** — a server busy on its main thread, with a large airport import or a long recovery, answers
late — so the new server refuses to start rather than share the logbook (Decisions & Alternatives).
Folders are compared by their real paths, so a junction, a short name or a substituted drive leading
to the holder's folder names that folder.

A stale lock is taken over, so a crash leaves nothing to clear by hand: the server renames it to a
name of its own, and only the server then holding the renamed file goes on — it checks that the file
still holds the text it judged before deleting it and creating its own exclusively. A renamed file
that holds another text — a lock another server has just taken — is put back without overwriting
anything and judged again. A lock that does not read as one is read again after a moment before it
is judged, since a lock another server is creating is empty until its text is written. A server that finds the lock held — and not stale — exits as unable to start: "Another MSFS
Career Map server (process <pid>, port <port>) is using this data folder". Two servers on one
logbook would each run a tracker over one checkpoint. The same check tells bringing in a logbook that
a copy still runs on the folder it would copy.

A server left behind on the installed app's own port meets the port first: the new server exits as
its port is in use, and the desktop shell deals with the leftover
([Shell › Keeping the server running](../desktop/shell/shell-design.md#keeping-the-server-running)).

## Backups

The desktop shell decides when the logbook is backed up and where; the server takes each backup,
names it and prunes the folder ([Shell › Backups](../desktop/shell/shell-design.md#backups)).

| Kind | Asked for by | Named |
|---|---|---|
| Daily | The desktop shell, over the private channel | `daily` |
| Before an update | The desktop shell, naming the version about to install | `update-<version>` |
| At the installer's or uninstaller's `--quit` | The desktop shell | `quit` |
| **Back up now** | The page (`POST /api/backups`), the pilot's own copy | `manual` |
| Before a schema upgrade | The server itself, as part of its start-up work | `upgrade-<version>` (the version upgrading it) |

**How.** The server copies the open logbook with SQLite's online backup — `node:sqlite`'s `backup()`,
which reads what still waits in the write-ahead log, works while the server keeps running and reports
its progress — into a temporary file in the destination folder. It then adds to that copy a
`backup_icons` table holding every uploaded icon file the logbook's aircraft rows name — always, empty
when no aircraft names one, since the table is also what marks the file as a backup when it is
restored — so a backup is one file that carries the whole logbook, and gives it its name only once it
is complete. A backup that fails, or is abandoned at shutdown, leaves no file. Backups run one at a
time, in the order asked for; one the private channel asks for during the start-up work is taken once
that work is done (**Back up now** gets the 503 of Starting then); one asked for while a logbook is
being brought in waits, and is left unanswered if the server exits to finish it (the desktop shell
asks the next server).

**Names.** `career-<yyyyMMddTHHmmssZ>-<kind>-<logbook id>.db`: the UTC time the backup started, so
names sort in time order whatever the PC's clock zone or daylight saving does; its kind; and the id of
the logbook it holds. "Newest" is judged by that time. A backup whose name is already taken waits for
the next second. The page shows a backup's time in the PC's time.

**Where.** A literal backups folder is used as it is, created with its parents when missing. Given
Windows' Documents known folder and a path under it, the server looks Documents up through Windows'
known folders at each backup — **Back up now** and the backup before an upgrade included — so a
Documents folder that OneDrive's folder backup or the pilot moves while the app runs is followed. It
creates only the path under a Documents folder that exists, and fails because the Documents folder
does not exist (Failures) rather than create Documents.

**Pruning.** After each backup into the backups folder, the server prunes the backups named with the
same logbook id — and only those: it keeps the seven newest `daily` backups and the three newest
others (`quit`, `update-…`, `upgrade-…`), the newest `upgrade-…` backup left out of that count and
kept. It never deletes a `manual` backup, a backup of another logbook, or a file whose name is not a
backup's. A Backups folder that OneDrive keeps in step between two PCs therefore holds each PC's
backups side by side, each pruned by its own server; a logbook replaced by one brought in leaves its
backups unpruned, since no live logbook carries its id any more.

**Failures.** A failed backup gives two reasons:

| Cause | Short reason |
|---|---|
| A write Windows refused (`EPERM` or `EACCES` — Controlled folder access refusing a program it does not recognise, for one) | "Windows refused the write (Controlled folder access?)" |
| A full disk | "the disk is full" |
| A missing Documents folder (Where) | "the Documents folder does not exist" |
| Anything else | "the backup failed" |

The **full reason** is "<short reason> — <folder>: <error message>", naming the folder and the error.
The short reason names no folder, so the desktop shell can show it in its tray and version line and in
a notification that names the folder itself; the full reason is what the desktop shell's log, the
server's output and the page show. Both travel in the private channel's `backup-failed` answer and in
`POST /api/backups`'s error, `{"error": full reason, "short": short reason}`.

When the backups folder cannot be written, the backup before an update naming version V
goes into the data folder as `career.before-update-V.db`, and the backup before an upgrade by V as
`career.before-V.db`, the earlier one of each deleted once the new one is done. A Documents folder
that refuses the app therefore never holds updates or upgrades back for good. When the backup before
an upgrade fails both ways, the server leaves the logbook unchanged, writes "Could not back up the
logbook before upgrading it: <full reason>" and exits as unable to start, which the desktop shell shows.

**Restoring.** A backup is restored by copying it in as `career.db` with the app stopped, as the README
says. At its next start, as soon as it has opened the logbook and before it decides whether opening
it is a schema upgrade, the server finds the `backup_icons` table, empty or not. It moves the data
folder's `images` folder, when there is one, aside as `images.before-restore-<yyyyMMddTHHmmssZ>`,
writes the table's icons into a new `images` folder, and then, in one transaction, gives the logbook a
new id and drops the table. A start cut short before the table is dropped finds it again and does
all of this again. The restored rows show their own icons, never an icon of the logbook they replaced
that happens to share an aircraft id; and a backup before an upgrade taken afterwards carries the
icons as any backup does.

## Bringing In a Logbook

On the installed app's first run the pilot may already have a career: in a copy run from source, or
in the backups of an earlier install or another PC. The server brings one in — into a logbook that
holds no hops, so nothing logged is ever replaced.

**What is offered.** `GET /api/logbook/offer` answers, worked out when the page asks:

- while the logbook in use holds no hops, its aircraft count — what bringing one in replaces — and the
  logbooks it can bring in: the folder the desktop shell found (the logbook to offer) when it holds
  `career.db`, and the newest backup in the backups folder of each logbook id other than its own whose
  logbook holds hops; each with its folder or file name, the backup's time, its hop count and the date
  of its newest hop. The new logbook's own first backups never crowd those out, being named with its
  own id;
- while it holds hops, that nothing can be brought in;
- either way, the outcome of the last attempt.

**Asking.** `POST /api/logbook/import` names a folder — offered or typed by the pilot — or a backup by
its file name in the backups folder. It is refused with 409 and the reason when the logbook in use
holds hops; when the folder is the data folder in use or holds no `career.db`; when a server still runs
on that folder (its lock, One server per data folder): "Close the MSFS Career Map running on that
folder first"; and when the tracker cannot read that logbook's checkpoint, as an older release meeting
a newer copy's might: "Log or discard its waiting legs in the other copy first, or update MSFS Career
Map".

**Preparing the copy.** The server pauses tracking (live-tracking: the sim link stopped with no
disconnect reaching the tracker, no sample or sim event taken, and every change to the tracker's state
refused until tracking resumes) and copies the logbook with SQLite's online backup into
`career.db.incoming` beside the database, with the uploaded icons its
aircraft rows name added as a backup carries them (a backup brought in carries its own). It writes
into the copy the merged tracker state, which live-tracking works out: this logbook's leg in progress
and waiting legs kept, the other logbook's added, no id carried over that could name the wrong row.
It marks the copy complete in `career.db.incoming.json`, answers 202 — saying whether it will be
started again by itself (the installed app, with a private channel) or must be started again by hand
(a copy run from source) — then shuts down as usual, casual mode left as it is, and exits with code
12. A failure before the answer deletes the copy and resumes tracking, the sim link started again on
the sim link (live-tracking).

**Finishing it at the next start.** Before it opens the logbook, a server that finds a copy marked
complete — start-up step `bringing-in` — checks again that the logbook in use holds no hops, closing
it with its write-ahead log checkpointed into the database. If it now holds some (a hop logged while
the copy was being made), the copy is discarded. Otherwise the swap runs, each step a rename, in this
order: the database's `-wal` and `-shm` files, when there are any, aside; then the database itself
aside as `career.before-import-<yyyyMMddTHHmmssZ>.db`, the two files keeping its name with `-wal` and
`-shm` added; then the copy into place as the database in use. An interruption at any step leaves
either logbook whole, and never a write-ahead log beside a database it does not belong to. A start that
finds a copy marked complete with no database and no `-wal` or `-shm` beside it — a swap cut short
after the database was moved aside — renames the copy into place. A copy not marked complete is
deleted.
Opening the brought-in logbook is then like opening any restored backup: its icons put in place and
a new id, then the schema step with its backup rule (an older copy is upgraded, backed up first). The
outcome — brought in, or not because the logbook held hops by then — is kept and reported with the
offer until the next attempt.

The desktop shell starts a server that exits with code 12 again at once, counting no failure, and
reloads an open window once the new server's start-up work is done
([Shell › Keeping the server running](../desktop/shell/shell-design.md#keeping-the-server-running)).

## API Conventions

- **Errors**: a known failure answers with its status and `{"error": "message"}`, plus any fields
  the page needs to act on that refusal (the tracker's casual-mode 409 names the leg it protects,
  live-tracking); anything else is logged and answered `500` with its message. An unknown `/api` path is `404 {"error": "not found"}`.
  A path id that is not a positive whole number is `400 "invalid id"`.
- **Request checks**: the `Host` and change checks of [Requests From Other Sites](#requests-from-other-sites),
  on every request in every mode.
- **Status**: `GET /api/status`, as [its contract](#apistatus) says.
- **Version**: one version for the app, from `package.json` — read at start by a copy run from
  source, built into the server bundle and the page's build — reported by `/api/status` and sent in
  the User-Agent of every request the server makes to an outside service:
  `MSFSCareerMap/<version> (+https://github.com/SharpWave/msfs-career-map)` — OurAirports,
  aviationweather.gov, Wikipedia, Open-Meteo and SimBrief. The User-Agent names the project as
  contact, never a person, as the services' policies ask of a distributed app; the installed app's
  window sends the same form.
- **The page's request helper** ([api.ts:19-45](../../../src/client/api.ts#L19-L45)): JSON in and out;
  `204` is no content; a failed call raises an error whose message is the server's `error`, or the
  status and its text, and which carries the HTTP status and the answer's body, so a caller can tell
  one refusal from another and use its fields.

## The Page

The page is the same in the installed app's window, in a browser tab on a copy run from source, and in
the browser tests; it has no bridge to the desktop shell.

**Layout** ([App.tsx](../../../src/client/App.tsx)). The map fills the window, and everything else
floats over it, so the map stays the main view and shows around and through the panels:

| Where | What |
|---|---|
| Top left | The **menu button** — the app's airplane mark and "Career Map" — with the **sidebar toggle** beside it |
| Left, under the top bar | The **left column**: the **sidebar** (**Live from the sim** above **Plan next hop**), or the open **drawer** in its place |
| Top right | The map toolbar (tour-map): **Layers**, the hazard count while any hazard toggle is on, **Fit all**, and **Clear highlight** / **Clear plan** while they apply |
| Bottom | The flight panel (flight-panel) while a flight is open, from the left column's right edge — the window's edge when the column is hidden — to the right edge, 40% of the window's height and at least 260 px |

The top bar is the row holding the menu button and the toolbar. Panels keep a 12 px gutter from the
window's edges and from each other. The layout is designed for windows from 800 × 600 px up. The
installed app's window can be smaller on a display whose scaled work area leaves it less room; there
every control stays reachable, the sidebar, drawers and flight panel scrolling inside where they do
not fit, and nothing is laid out beyond the window's edges.

**The sidebar** ([Sidebar.tsx](../../../src/client/components/Sidebar.tsx)) holds what a session uses
again and again: what the sim is doing, then where to go next, both in view at once. It is 400 px
wide (340 px in a window narrower than 960 px) and runs from under the top bar to the bottom of the
window.

Each card collapses to its header and opens again. Collapsing hides a card's body without
discarding it, so typed values, a SimBrief preview or a half-filled pending leg are still there when
it opens. The page remembers whether each card was left open or collapsed in its own storage, which
is kept per origin — in the installed app's window, under its address, whose port never changes; on
a first visit both are open.

The live card takes the height it needs, up to half the sidebar, and scrolls inside beyond
that; the planner card takes the rest and scrolls inside, its candidate list included, so there is
never a scroller inside a scroller. When the sidebar is too short to give the planner card 240 px,
the whole sidebar scrolls instead. The gaps between the cards and the space below them let clicks
through to the map.

**Menu and drawers** ([Menu.tsx](../../../src/client/components/Menu.tsx),
[Drawer.tsx](../../../src/client/components/Drawer.tsx)). What a session needs only now and then sits
behind the menu button. The menu shows the count line — "N aircraft · N hops · N airports · N
runways" — and its entries: **Log a hop** and **Fleet**; **Bring in a logbook** while the logbook holds
no hops; and **Back up now**. The menu button and the sidebar toggle show from the start; until the
map state has loaded, the menu leaves out the count line and its entries are disabled.

- The menu closes when an entry is chosen, when its button is clicked again, on Esc, and when the
  pointer goes down anywhere outside it — that click still does whatever it lands on. The menu and
  the Layers menu close each other.
- Choosing **Log a hop**, **Fleet** or **Bring in a logbook** opens it as a **drawer**: a panel headed
  by its title and a close button, shown in the left column instead of the sidebar. A drawer has the
  sidebar's width, so the left column keeps one right edge and the flight panel beside it never
  shifts. It is as tall as what it holds, up to the column's full height, and scrolls inside beyond
  that, so a short form does not hide a column of map.
- One drawer is open at a time; choosing another replaces it, and choosing the open one leaves it
  open. Closing the drawer shows the sidebar again.
- Opening a drawer moves the keyboard focus into it — to the field a hand-off fills, else to its
  close button. Closing it returns the focus to the control that opened it.
- The drawer stays open after a hop is logged or an aircraft saved from it, so the form's own
  confirmation shows and the next one can follow.
- **Back up now** asks the server for a backup and shows a toast, "Backed up to <file>" or "Backup
  failed: <reason>".

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

**Loading and errors.** Until the map state loads, the window reads "Loading…" (or "Starting…" while
the server's start-up work runs, below). If it fails other than with a 503 during that work, a
banner reads "Server error: message" with **Retry**. A part of the page that fails to render — the
live card, the flight panel, the planned routes, the live aircraft — shows "<part> failed: message"
with **Retry** in its place, and the rest of the page keeps working. A failed flight panel keeps its
place and its close button; a failed map layer (planned routes, live aircraft) shows its message
as a notice at the top of the clear part.

**Starting.** A page loaded while the server's start-up work runs — F5 during a restart, a browser
tab left open across one — gets 503 for the map state. It then reads "Starting… (opening the
logbook)", "(bringing in the logbook)", "(backing up the logbook)" or "(upgrading the logbook)" from
`/api/status` in place of "Loading…", and loads again every second until the map state loads; a 503
is never a server error.

While `/api/status` reports airport preparation under way (`seeding`, `downloading` or `importing`)
or failed, a notice at the top of the clear part reads "Preparing airport data: <step>. Airport
searches work once this finishes." or "Airport data could not be prepared: <reason>", and the page
asks again every 2 s until `airportData` reports the preparation `done`. It goes by `airportData`,
not by `ready`, which stays `true` through a preparation a daily check repeats after a failure, so the
notice follows that preparation as well. The step follows `airportData`:

| `state` | `<step>` |
|---|---|
| `"seeding"` | "copying the airport lists" |
| `"downloading"` | "downloading the <list> list" |
| `"importing"` | "importing <list>: <rows> of <total>", the counts with thousands separators |

`<list>` is `airports` or `runways`, as `list` names it. Until a first run's import has finished,
airport searches find nothing, which the notice's second sentence explains. (The installed app's
window shows the desktop shell's own start screen until the start-up work is done, so there the page
meets only the airport-data notice.)

**Bring in a logbook.** While the logbook holds no hops, the menu offers **Bring in a logbook**, and
the page opens that drawer as it loads when the server offers at least one logbook — on the installed
app's first run, so the offer is in front of the pilot for as long as it stands. The drawer lists each
logbook offered — a copy run from source by its folder, a backup by its date in the PC's time — with
its hop count, the date of its newest hop and **Bring in**; a field for another folder with its own
**Bring in**; and what bringing one in replaces: "This replaces the logbook here: N aircraft, no
hops." **Bring in** asks first — "Bring in <logbook>? This replaces the logbook here (N aircraft, no
hops)." — then asks the server, showing a refusal's reason in the drawer ("Close the MSFS Career Map
running on that folder first"). Once the server has accepted, the drawer reads "Bringing in the
logbook…". When the server will be started again by itself, the page waits for the new server: it
notes the `pid` `/api/status` reported before it asked, then asks `/api/status` every second — an
ask that fails being the restart under way — and reloads once it answers with another `pid` and
`startup` `done`, so it never reloads against the server that is exiting. When 60 s pass without
that, it stops asking and the drawer reads "Bringing in the logbook is taking longer than expected.
Reload the page once MSFS Career Map is running again." When the server must be started again by
hand, the drawer says "Start the server again to finish bringing in the logbook." When the last
attempt was not brought in, the drawer says so and why.

**The hand-off fragment.** The address's fragment can name a flight: `#hop=<id>` or `#pending=<id>`.
The desktop shell sets it when the pilot clicks a "Hop logged" or "Leg waiting to be logged"
notification ([Shell › Notifications](../desktop/shell/shell-design.md#notifications)); typed into a
browser tab, it works the same. The page acts on it at load and whenever it changes, but only on
fresh state from the server: once the map state has loaded and the event stream is open with the
tracker status the server sent as it opened — before that status no pending leg is known — and, after
the stream has opened again (live-tracking), once that reconnect's reload of the map and lists has
loaded. While the stream is away, or a load is under way, the page waits and keeps the fragment: what
it holds then may be older than the notification, which can name a hop logged or a leg left waiting
while the page was away from the server. Once it has acted, it clears the fragment with
`history.replaceState`, so the same fragment set again acts again. A page that reloads itself (A new
version or another logbook, below) keeps the fragment in its address and acts on it once the reloaded
page holds fresh state.

- `#pending=<id>` shows the left column with the sidebar in it (an open drawer stays mounted behind
  it) and hands the leg to the live card, which opens if it is collapsed and brings that leg's block,
  where the leg is logged, into view (live-tracking, LIVE-CARD-015), and to the flight panel
  (PANEL-OPEN-010).
- `#hop=<id>` shows the hop in the flight panel (PANEL-OPEN-009) and fits the map to it
  (MAP-ZOOM-004), leaving the left column as it is.
- An id that names nothing in that fresh state leaves everything as it is, with a toast: "That hop no
  longer exists" or "That leg has already been logged or discarded".

**A new version or another logbook.** The page is built with the app's version. Whenever it
reconnects to the server — its event stream opening again after the first time (live-tracking), or a
load answered after a 503 — it asks `/api/status`, and when the server reports another version the
page sends no further change and reloads itself. Only a browser tab can outlive an update, since the installed app's window closes
whenever the app exits to update; a page from one version against a server from another misbehaves.

It reloads at most once for a given server version, keeping that version in the tab's session
storage. A page that still reports another version after that reload — one served by a page dev
server started before the version changed — instead shows a notice at the top of the clear part,
"This page is version <X>; the server runs version <Y>. Reload the page once it is rebuilt.", and goes
on working, since reloading again would only bring back the same page.

The page also notes the logbook id `/api/status` reports as its map state first loads. When its event
stream opens again, it asks `/api/status` before it takes in that reconnect's reload of the map and
lists, and when the server holds another logbook — one brought in, or a backup restored by hand, while
the page stayed open — it sends no further change and reloads itself, whatever it has done about the
version. Nothing the page holds carries over to another logbook: the ids of aircraft, hops and
pending legs name other rows there, or none, so a planner result, or a destination the planner handed
to the hop form, would name the wrong aircraft. The planner keeps those across a reconnect only to a
server holding the same logbook (planner, PLAN-RUN-006, PLAN-RUN-007), which this check makes
sure of. The logbook id, not the process id or the data folder, is what tells: every restart brings
a new process id, and bringing in a logbook or restoring a backup keeps the data folder while always
giving the logbook a new id (The Logbook's Id). The page that asked to bring a logbook in reloads by
itself (Bring in a logbook, above); another tab open on the same server reloads by this check. It
cannot loop, since the reloaded page notes the new id as its own.

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
redraw, so the blur is capped at 12 px. While the page is asked for reduced transparency — Windows'
transparency effects turned off, as the window or the browser reports them — the panels are solid:
the same tint, fully opaque, with no blur.

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
from the left; the menu and the Layers menu fade in; the toast rises. While the page is asked for
reduced motion — Windows' animation effects turned off, as the window or the browser reports them —
nothing on the page animates: the live marker does not pulse, and the map jumps to a zoom's view
instead of flying there (MAP-ZOOM-007).

## Shared Formatting

([format.ts](../../../src/client/format.ts))

| Value | Written as |
|---|---|
| Duration | "45m" under an hour, "1h 05m" from an hour |
| Distance | "1,234 nm", rounded |
| Height | "6,500 ft", rounded |
| Date and time | The PC's locale and time zone, as the window or the browser reports them: month, day, year, hour and minute; short form without the year |
| Aircraft | "Name · Livery", or "Name" without a livery |

Hop-time conversions and the derived hop duration are logbook's; airport labels and runway summaries
are airports'. The tracker's own messages write durations as "1 h 05 min".

## Running From Source

The npm scripts are for developing the server and page; the pilot runs the installed app, which the
installer's shortcuts start (desktop distribution). A copy run from source runs beside an installed
copy without taking its flights: it links to the sim only when asked, and never while another server
on the PC holds the sim-link claim (live-tracking).

| Command | Does |
|---|---|
| `npm run dev` | The server on 127.0.0.1 at `PORT` (default 3080), restarting on change, with no `--sim` argument, so it never links to the sim (its sim mode is live-tracking's, LIVE-LINK-013), and the page's dev server on 127.0.0.1:5173, passing `/api/` and `/images/` to `http://127.0.0.1:<PORT>`; the trailing slash keeps the page's own `/api.ts` module on the page server |
| `npm run dev:sim` | As `npm run dev`, its server started with `--sim=link`, which puts it on the sim link (LIVE-LINK-013) |
| `npm run build` | Builds the page into `dist/`, the page build a copy run from source serves; the desktop build copies it into `page/` in the desktop build output (The Program Folder; desktop distribution). The build also records the npm packages the page bundle takes in, in `dist/.vite/packages.json`, which distribution's third-party notices are written from (DESK-DIST-PKG-025) and the server, serving no dot-folder, never serves |
| `npm start` | Runs a copy from source, which serves the build; `npm start -- --sim=link` links it to the sim |
| `npm run typecheck` | Checks the page and the server (with the scripts and tests) against their TypeScript settings |
| `npm test` | Runs the Vitest suites once (see Tests) |
| `npm run test:e2e` | Runs the Playwright browser tests (see Tests) |

The sim option is a start-up argument rather than a variable, so it reads the same in an npm script on
Windows' command shell, where `VAR=value command` does not work, and in the installed app's own
arguments. A copy run from source on the sim link still reads `SIMCONNECT_HOST` and `SIMCONNECT_PORT`
to reach a sim on another PC (live-tracking).

Running from source needs Node 22.16 or later, for `node:sqlite` and its online backup; the installed
app runs on the Node built into Electron and needs nothing installed. The ports apart from the
installed app's 3380 are development's and the tests': 3080 and 5173 for a copy run from source,
3180 and 5183 for the browser tests, 3280 for the desktop app's test mode.

**Icon tool** — `node scripts/make-ico.mjs out.ico a.png …` packs PNGs into one `.ico`.

The repository keeps out of git everything a copy run from source keeps in `data/`: the database and
its `-wal`, `-shm`, lock and incoming files, icons, the airport lists and their download times, and its
backups.

## Tests

The approach is the HLD's: Vitest for the logic and for the API against a temporary database,
Testing Library component tests for the page, and a few Playwright browser tests for the main
flows; what only the desktop shell does is covered by the packaged smoke test
([Distribution › Tests](../desktop/distribution/distribution-design.md#tests)). Every test runs
against data made for it. No test opens or changes the logbook in `data/` or in the installed app's
data folder, writes to the Backups folder in Documents, listens on the installed app's port, links to
the sim, or reaches a service on the internet: each server a test starts gets a data folder and
backups folder in the run's temporary folder, airport downloads off and no sim link.

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
points `CAREER_DB` at a new database there, so the file's icons, lists and backups sit beside its
database as they do for any database (see Data and Database). The setup does this before any app
module loads, because `db.ts` opens the database, and upgrades its tables, the moment it is first
imported. So the setup and the Vitest config import nothing from `src/server` statically, and the
setup checks that `CAREER_DB` names this file's own folder before its first import of app code. It
then loads the fixture lists with the same step that prepares airport data at startup, with airport
downloads off. Each test file runs in a fresh process, so no module or open database carries over
from one file to the next.

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
API with its JSON limit, request checks and error handlers, `/images`, and the page when built) on a
free port on 127.0.0.1, and call it over HTTP. Building the app starts nothing else: no listening, no
sim link, no reference-data step. Closing a test server first closes its open connections, such as the
live event stream, which would otherwise hold it open. They cover, among the rest: the request checks
(a wrong `Host` refused; a POST with `Sec-Fetch-Site: cross-site`, with a foreign `Origin` or with
`Origin: null` refused; a POST with `Sec-Fetch-Site: same-origin` and the dev server's `Origin`
accepted; a POST with neither header accepted); the `/api/status` contract, `logbookId` among it; backups — their names,
kinds, pruning by logbook id, `manual` and the newest `upgrade-…` kept, another logbook's left alone,
the fallback into the data folder, each cause's short reason and the full reason, the icons carried
and an empty `backup_icons` table when there are none; and bringing in a logbook — the offer, each
refusal, and the copy prepared and marked complete with its icons, its shutdown left to the test
(Inputs).

**Start-up work tests** run the start-up work's steps in process on databases made for them: a
restored backup's icons put back, the replaced `images` folder moved aside and a new id, with an empty
`backup_icons` table too; the id given before the backup before an upgrade, to a logbook without one
and to one from before the `settings` table; upgrade detection (a new or current database takes no
backup, an older one is backed up first, named with the id it keeps, and a backup failing both ways
leaves it unchanged); and the swap — its order, a copy marked complete with no database renamed into
place, and the outcome when a hop was logged before the swap.

**The shutdown order** is tested in process: the module that keeps it (Shutting Down) is handed a
stand-in sim link that emits its close event at once when stopped, the tracker and a database, and an
airborne and a landed leg come back unchanged from the checkpoint it writes.

**Server process tests** start the server itself as a child process on a data folder of its own, with
port 0 (it writes the port it got), airport downloads off and the sim off or the fake feed, and drive
it over HTTP and its channel: `/api/status` answering from the first moment with `opening` and the 503
on other routes until `done`; the start order; a missing input in the bundled form ending it with code
1; a port in use ending it with code 10; the lock (a live holder refused, a stale one taken over); the
swap of a logbook brought in at the next start, its uploaded icon's `/images/…` answering 200; an
uncaught error ending it with code 1; and Shut down ending it with code 0 within 5 s, its lock
removed. A child process has no fetch guard, so these tests never turn downloads or the sim link on.

**Outside services.** The shared setup replaces `fetch` so that any request except to the test's
own server fails the test, unless the test has supplied the answer. Another local port is no
exception, since the user's own server may be running there. Tests of OurAirports downloads, METARs,
terrain, hazards, Wikipedia and SimBrief give their answers from fixtures, which also lets them
cover failures and odd shapes the live services rarely produce, and check the User-Agent each request
carries.

**Component tests** render one part of the page with Testing Library. They open no database: each
test supplies the answers to the page's `/api` calls and a stand-in for the live event stream. They
cover the page's starting state on a 503, the airport-data notice (following a repeated preparation
while `ready` stays true), **Back up now**, the **Bring in a logbook** drawer, the hand-off fragment
(acted on only on fresh state — waiting while the event stream is away and until a reconnect's reload
has loaded —, cleared, an unknown id's toast) and the reload for a new version or another logbook
(the logbook id asked for before a reconnect's reload is taken in).

**Browser tests.** `npm run test:e2e` starts two servers and stops them after the run:

1. The app server on 127.0.0.1:3180, started by a script in `tests/support/`. The script makes a data
   folder for the run as the Vitest setup does, and refuses outside requests except those it answers
   from fixtures. Only then does it start the server in its own process as a copy run from source,
   on that data folder, with the arguments it is started with and accepts alone: `--port=3180`,
   `--sim=fake` (the fake feed: `POST /api/tracker/sample`, the feed `sim-fake` uses, driving the
   tracker) and `--airport-downloads=off`.
2. The page's dev server on 127.0.0.1:5183, with `PORT=3180`, so it passes `/api/` and `/images/` to
   the test server.

Neither server falls back to another port. If one is taken, the run fails. Before any test, the run
asks `/api/status` through port 5183 until it reports `ready`, for at most 60 s, then checks that it
reports the fixture lists' airport count. That proves the page reaches the test server and not one
holding real data. Every flow that saves passes the request checks through the dev server's proxy.

The tests run one at a time, since they share one server and one tracker. Each starts by discarding
any live and pending leg, works with aircraft it creates under its own names, and asserts nothing
that depends on what earlier tests left. They run in Chromium against `http://127.0.0.1:5183`. The
page's own requests to the internet (map tiles and outside links) are blocked, so the map draws
without a basemap. A first run needs `npx playwright install chromium`. The run's data folder is left
for a later run to delete, since the server may still hold it open when the run ends.

## Docs This Segment Owns

The README and the project notes in CLAUDE.md describe how the app is run and looked after, so they
change with this segment. They point to the designs for behaviour — the API and the tracking rules
live in the LLDs — rather than restate it.

What the two files cover, listed below, is a documentation obligation, not a spec: it describes what
a document says, not what the system does, so no EARS spec carries it and no test cites it. It is
checked by reading the README and CLAUDE.md against this list before each release is published
(desktop distribution's Releases), and a change to how the app is run, installed or looked after
brings the files in line with it as part of that change.

**The README** covers:

- installing from the project's GitHub Releases, Windows SmartScreen's warning while releases are
  unsigned, updating (by itself; when updates install), and uninstalling, which keeps the logbook;
- where the data folder (`%LOCALAPPDATA%\MSFS Career Map`), the backups folder
  (`Documents\MSFS Career Map\Backups`) and the desktop shell's own folder with its logs
  (`%APPDATA%\MSFS Career Map`) are, and a backup's typical size;
- repairing an install by running the release's installer again, which leaves the data folder alone
  and the shortcuts as they are;
- restoring a backup: Quit, move `career.db` and its `-wal` and `-shm` files aside, copy the backup in
  as `career.db`, then start the app — its icons come back with it;
- bringing a logbook from a copy run from source into the installed app on its first run, before
  creating aircraft or logging a hop there, with that copy closed;
- that a Backups folder kept in step between two PCs holds each PC's backups side by side;
- adding the app to Windows' priority notifications, and keeping its tray icon in view (Windows 11
  keeps a new program's icon under ^ on the taskbar; Settings › Personalization › Taskbar › Other
  system tray icons);
- letting the app write to Documents under Controlled folder access;
- for a pilot who flies MSFS 2020, having the app start with Windows, since Start with MSFS 2024
  starts it with MSFS 2024 alone;
- running from source: Node 22.16 or later, `npm run dev` on `http://127.0.0.1:5173`, `npm run
  dev:sim` to link to the sim (never while another copy holds the link), `npm start`, the data in
  `data/` with its backups in `data/backups/`, and the ports;
- its API table: one line per endpoint saying what it does — `POST /api/backups`,
  `GET /api/logbook/offer`, `POST /api/logbook/import` and `GET /api/status` with its fields among
  them — leaving the rules behind each to the LLDs.

**CLAUDE.md** states the stack as it runs — from source with `tsx` on Node 22.16 or later, installed
as an esbuild bundle in Electron's utility process — the commands with their 127.0.0.1 addresses and
`npm run dev:sim`, the `sim-fake` recipe with `--base http://127.0.0.1:<port>` against a copy of the
logbook in a folder of its own, and the data locations as the server's inputs give them.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Server and page | One local server serving the API and the page — installed, bundled into the desktop app's utility process; from source, run with npm — shown in the desktop app's window or a browser tab | The page packaged into the desktop shell, talking to it over IPC; a hosted service | The page stays a web page that works the same in a browser tab and is covered by the browser tests (HLD tenet). The sim link needs a process on the PC anyway, and there is nothing to host or sign into. |
| Database | Node's built-in `node:sqlite` | better-sqlite3; a server database | No native module to rebuild for each Electron major, it runs in Electron's utility process, and its online backup copies a live logbook for backups and for bringing one in; one file to back up or copy. |
| Running TypeScript | `tsx` when run from source; one esbuild bundle when installed (desktop distribution), the code finding every file through its inputs | `tsx` in the installed app too; compiling with `tsc` | No build step while developing; the bundle starts fast and ships one file. Code that never works out paths from its own location runs unchanged in both. |
| The server's inputs | Start-up arguments, all required by the bundled server; a copy run from source falling back to `CAREER_DB`, `PORT`, `TRACKER_FAKE` and the repository | Environment variables in every mode; defaults worked out from the code's location in the bundle too | A setting left in the environment can never point the installed server at another logbook, and a start that forgets the data folder stops rather than creating a logbook inside the program's folder, where the next update would delete it. |
| The program folder's layout | The page build in `page/` beside the seed lists, in the program's resources outside the app archive, and the same in the desktop build output | The page inside `app.asar`, given as an input of its own | One input then holds everything the server reads from the program, laid out the same packaged and unpackaged, and the server reads plain files as it does from `dist/`, needing nothing of Electron's archive support. |
| Listening address | 127.0.0.1 only, in every mode | Every interface; `localhost` | Nothing off the PC reaches the logbook. `localhost` can resolve to `::1` first, so tools and the server name one address. |
| Keeping other sites out | The `Host` must name 127.0.0.1 or localhost; a change refused when `Sec-Fetch-Site` is not `same-origin` or `none`, or, without it, when `Origin` is not the server's own; requests with neither allowed | A token the page sends with each change; CORS alone; accepting any loopback origin | A host name that resolves to this PC would otherwise reach the server, and a simple cross-site POST needs no CORS preflight. The page's own requests carry `same-origin` even through the dev server's proxy, which forwards the browser's `Origin` unchanged, so no token has to reach the page. Accepting any loopback origin would let any other local dev server's page change the logbook. |
| Start order | Listen; start-up work on the logbook; airport preparation; then the sim link | Airport data before listening; the sim link beside airport preparation in no set order | The desktop shell and the page need `/api/status` answering at once, with progress, while work that grows with the logbook runs. The import writes to the logbook, so it follows the logbook's opening and upgrade; one fixed order is simpler to reason about, and an import made at start never runs beside a leg. |
| One `/api/status` | One contract in every mode, answered from memory from the moment of listening, with a start-up step that says `done` outright and a separate `ready` | A readiness message on the private channel; a status that reads the database; absence of a step meaning done | The desktop shell, the page, the test harnesses and the desktop shell's look for a copy run from source all read the same fields. A status that reads the database cannot answer while the logbook is being opened or upgraded, and only an outright "done" proves the logbook is open. |
| `ready` and a repeated airport preparation | `ready` stays `true` once set; `airportData` reports the repeated preparation in place of the earlier report | `ready` false again while it runs; a second field for the repeat | `ready` says the start is over — the packaged smoke test and the browser tests wait on it once — and a server running on the airport data it had is not starting again. One report keeps the page's notice reading one place. |
| Start-up work off the event loop | A worker thread with its own connection, the server's own connection and statement-holding modules loaded once it is done | All of it at module load, as one synchronous step; steps that yield | `node:sqlite` is synchronous, and opening, write-ahead-log recovery, a backup or an upgrade cannot yield in the middle; `/api/status` must keep answering through them. |
| During start-up work | A start-up stand-in, apart from `createApp`, serving the page's files, icons and `/api/status`; every other API route 503 with `Retry-After` | Holding requests until ready; serving nothing; `createApp` serving from the start | A page reloaded mid-restart gets its files and can say the server is starting; a held request could hang for the length of an upgrade. `createApp` loads the modules that prepare statements on the server's own connection, which cannot open until the start-up work is done. |
| The private channel's messages | Objects with a `type`; each request but Shut down carrying an id that its answers repeat | Answers matched by order; one message per request with no progress | Backups queue behind one another and a save can be answered while a backup runs, so answers do not come in the order asked; the desktop shell bounds a backup by its progress, so progress needs a message of its own. |
| Shutdown order | Stop the samples and the sim link with no disconnect reaching the tracker, casual mode off when quitting, the tracker's final save, airport work and backups stopped, event streams closed, the database closed, the lock removed, within 5 s | Saving first, then stopping the link; no set order | Stopping the link closes its connection, which would otherwise reach the tracker as the sim disconnecting and change the leg after the final save. The 5 s leave margin inside the desktop shell's 10 s wait. |
| The desktop shell ending without Shut down | No shutdown of the server's own: Electron ends the utility process, and the write-ahead log, the tracker's checkpoint, the next run's fresh-run input and the stale lock's takeover keep the logbook and the leg | Shutting down when the private channel closes; a synchronous clean-up when a message port the desktop shell hands the server closes | The server cannot see the shell end. When Electron's main process exits, the utility process is ended at once with no event on its channel; on a crash only a port the shell handed over hears a close, and the process is ended before any awaited step of the shutdown order completes. A synchronous clean-up in that moment would save only the last few seconds of track, which the checkpoint already bounds, and would make the desktop shell hand the server a port of its own. |
| Casual mode at a copy run from source's stop | Left as it is on a stop signal — SIGINT, SIGBREAK, SIGHUP, or SIGTERM where delivered | Switched off on those signals, as at the installed app's Quit | Casual mode ends when the app quits — its Quit, the installer's `--quit`, signing out — or when MSFS closes normally (HLD), and a copy run from source has no app to quit. On Windows its watch restarts end the process outright, as a crash does, so a signal it handles is the developer stopping it — often to start it again at once, with another argument or after a change the watcher does not see — and switching casual mode off then would log the next landing of a flight the developer chose not to log. Its casual mode still ends at the switch and when MSFS closes normally while it is linked, and the live card shows it in every state. |
| Uncaught errors | Written out, then the server exits at once without a final save | Keep running; attempt the clean shutdown first | After an uncaught error the server's state may not be sound, and a final save could write it over a good checkpoint; the last checkpoint is a few seconds old, and the desktop shell restarts the server. |
| Exit codes | 0 clean, 1 cannot start or crashed, 10 port in use, 11 port refused, 12 restart to finish bringing in a logbook | One failure code with the reason in the log | The desktop shell acts differently on each — waiting out a leftover server, giving up at once with Windows' reason, restarting without counting a failure — and an exit code needs nothing parsed from the log. |
| Schema changes | Create-if-missing plus additive column upgrades in place, decided before anything changes, backed up first, run as one transaction | Versioned migration files; backing up at every start | Older databases keep working with no migration step, an older server runs on a newer logbook, and changes so far have all been additive. A backup at every start would take one at each restart and soon prune the one taken before an update. |
| One server per data folder | A lock file naming the process id and port, stale when the process is gone or its port answers for another folder | An operating-system file lock; none; the desktop shell's probe of port 3080 alone | Node has no portable advisory lock, and a lock file left by a crash must not need clearing by hand; asking the named port tells a live server from a reused process id. A copy run from source may use any port, so a probe of 3080 cannot tell that a copy still runs on a folder. |
| A holder that does not answer in time | Live when its process runs and its port accepts the connection, however long the answer takes; stale only when the process is gone, the port refuses or nothing listens, or the answer names another app, process or folder | Stale once 2 s pass without an answer | A server busy on its main thread — a large airport import, a long recovery — accepts connections it cannot answer yet. Taking its lock over puts two servers on one logbook, each with a tracker over one checkpoint, which can lose flights; refusing wrongly only asks the pilot to start again. |
| The same folder under another spelling | Folders compared by their real paths, falling back to the resolved path (case-insensitively on Windows) when a real path cannot be read | Comparing the resolved paths alone | A junction, an 8.3 short name or a substituted drive leads to the holder's folder under a spelling of its own, and would make a live holder look like a server on another folder. |
| Taking over a stale lock | Renaming it to a name of this server's own, the server then holding the renamed file deleting it only when it still holds the text judged; another text is put back with a link that never overwrites, and judged again; a lock that does not read as one read again after 100 ms; at most 3 takeovers | Deleting the file after checking its text is unchanged; judging an empty lock at once | A check and a delete are two steps another server can come between, and both servers then take the lock; a renamed file is in one place, held by one server. A lock being created is empty between its exclusive create and its write, and taking it over then would give the folder to two servers. |
| The logbook's id | 16 random hexadecimal characters in `settings`, new at creation, for a logbook without one, and at every restore or logbook brought in, given before the upgrade check | One id for a career's lineage, kept across restores and bringing in; the database's path; the new id given after the upgrade | A Backups folder kept in step between two PCs would otherwise hold two live logbooks with one id, each pruning the other's backups and either offering the other's career. Given after the upgrade, the backup before it would be named with the id of the logbook a restore came from — whose backups its pruning would then delete — or with none. |
| A backup's `backup_icons` table | Always added, empty when no aircraft names an uploaded icon | Added only when there are icons | The table is what marks a file as a restored backup; without it, a logbook with no uploaded icons would keep its source's id once restored or brought in, and the replaced logbook's icons would stay. |
| Taking a backup | SQLite's online backup into a temporary file, renamed when complete, one at a time | Copying the file; `VACUUM INTO` | A live write-ahead-log database copied as a file can lose or corrupt what waits in its log. `VACUUM INTO` is one long statement with no progress to report, and the desktop shell bounds a backup by its progress. |
| What a backup holds | The whole database, airport tables included, with the uploaded icons in a `backup_icons` table | An images folder beside each backup; leaving the icons out; leaving the airport tables out | A backup stays one file that the README's restore copies in as `career.db`, and its icons come back with it. Leaving the airport tables out would save some megabytes but make a restored logbook depend on importing the lists again before it can show its airports. |
| Backup names | `career-<UTC time>-<kind>-<logbook id>.db`, newest by that time | Local time; the file's own time; a counter | A local-time name sorts the latest backup before older ones after the clocks go back, and a file's time can change when it is copied; the kind and id let pruning and the first-run offer work from names alone. |
| Pruning | Per logbook id: seven daily and three others, never `manual` copies or the newest `upgrade-…` | Counting every backup in the folder; by age | Counting another logbook's backups would let a new, empty logbook's dailies prune an old career's last copies within a week. The pilot's own copies are theirs to delete, and the backup taken before an upgrade is the one a broken upgrade is undone from. |
| A failed backup's reason | A short reason in fixed words per cause, naming no folder, and a full reason naming the folder and the error | One free-text reason | The tray, the version line and a notification that names the folder itself show the short form, the log and the page the full one, and nothing has to be parsed out of free text. |
| A backups folder that cannot be written | The backup before an update or an upgrade falls back into the data folder, one of each kept | Failing it; holding the update or upgrade until Documents can be written | Controlled folder access can refuse an unsigned program every write to Documents for good; a backup beside the logbook still guards the update or upgrade. |
| Looking Documents up | The user's `Personal` value under `User Shell Folders` in the registry, read with `reg.exe` and its `%VARIABLES%` expanded | Asking PowerShell for the known folder; Electron's `app.getPath("documents")` passed in by the desktop shell | Node has no call for known folders. The registry value is where Windows keeps the folder's place and what OneDrive's folder backup changes; `reg.exe` answers in a few milliseconds, where PowerShell takes a second to start and can be held back by script policy. A path passed in at start would not follow a Documents folder moved while the app runs, and a copy run from source has no desktop shell. |
| Where Documents is | Looked up through Windows' known folders at each backup, the path under it created, never Documents itself | Fixed at the server's start; creating Documents when missing | OneDrive's folder backup can move Documents while the app runs for days; a folder fixed at start would leave backups outside OneDrive and out of the pilot's sight, and a recreated Documents would hide them in a folder Explorer no longer shows. |
| Bringing in a logbook | Through a restart: the copy and merged tracker state prepared beside the database, the server exiting with code 12, the next start checking for hops again and swapping before it opens anything | Swapping and reopening inside the running server | Most of the server's statements are prepared on its connection as modules load; a reopen would leave them bound to a closed connection, or need a rule every segment keeps. A swap before opening meets no open connection, no `-wal` or `-shm` of the old logbook and no backup running, and goes through the same opening, upgrade and backup rules as any start. |
| What the swap replaces | Only a logbook with no hops, checked again at the swap; the replaced database and icons kept aside | Replacing whatever is there; deleting the replaced logbook | A hop logged while the copy was being made keeps the logbook it was logged in. A logbook with no hops may still hold aircraft created since install; kept aside, nothing is lost. |
| The swap's steps | Renames in a set order — `-wal` and `-shm` aside, then the database, then the copy into place — and a complete copy with no database beside it renamed into place at the next start | Treating the renames as one step; copying the files | Windows cannot swap several files at once. In that order a server ended at any step leaves one logbook whole, and a write-ahead log never ends up beside a database it does not belong to, where SQLite would replay it into the wrong logbook. |
| The first-run offer on the page | A **Bring in a logbook** drawer, in the menu while the logbook holds no hops and opened at load while something is offered | A one-time question at the first start; a card in the sidebar | The offer stays in front of the pilot for as long as it stands, uses the drawers the page already has, and the desktop shell asks nothing; a sidebar card would push the live card down for the whole first session. |
| A new server version | The page reloads itself when it reconnects to a server of another version, at most once per server version, then shows a notice | A banner asking the pilot to reload; reloading only when no form holds typed values; reloading every time | A page from one version against a server from another sends requests of the wrong shape. Only a browser tab can outlive an update, and the page cannot tell reliably which forms hold typed values. A page dev server started before a version change serves the same page again, so reloading every time would loop. |
| A server holding another logbook | The page reloads itself when, as its event stream opens again, `/api/status` reports a logbook id other than the one its state was loaded with, asked before the reconnect's reload is taken in | Taking the reconnect's reload as the same logbook's; telling by the process id or the data folder | The ids of aircraft, hops and pending legs name other rows in another logbook, so a kept planner result or hop-form destination would name the wrong aircraft (planner, PLAN-RUN-006, PLAN-RUN-007). The process id changes at every restart, which would throw away a route being planned at each one; the data folder stays the same when a logbook is brought in or a backup restored, while the logbook's id always changes then. |
| Reloading after bringing in a logbook | Once `/api/status` answers with another process id and its start-up work done, within 60 s | Once `/api/status` says `done` | The exiting server still answers `done` until it stops listening, so the page could reload against it. |
| The hand-off fragment | Acted on only on fresh state — the map state, and the tracker status of the open event stream with a reconnect's reload loaded — then cleared | Acting at load; acting on whatever the page holds; asking the server for the one hop or leg; a query string | Pending legs arrive with the tracker status, so acting earlier would call every waiting leg already logged; a notification can name a hop logged or a leg left waiting while the page was away from the server, which state held from before would call gone, and the reconnect's reload brings it with no request of its own. Clearing lets the same notification act again, and a fragment changes nothing else on a page already open. |
| The sim option for a copy run from source | Off by default; `--sim=link`, given by `npm run dev:sim` | Linking by default; an environment variable | Career flights never land in the repository's `data/` by accident, and a copy run from source runs beside the installed app without competing for the sim. An argument reads the same in npm scripts on Windows' command shell and in the installed app's start-up arguments. |
| Console launcher | None: the installed app's shortcuts start the app, `npm run dev` runs it from source | A `.cmd` launcher and a desktop-shortcut script for a copy run from source | A copy run from source links to the sim only when asked, so a double-click launcher would start one that records no flight, and the installer makes the shortcuts the pilot needs. |
| Running from source | Node 22.16 or later | Node 22.13, the first with `node:sqlite` unflagged | Backups and bringing in a logbook use `node:sqlite`'s online backup, which Node 22 has from 22.16. |
| Error shape | `{"error": message}` with a meaningful status | Error codes; HTML errors | The page shows the message as is. |
| What the README and CLAUDE.md cover | Documentation obligations listed in this LLD (Docs This Segment Owns), checked by reading the files before each release | EARS specs for each topic; a test that searches the README for its topics | A spec states what the system does and a test verifies it; what a document says is verified by reading it. A test matching words in the README would pass on a stale sentence and fail on a better one. |
| Page layout | The map fills the window; panels float over it | A sidebar docked beside a smaller map; an icon rail opening one panel at a time | The map is the main view and stays whole behind the panels. A rail would keep the live card and the planner from being open together, which a session between flights wants. |
| What the sidebar holds | Live from the sim above Plan next hop; Log a hop, Fleet and the occasional entries behind the menu | Every card in one scrolling sidebar; Fleet first | The sim logs flights and the fleet changes rarely, so the hand-logging form and the fleet list are occasional; keeping them in the sidebar pushed the planner below the fold and the fleet to the bottom. |
| Where a drawer opens | Over the sidebar, in its place | From the right edge; a modal dialog | It opens where the menu is, and the map stays visible beside it — the fleet list highlights aircraft and opens hops on the map, which a modal would hide. |
| Hidden panels and collapsed cards | Stay mounted, hidden | Unmount when closed or collapsed | A half-typed hop, a pending leg being filled in, an expanded aircraft card or a planner form survives switching panels or collapsing a card. |
| Card open or collapsed | Remembered in the page's storage per card, kept per origin; open on a first visit | Always open on load; always collapsed | The live card's status strip lets a pilot keep it small for good, and reopening it on every load would undo that. The installed app's fixed port keeps the origin, and so the choice, from one run to the next. |
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
| Data beside the database | Icons, OurAirports lists and a copy run from source's backups in the data folder | Fixed `data/` paths; a separate setting per path | One input moves everything, so a copy or a test database never changes the real logbook's files or backups; a copy run from source keeps the `data/` layout. |
| Building the app | One function builds the Express app the server serves once its start-up work is done, used by the server and by the API tests | Tests assemble their own app from the router | API tests meet the same JSON limit, request checks, static paths and error handlers as the page, and importing the app starts nothing. |
| Test layout | `tests/<segment>/`, with `tests/e2e/`, `tests/fixtures/` and `tests/support/` | Beside the source (`tracker.test.ts` next to `tracker.ts`) | Groups tests the way the arrow groups specs, so a segment's tests are one folder; the source folders stay as they are. |
| Test databases | A data folder per test file, in a temp folder for the run | One shared test database; in-memory databases | Files cannot leak data into each other; a folder keeps a database's icons, lists and backups beside it and can be opened after a failure; the browser-test server needs a file it can be started on. |
| Server process tests | The server started as a child process on its own folder and port 0 for listening first, the start order, exits, the lock, the swap and the 5 s bound; the shutdown order tested in process, its module handed a stand-in sim link | Only `createApp` in-process; the shutdown order in a child process too | Listening first, exit codes and the bound are what the desktop shell relies on, and only a real process shows them. A child process cannot be handed a stand-in sim link, and tests never load the server's entry point, so the shutdown order lives in a module of its own that can be. |
| Browser tests in sequence | One at a time against one server | Parallel workers with a server each | They share one tracker; the suite is a few flows, so one server keeps the run simple. |
| Reference data in tests | A fixed subset of real OurAirports rows, airport downloads off | The full lists in `data/` | Expected results do not move when the lists are refreshed; a fresh checkout needs no download, and a test server never replaces its fixture lists. |
| Outside services in tests | Refused unless the test supplies the answer; the browser-test server answers from fixtures | Call the live services | Tests pass offline and give the same result every run; failure cases can be tested; free services are not loaded by test runs. |
| Page in browser tests | The Vite dev server on its own port, passing the API to the test server | Build into `dist/` and let the test server serve it | Leaves the page build in `dist/` alone and skips a build per run. |
| Browser-test ports | Fixed (3180 and 5183) on 127.0.0.1, failing when taken | Any free port; reuse a server already running | The runner waits on a known address; refusing a taken port means a test can never reach a server holding real data. |
| Browser | Chromium as installed by Playwright | The installed Edge | The browser's version moves with Playwright's, not with Windows updates. |

## Open Questions & Future Decisions

### Open

1. **Documents moved by OneDrive** — the lookup reads the `User Shell Folders` value (Decisions &
   Alternatives); still to be checked against a Documents folder that OneDrive's folder backup has
   moved.
2. **Worker threads in Electron's utility process** — the start-up work's worker thread with its own
   `node:sqlite` connection is still to be seen running in Electron 45's utility process; and the
   worker has to load from the one-file bundle, re-entered as a worker, or from a second entry the
   desktop build makes beside it (desktop distribution).
3. **Which error Controlled folder access gives** — taken to be `EPERM` or `EACCES` for a refused write
   to Documents; to be confirmed on Windows 11 with the feature on.

### Deferred

1. **Two duration styles** — the page's "1h 05m" and the tracker's "1 h 05 min".

## References

- HLD: [docs/high-level-design.md](../../high-level-design.md) — Approach, Target Users, Goals, Non-Goals
  (no other device), Tenets (The page stays a web page), System Design (127.0.0.1, the data folder and
  its backups, bringing in a logbook, development beside an installed copy, one sim link per PC),
  Segments → app-shell, Key Design Decisions (Where the logbook lives, Which copy logs flights, Testing)
- Desktop: [desktop-design.md](../desktop/desktop-design.md) (Processes, Names and folders, Test mode,
  Relies On), [shell](../desktop/shell/shell-design.md) (Starting the server, Ready, Talking to the server,
  Shutting the server down, Backups, Keeping the server running, First Run, Notifications, Relies On),
  [distribution](../desktop/distribution/distribution-design.md) (Packaging, Development, Tests, Relies On),
  [start-lists](../desktop/start-lists/start-lists-design.md) (Relies On)
- Related designs: [live-tracking](../live-tracking/live-tracking-design.md) (the tracker, its checkpoint
  and merge, the sim link and its claim, casual mode, the event stream),
  [airports](../airports/airports-design.md) (preparing airport data, seeding, downloads),
  [fleet](../fleet/fleet-design.md) (uploaded icons), [flight-panel](../flight-panel/flight-panel-design.md)
  (opening a hop or pending leg), [planner](../planner/planner-design.md) (its result kept across a
  reconnect to the same logbook)
- Code: [src/server/server.ts](../../../src/server/server.ts) (`runServer`, `startServer`: the start
  order), [src/server/index.ts](../../../src/server/index.ts) and [src/server/bundled.ts](../../../src/server/bundled.ts)
  (the two entries), [src/server/inputs.ts](../../../src/server/inputs.ts) (`readInputs`,
  `currentInputs`), [src/server/version.ts](../../../src/server/version.ts), [src/server/status.ts](../../../src/server/status.ts)
  (`/api/status` from memory), [src/server/checks.ts](../../../src/server/checks.ts) (`requestChecks`),
  [src/server/standin.ts](../../../src/server/standin.ts) (`createStandIn`; `servePage` and `serveImages`, which `createApp` shares),
  [src/server/lock.ts](../../../src/server/lock.ts) (the data-folder lock), [src/server/channel.ts](../../../src/server/channel.ts)
  (`privateChannel`, `serveChannel`), [src/server/shutdown.ts](../../../src/server/shutdown.ts) (`shutDown`,
  `installStopSignals`), [src/server/app.ts](../../../src/server/app.ts)
  (`createApp`), [src/server/locations.ts](../../../src/server/locations.ts) (data locations),
  [src/server/db.ts](../../../src/server/db.ts) (pragmas), [src/server/schema.ts](../../../src/server/schema.ts) (the schema step, upgrade detection), [src/server/logbook-id.ts](../../../src/server/logbook-id.ts), [src/server/startup-work.ts](../../../src/server/startup-work.ts) and [startup-worker.ts](../../../src/server/startup-worker.ts) (the start-up work), [src/server/backup.ts](../../../src/server/backup.ts), [backup-service.ts](../../../src/server/backup-service.ts), [backup-queue.ts](../../../src/server/backup-queue.ts) and [documents.ts](../../../src/server/documents.ts) (backups), [src/server/logbook-import.ts](../../../src/server/logbook-import.ts) (bringing in a logbook), [src/server/routes.ts](../../../src/server/routes.ts)
  (helpers 28-62, `/status` 885, error handlers 887-903), [src/client/api.ts](../../../src/client/api.ts)
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
  [.gitignore](../../../.gitignore), [scripts/make-ico.mjs](../../../scripts/make-ico.mjs),
  [README.md](../../../README.md), [CLAUDE.md](../../../CLAUDE.md)
- Code (the page's server-facing parts): [src/client/notices.ts](../../../src/client/notices.ts)
  (the starting, airport-data and version texts and the page's polling times),
  [src/client/navigation.ts](../../../src/client/navigation.ts) (reloading, the hand-off fragment),
  [src/client/version.ts](../../../src/client/version.ts) (the version built into the page),
  [src/client/components/BringIn.tsx](../../../src/client/components/BringIn.tsx) (the **Bring in a
  logbook** drawer); the server's inputs, start order and start-up worker, the request checks, the
  private channel and shutdown, backups, the data folder's lock and bringing in a logbook are in
  `src/server/` (the arrow's Code list)
- Tests: [vitest.config.ts](../../../vitest.config.ts), [playwright.config.ts](../../../playwright.config.ts),
  [tsconfig.test.json](../../../tsconfig.test.json), [tests/support/](../../../tests/support/) (shared setup,
  fetch guard, data folders, test servers), [tests/fixtures/](../../../tests/fixtures/),
  [tests/app-shell/](../../../tests/app-shell/), [tests/e2e/](../../../tests/e2e/)
- External: SQLite's online backup API (`node:sqlite`'s `backup()`), Fetch Metadata request headers
  (`Sec-Fetch-Site`), Electron (utility processes and their message channel)
