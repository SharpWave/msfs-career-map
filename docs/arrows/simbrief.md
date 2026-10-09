# Arrow: simbrief

SimBrief in and out: dispatch links for a leg, SimBrief's aircraft type list, the alias setting,
importing and archiving OFPs, the current plan for the flight being flown, plans on logged hops,
the SimBrief card and controls, and the planned route on the map.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → simbrief)

### LLD
- docs/intent/simbrief/simbrief-design.md

### EARS
- docs/intent/simbrief/simbrief-specs.md (39 specs)

### Tests
- none yet (they go in `tests/simbrief/`; the harness is app-shell's)

### Code
- src/client/simbrief.ts
- src/server/simbrief.ts
- src/server/ofp.ts
- src/server/routes.ts — settings and briefings (562-692)
- src/server/db.ts — `briefings`, `settings`, `kv_cache`
- src/client/components/LivePanel.tsx — `SimbriefControls`
- src/client/components/FlightPanel.tsx — `BriefingCard`
- src/client/components/BriefingLayer.tsx
- src/client/App.tsx — panel plan loading, routes to draw

## Architecture

**Purpose:** Plan in SimBrief as usual, and keep each plan with the flight it was for.

**Key Components:**
1. `simbriefUrl` / `legFor` — dispatch links
2. `simbriefAircraftTypes` — type list with cache and fallback
3. `fetchLatestOfp` / `parseOfp` — fetch and reduce the OFP
4. Briefing routes — preview, current plan, hop plans, archive
5. `SimbriefControls`, `BriefingCard`, `BriefingLayer`

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Dispatch link | SB-LINK-001 to 003 | 2 | 0 | 1 |
| Aircraft type list | SB-TYPE-001 to 004 | 4 | 0 | 0 |
| Alias setting | SB-USER-001 | 1 | 0 | 0 |
| Fetching a plan | SB-OFP-001 to 004 | 4 | 0 | 0 |
| Preview and confirm | SB-PICK-001 to 003 | 1 | 0 | 2 |
| Current plan | SB-CUR-001 to 003 | 3 | 0 | 0 |
| Plans on hops | SB-HOP-001 to 005 | 2 | 0 | 3 |
| Live card controls | SB-CTRL-001 to 004 | 4 | 0 | 0 |
| Flight panel card | SB-CARD-001 to 008 | 3 | 0 | 5 |
| Route on the map | SB-ROUTE-001 to 004 | 3 | 0 | 1 |

**Summary:** 27 of 39 specs implemented; 12 gaps; none deferred. No spec has a test.

## Key Findings

1. **OFP HTML inserted unsanitised** — FlightPanel.tsx:336.
2. **Use this plan fetches again** instead of keeping the previewed plan — LivePanel.tsx:54-58, routes.ts:647-653.
3. **Re-attaching keeps the old plan** pointing at the hop — routes.ts:666-687.
4. **Route can land a world copy away** — the `ref` prop never arrives (BriefingLayer.tsx:9-19).
5. **Any short livery is sent as a registration** — simbrief.ts:15-18.
6. **Plans of deleted hops stay in the table**, and the panel attaches a plan with no preview.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Sanitise the OFP HTML before showing it (SB-CARD-006; FlightPanel.tsx:336).
2. Preview, then store exactly the previewed plan, in both the live card and the panel; 409 when
   the latest plan changed (SB-PICK-001, SB-PICK-002, SB-CARD-003).
3. Replace a hop's old plan when attaching, delete plans with their hops, and return only the
   linked plan (SB-HOP-001, SB-HOP-003, SB-HOP-005; with FLEET-REC-016).
4. Draw routes on their flight's world copy (SB-ROUTE-003; BriefingLayer.tsx:9-19).
5. Show a pending leg's plan in the panel (SB-CARD-002).

### Nice to Have
6. Tighten the registration test (SB-LINK-002).
7. Style the PDF link; "—" for a plan with no flight identity (SB-CARD-007, SB-CARD-005).
8. One fallback type list instead of two.
