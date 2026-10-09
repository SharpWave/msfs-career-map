# App Shell — EARS Specs

Design: [app-shell-design.md](app-shell-design.md). Prefix `APP`; facets `SRV` (server startup and
serving), `DATA` (data locations and database), `API` (API conventions and version), `UI` (page
layout, failures, theme), `FMT` (shared formatting), `RUN` (scripts, launcher, shortcut).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Server

- [x] **APP-SRV-001**: When the server starts, the system shall make sure the airport and runway data are loaded, start live tracking unless it is disabled or faked, and listen on `PORT` (default 3080), logging the address and the database in use.
- [x] **APP-SRV-002**: The server shall serve the API under `/api`, accepting JSON bodies up to 8 MB, and uploaded aircraft icons under `/images` with a one-year immutable cache.
- [x] **APP-SRV-003**: When a client build exists in `dist/`, the server shall serve it and answer any other non-API path with its `index.html`; otherwise it shall answer `/` with a plain-text note that the API is running and how to get the page (`npm run dev`, or build and restart).
- [x] **APP-SRV-004**: The server shall build the app it serves — the API with its JSON limit and error handlers, `/images`, and the page — with one function, `createApp`, that neither listens, connects to the sim nor loads data when called, and that startup and the API tests both use.

## Data and Database

- [x] **APP-DATA-001**: The system shall keep its database at `CAREER_DB` when set, else at `data/career.db`, creating the data folders it needs, with write-ahead logging and foreign keys enforced.
- [x] **APP-DATA-002**: The system shall keep uploaded aircraft icons in an `images` folder, and the OurAirports lists as `airports.csv` and `runways.csv`, in the folder of the database in use, so a database named by `CAREER_DB` in another folder never reads or changes the real database's icons or lists.
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

- [x] **APP-RUN-001**: When `npm run dev` runs, the system shall start the server on `PORT` (default 3080), restarting on change, and the page on port 5173, passing `/api` and `/images` to the server on `PORT`.
- [x] **APP-RUN-002**: When `npm run build` runs, the system shall build the page into `dist/`; when `npm start` runs, the system shall start the server, which serves that build.
- [x] **APP-RUN-003**: When `npm run typecheck` runs, the system shall check the page, the server with its scripts, and the tests against their TypeScript settings.
- [x] **APP-RUN-004**: The project shall require Node 22.13 or later.
- [x] **APP-RUN-005**: When `start.cmd` runs without Node on the path, it shall say so and stop; when dependencies are missing, it shall install them first.
- [ ] **APP-RUN-006**: When `start.cmd` runs and there is no build, or any page source or build setting is newer than the build, it shall build the page before going on.
- [x] **APP-RUN-007**: When `start.cmd` finds no server answering `/api/status`, it shall start one in its window, wait up to 60 s for it, open the browser unless `CAREER_NO_BROWSER=1`, and keep the window open as the server's console.
- [ ] **APP-RUN-008**: When `start.cmd` finds a server answering `/api/status`, it shall open the browser on it if it reports the code's version, and otherwise say that an older server is still running and its window must be closed first, without opening the browser.
- [x] **APP-RUN-009**: When `scripts/install-shortcut.ps1` runs, it shall create or refresh a desktop shortcut "MSFS Career Map" that runs `start.cmd` minimised with the app icon.
- [x] **APP-RUN-010**: When `node scripts/make-ico.mjs out.ico a.png …` runs, it shall pack the PNG files into one `.ico`.
- [x] **APP-RUN-011**: When `npm test` runs, the system shall run the Vitest tests under `tests/` — logic and API tests in Node, component tests in jsdom — giving each Node test file its own data folder, inside a temporary folder for the run, with a new database and a copy of the fixture airport lists.
- [x] **APP-RUN-012**: When `npm run test:e2e` runs, the system shall start the app server on port 3180, on a new temporary data folder with the fixture airport lists and with the synthetic sim feed enabled, and the page's dev server on port 5183 passing `/api` and `/images` to it, then run the Playwright tests in Chromium one at a time and stop both servers.
- [x] **APP-RUN-013**: If `CAREER_DB` does not name a database in a Node test file's own temporary data folder when that file starts, then the system shall fail the file before any app module is loaded.
- [x] **APP-RUN-014**: When a Vitest test makes a request to any address other than the test server it started (component tests start none), the system shall fail the test unless the test has supplied the answer to that request.
- [x] **APP-RUN-015**: When `npm test` finishes, the system shall delete the run's temporary folder; when either test command starts, the system shall delete leftover test folders more than a day old.
- [x] **APP-RUN-016**: If port 3180 or 5183 is already in use when `npm run test:e2e` starts, then the system shall fail the run without running any test.
- [x] **APP-RUN-017**: Before the first browser test of an `npm run test:e2e` run, the system shall check that `/api/status`, requested through port 5183, reports the fixture lists' airport count, and fail the run if it does not.
- [x] **APP-RUN-018**: While `npm run test:e2e` runs, the app server shall answer the outside requests the browser tests rely on from fixtures and refuse every other outside request, and the browser shall block the page's requests to any address other than the two test servers.
