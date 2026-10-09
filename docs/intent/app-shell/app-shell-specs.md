# App Shell — EARS Specs

Design: [app-shell-design.md](app-shell-design.md). Prefix `APP`; facets `SRV` (server startup and
serving), `DATA` (data locations and database), `API` (API conventions and version), `UI` (page
layout, failures, theme), `FMT` (shared formatting), `RUN` (scripts, launcher, shortcut).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Server

- [x] **APP-SRV-001**: When the server starts, the system shall make sure the airport and runway data are loaded, start live tracking unless it is disabled or faked, and listen on `PORT` (default 3080), logging the address and the database in use.
- [x] **APP-SRV-002**: The server shall serve the API under `/api`, accepting JSON bodies up to 8 MB, and uploaded aircraft icons under `/images` with a one-year immutable cache.
- [x] **APP-SRV-003**: When a client build exists in `dist/`, the server shall serve it and answer any other non-API path with its `index.html`; otherwise it shall answer `/` with a plain-text note that the API is running and how to get the page (`npm run dev`, or build and restart).

## Data and Database

- [x] **APP-DATA-001**: The system shall keep its database at `CAREER_DB` when set, else at `data/career.db`, creating the data folders it needs, with write-ahead logging and foreign keys enforced.
- [ ] **APP-DATA-002**: The system shall keep uploaded aircraft icons in an `images` folder beside the database in use, so a database copy named by `CAREER_DB` never reads or changes the real database's icons.
- [x] **APP-DATA-003**: When the server opens a database, the system shall create any missing table and add any missing column to an existing table in place, keeping the data already there.

## API Conventions

- [x] **APP-API-001**: When an API request fails with a known error, the system shall answer with that error's status and `{"error": message}`; when it fails otherwise, the system shall log the error and answer 500 with its message.
- [x] **APP-API-002**: When an unknown path under `/api` is requested, the system shall answer 404 `{"error": "not found"}`.
- [x] **APP-API-003**: When an API path carries an id that is not a positive whole number, the system shall answer 400 "invalid id".
- [x] **APP-API-004**: When `GET /api/status` is called, the system shall return `ok`, the airport and runway counts, and the app version.
- [ ] **APP-API-005**: The system shall take the app version from `package.json`, report it in `GET /api/status`, and send `MSFSCareerMap/<version> (personal flight-sim logbook; local use)` as the User-Agent on every request the server makes to an outside service (OurAirports, aviationweather.gov, Wikipedia, Open-Meteo, SimBrief).
- [x] **APP-API-006**: When an API call from the page fails, the page shall report the server's `error` message, or the HTTP status and its text when there is none; a 204 answer shall count as success with no content.

## Page Layout and Failures

- [x] **APP-UI-001**: The page shall show the sidebar beside the map area, headed "Career Map" with the app's airplane mark and "N aircraft · N hops · N airports · N runways", followed by the cards Live from the sim, Log a hop, Plan next hop and Fleet, in that order.
- [x] **APP-UI-002**: When the user clicks the map toolbar's ◀ or ▶, the page shall hide or show the sidebar.
- [x] **APP-UI-003**: While the map state has not loaded, the map area shall read "Loading…".
- [x] **APP-UI-004**: If loading the map state fails, then the page shall show "Server error: message" with **Retry**, which loads it again.
- [x] **APP-UI-005**: If the live card, the flight panel or the planned routes fail to render, then the page shall show "<part> failed: message" with **Retry** in that part's place and keep the rest of the page working.
- [x] **APP-UI-006**: The page shall use one dark theme, with its colors defined once as theme variables.
- [ ] **APP-UI-007**: The page shall style hints and warnings under form fields the same way wherever they appear, including the planner's cruise-altitude warning.
- [x] **APP-UI-008**: The page shall be titled "MSFS Career Map" with an orange airplane icon.

## Shared Formatting

- [x] **APP-FMT-001**: The page shall write durations as "Nm" under an hour and "Nh MMm" from an hour, distances as "N nm" and heights as "N ft", rounded to whole units with thousands separators.
- [x] **APP-FMT-002**: The page shall write dates and times in the browser's locale and time zone, with month, day, year, hour and minute in full, and without the year in short form.
- [x] **APP-FMT-003**: The page shall name an aircraft "Name · Livery", or "Name" when it has no livery.

## Scripts and Launcher

- [x] **APP-RUN-001**: When `npm run dev` runs, the system shall start the server on port 3080, restarting on change, and the page on port 5173, passing `/api` and `/images` to the server.
- [x] **APP-RUN-002**: When `npm run build` runs, the system shall build the page into `dist/`; when `npm start` runs, the system shall start the server, which serves that build.
- [x] **APP-RUN-003**: When `npm run typecheck` runs, the system shall check the page, and the server with its scripts, against their TypeScript settings.
- [x] **APP-RUN-004**: The project shall require Node 22.13 or later.
- [x] **APP-RUN-005**: When `start.cmd` runs without Node on the path, it shall say so and stop; when dependencies are missing, it shall install them first.
- [ ] **APP-RUN-006**: When `start.cmd` runs and there is no build, or any page source or build setting is newer than the build, it shall build the page before going on.
- [x] **APP-RUN-007**: When `start.cmd` finds no server answering `/api/status`, it shall start one in its window, wait up to 60 s for it, open the browser unless `CAREER_NO_BROWSER=1`, and keep the window open as the server's console.
- [ ] **APP-RUN-008**: When `start.cmd` finds a server answering `/api/status`, it shall open the browser on it if it reports the code's version, and otherwise say that an older server is still running and its window must be closed first, without opening the browser.
- [x] **APP-RUN-009**: When `scripts/install-shortcut.ps1` runs, it shall create or refresh a desktop shortcut "MSFS Career Map" that runs `start.cmd` minimised with the app icon.
- [x] **APP-RUN-010**: When `node scripts/make-ico.mjs out.ico a.png …` runs, it shall pack the PNG files into one `.ico`.
- [ ] **APP-RUN-011**: When `npm test` runs, the system shall run the Vitest suites — logic, the API against a temporary database, and component tests — without opening the real logbook.
- [ ] **APP-RUN-012**: When `npm run test:e2e` runs, the system shall run the Playwright browser tests against a server on a temporary database fed by the synthetic sim feed, without opening the real logbook.
