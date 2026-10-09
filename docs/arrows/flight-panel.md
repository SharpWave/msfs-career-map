# Arrow: flight-panel

One flight under the map: the profile chart, the landing card and the flight card for a logged hop,
the live leg or a pending leg, and how a landing rating looks everywhere (icon, word, caption, color, badge).

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → flight-panel)

### LLD
- docs/intent/flight-panel/flight-panel-design.md

### EARS
- docs/intent/flight-panel/flight-panel-specs.md (33 specs)

### Tests
- tests/flight-panel/flight-panel.test.tsx — PANEL-OPEN-003, PANEL-OPEN-007
- tests/e2e/layout.spec.ts — PANEL-OPEN-008

### Code
- src/client/components/FlightPanel.tsx — all but `BriefingCard` (simbrief)
- src/client/components/ProfileChart.tsx
- src/client/landing.ts
- src/client/components/LandingBadge.tsx
- src/client/App.tsx — panel source, close on delete, follow the live leg
- src/client/styles.css — `.flight-panel`, `.fp-*`, `.profile*`, `.landing-badge`

## Architecture

**Purpose:** Show how one flight went — profile, landing, distance, fuel — for a logged hop or the
leg being flown.

**Key Components:**
1. `FlightPanel` — source (hop, live or pending leg), header, cards
2. `ProfileChart` — indexed series, legend, crosshair, landing marks, table
3. `LandingCard` / `StatsCard`
4. `RATING_META` + `LandingBadge` — how a rating looks across the app

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Opening and closing | PANEL-OPEN-001 to 007 | 5 | 0 | 2 |
| Header | PANEL-HEAD-001 to 005 | 3 | 0 | 2 |
| Profile chart | PANEL-CHART-001 to 010 | 10 | 0 | 0 |
| Landing card | PANEL-LAND-001 to 005 | 4 | 0 | 1 |
| How a rating looks | PANEL-LOOK-001 to 003 | 3 | 0 | 0 |
| Flight card | PANEL-STAT-001 to 003 | 1 | 0 | 2 |

**Summary:** 26 of 33 specs implemented; 7 gaps; none deferred. No spec has a test.

## Key Findings

1. **Live header says "airborne since" after touchdown** — FlightPanel.tsx:50.
2. **Live flight card is mostly "—"** — the tracker status lacks fuel at takeoff, weight, max ground
   speed and distance flown (FlightPanel.tsx:54-65).
3. **Scale says "above" for G thresholds that apply at the threshold** — FlightPanel.tsx:179.
4. **Pending legs cannot be opened** — no track in the status and no button in the live card.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Open pending legs in the panel, and follow them into the logbook or close on discard
   (PANEL-OPEN-002, PANEL-OPEN-006, PANEL-HEAD-005, PANEL-STAT-003; needs LIVE-API-007, LIVE-CARD-010).
2. Fill the live flight card (PANEL-STAT-002; needs LIVE-API-006).

### Nice to Have
3. Say "landed" in the live header after touchdown (PANEL-HEAD-004).
4. Fix the G wording in the scale (PANEL-LAND-004).
