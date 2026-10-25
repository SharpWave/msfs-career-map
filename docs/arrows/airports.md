# Arrow: airports

Airport reference data (the OurAirports lists: seeding a data folder from the program folder,
downloading with recorded download times, preparing at start, the monthly refresh, importing with
surface classes and the runway summary), finding airports (code resolution, search, the airport
input, nearest airport), and airport details (popup and its outside links, runways, METAR,
Wikipedia).

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour plus confirmed intended changes; specs drafted, no tests yet.
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
1. Preparation and refresh (`ensureReferenceData` today; seeding, download times, the daily check
   and its hold planned) — lists into the data folder, the import at start, the monthly refresh
2. Import (`importAirportsCsv`, `importRunwaysCsv`) — CSV to tables, surface classes, runway summary
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
| Reference data | APT-DATA-001 to 026 | 8 | 0 | 18 |
| Finding airports | APT-FIND-001 to 010 | 9 | 0 | 1 |
| Nearest airport | APT-NEAR-001 to 002 | 1 | 0 | 1 |
| Airport popup | APT-POP-001 to 007 | 5 | 0 | 2 |
| Runway display | APT-RWY-001 to 003 | 3 | 0 | 0 |
| METAR | APT-WX-001 to 010 | 9 | 0 | 1 |
| Wikipedia | APT-WIKI-001 to 004 | 3 | 0 | 1 |

**Summary:** 38 of 62 specs implemented; 24 gaps; none deferred. No spec has a test.

## Key Findings

1. **Airport data is prepared before the server listens, in one synchronous step, and an offline
   first run ends the server** — index.ts:44-56, airports.ts:197-209. The desktop app's start
   needs the server answering `/api/status` with progress first, and a server that exits offline
   would be restarted by the desktop shell only to fail again (APT-DATA-001, 002, 021, 022, 023).
2. **No seeding, no download times, no way to turn downloads off** — a new data folder can only be
   filled by a download, and a test or smoke-test server may fetch OurAirports and replace its
   fixture lists (APT-DATA-017, 018, 020).
3. **Downloads have no time limit and write the list in place** — airports.ts:64-70; a stalled
   download never settles, a failed one can leave a partial list, and the requests carry no
   User-Agent (app-shell's APP-API-005).
4. **Airport data is never refreshed after first run** — airports.ts:197-209 imports only into empty
   tables. The monthly refresh is the installed app's only refresh, `npm run import-airports` being
   a development command.
5. **The official-site link is the raw `home_link`** — AirportPopup.tsx:158-159; a value with no
   scheme resolves to the page's own address, which the desktop app's window (installed or in test
   mode) refuses to open.
6. **A re-import drops airports that hops still reference** — airports.ts:93-114 deletes every
   airport and skips `closed` ones, so a logged airport that closes vanishes from the map, the
   planner and hop edits.
7. **Nearest airport misses the far side of the 180° meridian** — airports.ts:566-568, unlike
   `planCandidates` (518-531).
8. **The METAR cache never drops expired entries** — airports.ts:438-466; a server that runs for
   weeks in the tray keeps every station it was ever asked about.
9. **The runway summary counts open runways only** — airports.ts:187; an airport whose runways
   are all closed reads as "no runway data".

## Work Required

### Must Fix
1. Prepare airport data after the logbook start-up work and before the sim link, test-first:
   clear leftovers, seed only the lists a data folder lacks with their download times, download
   only a list an import needs and only with airport downloads on, import in batches of at most
   about 100 ms into staging tables, report progress and the outcome for `/api/status`, never end
   the server on a failure, one import at a time, stop at shutdown (APT-DATA-001, 002, 017, 018,
   020 to 026). The desktop app's first run, test mode, the browser tests' readiness and the
   packaged smoke test rely on it; app-shell's start order and `ready` flag land with it. The
   daily repeat of a failed preparation (APT-DATA-022) comes with the daily check in item 5.
2. Bound downloads and write them under temporary names (APT-DATA-019).
3. Link the official site only with an http or https address, adding `https://` to a host-like
   value (APT-POP-007), which the desktop shell relies on.

### Should Fix
4. Keep airports that hops reference across re-imports (APT-DATA-007 to 009). This lands with or
   before the monthly refresh: once the refresh runs, every installed copy re-imports each month,
   and today's import (airports.ts:93-114) would drop closed or delisted airports that hops use,
   breaking the HLD rule that an airport a hop uses is never lost from the data.
5. The daily check and the monthly refresh, held while the sim link is connected or a leg is in
   progress, retried on failure (APT-DATA-003 to 005), the check also repeating a failed
   preparation (APT-DATA-022).
6. Wrap the nearest-airport search across the 180° meridian (APT-NEAR-002; airports.ts:566-568).
7. Fall back to the cached Wikipedia summary on network errors and timeouts (APT-WIKI-004).
8. Discard out-of-order search responses in the airport input (APT-FIND-006).
9. Drop expired METAR cache entries (APT-WX-010).
10. Tests for the 38 implemented APT specs.

### Nice to Have
11. Prefer a sentence end when clipping the popup blurb (APT-POP-005).
12. One METAR formatter for popup and tooltip.
13. Escape `%`/`_` in search input; derive headings for one-digit runway numbers.
