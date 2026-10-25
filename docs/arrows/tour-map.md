# Arrow: tour-map

The map view: geometry for tours, airport dots and parked aircraft (placed across the antimeridian
and drawn on every world copy in view), hop paths and tooltips, highlighting and zooming, basemaps
and view preferences, and the night and weather-hazard overlays.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted; first tests in place.
The desktop app's needs are written into the LLD and specs (2026-10-23): the map wherever the page is
shown, the installed app's window included; remembered choices per origin; a bound on the age of the
hazard set served after every source fails, shown on the map; the basemap credit; and the basemap
providers' terms for a distributed app, an open question. Four new gaps; the code is not yet changed.

## References

### HLD
- docs/high-level-design.md (System Design; Segments → tour-map; tenets The page stays a web page and
  Keyless and local)

### LLD
- docs/intent/tour-map/tour-map-design.md

### EARS
- docs/intent/tour-map/tour-map-specs.md (67 specs)

### Context
Downstream of this segment (desktop relies on tour-map through live-tracking), read for detail only;
the facts the map's intent rests on are the HLD's System Design.
- docs/intent/desktop/desktop-design.md — the installed app's fixed port (3380), test mode's port
  (3280) and Electron's own folder, where the window's page keeps its local storage
- docs/intent/desktop/shell/shell-design.md (The Window) — outside links sent to the default browser
  (the attribution's links, once they open in a new tab, by DESK-SHELL-WIN-007); the referrer and
  User-Agent the window's tile requests carry

### Tests
- tests/tour-map/paths.test.ts — MAP-GEO-002 to 009, MAP-GEO-011, MAP-GEO-015, MAP-GEO-016
- tests/tour-map/copies.test.ts — MAP-GEO-013 to 017, MAP-GEO-020, MAP-GEO-021, MAP-HAZ-010, MAP-NIGHT-001
- tests/tour-map/fit.test.ts — MAP-GEO-018, MAP-ZOOM-007 to 011
- tests/tour-map/map-toolbar.test.tsx — MAP-VIEW-006, MAP-VIEW-007, MAP-HAZ-005, MAP-HAZ-008, MAP-HL-002
- tests/tour-map/hop-tip.test.tsx — MAP-PATH-003
- tests/e2e/layout.spec.ts — MAP-VIEW-005, MAP-ZOOM-007
- tests/e2e/world-copies.spec.ts — MAP-GEO-013, MAP-GEO-014, MAP-GEO-016, MAP-GEO-019, MAP-VIEW-004, MAP-DOT-003, MAP-HAZ-008, MAP-HAZ-010

### Code
- src/client/paths.ts — geometry, placing shapes, world copies (`copiesInView`, `copyShifts`, `shiftLine`)
- src/client/geo.ts
- src/client/components/WorldCopies.tsx — the copies in view, shared with every layer
- src/client/components/MapView.tsx — all except `CandidateLayer`, the plan ring and the candidate popup (planner) and `PopupPadding` (app-shell)
- src/client/fit.ts — `applyFocus`, `gatherPoints`
- src/client/components/MapToolbar.tsx — toolbar and Layers menu, `HAZARD_TOGGLES`
- src/client/sun.ts, src/client/components/NightLayer.tsx
- src/client/components/HazardLayer.tsx, src/server/hazards.ts
- src/client/icons.ts — `shade`, `hopStroke` (93-112)
- src/client/prefs.ts — remembered choices in local storage
- src/client/App.tsx — selection, zoom requests (`requestFocus`, `openHop`), basemap and overlay preferences, URL view options
- src/server/routes.ts — `/state` (826-840), `/hazards` (800)

## Architecture

**Purpose:** Draw every visible aircraft's tour where it was flown, show where each aircraft is
parked and when airports were visited, and overlay daylight and weather hazards.

**Key Components:**
1. `buildRenderData` (`paths.ts`) — hop paths placed hop by hop, one dot per airport, parked positions
2. World copies (`paths.ts`, `WorldCopies.tsx`) — placing shapes, the copies in view, the shifts each shape is drawn at
3. `MapView` — layers on every copy, tooltips, highlight dimming, zoom controller (`applyFocus` in `fit.ts`)
4. `NightLayer` + `sun.ts` — day/night shading
5. `HazardLayer` + `hazards.ts` — G-AIRMET/SIGMET fetch, normalise, the earlier set after every source fails, display
6. `App` view state — highlight, zoom requests, remembered choices (`prefs.ts`)
7. `MapToolbar` — toolbar and Layers menu

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Map geometry | MAP-GEO-001 to 021 (no 010) | 19 | 0 | 1 |
| Hop paths and layers | MAP-PATH-001 to 006 | 6 | 0 | 0 |
| Visited-airport dots | MAP-DOT-001 to 003 | 3 | 0 | 0 |
| Parked markers | MAP-PARK-001 to 002 | 2 | 0 | 0 |
| Highlighting | MAP-HL-001 to 003 | 3 | 0 | 0 |
| Zooming | MAP-ZOOM-001 to 011 | 11 | 0 | 0 |
| Basemaps and view | MAP-VIEW-001 to 008 | 7 | 0 | 1 |
| Night shading | MAP-NIGHT-001 to 002 | 2 | 0 | 0 |
| Weather hazards | MAP-HAZ-001 to 012 | 8 | 0 | 4 |

**Summary:** 61 of 67 specs implemented; 6 gaps; none deferred. 34 specs have tests, all of them
implemented; 27 implemented specs have none.

## Key Findings

1. **An earlier hazard set of any age** — when all three sources fail, hazards.ts:198 serves the
   cached set however old it is, unflagged, and the toolbar shows it as "N areas" like a fresh one.
   The installed app's server runs for days behind the tray icon, so after a night offline or a long
   aviationweather.gov outage the overlay draws old weather as current. With no earlier set, the
   all-failed set is cached for 10 minutes and the toolbar says "0 areas" (MAP-HAZ-004, MAP-HAZ-011,
   MAP-HAZ-012).
2. **Basemap tiles in a distributed app** — the Light basemap loads from tile.openstreetmap.org
   (MapView.tsx:52), whose tile usage policy treats a distributed app as heavy use needing
   permission; whether Esri's terms allow its keyless ArcGIS Online services (Dark, Satellite, and
   Light Gray Canvas, the candidate to replace Light) in a distributed app has not been checked. An
   open question in the LLD for the user, to settle before the first public release.
3. **Attribution links navigate the page away in a browser tab** — Leaflet's own link and the
   OpenStreetMap link (MapView.tsx:53) have no target; the installed app's window sends them to the
   default browser, a browser tab loses the page. The credit itself is in place (MAP-VIEW-008).
   Across segments: once MAP-VIEW-008's links open in a new tab, they reach the desktop shell's
   new-window rule (DESK-SHELL-WIN-007, which lists the map's attribution) rather than its navigation
   rule (DESK-SHELL-WIN-006), which stays a guard; the packaged smoke test makes its own navigation to
   check it (DESK-DIST-SMOKE-005).
4. **hazards.ts keeps its own User-Agent** — `MSFSCareerMap/0.6 (personal flight-sim logbook; local
   use)` (hazards.ts:7), apart from app-shell's one User-Agent for every server request (APP-API-005);
   the change lands in this segment's code when app-shell's does.
5. **Partial hazard outages are invisible** — MapToolbar.tsx:60-64 ignores the set's `errors`.
6. **Zoom to a long great circle uses only its endpoints** — paths.ts:297, so a poleward arc can be clipped.
7. **Copies cost most zoomed out** — at the minimum zoom a wide window touches five or more world
   copies, and every layer, planner candidates included, is drawn on each. The desktop design's
   open question on the app's memory with the map loaded measures part of this.
8. **Wording-only changes for the desktop app** — MAP-ZOOM-001 (fit once per page), MAP-ZOOM-004 (a
   hop named in the page's address among the ways a hop opens), MAP-ZOOM-008 (a request replaces one
   still under way), MAP-ZOOM-010 (`prefers-reduced-motion`, following Windows' Animation effects),
   MAP-VIEW-002 (local storage per origin), MAP-VIEW-003 (URL options a development and testing aid)
   and MAP-HAZ-008 (the page's own request; an all-failed set left to MAP-HAZ-011) still hold in the
   code. A hop named in the page's address will come through app-shell's fragment route, not yet
   written; MAP-ZOOM-004 holds as long as that route opens hops through `openHop`
   (App.tsx:262-266), and the hop's zoom wins over the first load's fit still flying by
   MAP-ZOOM-008's replacement clause (Leaflet's `flyTo`, `flyToBounds`, `setView` and `fitBounds`
   stop the animation under way; React keeps only the last focus). App-shell's fragment-route spec
   should cite both. MAP-ZOOM-001 points at live-tracking for reloading the map state when the event
   stream reconnects, which LIVE-API-005 does not yet say; re-check once live-tracking's cascade
   lands.

## Work Required

### Should Fix
1. Bound the age of the hazard set served after every source fails, serve it as it was fetched
   (its failed sources included), flag it as earlier and show its time in the toolbar; serve and
   show an all-failed set as "hazards unavailable", uncached
   (MAP-HAZ-004, MAP-HAZ-011, MAP-HAZ-012; hazards.ts:183-202, HazardLayer.tsx, MapToolbar.tsx:60-64),
   test-first.
2. Put the basemap-tiles question (LLD Open Questions 1: OpenStreetMap's tile usage policy, and
   Esri's terms for Dark, Satellite and the Light Gray Canvas candidate) to the user before the
   first public release, and cascade the answer into MAP-VIEW-001 and MAP-VIEW-008 and, across
   segments, into the desktop shell's DESK-SHELL-WIN-011 and DESK-SHELL-WIN-012 and the desktop
   design's "Where the page comes from" rationale, which name OpenStreetMap's tiles or rest on its
   referrer requirement.
3. Include great-circle arc points in zoom-to-fit (MAP-GEO-012; paths.ts:297).
4. Open the attribution's links in a new tab (MAP-VIEW-008).
5. Use the server's one User-Agent in hazards.ts once app-shell has it (APP-API-005).

### Nice to Have
6. Show partial hazard outages in the toolbar (MAP-HAZ-009), beside the work in item 1.
7. Add tests for the 27 implemented MAP specs that have none, and for the clauses of MAP-ZOOM-008
   that fit.test.ts leaves out (a repeated request zooms again; a request replaces one under way).
