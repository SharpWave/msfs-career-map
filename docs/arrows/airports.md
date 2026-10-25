# Arrow: airports

Airport reference data (the OurAirports lists: seeding a data folder from the program folder,
downloading with recorded download times, preparing at start, the monthly refresh, importing with
surface classes and the runway summary), finding airports (code resolution, search, the airport
input, nearest airport), and airport details (popup and its outside links, runways, METAR,
Wikipedia).

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour plus confirmed intended changes.
Cascaded 2026-10-23 from the desktop app's HLD, the desktop design and its shell and distribution
LLDs, and the desktop edge audit: the server prepares airport data after it listens and before the
sim link starts, downloading only a list an import needs, reporting progress and never ending on a
failure (APT-DATA-001, 002, 021, 022); seeds a data folder with only the lists it lacks
(APT-DATA-017); records each list's download time in a set form (APT-DATA-018); bounds downloads
(APT-DATA-019); takes an input that turns downloads off (APT-DATA-020); imports in batches without
holding the server (APT-DATA-023), one import at a time (024), stopping at shutdown (025) and
clearing leftovers at start (026); refreshes a list that is missing or over 30 days old, holding the
refresh while the sim link is connected or a leg is in progress (APT-DATA-003 to 005); links an
official site only when it has a usable address (APT-POP-007); and bounds the METAR cache
(APT-WX-010).

## References

### HLD
- docs/high-level-design.md (Approach → free, public data; System Design → the data folder, the
  server; Segments → airports; Rules every segment follows → airport codes; Tenets → out of the
  pilot's way while flying)

### LLD
- docs/intent/airports/airports-design.md

### EARS
- docs/intent/airports/airports-specs.md (62 specs)

### Tests
- tests/airports/list-files.test.ts — APT-DATA-018, 019, 025; APP-API-005 (download times read and written; bounded downloads under a temporary name; a stop)
- tests/airports/import.test.ts — APT-DATA-006, 007, 010, 014, 023, 025, 026 (staging in batches, the old data in use until the swap, the event loop held under ~100 ms, failures and stops, airports hops reference kept)
- tests/airports/preparation.test.ts — APT-DATA-001, 002, 014, 017, 018, 019, 020, 021, 022, 026; APP-API-005, 010 (`AirportWork.prepareAtStart` on a database and folders of its own)
- tests/airports/refresh.test.ts — APT-DATA-003, 004, 005, 014, 016, 018, 019, 020, 022, 024, 025; APP-API-009, 010 (the daily checks, the hold, re-imports, stopping)
- tests/airports/unlisted.test.ts — APT-DATA-008, APT-FIND-002 (on the test file's own database)
- tests/airports/reimport-api.test.ts — APT-DATA-016, 024; APP-API-001, 008
- tests/airports/popup-unlisted.test.tsx — APT-DATA-009
- app-shell's tests/app-shell/server-airports.test.ts — APT-DATA-001, 002, 017, 018, 020, 021, 022, 023, 025, 026 through a server process

### Code
- src/server/airport-data.ts — the lists, download times, downloads, seeding, the staged import and swap, `AirportWork`
- src/server/airports.ts — the server's `airportWork`, lookups, METAR, Wikipedia; all except `planCandidates` (planner)
- src/server/routes.ts — airports section (65-117)
- scripts/import-airports.ts
- src/client/metar.ts
- src/client/components/AirportInput.tsx
- src/client/components/AirportPopup.tsx — all except `TerrainBlock` (planner)
- src/client/components/RunwayInfo.tsx
- src/client/format.ts — `airportTypeLabel`, `surfaceLabel`, `runwaySummary`, `airportWhere` (68-108)
- src/server/schema.ts — `airports` (with `unlisted`), `runways`, `airport_rwy`, `wiki_cache` tables

## Architecture

**Purpose:** Hold a worldwide airport and runway list locally, find airports by code, name or
position, and tell the user what an airport is like right now.

**Key Components:**
1. `AirportWork` (airport-data.ts) — preparation at start (leftovers, seeding, downloads, imports
   into empty tables), the daily checks with the monthly refresh held while the pilot is in the sim,
   requested re-imports, one at a time, stopped at shutdown
2. Import (`stageList`, `swapIn`) — CSV to staging tables in batches, one short swap keeping the
   airports hops reference, surface classes, runway summary
3. Lookup (`findAirport`, `searchAirports`, `nearestAirport`) — code resolution, ranked search, nearest field
4. `AirportInput` — typeahead code box shared by three forms
5. `AirportPopup` + `RunwayInfo` — details, runways, METAR, Wikipedia, links
6. METAR (`latestMetars`, `metar.ts`) — fetch, cache, station rule, freshness

**Consumers outside the map:** the desktop design and its distribution LLD rely on seeding a data
folder from the program folder (only the lists it lacks), the lists' download times and the input
that turns airport downloads off (test mode, the packaged smoke test); the desktop shell relies on
the official-site link carrying a scheme (APT-POP-007). app-shell's start order, `/api/status` and
its `ready` flag carry airport preparation's progress and outcome; app-shell's startup hands the
refresh live-tracking's sim-link and leg-in-progress state, and its shutdown stops airport work
before closing the database.

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Reference data | APT-DATA-001 to 026 | 26 | 0 | 0 |
| Finding airports | APT-FIND-001 to 010 | 9 | 0 | 1 |
| Nearest airport | APT-NEAR-001 to 002 | 1 | 0 | 1 |
| Airport popup | APT-POP-001 to 007 | 5 | 0 | 2 |
| Runway display | APT-RWY-001 to 003 | 3 | 0 | 0 |
| METAR | APT-WX-001 to 010 | 9 | 0 | 1 |
| Wikipedia | APT-WIKI-001 to 004 | 3 | 0 | 1 |

**Summary:** 56 of 62 specs implemented; 6 gaps; none deferred. 23 implemented specs have tests,
22 of the 26 reference-data specs among them.

## Key Findings

1. **The official-site link is the raw `home_link`** — AirportPopup.tsx:158-159; a value with no
   scheme resolves to the page's own address, which the desktop app's window (installed or in test
   mode) refuses to open.
2. **Nearest airport misses the far side of the 180° meridian** — airports.ts:381-419, unlike
   `planCandidates`.
3. **The METAR cache never drops expired entries** — airports.ts:262-289; a server that runs for
   weeks in the tray keeps every station it was ever asked about.
4. **The runway summary counts open runways only** — airport-data.ts:506-512; an airport whose
   runways are all closed reads as "no runway data".
5. **The refresh and a repeated preparation have not yet run against the real OurAirports lists** —
   the tests answer the downloads from fixtures; the swap was timed at about 230 ms for 80 000
   airports.

## Work Required

### Must Fix
1. Link the official site only with an http or https address, adding `https://` to a host-like
   value (APT-POP-007), which the desktop shell relies on.

### Should Fix
2. Wrap the nearest-airport search across the 180° meridian (APT-NEAR-002).
3. Fall back to the cached Wikipedia summary on network errors and timeouts (APT-WIKI-004).
4. Discard out-of-order search responses in the airport input (APT-FIND-006).
5. Drop expired METAR cache entries (APT-WX-010).
6. Tests for the 33 implemented APT specs that have none (APT-DATA-011 to 013 and 015 first).

### Nice to Have
7. Prefer a sentence end when clipping the popup blurb (APT-POP-005).
8. One METAR formatter for popup and tooltip.
9. Escape `%`/`_` in search input; derive headings for one-digit runway numbers.
