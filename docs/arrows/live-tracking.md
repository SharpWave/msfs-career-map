# Arrow: live-tracking

From the sim to the logbook: the SimConnect link and touchdown watcher, the leg state machine,
airport naming, landing measurement and rating, the recorded track and statistics, binding,
logging and pending legs, checkpointing, the tracker API and event stream, the live card and
map layer, and the `sim-fake` / `sim-probe` tools.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → live-tracking)

### LLD
- docs/intent/live-tracking/live-tracking-design.md

### EARS
- docs/intent/live-tracking/live-tracking-specs.md (71 specs)

### Tests
- none yet (they go in `tests/live-tracking/`; the harness is app-shell's)

### Code
- src/server/simconnect.ts
- src/server/tracker.ts
- src/server/index.ts — `startTracking`
- src/server/routes.ts — live tracker (445-560)
- src/client/tracker.ts — `useTracker` (`parseTrack` is shared)
- src/client/components/LivePanel.tsx — all but `SimbriefControls` (simbrief)
- src/client/components/LiveLayer.tsx
- src/client/App.tsx — tracker stream, logged-hop handling, toast, zoom to the live aircraft
- scripts/sim-fake.ts, scripts/sim-probe.ts

## Architecture

**Purpose:** Log every flight flown in the sim as a hop, with its track, landings and statistics,
without the user typing anything when the tracker can work it out.

**Key Components:**
1. `startSimLink` (`simconnect.ts`) — connection, 1 Hz samples, frame-rate touchdown watcher, events
2. `Tracker.feed` — phases, takeoff / landing / stop, interruptions
3. `complete` / `insertHop` / pending leg — logging or parking a finished leg
4. Checkpoint — `tracker_state` row, restored at startup
5. `/api/tracker*` + event stream
6. `LivePanel`, `LiveLayer`, App's tracker handling

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Sim link | LIVE-LINK-001 to 008 | 7 | 0 | 1 |
| Leg detection | LIVE-LEG-001 to 015 | 10 | 0 | 5 |
| Naming the airports | LIVE-NAME-001 to 003 | 2 | 0 | 1 |
| Landings and rating | LIVE-LAND-001 to 004 | 4 | 0 | 0 |
| What a leg records | LIVE-REC-001 to 005 | 3 | 0 | 2 |
| Binding | LIVE-BIND-001 to 003 | 2 | 0 | 1 |
| Logging and pending legs | LIVE-HOP-001 to 006 | 5 | 0 | 1 |
| Checkpointing | LIVE-SAVE-001 to 003 | 3 | 0 | 0 |
| API and event stream | LIVE-API-001 to 007 | 4 | 0 | 3 |
| Live card | LIVE-CARD-001 to 010 | 8 | 0 | 2 |
| Live aircraft on the map | LIVE-LAYER-001 to 003 | 3 | 0 | 0 |
| Test tools | LIVE-TOOL-001 to 004 | 3 | 0 | 1 |

**Summary:** 54 of 71 specs implemented; 17 gaps; none deferred. No spec has a test.

## Key Findings

1. **A leg restored after a server restart is discarded** — the first samples after connecting carry
   a blank livery, read as an aircraft change (simconnect.ts:119, tracker.ts:528).
2. **A landed leg can be lost or misnamed** when a new flight loads or the position jumps before the
   stop timer runs (tracker.ts:425-427, 545-556).
3. **A second pending leg replaces the first** and orphans its briefing (tracker.ts:776).
4. **Legs of 30–59 s are kept** despite the one-minute minimum (tracker.ts:729-730).
5. **`sim-fake` misreads arguments** when options come first (sim-fake.ts:20).

## Work Required

### Must Fix
1. Ignore the blank livery read right after connecting, so a restored leg survives a server
   restart (LIVE-LEG-012; simconnect.ts:119, tracker.ts:528).

### Should Fix
2. Keep pending legs in a list, addressed by id, each with its own card block; binding fills in
   matching legs (LIVE-HOP-003, LIVE-API-003, LIVE-CARD-008, LIVE-BIND-003).
3. Keep an airborne leg as pending when the sim disconnects (LIVE-LEG-008).
4. Close a landed leg when a new flight loads or the position jumps (LIVE-LEG-011).
5. Leave paused time out of flight time and the takeoff and stop timers (LIVE-REC-003, LIVE-LEG-014).
6. Prefer the parked airport on a near-tie at takeoff (LIVE-NAME-002).
7. Read and record sim-clock times (LIVE-LINK-008, LIVE-REC-004; with LOG-REC-002).
8. Send the live leg's statistics so far and serve a pending leg in full, with a **Profile** button
   per pending leg, for the flight panel (LIVE-API-006, LIVE-API-007, LIVE-CARD-010).

### Nice to Have
9. Drop legs under a full minute (LIVE-LEG-013).
10. Fix `sim-fake` argument parsing (LIVE-TOOL-003).
