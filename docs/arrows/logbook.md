# Arrow: logbook

The ordered hops of each fleet aircraft: the hop record and its sequence rules, correcting a
tracked hop, hand-logging, and the hop list in an aircraft card.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; brought in line on 2026-10-23 with the desktop app
(the HLD of that date, the desktop design and its shell, start-lists and distribution LLDs, and the
Phase 4 edge audit of their specs, none of whose items lands here); not yet audited. Brownfield
skeleton: the LLD describes current behaviour plus confirmed intended changes; specs drafted, 6 of
them tested.

## References

### HLD
- docs/high-level-design.md (System Design → logbook, the data folder, 127.0.0.1; Rules every
  segment follows → Order and position, Airport codes, Time, Schema changes)

### Consumers (desktop group)
Consumers that rely on this segment's specs; no other obligation on it.
- docs/intent/desktop/shell/shell-design.md (Notifications: `#hop=<id>` links) — LOG-REC-014, hop ids
  never reused in a logbook
- docs/intent/desktop/desktop-design.md (Relies On → app-shell: the first-run offer reads a logbook's
  hop count and newest hop) — LOG-REC-016, `created_at`
- docs/intent/desktop/distribution/distribution-specs.md (DESK-DIST-REL-011: an older release runs on
  a newer logbook, through app-shell's additive schema rule) — LOG-REC-013, LOG-REC-015

### LLD
- docs/intent/logbook/logbook-design.md

### EARS
- docs/intent/logbook/logbook-specs.md (47 specs)

### Tests
- tests/fleet/fleet-list.test.tsx — LOG-LIST-001, LOG-LIST-004, LOG-LIST-005
- tests/app-shell/page.test.tsx — LOG-FORM-003, LOG-FORM-004, LOG-FORM-009

### Code
- src/server/routes.ts — hops section (313-443), `/state` (826-840)
- src/server/db.ts — `hops` table (113-126, 177-179; `id` AUTOINCREMENT at 114, `created_at` default at 124)
- src/client/components/HopForm.tsx (a failed save: 114-118)
- src/client/App.tsx — the "Log a hop" drawer (396-411), the planner hand-off `pickCandidate` (312-318)
- src/client/components/Fleet.tsx — `AircraftCard` hop list (102-263)
- src/client/format.ts — `fmtTimeShort` (16-21, app-shell's shared formatting, used by the hop list),
  `hopDurationMin`, `isoToLocalInput`, `localInputToIso` (38-62)

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
| Hop record | LOG-REC-001 to 016 | 14 | 0 | 2 |
| Ordering & parked position | LOG-SEQ-001 to 009 | 8 | 0 | 1 |
| Correcting a tracked hop | LOG-EDIT-001 to 003 | 1 | 0 | 2 |
| Hop form | LOG-FORM-001 to 012 | 12 | 0 | 0 |
| Hop list | LOG-LIST-001 to 007 | 6 | 0 | 1 |

**Summary:** 41 of 47 specs implemented; 6 gaps; none deferred. 7 specs have tests (LOG-REC-002 in
tests/live-tracking/sim-clock.test.ts: the nullable columns, an insert without them, and the hop
API's sim-clock times kept on an edit).

## Key Findings

1. **Two writers to `hops`** — hand-logged rows come from the hop routes; flown legs come from the
   tracker's `insertHop` (src/server/tracker.ts:346-365), which follows the same append rule.
2. **Parked position is derived in six places** — Fleet.tsx:106, HopForm.tsx:28-32,
   Planner.tsx:86-89, paths.ts:194-202, routes.ts:738-743, and the tracker's takeoff tie-break
   (`parkedAt` in tracker.ts, which sorts in its query); the others depend on hops arriving sorted.
3. **Renumbering is not atomic** — routes.ts:407-410 and 417-418 run outside a transaction;
   reorder (434-441) is the only transactional path.
4. **Form-only validation** — arrival-before-departure and negative durations are rejected by
   HopForm.tsx:84-86 but accepted by the server.
5. **Hop ids are never reused** — `hops.id` is AUTOINCREMENT (db.ts:114), so the desktop app's hop
   notifications, whose `#hop=<id>` links may be clicked days later, find their hop or none
   (LOG-REC-014). Every `hops` table has been created with AUTOINCREMENT since the first commit
   (fd1f426); `CREATE TABLE IF NOT EXISTS` would not add it to an older one, so the [x] rests on that
   history. The counter is the logbook database's: a backup restored by hand, a brought-in logbook
   or a new one in place of a deleted data folder carries its own. Untested.
6. **Hop writes name their columns** — routes.ts:384 and 408, tracker.ts:268 — so an older version
   on a logbook whose `hops` table a newer one widened (an older release run by hand over a newer
   install, DESK-DIST-REL-011, or the installed app on a logbook brought in from a copy run from
   source that is ahead of it) leaves the newer fields alone on an edit (LOG-REC-013) and at their
   defaults when it logs a hop (LOG-REC-015); an insert naming no columns would fail on the wider
   table. Untested.
7. **`created_at` is set only by the column default** (db.ts:124), present since the first commit;
   no write names it (LOG-REC-016), so it can date a whole logbook's newest hop, hand-logged hops
   without times included. Untested.
8. **The logbook as a whole is app-shell's** — data folder, backups, schema upgrades and bringing in
   a logbook from another data folder; that import never replaces a logbook holding hops (app-shell
   checks again just before the swap), so a hop logged during the copy is kept and nothing in this
   segment changes for it. A brought-in logbook keeps its own hop ids, logged times and counter
   (SQLite's backup copies it whole).
9. **Times are the page's** — the form converts with `isoToLocalInput`/`localInputToIso` and the hop
   list formats with `fmtTimeShort` (format.ts:16-21), both in the page's own time zone, as
   LOG-FORM-012 and LOG-LIST-001 say. The page's zone equals the PC's once app-shell binds 127.0.0.1
   (APP-SRV-005); index.ts:48 listens on every interface today, so a page opened from another device
   shows that device's time.
10. **A failed save is never resent** — HopForm.tsx:114-118 shows the error from the shared `req`
    (api.ts:33-45), which has no retry, and keeps the values (LOG-FORM-008), so the form never logs a
    hop twice by itself after a server restart or a 503 during start-up work. This relies on
    app-shell's start-up retry (APP-UI-030) covering the page's loads only and never reaching a hop
    write through `req`. A save whose answer alone was lost can still be saved again by hand into a
    second row, accepted in the LLD's Decisions. Untested.
11. **No browser test of logging a hop** — the HLD's Testing decision names "log a hop" among the
    main browser-test flows; tests/e2e has none yet.

## Work Required

### Must Fix
*(none identified)*

### Should Fix
1. Add tests for what the desktop app relies on: a deleted newest hop's id is not given to the next
   hop (LOG-REC-014); an edit leaves a column the API does not name unchanged (LOG-REC-013); a hop
   logged through the API and by the tracker on a `hops` table with an extra column is stored
   (LOG-REC-015); `created_at` is set on insert and unchanged by an edit, a move and a reorder
   (LOG-REC-016); a save that fails with a 503 or no answer shows the error, keeps the values and
   sends one request only (LOG-FORM-008), which also holds app-shell's start-up retry (APP-UI-030)
   to the page's loads.
2. Add the HLD's "log a hop" browser test (tests/e2e): log a hop from the menu's Log a hop drawer,
   see it in the aircraft card and the parked position move (LOG-FORM-001, LOG-FORM-005,
   LOG-LIST-001, LOG-SEQ-008).
3. Make move/delete + renumber atomic (LOG-SEQ-004; routes.ts:407-410, 417-418).
4. Mirror the form's time and duration checks on the server (LOG-REC-009, LOG-REC-011).
5. Show errors from reorder/delete on the card (LOG-LIST-007; Fleet.tsx:114-138).
6. Add tests for the other implemented specs that have none (26 after items 1 and 2).

### New Behaviour
7. Restrict airport changes on tracked hops to plausible corrections (LOG-EDIT-001, LOG-EDIT-002).

### Nice to Have
8. One shared parked-position helper for the client consumers.
9. Return 400 for a missing or non-numeric `aircraft_id` (routes.ts:375-376, 370).
