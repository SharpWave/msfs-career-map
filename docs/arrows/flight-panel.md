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
down is found among the hops reloaded after the reconnect by its takeoff time. The fragment hand-off,
the live-leg guard and the reconnect follow are not built yet.

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

### Code
- src/client/components/FlightPanel.tsx — all but `BriefingCard` (simbrief)
- src/client/components/ProfileChart.tsx
- src/client/landing.ts
- src/client/components/LandingBadge.tsx
- src/client/App.tsx — panel source, close on delete, follow the live leg
- src/client/styles.css — `.flight-panel`, `.fp-*`, `.profile*`, `.landing-badge`

## Architecture

**Purpose:** Show how one flight went — profile, landing, distance, fuel — for a logged hop, the leg
being flown or a leg waiting to be logged.

**Key Components:**
1. `FlightPanel` — source (a hop or the live leg; a pending leg to come, PANEL-OPEN-002), header,
   cards
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
| Opening and closing | PANEL-OPEN-001 to 014 | 7 | 0 | 7 |
| Header | PANEL-HEAD-001 to 005 | 3 | 0 | 2 |
| Profile chart | PANEL-CHART-001 to 010 | 10 | 0 | 0 |
| Landing card | PANEL-LAND-001 to 005 | 4 | 0 | 1 |
| How a rating looks | PANEL-LOOK-001 to 004 | 4 | 0 | 0 |
| Flight card | PANEL-STAT-001 to 003 | 1 | 0 | 2 |

**Summary:** 29 of 41 specs implemented; 12 gaps; none deferred. 6 specs have tests.

## Key Findings

1. **Live header says "airborne since" after touchdown** — FlightPanel.tsx:50.
2. **Live flight card is mostly "—"** — the tracker status lacks fuel at takeoff, weight, max ground
   speed and distance flown (FlightPanel.tsx:54-65).
3. **Scale says "above" for G thresholds that apply at the threshold** — FlightPanel.tsx:180.
4. **Pending legs cannot be opened** — the live card's **Profile** on each pending leg and
   `GET /api/tracker/pending/:id` exist (live-tracking), but App passes the card a no-op
   `onOpenPending` (App.tsx:393) until the panel can show a pending leg (PANEL-OPEN-002).
5. **The page does not read `#hop=` or `#pending=`** — a click on the desktop app's "Hop logged" or
   "Leg waiting to be logged" notification would open the page without opening the flight
   (App.tsx has no fragment handling).
6. **The live panel follows any logged hop** — the `hop` event handler switches a live panel to
   whatever hop arrives, so logging a pending leg while flying the next one takes the live leg off
   the screen (App.tsx:172-173; PANEL-OPEN-013). With pending legs kept in a list (LIVE-HOP-003) and
   announced by notifications, that becomes an everyday flow.
7. **A live leg kept as a pending leg** (a sim crash in flight, LIVE-LEG-008) leaves the panel on
   "nothing being flown"; whether it should follow the leg into the pending list is an open question
   in the LLD (Deferred 12).
8. **A live leg logged while the event stream was down** — a server the desktop shell restarted, or
   a stream that ended, brings the hop only through the reload after the reconnect, with no `hop`
   event, so the live panel shows "nothing being flown" while the flight sits in the logbook
   (App.tsx:172-173; PANEL-OPEN-014).

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Open pending legs in the panel, follow one logged on the same page into the logbook, and close on
   discard or when the leg leaves the list from another window or tab (PANEL-OPEN-002,
   PANEL-OPEN-006, PANEL-HEAD-005, PANEL-STAT-003), wiring the live card's `onOpenPending` in App;
   live-tracking's pending routes are in place (LIVE-API-003, LIVE-API-007), and LIVE-CARD-010 waits
   on PANEL-OPEN-002.
2. Open the hop or pending leg named in the page's address fragment, and leave the panel as it was for
   an id that names nothing (PANEL-OPEN-009, PANEL-OPEN-010, PANEL-OPEN-011; with app-shell's fragment
   route; PANEL-OPEN-010 also needs item 1), test-first, so the desktop app's notification clicks land
   on the flight.
3. Keep a live panel on the live leg when a pending leg's hop is logged (PANEL-OPEN-013), and after a
   reconnect switch it to the live leg's hop among the reloaded hops (PANEL-OPEN-014), telling the
   live leg's hop by the takeoff time of the leg the panel last showed; test-first, alongside item 1.
   Relies on live-tracking keeping the leg's takeoff time in the hop exactly as its status gave it
   (LIVE-HOP-001, LIVE-HOP-004) and reloading the hops after a reconnect (LIVE-API-005).
4. Fill the live flight card (PANEL-STAT-002; needs LIVE-API-006).

### Nice to Have
5. Say "landed" in the live header after touchdown (PANEL-HEAD-004).
6. Fix the G wording in the scale (PANEL-LAND-004).
7. Tests for the 23 implemented specs that have none — PANEL-CHART-009 (redrawn whole on a reconnect)
   and PANEL-OPEN-012 (each load starts closed) first, since the desktop shell's server restarts and
   discarded window lean on them.
