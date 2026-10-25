# Arrow: flight-panel

One flight under the map: the profile chart, the landing card and the flight card for a logged hop,
the live leg or a pending leg, and how a landing rating looks everywhere on the page (icon, word,
caption, color, badge).

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted; first tests in place.
The HLD's desktop revision (2026-10-23) and the desktop group's edge audit are cascaded into the LLD
and specs: a hop or pending leg named in the page's address fragment opens in the panel (the desktop
app's notifications set it) and one naming nothing leaves the panel as it was; each load of the page
starts with the panel closed (the window is discarded when closed); the live chart is redrawn from
the server's whole track when the event stream reconnects (the desktop shell restarts a failed
server); a pending leg logged or discarded in another window or tab closes the panel, a pending
leg's hop never pulls the panel off the live leg, and a live leg logged while the event stream was
down is found among the hops reloaded after the reconnect by its takeoff time. Pending legs open in the
panel, from their **Profile** and from the address, and the live-leg guard and the reconnect follow are
built.

## References

### HLD
- docs/high-level-design.md (Goals → any tracked flight can be examined; Tenets → The page stays a web
  page; System Design → a restart never loses the leg, at most its last few seconds; Segments →
  flight-panel; Rules every segment follows → Time, The server decides, the page shows)

### LLD
- docs/intent/flight-panel/flight-panel-design.md

### EARS
- docs/intent/flight-panel/flight-panel-specs.md (41 specs)

### Tests
- tests/flight-panel/flight-panel.test.tsx — PANEL-OPEN-003, PANEL-OPEN-007, PANEL-LAND-001, PANEL-LAND-002, PANEL-LOOK-004
- tests/flight-panel/landing.test.ts — PANEL-LOOK-004 (which touchdown stands for a flight)
- tests/tour-map/hop-tip.test.tsx, tests/fleet/fleet-list.test.tsx, tests/live-tracking/live-card.test.tsx — PANEL-LOOK-004 (the hop tooltip, hop row and live card)
- tests/live-tracking/logging.test.ts — PANEL-LOOK-004 (the touchdown the tracker's "Logged" message names)
- tests/e2e/layout.spec.ts — PANEL-OPEN-008
- tests/flight-panel/pending-panel.test.tsx — PANEL-OPEN-002, 005, 006, 013, 014; PANEL-HEAD-005; PANEL-STAT-003 (with live-tracking's LIVE-CARD-010)
- app-shell's tests/app-shell/page-fragment.test.tsx — PANEL-OPEN-009, 010, 011; tests/e2e/page-server.spec.ts — PANEL-OPEN-009

### Code
- src/client/components/FlightPanel.tsx — all but `BriefingCard` (simbrief)
- src/client/components/ProfileChart.tsx
- src/client/landing.ts
- src/client/components/LandingBadge.tsx
- src/client/App.tsx — panel source, close on delete, follow the live leg by its takeoff time, a pending leg followed into its hop or closed, the reconnect follow
- src/client/styles.css — `.flight-panel`, `.fp-*`, `.profile*`, `.landing-badge`

## Architecture

**Purpose:** Show how one flight went — profile, landing, distance, fuel — for a logged hop, the leg
being flown or a leg waiting to be logged.

**Key Components:**
1. `FlightPanel` — source (a hop, the live leg or a pending leg, fetched in full), header, cards
2. `ProfileChart` — indexed series, legend, crosshair, landing marks, table
3. `LandingCard` / `StatsCard`
4. `RATING_META` + `LandingBadge` — how a rating looks across the page; `shownTouchdown` — which
   touchdown stands for a flight

**Opened from:** a hop's path (tour-map), a hop row (logbook), the live card's **Profile**
(live-tracking), and the page's address fragment `#hop=` / `#pending=` (app-shell's route, APP-UI-032,
set by the desktop shell's notifications).

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Opening and closing | PANEL-OPEN-001 to 014 | 14 | 0 | 0 |
| Header | PANEL-HEAD-001 to 005 | 4 | 0 | 1 |
| Profile chart | PANEL-CHART-001 to 010 | 10 | 0 | 0 |
| Landing card | PANEL-LAND-001 to 005 | 4 | 0 | 1 |
| How a rating looks | PANEL-LOOK-001 to 004 | 4 | 0 | 0 |
| Flight card | PANEL-STAT-001 to 003 | 2 | 0 | 1 |

**Summary:** 38 of 41 specs implemented; 3 gaps; none deferred. 16 implemented specs have tests.

## Key Findings

1. **Live header says "airborne since" after touchdown** — FlightPanel.tsx:109.
2. **Live flight card is mostly "—"** — the tracker status lacks fuel at takeoff, weight, max ground
   speed and distance flown (FlightPanel.tsx:112-124).
3. **Scale says "above" for G thresholds that apply at the threshold** — FlightPanel.tsx:243.
4. **A live leg kept as a pending leg** (a sim crash in flight, LIVE-LEG-008) leaves the panel on
   "nothing being flown"; whether it should follow the leg into the pending list is an open question
   in the LLD (Deferred 9).

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Fill the live flight card (PANEL-STAT-002; needs LIVE-API-006).

### Nice to Have
2. Say "landed" in the live header after touchdown (PANEL-HEAD-004).
3. Fix the G wording in the scale (PANEL-LAND-004).
4. Tests for the 22 implemented specs that have none — PANEL-CHART-009 (redrawn whole on a reconnect)
   and PANEL-OPEN-012 (each load starts closed) first, since the desktop shell's server restarts and
   discarded window lean on them.
