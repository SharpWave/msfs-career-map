# Arrow: live-tracking

From the sim to the logbook: the sim modes, the SimConnect link and touchdown watcher, the PC-wide
sim-link claim, the leg state machine, airport naming, landing measurement and rating, the recorded
track and statistics, binding, logging and pending legs, checkpointing (shutdown, save on request,
bringing in a logbook), casual mode and its path, the tracker API and event stream, the live card
and map layer, and the `sim-fake` / `sim-probe` development tools.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield LLD with partly inferred
rationale; the LLD and specs carry what the desktop app and the HLD require (which copy logs
flights, how long casual mode lasts, app-shell's server inputs, shutdown order and import).

Built and tested: pending legs in a list, each with a UUID and addressed by it in the API and the
live card, and each marked with whether it ended in the air (`ended_in_air`; "last seen" on the card);
an airborne leg kept as pending when the sim's connection ends; the restored-leg rule, including a
connection that ends before the first sample; a landed leg closed at its last sample on a new flight
or a jump; saves at every phase change and landing, on request and as a final checkpoint, after which
the tracker takes nothing and the pilot's actions are answered 503; a hop and its checkpoint in one
transaction; the smallest part of a checkpoint it cannot read set aside in `tracker_state_aside`,
unknown fields kept; casual mode checkpointed and restored, ended by a clean MSFS quit, by the
desktop shell's Shut down and by a run's first start (`--fresh-run`); a sim record the link cannot
read dropped and counted; the server's sim mode from its `--sim` input (`TRACKER_FAKE=1` for a copy
run from source started without it), `sim_mode` and `sim_host` in the status with one check of
whether a host names this PC (`isThisPc`); the server stopping the link first at shutdown, then the
tracker's final checkpoint (app-shell's shutdown order), and saving on the private channel's
request; the page opening its event stream again 3 s after it ends; the live card's pill and hints
for each sim mode; `sim-fake` taking its airports wherever they appear and posting to 127.0.0.1.

Not built yet: the PC-wide sim-link claim, and with it `link_holder` and the claim's release at
shutdown; the sim's clock; the remaining leg rules (legs under a full minute, paused time, the
parked-airport tie-break) and the live leg's statistics; pausing tracking for an import and the
merged checkpoint; the reload of the map and lists on a reconnect; the pending-leg hand-off; the
flight panel showing a pending leg (flight-panel, PANEL-OPEN-002). One spec question is open (Key
Findings 1).

LIVE-HOP-001 and LIVE-HOP-004 keep a leg's takeoff time in its hop exactly as the status gave it,
which the flight panel relies on (PANEL-OPEN-014). LIVE-LINK-012 and LIVE-LINK-013 own the sim
input and LIVE-CARD-015 the live card's part of the `#pending=` hand-off; app-shell cites them
(APP-SRV-006, APP-SRV-007, APP-UI-033). The server's start and shutdown orders, the private channel
and the stop signals are app-shell's; this segment's specs say what the tracker and the link do in
them (LIVE-LINK-011, LIVE-SAVE-004, 005, LIVE-CASUAL-013, 015).

## References

### HLD
- docs/high-level-design.md (System Design → live-tracking; Key Design Decisions → Which copy logs
  flights, Tracker design, Flying outside the career)

### LLD
- docs/intent/live-tracking/live-tracking-design.md

### EARS
- docs/intent/live-tracking/live-tracking-specs.md (126 specs)

### Tests
- tests/live-tracking/sim-link.test.ts — LIVE-LEG-012, LIVE-LINK-005, 009 (the link driven through `fake-sim.ts`, a stand-in node-simconnect)
- tests/live-tracking/stopping.test.ts — LIVE-LINK-007, 011, 016; LIVE-LEG-008; LIVE-CASUAL-013, 014; LIVE-SAVE-005 (the link's `stop()` reaching the tracker as nothing, then the tracker's `shutdown()`; LIVE-LINK-011 without the claim's release; LIVE-LINK-007's quit-versus-close split and pause events, with the Sim and FlightLoaded events reaching the handlers untested)
- tests/live-tracking/tracking.test.ts — LIVE-LINK-002, 003, 011, 012, 013; LIVE-API-004, 013; LIVE-LEG-008; LIVE-CASUAL-014 (`startTracking` over `fake-sim.ts`: the mode, host and port reaching the link, fake and off starting none, `sim_host` with the this-PC rule, the quit flag; LIVE-API-013 without `link_holder`)
- tests/live-tracking/short-records.test.ts — LIVE-LINK-018 (records shorter than their definition, per definition and per connection)
- tests/live-tracking/pending-legs.test.ts — LIVE-HOP-003, 007; LIVE-BIND-003; LIVE-LEG-008, 016; LIVE-API-014 (the pending list, binding with legs waiting, a disconnect in flight, a leg restored in the air)
- tests/live-tracking/restored-leg.test.ts — LIVE-LEG-012, 016; LIVE-HOP-007 (a restored leg resumed on reconnect, kept with its reason when the connection ends before the first sample, kept restored when the server stops the link)
- tests/live-tracking/landed-interruptions.test.ts — LIVE-LEG-010, 011; LIVE-HOP-007; LIVE-LAND-002 (a landed leg closed on a new flight or a jump, the jumping sample's touchdown kept; an airborne one still discarded)
- tests/live-tracking/ended-in-air.test.ts — LIVE-HOP-007; LIVE-SAVE-002 (the mark in the status, the event, the leg in full and the checkpoint; an older leg read by its reason; LIVE-HOP-007 without brought-in legs)
- tests/live-tracking/checkpoint.test.ts — LIVE-SAVE-001, 002, 004, 006, 007, 012 (LIVE-SAVE-006 with a write failed by a temporary trigger)
- tests/live-tracking/set-aside.test.ts — LIVE-SAVE-002, 013, 014 (a damaged pending leg or leg in progress set aside alone, the rest restored and written back in one transaction)
- tests/live-tracking/shutting-down.test.ts — LIVE-API-016; LIVE-SAVE-004, 005 (the tracker after `shutdown()`, and the eight guarded routes against a test server, a SimBrief import already past the guard archiving nothing; LIVE-API-016 without LIVE-API-015's 409)
- tests/live-tracking/tracker-api.test.ts — LIVE-API-001, 003, 007, 013, 014; LIVE-HOP-004; LIVE-LEG-007; LIVE-BIND-002; LIVE-SAVE-006; APP-API-001 (against a running test server; refusals answered 400 or 409 and a failed write 500)
- tests/live-tracking/live-card.test.tsx — LIVE-CARD-001, 003, 005, 006, 008, 010, 011, 012, 013, 014; LIVE-BIND-003 (LIVE-CARD-010 as far as **Profile** calling `onOpenPending`)
- tests/live-tracking/casual.test.ts — LIVE-CASUAL-001 to 015; LIVE-API-010, 011, 012; LIVE-LEG-002, 003 (the tracker driven by synthetic samples, through `pilot.ts`)
- tests/live-tracking/logging.test.ts — LIVE-HOP-006, LIVE-API-014 (the "Logged" message after a bounce, after a touch-and-go, and for a pending leg logged)
- tests/live-tracking/casual-api.test.ts — LIVE-API-008, 009, 011; LIVE-CASUAL-006, 009, 010 (against a running test server, including the event stream)
- tests/live-tracking/casual-shapes.test.ts — LIVE-LAYER-004 (placing the casual path)
- tests/live-tracking/use-tracker.test.tsx — LIVE-API-005, 011, 014; LIVE-CARD-009 (the page's event-stream hook, reopened 3 s after each end; LIVE-API-005 without the reload on a reconnect)
- tests/live-tracking/sim-fake-args.test.ts — LIVE-TOOL-003, 005
- tests/app-shell/channel.test.ts — LIVE-SAVE-004, 005; LIVE-CASUAL-013, 015 (a server process: the private channel's save and Shut down, the stop signals keeping casual mode, `--fresh-run`)
- tests/app-shell/shutdown.test.ts — LIVE-LINK-011; LIVE-SAVE-004, 005; LIVE-CASUAL-013 (the shutdown order in process: the link stopped before the final checkpoint, a landed leg kept landed and not rated again)
- tests/app-shell/server-start.test.ts, inputs.test.ts, server-exits.test.ts — LIVE-LINK-012, 013; LIVE-API-013 (the sim mode from the inputs in each form, through a server process and `readInputs`)
- tests/e2e/casual.spec.ts — LIVE-CARD-012, LIVE-CASUAL-001, 008, LIVE-LAYER-003, 004 (a casual flight in the browser; the path on every world copy)
- tests/tour-map/copies.test.ts, tests/e2e/world-copies.spec.ts — LIVE-LAYER-002 (the live aircraft and track on every world copy in view)
- tests/live-tracking/pilot.ts, state.ts, fake-sim.ts; tests/support/event-stream.ts, page-data.ts, server-process.ts — helpers (no specs of their own)

### Code
- src/server/simconnect.ts — `startSimLink` (guarded handler calls, the quit flag, a record it cannot read dropped and counted, `stop()`)
- src/server/tracker.ts — `Tracker` and its singleton, built with the fresh-run input and given the sim mode from the server's inputs; restoring with damaged parts set aside; `saveNow`, `shutdown`, `isShutDown`, `ShuttingDown`
- src/server/tracking.ts — `startTracking` (the sim mode, `sim_host`, the link wired to the tracker with the quit flag; the sim-link claim to come, its pipe name already a parameter)
- src/server/this-pc.ts — `isThisPc`
- src/server/inputs.ts, shutdown.ts, channel.ts — app-shell's modules, where the sim input is read (LIVE-LINK-012, 013), the link stopped before the tracker's final checkpoint (LIVE-LINK-011, LIVE-SAVE-005, LIVE-CASUAL-013) and the save request handed to `saveNow` (LIVE-SAVE-004)
- src/server/db.ts — `tracker_state`, `tracker_state_aside`, `transaction`
- src/server/routes.ts — live tracker (446-628), the guard after the final checkpoint (`unlessShutDown`) and the error handler's `ShuttingDown` answer
- src/client/tracker.ts — `useTracker` (`parseTrack` is shared)
- src/client/types.ts — `TrackerStatus`, `PendingLeg`, `PendingLegDetail`, `HopEvent`
- src/client/api.ts — the tracker calls
- src/client/components/LivePanel.tsx — all but `SimbriefControls` (simbrief)
- src/client/components/LiveLayer.tsx
- src/client/paths.ts — `casualShapes`
- src/client/App.tsx — tracker stream, logged-hop handling, toast, zoom to the live aircraft, `onOpenPending`
- scripts/sim-fake.ts, scripts/sim-fake-args.ts (`parseSimFakeArgs`), scripts/sim-probe.ts

## Architecture

**Purpose:** Log every flight flown in the sim as a hop, with its track, landings and statistics,
without the user typing anything when the tracker can work it out, and never lose one — across a
sim crash, a restart of the server or the app, or a second copy of the app on the PC.

**Key Components:**
1. Sim mode — the sim input: the `--sim` start-up argument alone for the bundled server (LIVE-LINK-012); for a copy run from source, `--sim` when given, else the fake feed with `TRACKER_FAKE=1`, else off (LIVE-LINK-013); app-shell carries the argument among the server's inputs
2. `startSimLink` (`simconnect.ts`) — connection, 1 Hz samples, frame-rate touchdown watcher, events (quit told from a lost connection), every handler call guarded, a record it cannot read dropped, stopping without a disconnect
3. `startTracking` (`tracking.ts`) — the mode, the link wired to the tracker, `sim_host` by `isThisPc`; the PC-wide sim-link claim (to come), a named pipe held while linked; tracking paused and resumed around bringing in a logbook (to come)
4. `Tracker.feed` — phases, takeoff / landing / stop, interruptions, the restored-leg rule
5. `complete` / `keepLeg` / `logHop` / pending legs — logging or parking a finished leg or one ended in the air (marked `ended_in_air`); hop and checkpoint in one transaction
6. Checkpoint — `tracker_state` row: saves at phase changes, on request (`saveNow`) and at shutdown (`shutdown`, after which the pilot's actions are refused); restored at startup, the smallest part it cannot read set aside in `tracker_state_aside`; merged when a logbook is brought in (to come)
7. Casual mode — `setCasual`, `recordCasual`, `clearPath`; the switch checkpointed, the path in memory only; ended at quit, at a run's first start (`freshRun`) and at a clean MSFS quit
8. `/api/tracker*` + event stream (status read by the page and by the desktop shell)
9. `LivePanel`, `LiveLayer`, App's tracker handling and the page's own reconnect

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Sim link | LIVE-LINK-001 to 018 | 11 | 0 | 7 |
| Leg detection | LIVE-LEG-001 to 016 | 14 | 0 | 2 |
| Naming the airports | LIVE-NAME-001 to 003 | 2 | 0 | 1 |
| Landings and rating | LIVE-LAND-001 to 004 | 4 | 0 | 0 |
| What a leg records | LIVE-REC-001 to 005 | 3 | 0 | 2 |
| Binding | LIVE-BIND-001 to 003 | 3 | 0 | 0 |
| Logging and pending legs | LIVE-HOP-001 to 007 | 6 | 0 | 1 |
| Checkpointing | LIVE-SAVE-001 to 015 | 10 | 0 | 5 |
| Casual mode | LIVE-CASUAL-001 to 015 | 14 | 0 | 1 |
| API and event stream | LIVE-API-001 to 016 | 11 | 0 | 5 |
| Live card | LIVE-CARD-001 to 015 | 13 | 0 | 2 |
| Live aircraft on the map | LIVE-LAYER-001 to 004 | 4 | 0 | 0 |
| Development tools | LIVE-TOOL-001 to 005 | 5 | 0 | 0 |

**Summary:** 100 of 126 specs implemented; 26 gaps; none deferred. 71 implemented specs have tests.
Tests also cite 7 gaps, checking the part built so far: LIVE-API-005, 013, 016; LIVE-CARD-010;
LIVE-CASUAL-013; LIVE-HOP-007; LIVE-LINK-011.

The 26 gaps by what they wait for:
- **The sim-link claim, the sim's clock and the remaining leg rules** (13): LIVE-LINK-001, 010, 014,
  015; LIVE-LINK-011's release of the claim; LIVE-API-013's `link_holder`; LIVE-LINK-008 and
  LIVE-REC-004; LIVE-LEG-013, 014; LIVE-REC-003; LIVE-NAME-002; LIVE-API-006.
- **Bringing in a logbook** (10): LIVE-LINK-017; LIVE-API-015; LIVE-SAVE-008 to 011, 015; a
  brought-in leg's mark (LIVE-HOP-007); the import's shutdown keeping casual mode (LIVE-CASUAL-013);
  the shutdown 503 coming after the import's 409 (LIVE-API-016).
- **The page** (3): the reload of the map and lists on a reconnect (LIVE-API-005); a pending leg's
  profile, with flight-panel's PANEL-OPEN-002 (LIVE-CARD-010); the pending-leg hand-off, with
  app-shell's APP-UI-032 and 033 (LIVE-CARD-015).

## Key Findings

1. **A pending leg's Profile opens nothing.** Each block's **Profile** calls `onOpenPending(id)`
   (LIVE-CARD-010 open), and App passes a no-op (App.tsx:393) until the flight panel can show a
   pending leg (PANEL-OPEN-002). Needs a decision: make PANEL-OPEN-002 a condition for merging or
   releasing, or make `onOpenPending` optional and show **Profile** only when it is given.
2. **Nothing stops two servers on the PC logging the same flight.** The PC-wide sim-link claim is
   neither taken nor checked, `link_holder` is always null, and the shutdown order has no claim to
   release (LIVE-LINK-001, 010, 011, 014, 015, LIVE-API-013). Only a copy run from source started
   with `--sim=link` links beside the installed app, so the risk is the developer's own. What the
   claim will use is in place: `isThisPc` decides which links take and check it, and
   `startTracking` already takes the pipe's name as a parameter that tests set to a private one.
3. **A reconnect reloads nothing.** The page opens its event stream again 3 s after it ends, a 503
   while a server starts included, and takes the full state, but leaves the map and the lists as
   they were (LIVE-API-005), so a hop logged while the stream was away appears only after a reload.
4. **Legs of 30–59 s are kept** despite the one-minute minimum (tracker.ts:1394-1395, LIVE-LEG-013),
   and paused time counts toward flight time and the takeoff and stop timers (LIVE-REC-003,
   LIVE-LEG-014).
5. **The LLD's code line links** point at the right places for the sim mode, the claim's module,
   the interruptions and the deferred items, but many others predate later changes.

## Work Required

### Must Fix — the desktop app's server groundwork
1. The PC-wide sim-link claim: the named pipe `\\.\pipe\msfs-career-map-sim-link` taken when
   SimConnect opens on a link to a sim on this PC and released when the connection ends or the link
   stops, the shutdown order releasing it (LIVE-LINK-010, 011); answering each check with one JSON
   line naming the holder (`"installed"` from the bundled server, `"source"` from a copy run from
   source) and its data folder; no SimConnect opened while another server holds it, checking again
   at each 10 s retry, a silent holder counted after 1 s, and a connection closed at once with
   nothing passed to the tracker when the claim cannot be taken (LIVE-LINK-001, 014); none for the
   fake feed, off or a sim on another PC (LIVE-LINK-015); `link_holder` from a real check
   (LIVE-API-013), which the live card already shows. Test-first, every in-process test on a
   private pipe name and no process test on `--sim=link`; a test that sim-probe takes no claim
   (LIVE-TOOL-004).
2. The sim's clock: the link reading the sim's zulu date and time, and each leg recording its
   takeoff and touchdown on it as well as the real one (LIVE-LINK-008, LIVE-REC-004; with
   LOG-REC-002).
3. The remaining leg rules: legs under a full minute dropped (LIVE-LEG-013); paused time left out
   of flight time and the takeoff and stop timers (LIVE-REC-003, LIVE-LEG-014); the parked airport
   preferred on a near-tie at takeoff (LIVE-NAME-002); the live leg's statistics so far sent for
   the flight panel (LIVE-API-006).
4. Bringing in a logbook: tracking paused and, after a failed import, resumed; changes refused while
   paused, with LIVE-API-016's 503 after that 409; the merged checkpoint, with the source's leg in
   progress kept with its aircraft and briefing and its legs marked `ended_in_air`; refused when the
   source's cannot be read as a whole; the import's shutdown keeping casual mode (LIVE-LINK-017,
   LIVE-API-015, LIVE-SAVE-008 to 011, 015, LIVE-HOP-007, LIVE-CASUAL-013), with app-shell's import
   (APP-IMP-002, APP-IMP-003).
5. The page reloading the map and lists on every reconnect after the first, leaving the planner's
   results to the planner (LIVE-API-005; the version reload is app-shell's, APP-UI-036).
6. The pending-leg hand-off opening the card on that leg (LIVE-CARD-015), with app-shell's fragment
   (APP-UI-032, APP-UI-033).

### Should Fix
7. Settle whether PANEL-OPEN-002 gates merging this branch (Key Findings 1), then build what it
   decides.
8. Add tests for the 29 implemented specs that have none — first LIVE-HOP-001's takeoff time (a hop
   logged at once carries, as `departed_at`, the string the status gave as `leg.departed_at`; the
   flight panel relies on it, PANEL-OPEN-014) — one that the link passes the Sim and FlightLoaded
   events on (LIVE-LINK-007), and one that discarding a pending leg writes the checkpoint before
   deleting its briefing (LIVE-HOP-005).
9. Refresh the rest of the LLD's code line links (Key Findings 5).
