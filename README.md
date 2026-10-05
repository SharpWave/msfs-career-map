# MSFS Career Map

A map-first logbook for a home-spun MSFS 2024 "career mode": every aircraft + livery you fly
always starts where it last parked, so each one builds its own tour across the map. This app
draws those tours as big colorful hop-to-hop paths, shows where each plane currently sits, and
remembers when you landed at or left each airport.

Version 0.7: manual hop logging, editable paths, per-aircraft icons and colors, airport lookup
by ICAO/IATA/local code, runway data on every airport, a "next hop" planner that shows which
airports are within a given flight time of where a plane is parked, and live tracking from the
sim: with MSFS running, each takeoff and landing becomes a logged hop with the actual flown track.

## Quick start

Requires Node 22.13 or newer (uses Node's built-in SQLite, no native modules to compile).

```powershell
npm install
npm run dev
```

Then open http://localhost:5173. On first start the server downloads the
[OurAirports](https://ourairports.com/data/) airport and runway lists (about 20 MB) into `data/`
and imports them into the database. That takes a few seconds once.

For everyday use without the dev tooling:

```powershell
npm run build   # bundles the client into dist/
npm start       # serves API + client on http://localhost:3080
```

Or double-click **`start.cmd`**: it installs dependencies and builds on first run, starts the
server (or reuses one that is already up), and opens the app in your browser. Close its window to
stop the server. `powershell -File scripts\install-shortcut.ps1` puts a **MSFS Career Map**
shortcut with the app icon on your desktop that does the same thing.

With MSFS running on the same PC the app talks to it through SimConnect on its own (nothing to
install in the sim); see **Live tracking** below.

## Using it

- **Fleet**: click **+ Aircraft**, give it a name and livery/registration (that pairing is the unit
  of persistence for add-ons like A2A that track wear per livery), pick a path color, and choose an
  icon. Icons can be a built-in silhouette, an uploaded image (stored in `data/images/`), or an
  image URL.
- **Log a hop**: pick the aircraft, origin, destination, and optionally departure/arrival times,
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
  track sampled every five seconds. A touch-and-go stays inside the one leg. Legs the tracker
  cannot finish by itself (unbound aircraft, tracking started in the air, stopped away from any
  airport) wait in the card for you to fill in and log, or discard. Loading a new flight, changing
  aircraft, slewing far away or closing the sim mid-flight drops the leg being flown; an app
  restart does not. Tracked hops are drawn with their real path (hover shows the distance flown)
  instead of a great circle, still tied to the airport dots at both ends. `npm run sim-probe`
  prints what the sim reports, for checking the connection.
- **Map**: each aircraft's hops are drawn as thick colored great-circle lines with direction
  chevrons. The icon at the end of each path is where that plane is parked now. Hover an airport dot
  to see every arrival and departure logged there, hover a line for that hop's details. Click an
  aircraft (in the sidebar or on the map) to highlight it and zoom to its path.
- **Edit**: expand an aircraft card (the `▸ n` button) to see its hops. Each hop can be edited,
  reordered, or deleted. Edit the aircraft itself with the pencil, hide it from the map with the eye.
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
- **Overlays**: **Night** shades the half of the world past sunset and, darker, past civil
  twilight, refreshed every minute. **Ice / Turb / IFR / Storms** shade the current G-AIRMET
  (CONUS) and SIGMET (worldwide) hazard areas from aviationweather.gov, the same areas SimBrief
  puts in its briefing, with base/top altitudes and validity on hover; refreshed every ten
  minutes. G-AIRMETs show the forecast snapshot nearest to now.
- **SimBrief**: give an aircraft its ICAO type designator (the aircraft form offers SimBrief's own
  list of about 200 profiles, searchable by code or name, refreshed daily) and every planner
  candidate gets a SimBrief link, in the popup and
  as the **SB** button in the list, that opens SimBrief's dispatch page with origin, destination,
  aircraft type and registration already filled in.
- **Airport details**: click any airport dot (visited or planner candidate) for a popup with its
  Wikipedia lead image and blurb, the live METAR with flight category (via aviationweather.gov),
  runways, and links to Wikipedia, the official site, SkyVector and the decoded METAR/TAF page.
  Wikipedia summaries are cached in the database for a month; METARs for five minutes.
- **Basemaps**: Dark (Esri), Light (OpenStreetMap), Satellite (Esri imagery). All keyless.

Airport codes accept ICAO idents (`KBOS`), GPS codes, IATA (`BOS`) and US local codes; type a name
or city to search.

## Where the data lives

Everything is in `data/` (git-ignored):

| File | Contents |
| --- | --- |
| `data/career.db` | SQLite database: aircraft, hops, imported airports and runways |
| `data/airports.csv`, `data/runways.csv` | OurAirports source lists, re-importable with `npm run import-airports` |
| `data/images/` | Uploaded aircraft icons |

Back up `career.db` and `images/` and you have everything. Set `CAREER_DB` to use a different
database path, `PORT` to change the server port (default 3080).

Live tracking: `TRACKER=0` turns it off. `SIMCONNECT_HOST` and `SIMCONNECT_PORT` reach a sim on
another PC (enable TCP in that PC's `SimConnect.xml`). `TRACKER_FAKE=1` replaces the sim with
`npm run sim-fake -- KBOS KPVD`, a synthetic flight for trying the feature without MSFS.

## API

All JSON, under `/api`:

| Method | Path | Purpose |
| --- | --- | --- |
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
| GET | `/tracker` | Live tracker status: connection, sim aircraft, bound fleet row, phase, position, leg, pending leg |
| GET | `/tracker/events` | Server-sent events: `status`, `track`, `point`, `hop`, `pending` |
| POST | `/tracker/bind` | Bind the sim aircraft being flown to a fleet row: `{ aircraft_id }` |
| POST | `/tracker/pending` | Log the pending leg, supplying any of `{ aircraft_id, origin, dest }` it lacked |
| DELETE | `/tracker/pending` | Discard the pending leg |
| DELETE | `/tracker/leg` | Discard the leg being flown |
| POST | `/tracker/sample` | Feed one synthetic position sample (only with `TRACKER_FAKE=1`) |
| GET/POST | `/aircraft` | List / create |
| PUT/DELETE | `/aircraft/:id` | Update / delete (deletes its hops) |
| POST | `/aircraft/:id/icon` | Upload a custom icon as a base64 data URL |
| PUT | `/aircraft/:id/hops/order` | Reorder hops: `{ ids: [...] }` |
| GET/POST | `/hops` | List (`?aircraft_id=`) / create |
| PUT/DELETE | `/hops/:id` | Update / delete |
| POST | `/airports/reimport?download=1` | Refresh the airport and runway lists |

Timestamps are ISO 8601 UTC; the UI enters and displays them in local time. Aircraft carry
optional `cruise_kts` and `min_runway_ft`; the planner needs the first and honours the second.
A tracked hop's `track` is a JSON array of `[lat, lon, alt_ft, unix_seconds]` samples; aircraft
carry `sim_title` and `sim_livery` so the tracker can find them.

## Project layout

```
src/server/   Express API, SQLite schema, airport + runway import, planner query (TypeScript via tsx)
  simconnect.ts  SimConnect link (node-simconnect, pure TypeScript): position samples, system events, reconnect
  tracker.ts     turns samples into hops: takeoff/landing detection, track recording, pending legs
src/client/   Vite + React + Leaflet UI
  paths.ts    turns hops into map geometry (great circles or recorded tracks, antimeridian unwrapping)
  icons.ts    built-in aircraft silhouettes and the path color palette
  tracker.ts  subscribes to the tracker's event stream
scripts/      import-airports.ts, sim-probe.ts (print what the sim reports), sim-fake.ts (synthetic flight)
data/         runtime data (ignored by git)
```

## Roadmap

Live tracking shipped in 0.7 on [`node-simconnect`](https://github.com/EvenAR/node-simconnect).
Around it: thin very long tracks before storing them, an altitude profile on hover, and
per-aircraft totals that include tracked time.

Other ideas: engine-hours per aircraft, flight-time totals, exporting the map, importing a
logbook from other tools.
