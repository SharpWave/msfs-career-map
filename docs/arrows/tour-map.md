# Arrow: tour-map

The map view: geometry for tours, airport dots and parked aircraft (with antimeridian
unwrapping), hop paths and tooltips, highlighting and zooming, basemaps and view preferences, and
the night and weather-hazard overlays.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted; first tests in place.

## References

### HLD
- docs/high-level-design.md (System Design → tour-map)

### LLD
- docs/intent/tour-map/tour-map-design.md

### EARS
- docs/intent/tour-map/tour-map-specs.md (52 specs)

### Tests
- tests/tour-map/paths.test.ts — MAP-GEO-002, MAP-GEO-004, MAP-GEO-005

### Code
- src/client/paths.ts
- src/client/geo.ts
- src/client/components/MapView.tsx — all except `CandidateLayer`, the plan ring and the candidate popup (planner)
- src/client/sun.ts, src/client/components/NightLayer.tsx
- src/client/components/HazardLayer.tsx, src/server/hazards.ts
- src/client/icons.ts — `shade`, `hopStroke` (93-112)
- src/client/App.tsx — selection, zoom requests, basemap and overlay preferences, URL view options, toolbar
- src/server/routes.ts — `/state` (797-811), `/hazards` (771)

## Architecture

**Purpose:** Draw every visible aircraft's tour where it was flown, show where each aircraft is
parked and when airports were visited, and overlay daylight and weather hazards.

**Key Components:**
1. `buildRenderData` (`paths.ts`) — chains, unwrapping, paths, airport dots, parked positions
2. `MapView` — layers, tooltips, highlight dimming, zoom controller
3. `NightLayer` + `sun.ts` — day/night shading
4. `HazardLayer` + `hazards.ts` — G-AIRMET/SIGMET fetch, normalise, display
5. `App` view state — highlight, zoom requests, preferences, toolbar

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Map geometry | MAP-GEO-001 to 013 | 11 | 0 | 2 |
| Hop paths and layers | MAP-PATH-001 to 006 | 6 | 0 | 0 |
| Visited-airport dots | MAP-DOT-001 to 003 | 3 | 0 | 0 |
| Parked markers | MAP-PARK-001 to 002 | 2 | 0 | 0 |
| Highlighting | MAP-HL-001 to 003 | 3 | 0 | 0 |
| Zooming | MAP-ZOOM-001 to 008 | 8 | 0 | 0 |
| Basemaps and view | MAP-VIEW-001 to 005 | 5 | 0 | 0 |
| Night shading | MAP-NIGHT-001 to 002 | 2 | 0 | 0 |
| Weather hazards | MAP-HAZ-001 to 010 | 8 | 0 | 2 |

**Summary:** 48 of 52 specs implemented; 4 gaps; none deferred. 3 specs have tests.

## Key Findings

1. **Hazards are drawn on one world copy** — HazardLayer.tsx:78-80, unlike NightLayer's three.
2. **Partial hazard outages are invisible** — App.tsx:397-401 ignores the set's `errors`.
3. **Planner candidates across 180° from the origin land a world away** — MapView.tsx:402 and
   App.tsx:284 apply only the plan's shift.

## Work Required

### Should Fix
1. Draw hazard polygons on every world copy (MAP-HAZ-010).
2. Include great-circle arc points in zoom-to-fit (MAP-GEO-012; paths.ts:192).
3. Place planner candidates within 180° of the drawn origin (MAP-GEO-013; a `paths.ts` helper used by
   `CandidateLayer`, the candidate popup and candidate zoom).

### Nice to Have
4. Show partial hazard outages in the toolbar (MAP-HAZ-009).
5. Reuse marker icons across live-tracker re-renders.
