# App Shell — EARS Specs

Design: [app-shell-design.md](app-shell-design.md). Prefix `APP`; facets `SRV` (server startup and
serving), `DATA` (data locations and database), `API` (API conventions and version), `UI` (page
layout, menu and drawers, the covered part of the map, failures, the look), `FMT` (shared formatting), `RUN` (scripts, launcher, shortcut).

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

- [x] **APP-UI-001**: The page shall show the map across the whole window, with a top bar holding the menu button (the app's airplane mark and "Career Map") and the sidebar toggle at the left and the map toolbar at the right, and below it on the left a left column showing the sidebar, which holds the cards Live from the sim and Plan next hop in that order.
- [x] **APP-UI-002**: When the user clicks the sidebar toggle, the page shall hide the left column, closing any open drawer, or show the sidebar in it again; the page shall open with the sidebar shown.
- [x] **APP-UI-003**: While the map state has not loaded, the map area shall read "Loading…".
- [x] **APP-UI-004**: If loading the map state fails, then the page shall show "Server error: message" with **Retry**, which loads it again.
- [x] **APP-UI-005**: If the live card, the flight panel, the planned routes or the live aircraft fail to render, then the page shall show "<part> failed: message" with **Retry** in that part's place — the flight panel keeping its place and close button, a map layer as a notice at the top of the clear part of the map (APP-UI-020) — and keep the rest of the page working.
- [x] **APP-UI-006**: The page shall use one dark theme, with its colors — accent, text, muted, ok, caution, airborne and danger — defined once as theme variables, and shall use the accent for no status.
- [x] **APP-UI-007**: The page shall style hints and warnings under form fields the same way wherever they appear, including the planner's cruise-altitude warning.
- [x] **APP-UI-008**: The page shall be titled "MSFS Career Map" with an orange airplane icon.
- [x] **APP-UI-009**: The page shall make the sidebar and each drawer 400 px wide (340 px in a window narrower than 960 px), starting under the top bar, the sidebar running to the bottom of the window and a drawer as tall as what it holds up to the same bottom edge, and the flight panel span from the left column's right edge (the window's edge when the column is hidden) to the window's right edge, 40% of the window's height and at least 260 px, keeping a 12 px gutter between panels and from the window's edges.
- [x] **APP-UI-010**: The sidebar shall give the live card the height it needs up to half the sidebar, scrolling inside beyond that, and the planner card the rest, scrolling inside together with its candidate list; when that would leave the planner card under 240 px, the whole sidebar shall scroll instead.
- [x] **APP-UI-011**: The page shall let clicks in the gaps between and below the sidebar's cards through to the map.
- [x] **APP-UI-029**: When the user collapses or opens a sidebar card, the page shall hide or show the card's body without discarding what it holds, and remember in the browser whether each card was left open, opening both cards on a first visit.

## Menu and Drawers

- [x] **APP-UI-012**: When the user opens the menu, the page shall show "N aircraft · N hops · N airports · N runways" and the entries Log a hop and Fleet; while the map state has not loaded, the menu shall leave out the count line and disable both entries.
- [x] **APP-UI-013**: When the user chooses Log a hop or Fleet in the menu, the page shall close the menu and show that drawer, headed by its title and a close button, in the left column in place of the sidebar, replacing any other open drawer and showing the column if it was hidden.
- [x] **APP-UI-014**: When the user closes a drawer, the page shall show the sidebar in the left column and return the keyboard focus to the control that opened the drawer.
- [x] **APP-UI-015**: When a drawer opens, the page shall move the keyboard focus into it: to the field a hand-off fills, else to the drawer's close button.
- [x] **APP-UI-016**: The page shall close the menu and the Layers menu on Esc, when their button is clicked again, and when the pointer goes down outside them, letting that click act on whatever it lands on; opening either menu shall close the other.
- [x] **APP-UI-017**: When another part of the page hands work to a drawer (LOG-FORM-004, FLEET-SIM-003, PLAN-FORM-003), the page shall open that drawer, showing the left column, and scroll the drawer to the form the hand-off fills once the drawer is showing.
- [x] **APP-UI-018**: The page shall keep the sidebar, and each drawer once it has opened, mounted while hidden, so its forms, expanded cards and results are as the user left them when it shows again unless a hand-off has changed them, and shall make a hidden panel inert: out of the tab order, not read out, and unable to take the focus.
- [x] **APP-UI-019**: When a hop is logged or an aircraft saved from a drawer, the page shall keep the drawer open.

## The Covered Part of the Map

- [x] **APP-UI-020**: The page shall supply every zoom request with the part of the map the panels leave clear — right of the left column (or of the window's edge gutter when the column is hidden), below the top bar and above the flight panel — worked out from which panels are open when the request is made.
- [x] **APP-UI-021**: When a map popup opens, the page shall pan the map so the popup lies inside the clear part of the map (APP-UI-020); the page shall show the map's attribution above the flight panel.
- [x] **APP-UI-022**: The page shall stack, from the bottom, the map with its popups and tooltips, the "Nothing on the map yet" card, the left column and the flight panel, the top bar, the menus, the toast, and the error banner, and shall centre the toast, the error banner and the empty-map card across the clear part of the map (APP-UI-020), the toast and banner just above the flight panel while it is open.

## The Look

- [x] **APP-UI-023**: The page shall draw every panel over the map — the menu button, the sidebar's cards, drawers, toolbar, menus, flight panel, map popups and tooltips, toast and banner — as frosted glass: a dark tint over a blur of the map of at most 12 px, with a hairline edge; the tint shall be heavier in the drawers and on every panel while the Light basemap is shown, and anything that pops up inside a panel (airport suggestions, the profile chart's readout) shall be solid.
- [x] **APP-UI-024**: While the browser asks for reduced transparency, the page shall draw its panels in their tint, fully opaque, without blur.
- [x] **APP-UI-025**: The page shall set its text in B612 and its airport codes, times and numeric readouts in B612 Mono, both served by the app itself.
- [x] **APP-UI-026**: The page shall draw its interface icons from one inline SVG set, and give every button that shows only an icon an accessible name matching its tooltip.
- [x] **APP-UI-027**: The page shall show an accent focus ring on any control reached by keyboard.
- [x] **APP-UI-028**: While the browser asks for reduced motion, the page shall not animate the drawers, the menus, the toast or the live marker's pulse.

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
