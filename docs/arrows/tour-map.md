# Arrow: tour-map

The map view: geometry for tours, airport dots and parked aircraft (placed across the antimeridian
and drawn on every world copy in view), hop paths and tooltips, highlighting and zooming, basemaps
and view preferences, and the night and weather-hazard overlays.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted; first tests in place.

## References

### HLD
- docs/high-level-design.md (System Design → tour-map)

### LLD
- docs/intent/tour-map/tour-map-design.md

### EARS
- docs/intent/tour-map/tour-map-specs.md (64 specs)

### Tests
- tests/tour-map/paths.test.ts — MAP-GEO-002 to 009, MAP-GEO-011, MAP-GEO-015, MAP-GEO-016
- tests/tour-map/copies.test.ts — MAP-GEO-013 to 017, MAP-GEO-020, MAP-GEO-021, MAP-HAZ-010, MAP-NIGHT-001
- tests/tour-map/fit.test.ts — MAP-GEO-018, MAP-ZOOM-007 to 011
- tests/tour-map/map-toolbar.test.tsx — MAP-VIEW-006, MAP-VIEW-007, MAP-HAZ-005, MAP-HAZ-008, MAP-HL-002
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
- src/client/App.tsx — selection, zoom requests (`requestFocus`), basemap and overlay preferences, URL view options
- src/server/routes.ts — `/state` (826-840), `/hazards` (800)

## Architecture

**Purpose:** Draw every visible aircraft's tour where it was flown, show where each aircraft is
parked and when airports were visited, and overlay daylight and weather hazards.

**Key Components:**
1. `buildRenderData` (`paths.ts`) — hop paths placed hop by hop, one dot per airport, parked positions
2. World copies (`paths.ts`, `WorldCopies.tsx`) — placing shapes, the copies in view, the shifts each shape is drawn at
3. `MapView` — layers on every copy, tooltips, highlight dimming, zoom controller (`applyFocus` in `fit.ts`)
4. `NightLayer` + `sun.ts` — day/night shading
5. `HazardLayer` + `hazards.ts` — G-AIRMET/SIGMET fetch, normalise, display
6. `App` view state — highlight, zoom requests, preferences
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
| Basemaps and view | MAP-VIEW-001 to 007 | 7 | 0 | 0 |
| Night shading | MAP-NIGHT-001 to 002 | 2 | 0 | 0 |
| Weather hazards | MAP-HAZ-001 to 010 | 9 | 0 | 1 |

**Summary:** 62 of 64 specs implemented; 2 gaps; none deferred. 33 specs have tests.

## Key Findings

1. **Partial hazard outages are invisible** — MapToolbar.tsx:60-64 ignores the set's `errors`.
2. **Zoom to a long great circle uses only its endpoints** — paths.ts:297, so a poleward arc can be clipped.
3. **Copies cost most zoomed out** — at the minimum zoom a wide window touches five or more world
   copies, and every layer, planner candidates included, is drawn on each.

## Work Required

### Should Fix
1. Include great-circle arc points in zoom-to-fit (MAP-GEO-012; paths.ts:297).

### Nice to Have
2. Show partial hazard outages in the toolbar (MAP-HAZ-009).
3. Add tests for the 29 implemented MAP specs that have none.
