# MSFS Career Map

A map-first logbook for a home-spun MSFS 2024 "career mode": every aircraft + livery you fly
always starts where it last parked, so each one builds its own tour across the map. This app
draws those tours as big colorful hop-to-hop paths, shows where each plane currently sits, and
remembers when you landed at or left each airport.

Version 0.6: manual hop logging, editable paths, per-aircraft icons and colors, airport lookup
by ICAO/IATA/local code, runway data on every airport, and a "next hop" planner that shows which
airports are within a given flight time of where a plane is parked. Live flight tracking from the
sim is planned (see Roadmap).

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

## Using it

- **Fleet**: click **+ Aircraft**, give it a name and livery/registration (that pairing is the unit
  of persistence for add-ons like A2A that track wear per livery), pick a path color, and choose an
  icon. Icons can be a built-in silhouette, an uploaded image (stored in `data/images/`), or an
  image URL.
- **Log a hop**: pick the aircraft, origin, destination, and optionally departure/arrival times,
  flight time and notes. The origin defaults to wherever that aircraft last parked, and after you
  add a hop the form rolls forward so the next hop starts at the destination you just entered.
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
  surface. Filter by airport type or paved-only. If the aircraft also has a **minimum runway
  length**, only airports with a runway at least that long are shown. Hover a dot for distance,
  time and runways; click it (or **Use** in the list) to drop it into the hop form as the next
  destination. The planner can start from any airport via the **From** box, and
  `?plan=<aircraft id>&minutes=90` in the URL runs it on page load. After each search the
  current METARs for the large and medium airports in range are fetched in batches and their
  dot rings turn green/blue/red/magenta for VFR/MVFR/IFR/LIFR as they arrive (only reports under
  90 minutes old count; METARs are reused for five minutes between searches).
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
| GET | `/plan?aircraft_id=&max_minutes=` | Airports in range of where the aircraft is parked; optional `types=`, `paved=1`, `min_runway_ft=`, `from=`, `limit=` |
| GET/POST | `/aircraft` | List / create |
| PUT/DELETE | `/aircraft/:id` | Update / delete (deletes its hops) |
| POST | `/aircraft/:id/icon` | Upload a custom icon as a base64 data URL |
| PUT | `/aircraft/:id/hops/order` | Reorder hops: `{ ids: [...] }` |
| GET/POST | `/hops` | List (`?aircraft_id=`) / create |
| PUT/DELETE | `/hops/:id` | Update / delete |
| POST | `/airports/reimport?download=1` | Refresh the airport and runway lists |

Timestamps are ISO 8601 UTC; the UI enters and displays them in local time. Aircraft carry
optional `cruise_kts` and `min_runway_ft`; the planner needs the first and honours the second.

## Project layout

```
src/server/   Express API, SQLite schema, airport + runway import, planner query (TypeScript via tsx)
src/client/   Vite + React + Leaflet UI
  paths.ts    turns hops into map geometry (great circles, antimeridian unwrapping)
  icons.ts    built-in aircraft silhouettes and the path color palette
scripts/      import-airports.ts
data/         runtime data (ignored by git)
```

## Roadmap

**1.0 — live tracking.** Record the actual flown track from the sim instead of a straight line,
and auto-fill departure/arrival airports and times. The `hops.track` column is already reserved
for a JSON array of `[lat, lon, alt_ft, timestamp]` samples. Candidate approaches, all SimConnect
based so they work with MSFS 2024:

- [`node-simconnect`](https://github.com/EvenAR/node-simconnect) — fits this Node stack directly;
  subscribe to `PLANE LATITUDE/LONGITUDE/ALTITUDE`, `SIM ON GROUND`, `TITLE` and `ATC ID` a few times
  a second and detect takeoff/landing from the on-ground flag.
- [`Python-SimConnect`](https://github.com/odwdinc/Python-SimConnect) — same idea as a small
  sidecar script posting to this API.
- Reading `TITLE` / livery from the sim would let the tracker pick the matching aircraft row
  automatically.

Other ideas: engine-hours per aircraft, flight-time totals, exporting the map, importing a
logbook from other tools.
