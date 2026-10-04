# MSFS Career Map

A map-first logbook for a home-spun MSFS 2024 "career mode": every aircraft + livery you fly
always starts where it last parked, so each one builds its own tour across the map. This app
draws those tours as big colorful hop-to-hop paths, shows where each plane currently sits, and
remembers when you landed at or left each airport.

Version 0.5: manual hop logging, editable paths, per-aircraft icons and colors, airport lookup
by ICAO/IATA/local code. Live flight tracking from the sim is planned (see Roadmap).

## Quick start

Requires Node 22.13 or newer (uses Node's built-in SQLite, no native modules to compile).

```powershell
npm install
npm run dev
```

Then open http://localhost:5173. On first start the server downloads the
[OurAirports](https://ourairports.com/data/) airport list (about 12 MB) into `data/airports.csv`
and imports it into the database. That takes a few seconds once.

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
- **Basemaps**: Dark (Esri), Light (OpenStreetMap), Satellite (Esri imagery). All keyless.

Airport codes accept ICAO idents (`KBOS`), GPS codes, IATA (`BOS`) and US local codes; type a name
or city to search.

## Where the data lives

Everything is in `data/` (git-ignored):

| File | Contents |
| --- | --- |
| `data/career.db` | SQLite database: aircraft, hops, imported airports |
| `data/airports.csv` | OurAirports source list, re-importable with `npm run import-airports` |
| `data/images/` | Uploaded aircraft icons |

Back up `career.db` and `images/` and you have everything. Set `CAREER_DB` to use a different
database path, `PORT` to change the server port (default 3080).

## API

All JSON, under `/api`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/state` | Aircraft, hops, and every airport they reference, in one call |
| GET | `/airports/search?q=` | Search by code, name or city |
| GET | `/airports/:code` | Look up one airport by any code |
| GET/POST | `/aircraft` | List / create |
| PUT/DELETE | `/aircraft/:id` | Update / delete (deletes its hops) |
| POST | `/aircraft/:id/icon` | Upload a custom icon as a base64 data URL |
| PUT | `/aircraft/:id/hops/order` | Reorder hops: `{ ids: [...] }` |
| GET/POST | `/hops` | List (`?aircraft_id=`) / create |
| PUT/DELETE | `/hops/:id` | Update / delete |
| POST | `/airports/reimport?download=1` | Refresh the airport list |

Timestamps are ISO 8601 UTC; the UI enters and displays them in local time.

## Project layout

```
src/server/   Express API, SQLite schema, airport import (TypeScript via tsx)
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
