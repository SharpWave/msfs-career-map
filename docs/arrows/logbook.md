# Arrow: logbook

The ordered hops of each fleet aircraft: the hop record and its sequence rules, correcting a
tracked hop, hand-logging, and the hop list in an aircraft card.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour plus confirmed intended changes; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → logbook)

### LLD
- docs/intent/logbook/logbook-design.md

### EARS
- docs/intent/logbook/logbook-specs.md (44 specs)

### Tests
- none (the project has no test suite yet)

### Code
- src/server/routes.ts — hops section (313-443), `/state` (797-811)
- src/server/db.ts — `hops` table (113-126, 177-179)
- src/client/components/HopForm.tsx
- src/client/components/Sidebar.tsx — "Log a hop" card (91-103), `AircraftCard` hop list (200-368)
- src/client/format.ts — `hopDurationMin`, `isoToLocalInput`, `localInputToIso` (38-62)

## Architecture

**Purpose:** Keep each aircraft's tour as a contiguous, ordered list of hops whose last
destination is where the aircraft is parked, and let the user log, correct, reorder and delete
hops by hand.

**Key Components:**
1. Hop routes (`routes.ts`) — validation, canonical idents, sequence append/renumber/reorder
2. `HopForm` — create (with parked-origin default, roll-forward, planner preset) and edit
3. `AircraftCard` hop list — rows, totals, ↑/↓, inline edit, delete
4. `hopDurationMin` — duration shown when none is stored

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Hop record | LOG-REC-001 to 013 | 10 | 0 | 3 |
| Ordering & parked position | LOG-SEQ-001 to 009 | 8 | 0 | 1 |
| Correcting a tracked hop | LOG-EDIT-001 to 003 | 1 | 0 | 2 |
| Hop form | LOG-FORM-001 to 012 | 12 | 0 | 0 |
| Hop list | LOG-LIST-001 to 007 | 6 | 0 | 1 |

**Summary:** 37 of 44 specs implemented; 7 gaps; none deferred. No spec has a test.

## Key Findings

1. **Two writers to `hops`** — hand-logged rows come from the hop routes; flown legs come from the
   tracker's `insertHop` (src/server/tracker.ts:306-325), which follows the same append rule.
2. **Parked position is derived in six places** — Sidebar.tsx:204, HopForm.tsx:28-32,
   Planner.tsx:86-89, paths.ts:137-140, routes.ts:709-714, and the tracker's takeoff tie-break
   (intended); all depend on hops arriving sorted.
3. **Renumbering is not atomic** — routes.ts:407-410 and 417-418 run outside a transaction;
   reorder (434-441) is the only transactional path.
4. **Form-only validation** — arrival-before-departure and negative durations are rejected by
   HopForm.tsx:84-86 but accepted by the server.

## Work Required

### Must Fix
*(none identified)*

### Should Fix
1. Make move/delete + renumber atomic (LOG-SEQ-004; routes.ts:407-410, 417-418).
2. Mirror the form's time and duration checks on the server (LOG-REC-009, LOG-REC-011).
3. Show errors from reorder/delete on the card (LOG-LIST-007; Sidebar.tsx:212-236).

### New Behaviour
4. Restrict airport changes on tracked hops to plausible corrections (LOG-EDIT-001, LOG-EDIT-002).
5. Store sim-clock departure and arrival alongside real-world times (LOG-REC-002); capture is
   live-tracking's.

### Nice to Have
6. One shared parked-position helper for the client consumers.
7. Return 400 for a missing or non-numeric `aircraft_id` (routes.ts:375-376, 370).
