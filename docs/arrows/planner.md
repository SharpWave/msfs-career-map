# Arrow: planner

Where an aircraft can go next: the block-time model, the candidate search with its hard filters,
live weather and darkness checks, the terrain check along a leg, the planner card, and the range
ring and candidate dots on the map.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, few tests. LLD and specs
follow the HLD of 2026-10-23 (the desktop app) and its edge audit: outside links leave the app's
window for the default browser (DESK-SHELL-WIN-007), a result lives in the page alone and is kept
across an event-stream reconnect unless the reload brings a hop logged meanwhile, a page that finds
the server holding a different logbook reloads itself, a METAR is judged fresh again every minute
however long the page stays open, and the terrain cache is bounded for a server that runs for weeks.
One open question: Open-Meteo's terms for a distributed app (LLD Open 1), whose credit half — a
credit on the terrain line, which the data's CC BY 4.0 licence requires — awaits the user's approval.

## References

### HLD
- docs/high-level-design.md (System Design → planner)

### LLD
- docs/intent/planner/planner-design.md

### EARS
- docs/intent/planner/planner-specs.md (68 specs)

### Tests
- tests/tour-map/map-toolbar.test.tsx — PLAN-RUN-002
- tests/app-shell/page.test.tsx — PLAN-FORM-003
- tests/e2e/world-copies.spec.ts — PLAN-DRAW-005 (a candidate's popup opens beside the dot clicked, across the 180° meridian)

### Code
- src/server/performance.ts
- src/server/routes.ts — limits (150-153), `maxFieldElevation` (214-229), `/plan` (730-795), `/terrain` (806-822)
- src/server/airports.ts — `planCandidates`, `distanceNm`, `bearingDeg` (478-551)
- src/server/terrain.ts — Open-Meteo requests, elevation cache
- src/client/constraints.ts
- src/client/components/Planner.tsx
- src/client/components/MapView.tsx — surface colors, candidate styles, plan rings, `CandidateLayer`, candidate tooltip and popup
- src/client/components/AirportPopup.tsx — terrain fetch, flags, `TerrainBlock`, **Use**
- src/client/App.tsx — METAR batching, flags, plan lifecycle (the tracker's `hop` handler), URL auto-plan, **Edit aircraft** hand-off (`editAircraft`)

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
| Live checks | PLAN-FLAG-001 to 010 | 8 | 0 | 2 |
| Terrain along a leg | PLAN-TERR-001 to 008 | 6 | 0 | 2 |
| Planner form | PLAN-FORM-001 to 011 | 8 | 0 | 3 |
| Results in the card | PLAN-LIST-001 to 009 | 8 | 0 | 1 |
| Plan lifecycle | PLAN-RUN-001 to 007 | 5 | 0 | 2 |
| Planner layers on the map | PLAN-DRAW-001 to 006 | 6 | 0 | 0 |

**Summary:** 56 of 68 specs implemented; 12 gaps; none deferred. 3 specs have tests; the other 53
implemented specs have none.

## Key Findings

1. **`total` understates dense searches** — routes.ts:762-775 counts only the nearest 2 × limit.
2. **Stale label** — Planner.tsx:196 says cruise altitude is "also sent to SimBrief"; it no longer is.
3. **Short legs to a higher field are timed too short** — performance.ts:57-61.
4. **Planner limits restated in the page** — Planner.tsx:199-229 hard-codes 2,000 / 10,000 / 12,000 ft.
5. **Oxygen altitude is 12,000 ft, intended 12,500 ft** — routes.ts:153, Planner.tsx:199-227.
6. **Small airports never get weather** — App.tsx:100 looks up large and medium candidates only.
7. **Terrain cache has no bound** — terrain.ts:10 keeps every point for the life of the server, which
   in the installed app runs for days or weeks (PLAN-TERR-008).
8. **Terrain requests carry their own User-Agent** — terrain.ts:7 hard-codes
   `MSFSCareerMap/0.6 (personal flight-sim logbook; local use)`; app-shell's APP-API-005 gives every
   server request one shared User-Agent with the app's version and the project's GitHub address as
   contact, which matters once every installed copy calls Open-Meteo.
9. **A reconnect keeps the plan unless a hop was logged meanwhile** — App.tsx's tracker `hop`
   handler removes the result and the hop-form preset (PLAN-RUN-003). The reconnect reload
   live-tracking adds (LIVE-API-005) is not a `hop` event: it has to leave them (PLAN-RUN-006)
   unless it brings a hop the page did not hold, which removes both (PLAN-RUN-007), found by
   comparing the hops the page held before the reload. Today nothing reloads on reconnect, so the
   result and preset are always kept, even when a server restarted mid-flight logged the leg while
   the page was away, leaving the hop form prefilled for a flight already logged.
10. **Weather age on screen looks met, untested** — App.tsx's one-minute `now` tick recomputes the
    flags, MapView's restyle effect runs on each new flags map and re-reads `categoryFor` at the
    current time, and the list's badge does the same on re-render, so a METAR past 90 minutes already
    loses its flags, badge and outline (PLAN-FLAG-010); no test holds it.
11. **No plan → Use browser test** — the HLD's Testing decision names plan → Use among the main flows
    the Playwright tests cover; tests/e2e has none.
12. **Open-Meteo credit and limits** — the terrain line credits neither Open-Meteo nor the
    Copernicus programme, though the data's CC BY 4.0 licence requires a credit wherever the app
    shows it, and Open-Meteo's free-tier rate limits are applied per caller address and per
    application (LLD Open 1).
13. **A result can outlive the logbook it was searched in** — the restart that finishes bringing in
    a logbook reloads the installed app's window and the page that asked for it, but another browser
    tab, or a copy run from source started again by hand, only reconnects and would keep a result and
    a hop-form destination whose aircraft id belongs to the replaced logbook. The planner relies on
    app-shell to have such a page reload itself (LLD Plan lifecycle; PLAN-RUN-006 and PLAN-RUN-007
    cover only a server holding the same logbook), which needs `/api/status` to report the logbook
    id — not yet in app-shell's specs.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Use a 12,500 ft oxygen altitude everywhere, from one server constant (PLAN-FIND-006,
   PLAN-TERR-007, PLAN-FORM-007, PLAN-FORM-009).
2. Look up METARs for small candidates with a four-letter station (PLAN-FLAG-001, PLAN-LIST-003).
3. Count every passing airport in the result total (PLAN-FIND-010; routes.ts:762-775).
4. Bound the terrain cache at 100,000 points, least recently used dropped (PLAN-TERR-008;
   terrain.ts:10), since the installed app's server runs for weeks. `elevationsFt` reads every point
   from the cache after storing the new ones and counts a missing one as 0 ft, so the bound must
   never drop a point of the request being answered; the test must cover a leg checked again with
   the cache full.
5. On an event-stream reconnect, keep the planner result and handed destination (PLAN-RUN-006)
   unless the reload brings a hop the page did not hold, which removes both (PLAN-RUN-007), tested
   together with live-tracking's reconnect reload. Both wait on LIVE-API-005 (`[ ]`), which brings
   that reload; the reload must leave out the `hop` handler's clearing (LIVE-CARD-009 reloads, but
   the clearing is PLAN-RUN-003's).
6. Test that a METAR past 90 minutes loses its flags, badge and outline with the page left open
   (PLAN-FLAG-010; fake timers). The code already does this (Key Finding 10), so PLAN-FLAG-010 goes
   `[x]` once the test passes, with no code change.
7. Add the plan → Use browser test the HLD names (PLAN-RUN-001, PLAN-RUN-004, PLAN-LIST-009), opened
   with `?plan=` and with the METAR requests answered by fixtures or left to fail (PLAN-FLAG-002).
8. Send app-shell's shared User-Agent from terrain.ts (APP-API-005, app-shell's spec; the request is
   the planner's).

### Nice to Have
9. Drop "also sent to SimBrief" from the cruise-altitude label (PLAN-FORM-006).
10. Time short legs with the difference in field elevation (performance.ts:57-61).
11. Space terrain samples by distance rather than a fixed 25 (terrain.ts:61-62).
12. Look a shown result's METARs up again as they age, failed batches included (LLD Deferred 12).
13. Settle LLD Open 1: on the user's approval, credit "Elevation: Copernicus DEM GLO-90 via
    Open-Meteo" on the terrain line (a Decisions row and a new PLAN-TERR spec), since the licence
    requires it; then decide whether Open-Meteo's per-application limit matters at the app's scale.
