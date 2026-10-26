# MSFS Career Map

A map-first logbook for a home-spun MSFS 2024 "career mode": every aircraft + livery you fly
always starts where it last parked, so each one builds its own tour across the map. This app
draws those tours as big colorful hop-to-hop paths, shows where each plane currently sits, and
remembers when you landed at or left each airport.

Version 0.8: manual hop logging, editable paths, per-aircraft icons and colors, airport lookup
by ICAO/IATA/local code, runway data on every airport, a "next hop" planner that shows which
airports are within a given flight time of where a plane is parked, and live tracking from the
sim: with MSFS running, each takeoff and landing becomes a logged hop with the actual flown track,
a rated landing (butter to graveyard), a speed/altitude profile, fuel and weight figures, and
optionally the SimBrief plan it was flown from.

## Quick start

Requires Node 22.16 or newer (uses Node's built-in SQLite, no native modules to compile).

```powershell
npm install
npm run dev       # the server and the page's dev server, tracking off
npm run dev:sim   # the same, with the server linked to the sim
```

Then open http://127.0.0.1:5173. On first start the server downloads the
[OurAirports](https://ourairports.com/data/) airport and runway lists (about 20 MB) into `data/`
and imports them into the database, answering all the while (`/api/status` shows the progress).
It checks the lists once a day and downloads them again once they are more than 30 days old,
but never while it is linked to the sim or a leg is in progress. An airport a logged hop uses is
kept when OurAirports drops it, and its popup says "No longer listed by OurAirports".

For everyday use without the dev tooling:

```powershell
npm run build              # bundles the client into dist/
npm start -- --sim=link    # serves API + client on http://127.0.0.1:3080, linked to the sim
```

Or double-click **`start.cmd`**: it installs dependencies and builds on first run, starts the
server linked to the sim (or reuses one that is already up), and opens the app in your browser.
Close its window to stop the server. `powershell -File scripts\install-shortcut.ps1` puts a **MSFS Career Map**
shortcut with the app icon on your desktop that does the same thing.

After updating the code, close the launcher window (that stops the server), run `npm run build`,
and launch again: the launcher only builds when there is no bundle yet, and a page built for a
newer version will not get along with a server still running the old one.

Started linked to the sim, with MSFS running on the same PC, the app talks to it through
SimConnect on its own (nothing to install in the sim); see **Live tracking** below.

## Using it

The map fills the window; everything else floats over it on frosted-glass panels. The **sidebar**
on the left holds what a session uses again and again: **Live from the sim** above **Plan next
hop**. Either card collapses to its header (the live card to a one-line status strip) and stays
that way next time. **Career Map** at the top left opens the menu: the logbook's counts, **Log a
hop** and **Fleet**, each of which opens as a drawer in the sidebar's place (close it to get the
sidebar back), and **Back up now**, which copies the logbook into `data/backups/`. While the logbook
holds no hops the menu also offers **Bring in a logbook**, listing other copies' logbooks and backups
to bring in instead (it opens by itself when there are any). The button beside it hides the sidebar
for a clear map. At the top right, **Layers** picks the basemap, night shading and weather hazards;
**Fit all** zooms to every path.

An address ending in `#hop=<id>` opens that hop in the flight panel, and `#pending=<id>` a leg waiting
to be logged. While the server is starting the page says which step it is at; while it prepares
airport data a notice shows the progress; and a page left open across an update or a logbook swap
reloads itself.

- **Fleet** (in the menu): click **+ Aircraft**, give it a name and livery/registration (that pairing is the unit
  of persistence for add-ons like A2A that track wear per livery), pick a path color, and choose an
  icon. Icons can be a built-in silhouette, an uploaded image (stored in `data/images/`), or an
  image URL.
- **Log a hop** (in the menu): pick the aircraft, origin, destination, and optionally departure/arrival times,
  flight time and notes. The origin defaults to wherever that aircraft last parked, and after you
  add a hop the form rolls forward so the next hop starts at the destination you just entered.
- **Live tracking**: the **Live from the sim** card shows whether the app is talking to MSFS,
  which aircraft and livery is loaded, and what it is doing. The first time you fly a sim aircraft,
  bind it to a fleet aircraft (**Bind**) or create one from it (**+ New**); the pairing of the
  sim's `TITLE` and `LIVERY NAME` is remembered on the aircraft, so every later flight in that
  livery is logged to the right row by itself. A takeoff starts a leg (the on-ground flag off for
  five seconds; the origin is the nearest airport to where the wheels left), the map shows the
  plane moving with its track growing behind it, and thirty seconds after it stops rolling after a
  landing the leg is logged as a hop: departure and touchdown times, airborne minutes, and the
  track sampled every five seconds (a **Log now** button on the card skips the wait, for a sim that
  froze or was quit after touchdown). A touch-and-go stays inside the one leg. Legs the tracker
  cannot finish by itself (unbound aircraft, tracking started in the air, stopped away from any
  airport) wait in the card, each in a block of its own, oldest first, for you to fill in and log,
  or discard; however many wait, none replaces another. Loading a new flight, changing aircraft or
  slewing far away drops a leg still in the air; a leg that has already landed is logged where it
  stopped, or waits in the card when it cannot be. Closing the sim or losing it mid-flight keeps the leg
  waiting to be logged, ending where the sim last reported it. A restart of the app mid-flight
  carries the leg on when the sim is still flying it, and otherwise keeps it waiting to be logged
  too. Nothing is tracked while the sim sits in its menus or a loading screen (it
  reports a bogus position there). Tracked hops are drawn with their real path (hover shows the
  distance flown) instead of a great circle, still tied to the airport dots at both ends.
  `npm run sim-probe` prints what the sim reports, for checking the connection.
- **Casual mode**: for flying that is not part of the career, slide the **Casual** switch on the
  live card (it sits in the folded strip too, so you can always see it is on). The path you fly
  is drawn dashed behind the aircraft and nothing is logged: no legs, no pending legs, no fleet
  aircraft needed. The path is split wherever you slew, load a new flight or reconnect; **Clear**
  starts it afresh and switching casual mode off throws it away. Switching on mid-flight in a fleet
  aircraft asks first, since that leg will not be logged; a leg already landed is logged as usual.
  Casual mode stays on until you switch it off or close MSFS (a sim crash or a lost connection only
  breaks the path), and a restart of the app keeps it on, though the path, kept in memory only,
  starts again empty.
- **Landing rate**: a few variables are watched every frame, so the moment the wheels touch the
  tracker records the descent rate on the last airborne frame, the peak G over the next second,
  the touchdown airspeed, pitch and bank, and the sim's own touchdown velocity for comparison
  with third-party monitors. Each touchdown is rated **butter** (≤ 100 fpm), **solid** (≤ 250),
  **hard** (≤ 500), **hospital** (≤ 800) or **graveyard**, with a peak G above 1.6 / 2.0 / 2.6 /
  3.5 bumping the class up. The rating shows as a badge in the hop list, on the hop's hover, and
  in the flight panel with a line about how the passengers took it. A bounce or a touch-and-go
  keeps every touchdown; the hop is rated by the first touchdown of its final landing, where
  touchdowns less than 30 s apart count as bounces of one landing.
- **Flight panel**: click a hop (its line on the map or its row in an aircraft card in Fleet) and
  a panel floats up across the bottom of the map, and the map zooms the hop into the space above it. The chart plots altitude, ground speed, vertical speed,
  indicated airspeed and fuel against elapsed time, each indexed to its own range so they share
  one plot; the legend shows each series' real min–max, the crosshair shows real values, series
  can be toggled, and a table view lists every sample. Beside it: the landing card, flight stats
  (distance flown vs direct, max altitude and speed, fuel used, takeoff and landing weight) and
  the SimBrief card. **Profile** in the live card opens the same panel for the leg being flown,
  and it follows the leg into the logbook when it lands. Close it to get the map back.
- **SimBrief plans**: enter your SimBrief alias or pilot ID once in the live card, then
  **Import SimBrief plan** fetches your most recent OFP, shows origin, destination, aircraft,
  passengers and when it was generated for you to confirm, and attaches it to the flight (before
  or during the leg). The planned route is drawn as a dashed line with its fixes, and when the
  hop is logged the whole OFP is archived with it: the summary (callsign, runways, route, cruise,
  distance, ETE, fuel plan, passengers, cargo, weights), the OFP text, a link to SimBrief's PDF,
  and the raw JSON. The flight panel shows it all and can also attach your latest plan to an
  already-logged hop. No PDF is stored; SimBrief keeps those on its side.
- **Map**: each aircraft's hops are drawn as thick colored lines with direction chevrons: the
  real flown track for hops the sim recorded, a great circle for hops logged by hand. Consecutive
  hops alternate between the aircraft's color and a lighter shade of it, so the leg that landed
  at an airport and the one that left it stay apart when zoomed in. The icon at
  the end of each path is where that plane is parked now; while you fly, a pulsing marker shows
  the aircraft itself. Hover an airport dot to see every arrival and departure logged there,
  hover a line for that hop's details, click a line for its flight panel. Click an aircraft (in
  Fleet or on the map) to highlight it and zoom to its path.
- **Aircraft numbers**: in the aircraft form, type the SimBrief type (e.g. `B738`) and click **Fill
  from table** to fill cruise speed, runway, ceiling, crosswind and the block-time model from the
  app's performance table, researched for every type in SimBrief's list from manufacturers' and
  aviation authorities' publications. **Sources** shows where each number comes from; a number no
  such source gives is left blank, or for climb and descent filled from the class preset and marked
  as such. Nothing is saved until you save, and you can change any value first.
- **Edit**: in Fleet, expand an aircraft card (the chevron with its hop count) to see its hops.
  Each hop can be moved earlier or later, edited, or deleted. Edit the aircraft itself with the
  pencil, hide it from the map with the eye.
- **Runways**: every airport tooltip lists its class (large/medium/small, seaplane base, heliport),
  elevation, and open runways with length, width, surface and lighting, so you can tell at a glance
  whether a field suits the plane you're in. Surfaces are grouped into paved, grass, gravel, dirt,
  water and snow.
- **Plan next hop**: give an aircraft a **cruise speed** (edit the aircraft), then in the planner
  choose a maximum flight time. The map draws the range ring around wherever the plane is parked
  and marks every airport inside it: dot size is the airport class, dot color is the runway
  surface. The ring and each airport's estimated time come from a **block-time model**, not plain
  speed × time: a fixed taxi/approach overhead, a climb at reduced speed to the cruise altitude,
  cruise, and a descent to the destination's elevation. Each aircraft can carry its own typical
  cruise altitude, climb rate and speed, descent rate and overhead (the form has presets for
  piston single/twin, turboprop, jet, airliner and helicopter; blank fields use light-piston
  defaults), and the planner can override the cruise altitude per search. Filter by airport type or paved-only. If the aircraft also has a **minimum runway
  length**, only airports with a runway at least that long are shown. Hover a dot for distance,
  time and runways; click it (or **Use** in the list) to drop it into the hop form as the next
  destination. The planner can start from any airport via the **From** box, and
  `?plan=<aircraft id>&minutes=90` in the URL runs it on page load. After each search the
  current METARs for the large and medium airports in range are fetched in batches and their
  dot rings turn green/blue/red/magenta for VFR/MVFR/IFR/LIFR as they arrive (only reports under
  90 minutes old count; METARs are reused for five minutes between searches).
- **What limits where a plane can go**: beyond cruise speed and minimum runway, each aircraft can
  have a **service ceiling**, a **pressurised / has oxygen** flag, a **max crosswind**, and an
  **IFR capable** flag. The planner drops fields the plane can't operate from (above the ceiling
  minus a 2,000 ft pattern, or above 10,000 ft without oxygen, since the pattern would top
  12,000 ft). From the live METARs it then flags, and by default hides, airports that are IFR/LIFR
  for a VFR-only plane, whose best runway's crosswind (gusts included) beats the limit, or that
  will be dark at the ETA with no runway lighting. Night arrivals at lit fields are tagged but
  kept. The click popup also samples **terrain along the leg** (Copernicus DEM via Open-Meteo),
  shows the highest point and a minimum en-route altitude (1,000 ft clearance, 2,000 ft over high
  terrain), and warns when that altitude exceeds the ceiling or needs oxygen.
- **Overlays** (in **Layers**; the button shows a moon and hazard-colored dots for what is on):
  **Night shading** shades the half of the world past sunset and, darker, past civil
  twilight, refreshed every minute. **Ice / Turb / IFR / Storms** shade the current G-AIRMET
  (CONUS) and SIGMET (worldwide) hazard areas from aviationweather.gov, the same areas SimBrief
  puts in its briefing, with base/top altitudes and validity on hover; refreshed every ten
  minutes. G-AIRMETs show the forecast snapshot nearest to now.
- **SimBrief links**: give an aircraft its ICAO type designator (the aircraft form offers
  SimBrief's own list of about 200 profiles, searchable by code or name, refreshed daily) and
  every planner candidate gets a SimBrief link, in the popup and as the **SB** button in the
  list, that opens SimBrief's dispatch page with origin, destination, aircraft type and
  registration already filled in.
- **Airport details**: click any airport dot (visited or planner candidate) for a popup with its
  Wikipedia lead image and blurb, the live METAR with flight category (via aviationweather.gov),
  runways, and links to Wikipedia, the official site, SkyVector and the decoded METAR/TAF page.
  Wikipedia summaries are cached in the database for a month; METARs for five minutes.
- **Basemaps** (in **Layers**): Dark (Esri), Light (OpenStreetMap), Satellite (Esri imagery). All
  keyless; the panels darken over the Light map so they stay readable.
- **Look**: the interface is set in B612, the typeface Airbus drew for cockpit displays (bundled
  with the app, so nothing is fetched from a font service). Status colors follow the cockpit
  convention: green normal, amber caution, red warning; orange marks actions. When the browser
  asks for reduced motion or reduced transparency, panels stop animating or turn solid.

Airport codes accept ICAO idents (`KBOS`), GPS codes, IATA (`BOS`) and US local codes; type a name
or city to search.

## Where the data lives

Everything is in `data/` (git-ignored), or in the folder the server's `--data` argument names, or
beside the database named by `CAREER_DB`:

| File | Contents |
| --- | --- |
| `data/career.db` | SQLite database: aircraft, hops (with tracks, landings and stats), archived SimBrief briefings, settings, the live tracker's checkpoint, imported airports and runways |
| `data/airports.csv`, `data/runways.csv` | OurAirports source lists, re-importable with `npm run import-airports` |
| `data/airports.csv.downloaded`, `data/runways.csv.downloaded` | When each list was downloaded (ISO UTC); a list without one counts from its file date |
| `data/images/` | Uploaded aircraft icons |
| `data/career.db.lock` | The running server's process id and port, there while it runs: a second server started on the same folder refuses to start, and one left by a server that is gone is taken over at the next start |
| `data/backups/` | Backups: `career-<UTC time>-<kind>-<logbook id>.db`, each one file holding the whole logbook with its uploaded icons. Taken by **Back up now** (`POST /api/backups`, `manual`, never pruned) and by the server before it upgrades an older logbook (`upgrade-<version>`) |
| `data/career.before-*.db`, `data/images.before-restore-*` | What a logbook brought in, a restored backup, or a backup that could not go into `backups/` left beside the logbook |

To restore a backup, stop the server, move `career.db` and its `-wal` and `-shm` files aside, copy
the backup in as `career.db`, and start the server again: its icons come back with it (the `images/`
folder it replaces is moved aside), and it gets a logbook id of its own. A logbook from another data
folder (`--data=<folder>`) or a backup can also be brought in with `POST /api/logbook/import`, while
the logbook here holds no hops; the server then exits with code 12 and swaps it in when started
again. Start the server with
`--data=<folder>` (for example `npm start -- --data=D:\career`) to use another data folder, or set
`CAREER_DB` to a database path; `PORT` (or `--port=<n>`) changes the server port (default 3080). The icons and airport lists live
in the same folder as the database in use, so a copy for testing belongs in a folder of its own
(copy `images/` along with it to see the icons).

Live tracking: the server's `--sim=link|fake|off` argument chooses it. `link` talks to MSFS, `fake`
takes synthetic samples from `npm run sim-fake -- KBOS KPVD` (a flight for trying the feature
without MSFS), and `off`, a copy run from source's default, tracks nothing; the card then says
tracking is off. A copy run from source started without `--sim` takes the fake feed from
`TRACKER_FAKE=1`. On the sim link, `SIMCONNECT_HOST` and `SIMCONNECT_PORT` reach a sim on another
PC (enable TCP in that PC's `SimConnect.xml`).

## Desktop app (in development)

The app is becoming a Windows program: an Electron shell that runs the server in the background,
keeps a tray icon and shows the page in a window of its own. Until it is packaged it runs from the
repository, always in test mode, on a folder of its own:

```powershell
npm run desktop          # build, then start the desktop app on .desktop-dev\ (port 3280, fake feed)
npm run desktop:build    # build only: the page, then everything the app runs into build/desktop/
```

`npm run desktop` builds the page and bundles the server and the shell into `build/desktop/`, with
the seed airport lists (downloaded only when missing; add `-- --fresh` to fetch them again) and the
icons, then starts Electron unpackaged in test mode on `.desktop-dev\` (git-ignored): its logbook in
`.desktop-dev\data`, backups in `.desktop-dev\Backups`, the shell's logs and settings in
`.desktop-dev\desktop`. Its server runs on port 3280 with the fake feed and airport downloads off,
so it never touches the real logbook or the sim and can run beside `npm run dev`. Drive it with a
synthetic flight:

```powershell
npm run sim-fake -- --base http://127.0.0.1:3280 KBOS KPVD
```

Closing the window leaves the app in the tray; **Quit** is in the tray icon's menu.

### Packaging and the installer

```powershell
npm run package          # the desktop build, then electron-builder: release\win-unpacked and the installer
npm run test:packaged    # the packaged smoke test on release\win-unpacked (needs port 3280 free)
npm run test:installer   # the installer's own steps, built into small test programs run on temp folders
```

The installer (`release\MSFS Career Map Setup <version>.exe`) installs for your Windows account only,
needing no administrator rights, always into `%LOCALAPPDATA%\Programs\MSFS Career Map`. Installing,
updating and uninstalling never touch the data folder (`%LOCALAPPDATA%\MSFS Career Map`), the backups
folder (`MSFS Career Map\Backups` in Documents) or the app's settings and logs
(`%APPDATA%\MSFS Career Map`); uninstalling names them on its last page so you can delete them by
hand. A build run from anywhere but the install folder (the unpacked build in `release\` included)
runs only in test mode, with `--test-data=<folder>`.

The installed app's tray menu offers **Start with MSFS 2024** and **Start with Windows**, both off
until you turn them on. The first adds one entry, "MSFS Career Map", to the `EXE.xml` of each MSFS 2024
edition installed (Microsoft Store in
`%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache`, Steam in
`%APPDATA%\Microsoft Flight Simulator 2024`), changing nothing else in the file and only while MSFS is
closed; the second adds the value "MSFS Career Map" to Windows' per-user start-up list, which Task
Manager's Startup apps also switches. Before each change the app copies what it changes into
`%APPDATA%\MSFS Career Map\start-up list backups` (the five newest of each kept). An entry another
program removes is never put back; the menu item says so until you click it. Uninstalling takes both
entries away. A copy in test mode leaves both lists alone. If you fly MSFS 2020, turn on Start with
Windows instead; Start with MSFS 2024 starts the app with MSFS 2024 only.

The installed app tells you through Windows notifications when a leg is waiting to be logged or a hop
is logged (only while its window isn't in front), when an update is ready, when it stopped tracking and
when backups keep failing; they are silent while you fly, and a click opens the window on that hop or
leg. Windows' Focus and Do Not Disturb hold them back: to let them through, add MSFS Career Map under
Settings > System > Notifications > Set priority notifications. Windows 11 also keeps a new program's
tray icon under ^ on the taskbar; Settings > Personalization > Taskbar > Other system tray icons keeps it
in view.

The installed app keeps itself up to date from this project's GitHub Releases. It checks a minute
after it starts and every four hours after that, and **Check for updates** in the tray menu checks at
once. A new version is downloaded only while MSFS is closed, and the tray's version line shows where
it stands (up to date, downloading, ready). A ready update installs when you choose Quit or **Restart
to update**, or by itself once MSFS and the window have stayed closed for five minutes with no leg in
progress and casual mode off. A backup of the logbook is taken first, and if that backup fails the
update waits: the version line gives the reason, and **Restart to update without a backup** installs
it anyway. Closing the app any other way installs nothing. A copy in test mode never checks for
updates.

Don't run the installer on a development PC unless you mean to install the app: it is the real
thing. The release workflow tries it on a clean GitHub runner instead (below).

### Releasing

A release is built by GitHub Actions (`.github/workflows/release.yml`) on `windows-latest`:

- Push a tag `dry-run-v<version>` (the version in `package.json`) to rehearse: every check, the
  packaging, the packaged smoke test and the installer round trip (install, start, install a newer
  build over the running app, uninstall, on the runner's real folders), and no release.
- Push a tag `v<version>` to release: the same steps, then a **draft** GitHub release with the
  installer, its blockmap, `latest.yml` and the installer's SHA-256. A tag whose version differs from
  `package.json`'s fails at once; a version already published stops the workflow.

Before the first `v` tag, `npm run aircraft-types:check` must pass: the performance table covers every
type of its SimBrief snapshot, researched and checked.

The maintainer publishes a draft by hand; installed copies see a release only once it is published.
A published release is never deleted, retagged or replaced: a broken one is fixed by publishing a
higher version. Ship a release at least every six months, to stay on a supported Electron, and
sooner when Chromium has security fixes.

## Tests

```powershell
npm test                        # logic, API, component and desktop-shell tests (Vitest)
npx playwright install chromium # once, for the browser tests
npm run test:e2e                # browser tests (Playwright) on servers of their own, ports 3180 and 5183
npm run test:installer          # the installer's steps (NSIS test programs on temp folders)
npm run test:packaged           # after npm run package: the packaged app, in test mode on port 3280
```

Tests run on temporary databases with a small fixed set of New England airports, never on
`data/`, and never reach the internet. The desktop shell's tests run without Electron: a test fails
if it starts a process, opens a connection, loads Electron or calls `fetch`, so they can never touch
the installed app, Windows' settings or the sim.

## API

All JSON, under `/api`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | The server itself: app, version, process id, data folder, logbook id, sim mode, start-up step, airport-data report, `ready`, airport and runway counts (answered while the server starts too) |
| POST | `/backups` | Back the logbook up now into the backups folder: `{ file }`, or the failure's `{ error, short }` |
| GET | `/logbook/offer` | While the logbook holds no hops, the logbooks that can be brought in (the folder `--offer` names, the newest backup of each other logbook), with the outcome of the last attempt |
| POST | `/logbook/import` | Bring in a logbook: `{ folder }` or `{ backup }`; 202 and the server exits to swap it in at its next start, or 409 with the reason |
| GET | `/state` | Aircraft, hops, and every airport they reference, in one call |
| GET | `/airports/search?q=` | Search by code, name or city (includes a runway summary) |
| GET | `/airports/:code` | Look up one airport by any code, with its runway list |
| GET | `/airports/:code/wiki` | Cached Wikipedia summary (title, extract, lead image) |
| GET | `/metar/:icao` | Latest METAR from aviationweather.gov, decoded |
| GET | `/metars?ids=A,B,C` | Same for up to 500 stations at once (unreported ones are null) |
| GET | `/simbrief/aircraft` | SimBrief's aircraft type list, cached daily |
| GET | `/hazards` | Current G-AIRMET / SIGMET areas, normalised, cached 10 min |
| GET | `/terrain?from=lat,lon&to=lat,lon` | Terrain profile along a leg with a suggested minimum altitude |
| GET | `/plan?aircraft_id=&max_minutes=` | Airports in range of where the aircraft is parked; optional `types=`, `paved=1`, `min_runway_ft=`, `from=`, `cruise_alt_ft=`, `limit=` |
| GET | `/tracker` | Live tracker status: sim mode, connection, sim aircraft, bound fleet row, phase, position, leg, pending legs (each with its id, without its track) |
| GET | `/tracker/events` | Server-sent events: `status`, `track`, `point`, `path`, `path-point`, `hop` (`{ hop, message }`), `pending` (the leg as the status lists it) |
| POST | `/tracker/bind` | Bind the sim aircraft being flown to a fleet row: `{ aircraft_id }`; also fills in that aircraft on waiting legs flown in the same sim aircraft and livery |
| GET | `/tracker/pending/:id` | One pending leg in full: track, landings, statistics and briefing; 404 for an unknown id |
| POST | `/tracker/pending/:id` | Log that pending leg, supplying any of `{ aircraft_id, origin, dest }` it lacked; 404 for an unknown id |
| DELETE | `/tracker/pending/:id` | Discard that pending leg; 404 for an unknown id |
| POST | `/tracker/complete` | Log the landed leg now, without waiting for the 30 s stop timer (frozen or quit sim) |
| DELETE | `/tracker/leg` | Discard the leg being flown |
| PUT | `/tracker/casual` | Switch casual mode: `{ on, drop_leg? }`; 409 with the leg's details while a fleet aircraft's leg is airborne, unless `drop_leg` |
| DELETE | `/tracker/path` | Clear the casual path |
| POST | `/tracker/sample` | Feed one synthetic position sample (only on the fake feed, `--sim=fake`) |
| POST/DELETE | `/tracker/briefing` | Attach your latest SimBrief OFP to the flight being flown (or the next one; 409 in casual mode) / detach it |
| GET/PUT | `/settings` | `{ simbrief_username }` |
| GET | `/simbrief/latest` | Preview your latest SimBrief OFP without storing it; optional `?username=` |
| GET | `/briefings/:id` | A stored briefing: summary, fixes, OFP text as HTML |
| GET/POST/DELETE | `/hops/:id/briefing` | The hop's briefing / attach your latest OFP to it / remove it |
| GET/POST | `/aircraft` | List / create |
| GET | `/aircraft-types` | The performance table's types (designator, name, variant) and its SimBrief snapshot date |
| GET | `/aircraft-types/:type` | One type's numbers, each with its source or calculation |
| PUT/DELETE | `/aircraft/:id` | Update / delete (deletes its hops) |
| POST | `/aircraft/:id/icon` | Upload a custom icon as a base64 data URL |
| PUT | `/aircraft/:id/hops/order` | Reorder hops: `{ ids: [...] }` |
| GET/POST | `/hops` | List (`?aircraft_id=`) / create |
| PUT/DELETE | `/hops/:id` | Update / delete |
| POST | `/airports/reimport[?download=1]` | Re-import the airport and runway lists from `data/`, downloading both first with `download=1`; 409 while another import is under way |

Timestamps are ISO 8601 UTC; the UI enters and displays them in local time. Aircraft carry
optional `cruise_kts` and `min_runway_ft`; the planner needs the first and honours the second.
A tracked hop's `track` is a JSON array of `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm,
ias_kts, fuel_lb]` samples (hops from 0.7 have the first four only), `landings` a JSON array of
touchdowns with their rating, `stats` the fuel/weight/altitude figures, and `briefing_id` points
at the archived SimBrief OFP. Aircraft carry `sim_title` and `sim_livery` so the tracker can find
them.

## Project layout

```
src/server/   Express API, SQLite schema, airport + runway import, planner query (TypeScript via tsx)
  server.ts      reads the inputs and starts the server in order; shutdown.ts stops it in order
  tracking.ts    starts the sim link, the fake feed or nothing, by the --sim mode
  simconnect.ts  SimConnect link (node-simconnect, pure TypeScript): samples, touchdown watcher, system events
  tracker.ts     turns samples into hops: takeoff/landing detection, landing rating, track + stats, pending legs
  ofp.ts         SimBrief OFP fetch + parse
src/client/   Vite + React + Leaflet UI
  paths.ts    turns hops into map geometry (great circles or recorded tracks) and the world copies each shape is drawn on
  icons.ts    built-in aircraft silhouettes and the path color palette
  tracker.ts  subscribes to the tracker's event stream
  landing.ts  how landing ratings are shown
  components/FlightPanel.tsx, ProfileChart.tsx   the bottom panel and its chart
src/desktop/  Electron shell: runs the server, keeps it running, the window, the tray and its start lists (main.ts is the Electron glue)
scripts/      import-airports.ts, sim-probe.ts (print what the sim reports), sim-fake.ts (synthetic flight),
              desktop-build.ts and tray-icons.ts (the desktop build), desktop.ts (npm run desktop),
              test-packaged.ts (npm run test:packaged), release/ (the release workflow's scripts and installer round trip)
tests/        tests by segment, desktop/ shell and build tests, e2e/ browser tests, installer/ the installer's
              steps, packaged/ the packaged smoke test, fixtures/ airport lists, support/ shared setup
data/         runtime data (ignored by git)
build/        installer.nsh and installer-steps.nsh (the installer's own steps); desktop/ the desktop build (ignored by git)
electron-builder.json  packaging: names, the per-user NSIS installer, fuses
release/      electron-builder's output (ignored by git)
```

## Roadmap

Live tracking shipped in 0.7 on [`node-simconnect`](https://github.com/EvenAR/node-simconnect);
landing rates, flight profiles and SimBrief briefings in 0.8. Around them: thin very long tracks
before storing them, per-aircraft totals that include tracked time and landing averages, and
comparing the flown track against the SimBrief route.

Other ideas: engine-hours per aircraft, flight-time totals, exporting the map, importing a
logbook from other tools.
