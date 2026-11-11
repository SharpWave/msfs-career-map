# Arrow: aircraft-panel

One aircraft beside the map: its picture, hiding it or the others, what its tour adds up to — totals,
tour facts and a landing summary — and its hops in a list, latest first, each with its distance,
flight time, landing, fuel burned and SimBrief plan.

## Status

**MAPPED** — written 2026-11-11 through the full workflow (design, specs, edge audit, tests, code);
not yet audited. Every spec is implemented and tested. Not yet tried by hand in the installed app.

## References

### HLD
- docs/high-level-design.md (Goals → any tour can be looked back on as a whole; Tenets → The page
  stays a web page; Segments → aircraft-panel; Rules every segment follows → Order and position,
  Time, The server decides, the page shows)

### LLD
- docs/intent/aircraft-panel/aircraft-panel-design.md

### EARS
- docs/intent/aircraft-panel/aircraft-panel-specs.md (51 specs)

### Tests
- tests/aircraft-panel/tour.test.ts — ACP-TOUR-002 to 010, ACP-LIST-002, ACP-LIST-003, ACP-PLAN-003, ACP-PLAN-005 (a hop's figures and the tour block's)
- tests/aircraft-panel/layout.test.ts — ACP-LAY-001, ACP-LAY-002, ACP-LAY-003
- tests/aircraft-panel/aircraft-panel.test.tsx — ACP-HEAD-001 to 004, ACP-VIS-001 to 005, ACP-TOUR-001, 002, 004, 006 to 010, ACP-ACT-001 to 003, ACP-LIST-001 to 008, ACP-PLAN-001 to 005, ACP-OPEN-009, ACP-LAY-002
- tests/aircraft-panel/page.test.tsx — ACP-OPEN-001 to 008, ACP-LAY-002, 003, 005, ACP-ACT-001 to 005, ACP-LIST-004 to 007, ACP-VIS-002, 003, 005 (with tour-map's MAP-PARK-002, MAP-PATH-004, MAP-ZOOM-003, MAP-HL-002, MAP-HL-004; fleet's FLEET-CARD-001, FLEET-LOOK-012; app-shell's APP-UI-017, 020 to 022, 043, 044; logbook's LOG-FORM-013; planner's PLAN-FORM-013; live-tracking's LIVE-CARD-009)
- tests/e2e/aircraft-panel.spec.ts — ACP-OPEN-001, ACP-LAY-001, ACP-LAY-004, ACP-LIST-004, 005, 007, ACP-VIS-001, 002, 005 (with MAP-HL-004, MAP-HL-005, MAP-PATH-005, LIVE-LAYER-005, FLEET-LOOK-012, FLEET-LOOK-013, APP-UI-021, APP-UI-041)
- Siblings' tests of what the panel relies on: tests/fleet/visibility-api.test.ts (FLEET-LOOK-013), tests/simbrief/aircraft-plans-api.test.ts (SB-HOP-006), tests/tour-map/highlight.test.ts (MAP-HL-001, MAP-HL-005), tests/tour-map/map-toolbar.test.tsx (FLEET-LOOK-012, MAP-HL-002), tests/logbook/hop-form-handoff.test.tsx (LOG-FORM-013), tests/planner/planner-handoff.test.tsx (PLAN-FORM-013), tests/fleet/fleet-list.test.tsx (FLEET-CARD-001)

### Code
- src/client/components/AircraftPanel.tsx — the panel: frame and error boundary, header, picture, toggles, tour block, actions, hop list, the plan digest
- src/client/tour.ts — a hop's figures, the tour's summary, a plan's figures beside a hop's
- src/client/layout.ts — `aircraftPanelRoom`, `listScrollsAlone`, the clear part's right side
- src/client/App.tsx — whether the panel is open, `pickAircraft`, the hop it marks, its hand-offs
- src/client/styles.css — `.aircraft-panel`, `.acp-*`, `--clear-right`

## Architecture

**Purpose:** Look back on one aircraft's tour as a whole, beside the map that shows it.

**Key Components:**
1. `AircraftPanel` — the frame with its close button, and inside an error boundary keyed by the
   aircraft: header, `Picture`, `Toggles`, `TourBlock`, the actions and the `HopRow` list
2. `tour.ts` — `hopFigures` / `tourRows` / `tourSummary` (worked out from the map state's hops, so a
   hidden aircraft's tour adds up the same), `plannedFigures`, `digestEntry`
3. `usePlanDigest` — simbrief's digest of the aircraft's plans, asked for while the panel shows it
4. The page's state (`App.tsx`): the panel is open or not, apart from the highlight; it shows the
   highlighted aircraft

**Opened from:** a parked marker or a hop's path (tour-map), the live aircraft while it is bound (live-tracking), an aircraft card's badge or name (fleet).
**Hands off to:** the flight panel (a row, the longest hop), the planner, the hop form, the aircraft form.

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Opening and closing | ACP-OPEN-001 to 009 | 9 | 0 | 0 |
| Where it sits | ACP-LAY-001 to 005 | 5 | 0 | 0 |
| Header and picture | ACP-HEAD-001 to 004 | 4 | 0 | 0 |
| Hiding aircraft | ACP-VIS-001 to 005 | 5 | 0 | 0 |
| The tour block | ACP-TOUR-001 to 010 | 10 | 0 | 0 |
| Actions | ACP-ACT-001 to 005 | 5 | 0 | 0 |
| The hop list | ACP-LIST-001 to 008 | 8 | 0 | 0 |
| SimBrief plans in the list | ACP-PLAN-001 to 005 | 5 | 0 | 0 |

**Summary:** all 51 specs implemented; none deferred. All 51 have tests.

## Key Findings

1. **Not yet used on a real logbook.** The tests run on fixture tours of a handful of hops; the list
   renders every hop, and a tour of several hundred has not been looked at in the installed app.
2. **The picture is the aircraft's icon.** An aircraft on a built-in silhouette has none; bundled
   photos by type are an idea the LLD defers (Deferred 1).

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Try the panel by hand in the installed app on the real logbook: a long tour's list, an uploaded
   icon as the picture, hiding the others across a restart, the PDF link opening in the default
   browser.

### Nice to Have
2. The LLD's deferred items: a "flying now" line, sorting and periods, a running cost, narrow
   windows.
