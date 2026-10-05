# MSFS Career Map — project notes

Map-centric logbook for a home-spun MSFS 2024 career mode. See README.md for the user-facing
description, API table and roadmap.

## Stack

- Node 22+ with the built-in `node:sqlite` (no native modules). Server is Express 4 in TypeScript run
  via `tsx`; schema lives in `src/server/db.ts`.
- Client is Vite + React 18 + react-leaflet 4. Vite root is `src/client`, build output is `dist/`,
  which the server serves when present.
- Airport and runway data are the OurAirports CSVs, imported into `airports` / `runways` on first
  run. `airport_rwy` is a per-airport summary (longest runway, surfaces, paved/lit flags) rebuilt by
  every runway import; airport queries LEFT JOIN it. Surface free-text is normalised by
  `surfaceClass()` in `src/server/airports.ts`.
- Schema changes to existing tables go through `addColumnIfMissing()` in `src/server/db.ts` so
  older databases upgrade in place.
- Live tracking: `src/server/simconnect.ts` wraps node-simconnect (pure TypeScript, no SDK DLL)
  and only produces position samples and system events; `src/server/tracker.ts` is the
  sim-independent state machine (`feed(sample)`), checkpointed to the `tracker_state` row so a
  leg survives a server restart. The client subscribes to `/api/tracker/events` (SSE).

## Commands

- `npm run dev` — server on :3080 (tsx watch) + Vite on :5173 with `/api` proxied.
- `npm run build` then `npm start` — production-style single server on :3080.
- `npm run typecheck` — both client and server tsconfigs.
- `npm run import-airports [-- --fresh]` — re-import (optionally re-download) airports.
- `npm run sim-probe` — print what a running sim reports, without touching the database.
- `TRACKER_FAKE=1 npm run dev` then `npm run sim-fake -- KBOS KPVD [--touch-and-go]
  [--start-airborne]` — drive the tracker with a synthetic flight; test against a copy of the
  database (`CAREER_DB=...`) so fake hops never land in the real logbook.

## Conventions

- Hops are ordered per aircraft by `seq`; the server renumbers after deletes/reorders.
- Airport codes are resolved server-side to the canonical OurAirports `ident` before storage.
- Timestamps are stored as ISO UTC strings; the client converts to/from `datetime-local`.
- `hops.track` is a JSON array of `[lat, lon, alt_ft, unix_seconds]`, written only by the tracker
  (one sample per 5 s). `parseTrack()` in `src/client/tracker.ts` reads it and `paths.ts` draws it
  in place of the great circle, with the airport positions prepended/appended.
- Aircraft rows carry `sim_title` / `sim_livery` (the sim's `TITLE` and `LIVERY NAME`); the
  tracker matches on both, with a blank `sim_livery` meaning any livery.
- Map geometry (great circles, antimeridian unwrapping, parked-aircraft positions) is computed in
  `src/client/paths.ts` and shared by the map and the zoom-to-fit logic. Keep those in sync.
- Writing files with bash heredocs failed in this environment; use the Write tool for new files.
