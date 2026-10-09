# Arrow: airports

Airport reference data (OurAirports import, surface classes, runway summary), finding airports
(code resolution, search, the airport input, nearest airport), and airport details (popup,
runways, METAR, Wikipedia).

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour plus confirmed intended changes; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → airports)

### LLD
- docs/intent/airports/airports-design.md

### EARS
- docs/intent/airports/airports-specs.md (50 specs)

### Tests
- none yet (they go in `tests/airports/`; the harness is app-shell's)

### Code
- src/server/airports.ts — all except `planCandidates` (planner)
- src/server/routes.ts — airports section (63-114)
- scripts/import-airports.ts
- src/client/metar.ts
- src/client/components/AirportInput.tsx
- src/client/components/AirportPopup.tsx — all except `TerrainBlock` (planner)
- src/client/components/RunwayInfo.tsx
- src/client/format.ts — `airportTypeLabel`, `surfaceLabel`, `runwaySummary`, `airportWhere` (68-108)
- src/server/db.ts — `airports`, `runways`, `airport_rwy`, `wiki_cache` tables

## Architecture

**Purpose:** Hold a worldwide airport and runway list locally, find airports by code, name or
position, and tell the user what an airport is like right now.

**Key Components:**
1. Import (`importAirportsCsv`, `importRunwaysCsv`, `ensureReferenceData`) — CSV to tables, surface classes, runway summary
2. Lookup (`findAirport`, `searchAirports`, `nearestAirport`) — code resolution, ranked search, nearest field
3. `AirportInput` — typeahead code box shared by three forms
4. `AirportPopup` + `RunwayInfo` — details, runways, METAR, Wikipedia, links
5. METAR (`latestMetars`, `metar.ts`) — fetch, cache, station rule, freshness

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Reference data | APT-DATA-001 to 016 | 10 | 0 | 6 |
| Finding airports | APT-FIND-001 to 010 | 9 | 0 | 1 |
| Nearest airport | APT-NEAR-001 to 002 | 1 | 0 | 1 |
| Airport popup | APT-POP-001 to 006 | 5 | 0 | 1 |
| Runway display | APT-RWY-001 to 003 | 3 | 0 | 0 |
| METAR | APT-WX-001 to 009 | 9 | 0 | 0 |
| Wikipedia | APT-WIKI-001 to 004 | 3 | 0 | 1 |

**Summary:** 40 of 50 specs implemented; 10 gaps; none deferred. No spec has a test.

## Key Findings

1. **A re-import drops airports that hops still reference** — airports.ts:93-114 deletes every
   airport and skips `closed` ones, so a logged airport that closes vanishes from the map, the
   planner and hop edits.
2. **Airport data is never refreshed after first run** — airports.ts:197-209 only imports when the
   tables are empty.
3. **Nearest airport misses the far side of the 180° meridian** — airports.ts:566-568, unlike
   `planCandidates` (518-531).
4. **The runway summary counts open runways only** — airports.ts:187; an airport whose runways
   are all closed reads as "no runway data".

## Work Required

### Must Fix
*(none identified)*

### Should Fix
1. Keep airports that hops reference across re-imports (APT-DATA-007 to 009).
2. Wrap the nearest-airport search across the 180° meridian (APT-NEAR-002; airports.ts:566-568).
3. Fall back to the cached Wikipedia summary on network errors and timeouts (APT-WIKI-004).
4. Discard out-of-order search responses in the airport input (APT-FIND-006).

### New Behaviour
5. Monthly automatic refresh, deferred while a leg is flown, retried on failure (APT-DATA-003 to 005).

### Nice to Have
6. Prefer a sentence end when clipping the popup blurb (APT-POP-005).
7. One METAR formatter for popup and tooltip.
8. Escape `%`/`_` in search input; derive headings for one-digit runway numbers.
