# MSFS Career Map — project notes

Map-centric logbook for a home-spun MSFS 2024 career mode. See README.md for the user-facing
description, API table and roadmap.

## Stack

- Node 22+ with the built-in `node:sqlite` (no native modules). Server is Express 4 in TypeScript run
  via `tsx`; schema lives in `src/server/db.ts`.
- Client is Vite + React 18 + react-leaflet 4. Vite root is `src/client`, build output is `dist/`,
  which the server serves when present.
- Airport data is the OurAirports CSV, imported into the `airports` table on first run.

## Commands

- `npm run dev` — server on :3080 (tsx watch) + Vite on :5173 with `/api` proxied.
- `npm run build` then `npm start` — production-style single server on :3080.
- `npm run typecheck` — both client and server tsconfigs.
- `npm run import-airports [-- --fresh]` — re-import (optionally re-download) airports.

## Conventions

- Hops are ordered per aircraft by `seq`; the server renumbers after deletes/reorders.
- Airport codes are resolved server-side to the canonical OurAirports `ident` before storage.
- Timestamps are stored as ISO UTC strings; the client converts to/from `datetime-local`.
- `hops.track` (JSON) is reserved for the live-tracking feature; nothing writes it yet.
- Map geometry (great circles, antimeridian unwrapping, parked-aircraft positions) is computed in
  `src/client/paths.ts` and shared by the map and the zoom-to-fit logic. Keep those in sync.
- Writing files with bash heredocs failed in this environment; use the Write tool for new files.
