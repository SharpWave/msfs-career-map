# Arrow: planner

Where an aircraft can go next: the block-time model, the candidate search with its hard filters,
live weather and darkness checks, the terrain check along a leg, the planner card, and the range
ring and candidate dots on the map.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → planner)

### LLD
- docs/intent/planner/planner-design.md

### EARS
- docs/intent/planner/planner-specs.md (64 specs)

### Tests
- none (the project has no test suite yet)

### Code
- src/server/performance.ts
- src/server/routes.ts — limits (150-153), `maxFieldElevation` (214-229), `/plan` (694-766), `/terrain` (773-793)
- src/server/airports.ts — `planCandidates`, `distanceNm`, `bearingDeg` (473-551)
- src/server/terrain.ts
- src/client/constraints.ts
- src/client/components/Planner.tsx
- src/client/components/MapView.tsx — surface colors, candidate styles, plan rings, `CandidateLayer`, candidate tooltip and popup
- src/client/components/AirportPopup.tsx — terrain fetch, flags, `TerrainBlock`, **Use**
- src/client/App.tsx — METAR batching, flags, plan lifecycle, URL auto-plan

## Architecture

**Purpose:** Find every airport an aircraft can reach and use within a flight time from where it
is parked, and show which of them live weather or darkness rules out.

**Key Components:**
1. `profileFor` / `blockMinutes` / `maxRangeNm` (`performance.ts`) — block-time model and ring radius
2. `GET /api/plan` + `planCandidates` — origin, hard filters, timing, ordering, cap
3. `assessCandidate` (`constraints.ts`) + App's METAR batching — IFR, crosswind, darkness flags
4. `GET /api/terrain` + `terrain.ts` — terrain profile and minimum altitude for a leg
5. `Planner` card — form, results summary and list
6. Map layers — range ring(s), `CandidateLayer`, candidate tooltip and popup content

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Block-time model | PLAN-TIME-001 to 007 | 7 | 0 | 0 |
| Candidate search | PLAN-FIND-001 to 010 | 8 | 0 | 2 |
| Live checks | PLAN-FLAG-001 to 009 | 8 | 0 | 1 |
| Terrain along a leg | PLAN-TERR-001 to 007 | 6 | 0 | 1 |
| Planner form | PLAN-FORM-001 to 011 | 8 | 0 | 3 |
| Results in the card | PLAN-LIST-001 to 009 | 8 | 0 | 1 |
| Plan lifecycle | PLAN-RUN-001 to 005 | 5 | 0 | 0 |
| Planner layers on the map | PLAN-DRAW-001 to 006 | 6 | 0 | 0 |

**Summary:** 56 of 64 specs implemented; 8 gaps; none deferred. No spec has a test.

## Key Findings

1. **`total` understates dense searches** — routes.ts:733-746 counts only the nearest 2 × limit.
2. **Stale label** — Planner.tsx:196 says cruise altitude is "also sent to SimBrief"; it no longer is.
3. **Candidates across 180° from the origin land a world away** — MapView.tsx:402, App.tsx:284;
   the fix is map geometry, tracked in tour-map as MAP-GEO-013.
4. **Short legs to a higher field are timed too short** — performance.ts:57-61.
5. **Planner limits restated in the browser** — Planner.tsx:199-229 hard-codes 2,000 / 10,000 / 12,000 ft.
6. **Oxygen altitude is 12,000 ft, intended 12,500 ft** — routes.ts:153, Planner.tsx:199-227.
7. **Small airports never get weather** — App.tsx:111 looks up large and medium candidates only.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Use a 12,500 ft oxygen altitude everywhere, from one server constant (PLAN-FIND-006,
   PLAN-TERR-007, PLAN-FORM-007, PLAN-FORM-009).
2. Look up METARs for small candidates with a four-letter station (PLAN-FLAG-001, PLAN-LIST-003).
3. Count every passing airport in the result total (PLAN-FIND-010; routes.ts:733-746).

### Nice to Have
4. Drop "also sent to SimBrief" from the cruise-altitude label (PLAN-FORM-006).
5. Time short legs with the difference in field elevation (performance.ts:57-61).
6. Space terrain samples by distance rather than a fixed 25 (terrain.ts:61-62).
