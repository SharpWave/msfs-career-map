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
for each sim mode; `sim-fake` taking its airports wherever they appear and posting to 127.0.0.1;
the PC-wide sim-link claim (`sim-link-claim.ts`), taken once SimConnect opens on a link to this PC,
answered with the holder and its data folder, released when the connection ends or the link stops,
checked before every attempt with a silent holder counted after 1 s, and its holder in the status as
`link_holder`; the sim's clock read in a definition of its own and carried by each sample, with
hops and pending legs recording takeoff and touchdown on it (logbook's sim-clock columns); legs under
a minute of flight time dropped; paused time left out of the takeoff and stop timers and of flight
time; the parked airport preferred on a near-tie at takeoff; the live leg's statistics in the status;
tracking paused while a logbook is brought in (the link and its claim stopped, nothing taken, every
change answered 409 "Bringing in a logbook") and resumed after an import that failed before its
answer; the merged checkpoint written into the copy — this PC's flying kept with its plans copied
and its pending legs' aircraft cleared, the source's pending legs added, its leg in progress kept as
a pending leg "brought in from another logbook mid-leg", what cannot be read set aside, a source whose
checkpoint cannot be read refused.

The page's side is built too: the map and lists reloaded on every reconnect after the first; a
pending leg's **Profile** opening it in the flight panel; the card opening at a pending leg handed to
it by the `#pending=` fragment. The claim and the sim's clock have run only against stand-ins of
SimConnect and the other copy, not yet beside a real MSFS.

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
- tests/live-tracking/stopping.test.ts — LIVE-LINK-007, 011, 016; LIVE-LEG-008; LIVE-CASUAL-013, 014; LIVE-SAVE-005 (the link's `stop()` reaching the tracker as nothing, then the tracker's `shutdown()`; LIVE-LINK-007's quit-versus-close split and pause events, with the Sim and FlightLoaded events reaching the handlers untested)
- tests/live-tracking/tracking.test.ts — LIVE-LINK-002, 003, 011, 012, 013; LIVE-API-004, 013; LIVE-LEG-008; LIVE-CASUAL-014 (`startTracking` over `fake-sim.ts`, each on a private claim pipe: the mode, host and port reaching the link, fake and off starting none, `sim_host` with the this-PC rule, the quit flag)
- tests/live-tracking/sim-link-claim.test.ts — LIVE-LINK-001, 010, 011, 014, 015; LIVE-API-013; LIVE-TOOL-004 (the claim on a private pipe, the other copy played by the test: taken, answered, released, checked at each retry, a silent holder, the race between check and take, none off the link to this PC)
- tests/live-tracking/sim-clock.test.ts — LIVE-LINK-008, LIVE-REC-004, LOG-REC-002 (the clock record read and moved on to each sample; hops, pending legs and the checkpoint carrying sim-clock times; the columns and the hop API)
- tests/live-tracking/merged-checkpoint.test.ts — LIVE-SAVE-008, 009, 010, 011, 015; LIVE-HOP-007; LIVE-BIND-001 (`writeMergedCheckpoint` with a real source checkpoint, `checkpointProblem`)
- tests/live-tracking/import-pause.test.ts — LIVE-LINK-011, 017; LIVE-API-015, 016 (the tracker and `startTracking`'s link paused and resumed)
- tests/live-tracking/leg-rules.test.ts — LIVE-LEG-013, 014; LIVE-REC-003; LIVE-NAME-001, 002; LIVE-API-006 (legs under a minute, pauses in the timers and the flight time, the parked airport on a near-tie, the statistics so far)
- tests/live-tracking/short-records.test.ts — LIVE-LINK-018 (records shorter than their definition, per definition and per connection)
- tests/live-tracking/pending-legs.test.ts — LIVE-HOP-003, 007; LIVE-BIND-003; LIVE-LEG-008, 016; LIVE-API-014 (the pending list, binding with legs waiting, a disconnect in flight, a leg restored in the air)
- tests/live-tracking/restored-leg.test.ts — LIVE-LEG-012, 016; LIVE-HOP-007 (a restored leg resumed on reconnect, kept with its reason when the connection ends before the first sample, kept restored when the server stops the link)
- tests/live-tracking/landed-interruptions.test.ts — LIVE-LEG-010, 011; LIVE-HOP-007; LIVE-LAND-002 (a landed leg closed on a new flight or a jump, the jumping sample's touchdown kept; an airborne one still discarded)
- tests/live-tracking/ended-in-air.test.ts — LIVE-HOP-007; LIVE-SAVE-002 (the mark in the status, the event, the leg in full and the checkpoint; an older leg read by its reason; LIVE-HOP-007 without brought-in legs)
- tests/live-tracking/checkpoint.test.ts — LIVE-SAVE-001, 002, 004, 006, 007, 012 (LIVE-SAVE-006 with a write failed by a temporary trigger)
- tests/live-tracking/set-aside.test.ts — LIVE-SAVE-002, 013, 014 (a damaged pending leg or leg in progress set aside alone, the rest restored and written back in one transaction)
- tests/live-tracking/shutting-down.test.ts — LIVE-API-016; LIVE-SAVE-004, 005 (the tracker after `shutdown()`, and the eight guarded routes against a test server, a SimBrief import already past the guard archiving nothing; LIVE-API-016 without LIVE-API-015's 409)
- tests/live-tracking/tracker-api.test.ts — LIVE-API-001, 003, 007, 013, 014; LIVE-HOP-004; LIVE-LEG-007; LIVE-BIND-002; LIVE-SAVE-006; APP-API-001 (against a running test server; refusals answered 400 or 409 and a failed write 500)
- tests/live-tracking/live-card.test.tsx — LIVE-CARD-001, 003, 005, 006, 008, 010, 011, 012, 013, 014; LIVE-BIND-003
- flight-panel's tests/flight-panel/pending-panel.test.tsx — LIVE-CARD-010 (**Profile** opening the leg in the panel); app-shell's tests/app-shell/page-fragment.test.tsx — LIVE-CARD-015; tests/app-shell/page-server.test.tsx — LIVE-API-005 (the reload on a reconnect)
- tests/live-tracking/casual.test.ts — LIVE-CASUAL-001 to 015; LIVE-API-010, 011, 012; LIVE-LEG-002, 003 (the tracker driven by synthetic samples, through `pilot.ts`)
- tests/live-tracking/logging.test.ts — LIVE-HOP-006, LIVE-API-014 (the "Logged" message after a bounce, after a touch-and-go, and for a pending leg logged)
- tests/live-tracking/casual-api.test.ts — LIVE-API-008, 009, 011; LIVE-CASUAL-006, 009, 010 (against a running test server, including the event stream)
- tests/live-tracking/casual-shapes.test.ts — LIVE-LAYER-004 (placing the casual path)
- tests/live-tracking/use-tracker.test.tsx — LIVE-API-005, 011, 014; LIVE-CARD-009 (the page's event-stream hook, reopened 3 s after each end, each connection counted once its first status arrives)
- tests/live-tracking/sim-fake-args.test.ts — LIVE-TOOL-003, 005
- tests/app-shell/channel.test.ts — LIVE-SAVE-004, 005; LIVE-CASUAL-013, 015 (a server process: the private channel's save and Shut down, the stop signals keeping casual mode, `--fresh-run`)
- tests/app-shell/shutdown.test.ts — LIVE-LINK-011; LIVE-SAVE-004, 005; LIVE-CASUAL-013 (the shutdown order in process: the link stopped before the final checkpoint, a landed leg kept landed and not rated again)
- tests/app-shell/server-start.test.ts, inputs.test.ts, server-exits.test.ts — LIVE-LINK-012, 013; LIVE-API-013 (the sim mode from the inputs in each form, through a server process and `readInputs`)
- tests/e2e/casual.spec.ts — LIVE-CARD-012, LIVE-CASUAL-001, 008, LIVE-LAYER-003, 004 (a casual flight in the browser; the path on every world copy)
- tests/tour-map/copies.test.ts, tests/e2e/world-copies.spec.ts — LIVE-LAYER-002 (the live aircraft and track on every world copy in view)
- tests/live-tracking/pilot.ts, state.ts, fake-sim.ts; tests/support/event-stream.ts, page-data.ts, server-process.ts — helpers (no specs of their own)

### Code
- src/server/simconnect.ts — `startSimLink` (guarded handler calls, the quit flag, a record it cannot read dropped and counted, the sim's clock, the gate passed before each attempt and once SimConnect opens, `stop()`)
- src/server/tracker.ts — `Tracker` and its singleton, built with the fresh-run input and given the sim mode from the server's inputs; restoring with damaged parts set aside; `saveNow`, `shutdown`, `isShutDown`, `ShuttingDown`; `leavePauseOut`, `flightMs`, `departureAirport`
- src/server/tracking.ts — `startTracking` (the sim mode, `sim_host`, the link wired to the tracker with the quit flag, the sim-link claim as its gate, `link_holder`)
- src/server/sim-link-claim.ts — `SIM_LINK_PIPE`, `checkClaim`, `takeClaim`
- src/server/airports.ts — `nearestAirport`'s preferred airport (the parked-airport tie-break; airports owns the ranking)
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
2. `startSimLink` (`simconnect.ts`) — connection, 1 Hz samples with the sim's clock, frame-rate touchdown watcher, events (quit told from a lost connection), every handler call guarded, a record it cannot read dropped, a gate before each connection, stopping without a disconnect
3. `startTracking` (`tracking.ts`) — the mode, the link wired to the tracker, `sim_host` by `isThisPc`; the PC-wide sim-link claim (`sim-link-claim.ts`), a named pipe held while linked; tracking paused and resumed around bringing in a logbook (to come)
4. `Tracker.feed` — phases, takeoff / landing / stop, interruptions, the restored-leg rule
5. `complete` / `keepLeg` / `logHop` / pending legs — logging or parking a finished leg or one ended in the air (marked `ended_in_air`); hop and checkpoint in one transaction
6. Checkpoint — `tracker_state` row: saves at phase changes, on request (`saveNow`) and at shutdown (`shutdown`, after which the pilot's actions are refused); restored at startup, the smallest part it cannot read set aside in `tracker_state_aside`; merged when a logbook is brought in (to come)
7. Casual mode — `setCasual`, `recordCasual`, `clearPath`; the switch checkpointed, the path in memory only; ended at quit, at a run's first start (`freshRun`) and at a clean MSFS quit
8. `/api/tracker*` + event stream (status read by the page and by the desktop shell)
9. `LivePanel`, `LiveLayer`, App's tracker handling and the page's own reconnect

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Sim link | LIVE-LINK-001 to 018 | 18 | 0 | 0 |
| Leg detection | LIVE-LEG-001 to 016 | 16 | 0 | 0 |
| Naming the airports | LIVE-NAME-001 to 003 | 3 | 0 | 0 |
| Landings and rating | LIVE-LAND-001 to 004 | 4 | 0 | 0 |
| What a leg records | LIVE-REC-001 to 005 | 5 | 0 | 0 |
| Binding | LIVE-BIND-001 to 003 | 3 | 0 | 0 |
| Logging and pending legs | LIVE-HOP-001 to 007 | 7 | 0 | 0 |
| Checkpointing | LIVE-SAVE-001 to 015 | 15 | 0 | 0 |
| Casual mode | LIVE-CASUAL-001 to 015 | 15 | 0 | 0 |
| API and event stream | LIVE-API-001 to 016 | 16 | 0 | 0 |
| Live card | LIVE-CARD-001 to 015 | 15 | 0 | 0 |
| Live aircraft on the map | LIVE-LAYER-001 to 004 | 4 | 0 | 0 |
| Development tools | LIVE-TOOL-001 to 005 | 5 | 0 | 0 |

**Summary:** all 126 specs implemented; none deferred. 101 have tests.

## Key Findings

1. **Not yet flown beside a real MSFS:** the sim-link claim (two servers on `--sim=link` at once)
   and the sim's clock (the ZULU variables' units and values as MSFS 2024 reports them). The tests
   play SimConnect and the other copy with stand-ins.
2. **The LLD's code line links** point at the right places for the sim mode, the claim's module,
   the interruptions and the deferred items, but many others predate later changes.

## Work Required

### Must Fix
*(none)*

### Should Fix
1. Fly the claim and the sim's clock beside a real MSFS (Key Findings 1): two servers on
   `--sim=link` in separate data folders, the second waiting with "linked to another copy"; a hop's
   sim-clock times against the sim's own clock.
2. Add tests for the 25 implemented specs that have none — first LIVE-HOP-001's takeoff time (a hop
   logged at once carries, as `departed_at`, the string the status gave as `leg.departed_at`; the
   flight panel relies on it, PANEL-OPEN-014) — one that the link passes the Sim and FlightLoaded
   events on (LIVE-LINK-007), and one that discarding a pending leg writes the checkpoint before
   deleting its briefing (LIVE-HOP-005).
3. Refresh the rest of the LLD's code line links (Key Findings 2).
