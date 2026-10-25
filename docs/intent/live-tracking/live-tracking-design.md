---
parent: high-level-design
prefix: LIVE
---

# Live Tracking

## Context and Design Philosophy

Live tracking turns flying in the sim into logbook hops without typing: the app watches the
sim, notices a takeoff and a landing, names the airports, measures the landing, records the
flown track, and logs the leg against the right fleet aircraft. When it cannot work something
out — an unknown sim aircraft, no airport where the wheels left or stopped, a flight the app
stopped watching — it keeps the leg for the user to finish rather than guessing.

The design splits the sim from the logic. [simconnect.ts](../../../src/server/simconnect.ts) is
a thin SimConnect adapter that only produces position samples and system events.
[tracker.ts](../../../src/server/tracker.ts) is a sim-independent state machine fed one sample at
a time, so a synthetic feed (`npm run sim-fake`) can drive the whole pipeline without the sim.
The tracker checkpoints itself to the database at every phase change and every few seconds
between them, so a server restart mid-flight loses at most the last few seconds of track.

The app runs as a Windows desktop program whose desktop shell keeps the server running, restarts it
when it fails and shuts it down when the app quits (desktop). The desktop shell reads the tracker's
status and event stream as the page does, so what the tracker reports — its phase, its messages, a
pending leg's reason, another copy holding the sim — is also what the tray and the notifications
say.

This segment owns:

- the sim link — the sim mode a server tracks in, connection, the samples and events it reads, the
  frame-rate touchdown watcher, and the PC-wide sim-link claim that lets one server on the PC link
  to the sim at a time;
- the tracker — leg phases, takeoff and stop detection, airport naming, touch-and-go, landing
  measurement and rating, the recorded track and flight statistics, checkpointing;
- binding a sim aircraft to a fleet row, and logging or parking a finished leg;
- casual mode — flying with the path drawn on the map and nothing logged;
- the tracker API and event stream (`/api/tracker*`);
- the **Live from the sim** card, the live aircraft, track and casual path on the map, and the
  "Logged" toast;
- the development tools `sim-fake` and `sim-probe`, run from the repository.

It relies on: fleet for the sim-binding fields and create-from-sim (FLEET-SIM); airports for
nearest-airport naming (APT-NEAR) and code resolution; logbook for the hop record it writes and
the parked position (LOG-SEQ-008); tour-map for placing the live aircraft and track and drawing
them on every world copy in view; simbrief for the briefing a leg carries; flight-panel for showing
the live leg's profile and for mapping a landing rating to its icon, word and color; and app-shell
for carrying the server's start-up arguments (`--sim`, which it requires of the bundled server and
`npm run dev:sim` gives, and `--fresh-run`), the order of its shutdown, the save request, bringing
in a logbook (when tracking pauses and resumes), a page reloading itself for a server of another
version, and acting on the `#pending=` fragment.

## The Sim Link

### Sim Mode

A server tracks in one of three **sim modes**: the sim link, the fake feed, or off. It takes the
mode from its **sim input**: the `--sim=link|fake|off` start-up argument, which reads the same in an
npm script and in the installed app's arguments, and, for a copy run from source only, the
fallbacks below. Which mode each input gives is this segment's (LIVE-LINK-012, LIVE-LINK-013);
app-shell carries the argument among the server's start-up inputs and ends a bundled server's start
that lacks it (APP-SRV-006).

- **A server the desktop shell starts** — the bundled server — takes its mode from `--sim` alone:
  the desktop shell gives the installed app's server `--sim=link` and the test mode's `--sim=fake`
  (desktop shell). It reads no environment setting for the sim — neither `TRACKER_FAKE` nor
  `SIMCONNECT_HOST` / `SIMCONNECT_PORT` — so it links to the sim on this PC because the desktop shell
  said so, never because of anything left in the environment.
- **A copy run from source** (`npm run dev`, `npm run dev:sim`, `npm start`, the browser-test
  server) tracks in the mode its `--sim` argument names when given — `npm run dev:sim` gives
  `--sim=link` (app-shell's script), and `npm start -- --sim=link` links a copy serving the build —
  else on the fake feed with `TRACKER_FAKE=1`, and off otherwise. A copy run from source thus logs nothing
  from the sim unless the developer asks, so career flights never land in the repository's data
  folder by accident (HLD, Which copy logs flights). On the sim link, `SIMCONNECT_HOST` /
  `SIMCONNECT_PORT` reach a sim on another PC.

On the **fake feed** the link is not started and the tracker takes samples from
`POST /api/tracker/sample` (`sim-fake`, the browser tests, the desktop app's test mode); **off**,
nothing is tracked ([tracking.ts](../../../src/server/tracking.ts), `startTracking`). The tracker status names
the mode, so the live card can say why a copy that is off tracks nothing.

### Connecting

On the sim link, [simconnect.ts](../../../src/server/simconnect.ts) connects to the sim and retries
every 10 s while it is not running, logging only the first failure — and opens no connection while
another server on the PC holds the sim-link claim (One Link per PC, below).

**Once a second** it reads the user aircraft's latitude, longitude, altitude, on-ground flag,
ground speed, true heading, vertical speed, indicated airspeed, G, total fuel and weight, the
sim's touchdown velocity, pitch and bank, `TITLE` and `ATC ID`
([simconnect.ts:145-172](../../../src/server/simconnect.ts#L145-L172)). `LIVERY NAME` is read
separately, so a sim without it (MSFS 2020) loses only the livery, which then reads as blank. A
sample is stamped with the wall-clock time it arrived.

**Livery first.** Because the livery arrives in its own request, on each new connection the link
holds the samples it reads until the first livery reading arrives, or the sim rejects the
variable, and then passes them on in order with that livery. A sample's livery is therefore the
sim's actual livery, never a placeholder for one not yet read. If neither has happened 5 s after
the first held sample, the link passes the held samples on with a blank livery rather than stop
tracking.

**Every frame** it watches the on-ground flag, vertical speed, G and airspeed to catch the
touchdown ([simconnect.ts:177-212](../../../src/server/simconnect.ts#L177-L212)). On the frame the
wheels touch it takes the descent rate and airspeed of the last airborne frame, then the peak G
over the next second. The result rides on the next once-a-second sample, together with the sim's
own touchdown velocity (as fpm), pitch and bank.

**Events**: Pause, Sim (false while in menus or loading) and FlightLoaded, plus the connection
ending, each ending followed by retrying. The link tells the sim's own quit event — MSFS closing
normally — apart from a connection that closed or failed (a sim crash, a lost connection), since
only a clean quit ends casual mode (Casual Mode, How long it lasts).

**Errors.** An error while the tracker handles one sample or sim event is written out, and the
next sample or event is passed on as usual. One bad sample never ends the server — which the
desktop shell would restart straight into the same checkpoint and sample — nor stops tracking.

A record the link itself cannot read — one shorter than its data definition, which node-simconnect's
reader throws on — is dropped, and the connection and the server carry on. The first such record of
each data definition on a connection is written out in full; later ones on that connection are only
counted, and the count is written out when the connection ends or the link stops. A short record
repeats with every record of its definition — the per-frame one at the sim's frame rate — so writing
each would fill the server's log within minutes, while one full line per definition shows the cause
and the count shows how long it went on.

**Stopping.** When the server stops tracking — at its shutdown (app-shell's shutdown order), or as
it pauses tracking to bring in a logbook (below) — the link is stopped first: it is marked stopping
before its connection closes, so the closing reaches the tracker as nothing at all, the per-frame
watcher stops with it, and the sim-link claim is released. The tracker's state saved afterwards is
its state from before the link stopped, and the leg comes back as it was at the next start. Taken
as a disconnect, every Quit, update or sign-out would turn a leg in the air into a pending leg and
close a taxiing leg at the runway exit.

**Pausing to bring in a logbook.** When app-shell accepts a logbook to bring in, it pauses tracking
before copying it: the link stops as above, and until tracking resumes the tracker takes no sample —
the fake feed's included — and no sim event, and the API refuses every change to the tracker's state
with 409 "Bringing in a logbook" (binding, logging or discarding a leg, switching casual mode,
clearing the path, posting a sample). The tracker's state is thus fixed from the moment its merged
checkpoint is written into the copy (Checkpointing, Bringing in a logbook) to the server's exit, and
nothing bound, logged, discarded or switched in between lands only in the logbook being replaced.
When the import fails before the server answers, app-shell resumes tracking: the link starts again
(on the sim link) and the tracker goes on from its state as it was, so a failed import never leaves
the server running with tracking dead until its next start. The pause lasts as long as the copy
takes to make, seconds for a career logbook; a leg in the air across it continues on the first
sample after it.

**The sim's clock.** The link also reads the sim's zulu date and time once a second, in a data
definition of its own, so a sim that rejects one of its variables loses only the sim-clock times.
Each sample carries the latest reading, moved on by the time since it arrived; it carries none
before the first reading on a connection, after the sim has rejected a clock variable, or when the
values make no date. Each leg records its takeoff and touchdown on the sim's clock as well as the
real one (logbook, LOG-REC-002).

### One Link per PC

Only one server on the PC links to the sim at a time, so two copies of the app never log the same
flight. The installed app links by default and a copy run from source only when started with
`--sim=link` (Sim Mode); either way, a server never links while another holds the link, and
neither takes it from the other.

**The claim** is a Windows named pipe, `\\.\pipe\msfs-career-map-sim-link`, which every process on
the PC sees whatever its Windows account. The server holding the claim listens on it; Windows lets
only one process listen on a pipe name and frees it when that process ends, a crash included.

- **Taken when SimConnect opens.** Before each connection attempt a server on the sim link checks
  the pipe. If another server holds it, it opens no SimConnect connection and checks again at its
  next 10 s retry; a holder that accepts the check but gives no answer within 1 s — a server that
  hangs — counts as holding it without saying who it is. If none answers, it connects; once SimConnect has opened, it takes the claim by
  listening on the pipe. Should another server have taken it in between, the listen fails, and the
  server closes the connection it just opened at once — passing nothing to the tracker, neither a
  connect nor a disconnect — and waits in the same way.
- **Held while connected, released at once** when the link's connection ends — the sim quitting or
  crashing, the connection failing — or the link stops (Stopping); the process ending releases it
  with it. A server whose sim is not running, or is still loading, holds nothing.
- **Who holds it.** The holder answers each check on the pipe with who it is — the installed app
  (a server the desktop shell started) or a copy run from source — and its data folder. A server
  waiting on the claim reports that holder in its status (`link_holder`, API and Event Stream),
  with the words the live card and the desktop shell's tray show: "The sim is linked to another copy (the installed app)", "The sim is
  linked to another copy (run from source)", or "The sim is linked to another copy" when the holder
  does not say. The words come from the tracker so the tray and the live card always agree.
- **Only a link to the sim on this PC** takes or checks the claim. The fake feed, a server that is
  off, and `npm run sim-probe` neither take nor check it, and report no holder: a fake-feed copy —
  the browser tests, the desktop app's test mode — never keeps the installed app off a real flight,
  nor stops following its own samples because the installed app is flying. A copy run from source
  that links to a sim on another PC (`SIMCONNECT_HOST`) takes no claim either, since a claim on this
  PC says nothing about that one; its live card says the other PC's own copy is not checked. A
  `SIMCONNECT_HOST` that names this PC — a loopback address, `localhost`, the PC's own name or one of
  its addresses — reaches the sim on this PC, and that link takes and checks the claim as any other.

The claim lives with the server's tracking ([tracking.ts](../../../src/server/tracking.ts), `startTracking`),
around the link, not in the link module that `sim-probe` also uses: the pipe, its check and its
answer are in [sim-link-claim.ts](../../../src/server/sim-link-claim.ts), and `startTracking` puts the
claim in front of the link as a gate the link passes before each attempt and once SimConnect has
opened, and releases when the connection ends or the link stops. Whether a host names this PC is one
check, `isThisPc` ([this-pc.ts](../../../src/server/this-pc.ts)), made without a DNS lookup, which
decides both which links take and check the claim and when the status's `sim_host` is null.

## Leg Detection

While casual mode is off (below), the tracker
([tracker.ts:626-747](../../../src/server/tracker.ts#L626-L747)) moves through
**idle → ground → airborne → landed**, and back to ground when the leg is closed.

**Samples it ignores.** While the sim is paused, in menus or loading, or the position is within
0.05° of latitude 0, longitude 0 (where the sim parks the aircraft in its menus), samples change
nothing ([tracker.ts:286-294](../../../src/server/tracker.ts#L286-L294)).

**Takeoff.** On the ground, the on-ground flag must stay off for 5 s before a takeoff counts, so
runway bounces do not start legs. The leg's departure time is the first airborne sample; its
origin is the airport nearest the last on-ground sample, within 5 nm (airports' nearest-airport
rule, which favours a large airport over a smaller field next to it). The track starts with that
ground point.

**Near-tie at takeoff.** When the sim aircraft is bound and its fleet aircraft's parked airport
(its last logged destination) is within the 5 nm radius and ranks within 1 nm of the nearest
airport — by the same distance-plus-class-handicap ranking — the parked airport is the origin. A
career aircraft usually departs from where it last landed, an airport's reference point can sit a
mile from the runway end it lifts off from, and two fields sharing a boundary are often under a
mile apart.

**Started in the air.** If tracking begins with the aircraft already airborne, a leg starts with
no origin.

**Landing.** When the on-ground flag comes on in flight, the leg is landed and its touchdown time
is set. A landing is recorded (below). If the aircraft leaves the ground again — a bounce or a
touch-and-go —
the same leg continues and the next touchdown replaces the touchdown time.

**Stop.** Once landed, the leg closes when ground speed has stayed under 5 kt for 30 s. Its
destination is the airport nearest the stop position, within 5 nm. **Log now** closes a landed
leg at once, for a sim that froze or was left after touchdown.

**Interruptions** ([tracker.ts:869-931](../../../src/server/tracker.ts#L869-L931), [1145-1165](../../../src/server/tracker.ts#L1145-L1165)):

| Event | Leg airborne | Leg landed |
|---|---|---|
| The sim link's connection ends — the sim quitting or crashing, the connection failing; never the server stopping the link | Kept as a pending leg ending at the last sample, destination blank (a leg restored at server start and not yet resumed: as Restored at server start says) | Closed at the last sample |
| A different sim aircraft or livery | Discarded | Closed at the last sample |
| A new flight is loaded | Discarded | Closed at the last sample |
| Position jumps more than 50 nm + 700 kt × the time since the last sample | Discarded | Closed at the last sample before the jump |

A landed leg is the user's flight already done, so every interruption is meant to close it where
it stopped rather than lose it. A measured touchdown rides on the next once-a-second sample, so when
that sample is the jump it is recorded on the landed leg first, where the aircraft last was, and the
hop has the measured landing; one that would come only after a new flight loads finds the leg
already closed, and the hop keeps the provisional landing (Decisions & Alternatives). Either way
the closed leg is logged as a hop when it can be, and otherwise kept as a pending leg that ended on
the ground.

A disconnect in flight is usually a sim crash, not a choice, so the leg is kept for the user to
finish or discard rather than thrown away. Changing aircraft, loading a new flight or slewing
away are the user's own doing, and the airborne leg is discarded.

**Restored at server start.** A leg the server restores in the air is waiting for the sim to show
whether the flight went on. It continues only when the first sample the tracker takes from a sim
connection shows the same sim aircraft (title and livery), airborne, within the jump bound from the
leg's last sample: the server restarted while the sim flew on. Anything else — a new flight loaded
before that sample, the sim link's connection ending before it, another sim aircraft, a jump beyond
the bound, or the aircraft on the ground — means the flight ended while the app was not watching: a
Windows restart or shutdown with a flight left running, a sign-out, a desktop shell that crashed,
the app quit in flight. The leg is then kept as a pending leg ending at its last sample, with no
destination and the reason "MSFS Career Map stopped in flight and the sim did not resume it", and
that first sample, whenever it comes, is taken as the start of tracking. The leg is never discarded
as an aircraft change, a new flight or a jump, and never closed as a hop: its first on-ground sample
would otherwise count as a touchdown rated from a sample hours old, and log a hop spanning the
night. A connection that ends before the first sample — MSFS started to its menu after a Windows
restart, whose samples are ignored, then quit — gives the leg this reason too, not "the sim
disconnected in flight": the sim did not stop in flight, the flight had ended before the app was
watching again. The server stopping the link is none of these (Stopping): the leg stays restored in
its checkpoint for the next start. A restored landed leg follows the interruptions table: it closes
at its last sample when the sim shows another aircraft, a new flight or a jump, and otherwise waits
for the stop as usual. Until the sim reports, a restored leg counts as a leg in progress.

**Changing aircraft.** When the sim's title or livery changes, the tracker looks up the binding
for the new pair. Since the link passes on no sample before it has read the livery (Livery first,
above), the first sample after a connection carries the real livery, so neither a leg restored
after a server restart nor one started in the air is mistaken for an aircraft change.

**Too short.** A leg is dropped when its flight time (below) is under a minute, judged to the
second before it is rounded. A dropped leg leaves the current SimBrief briefing for the next leg.

**Pauses.** Time the sim spends paused does not count: not toward the 5 s takeoff confirmation or
the 30 s stop, and not toward flight time. The tracker takes no sample while the sim is paused, and
the gap between the last sample before a pause and the first one after it counts as time paused,
the second or so of flying on either side of it included. A takeoff confirmation or stop running
before a pause goes on from where it stood; the time paused within a leg is checkpointed with it.

**Time asleep.** When the PC sleeps, the sim and the server stop together, and the tracker sees only
a gap between samples. It treats that gap as any other: as time flown, toward flight time and the
timers. It cannot tell a sleep from a server restart during which the sim flew on, which is real
flying, and a PC put to sleep mid-flight is rare. A takeoff confirmation or stop that was running
completes on the first sample after the gap if the aircraft is still airborne or still stopped. The
desktop shell has the state saved as the PC suspends (Checkpointing).

## Landings

Each touchdown in a leg becomes a landing: time, descent rate (fpm, positive down), peak G,
airspeed, the sim's own touchdown rate, pitch, bank, position, rating and source
([tracker.ts:805-847](../../../src/server/tracker.ts#L805-L847)).

- **Provisional** ("samples"): when the once-a-second data shows the wheels down, the descent rate
  and airspeed come from the last airborne sample and G is unknown.
- **Measured** ("frames"): when the frame watcher's touchdown arrives, it replaces a provisional
  landing from within 6 s, or is added as a new landing. With the fake feed the measured numbers
  come from the script.

Each landing recorded or replaced is saved at once (Checkpointing).

**Rating** ([tracker.ts:55-71](../../../src/server/tracker.ts#L55-L71)) — the worse of the two
classes:

| Rating | Descent rate up to | Peak G below |
|---|---|---|
| butter | 100 fpm | 1.6 |
| solid | 250 fpm | 2.0 |
| hard | 500 fpm | 2.6 |
| hospital | 800 fpm | 3.5 |
| graveyard | above 800 fpm | 3.5 and over |

Without a G the rating comes from the descent rate alone. How a rating is drawn is flight-panel's.

## What a Leg Records

- **Track**: a point at most every 5 s while airborne or landed, plus the stop point, each
  `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts, fuel_lb]` (logbook's track format)
  ([tracker.ts:297-306](../../../src/server/tracker.ts#L297-L306), [775-783](../../../src/server/tracker.ts#L775-L783)).
- **Times**: departure at takeoff and arrival at the last touchdown, on the real-world clock and on
  the sim's (none when the samples carried no sim clock); flight time as the whole minutes between
  them less any time paused, rounded as the logbook stores flight times (LOG-REC-010). For a
  leg kept in the air — after a disconnect in flight, or restored and not resumed — the arrival is
  the last sample, and the pending leg is marked as ended in the air (Binding and Logging).
- **Statistics** ([tracker.ts:873-883](../../../src/server/tracker.ts#L873-L883)): fuel at takeoff and
  at the stop, fuel used, weight at takeoff and at the stop, highest altitude, highest ground
  speed, and distance flown along the track. A fuel or weight reading of zero is stored as unknown.
- **Landings** (above) and the **briefing** current when the leg closes.

## Binding and Logging

**Binding** ([tracker.ts:245-249](../../../src/server/tracker.ts#L245-L249), [476-486](../../../src/server/tracker.ts#L476-L486),
[751-754](../../../src/server/tracker.ts#L751-L754)). The tracker finds the fleet aircraft whose sim
title matches and whose sim livery matches exactly or is blank ("any livery"), preferring an exact
livery, then the oldest row. Binding from the live card writes the current title and livery onto
the chosen aircraft, so the pairing is remembered, and fills in the aircraft of every waiting leg
flown in that sim aircraft and livery that has none.

**Logging** ([tracker.ts:850-918](../../../src/server/tracker.ts#L850-L918)). A closed leg is logged
straight into the logbook, at the end of the aircraft's sequence, when the sim aircraft is bound
to an existing fleet aircraft and both airports are known. The current SimBrief briefing goes with
it, and the tracker reports "Logged ORIG → DEST, time" with the descent rate and rating of the
touchdown that stands for the hop — the first touchdown of its final landing, by flight-panel's
bounce rule (PANEL-LOOK-004) — so the message and the hop's badge agree. The same message travels
with the hop on the event stream, where the desktop shell's "Hop logged" notification shows it.
The hop and the checkpoint that no longer holds its leg are written in one transaction
(Checkpointing).

Otherwise it becomes a **pending leg**, with the reason: no fleet aircraft bound (including one
deleted during the flight), departure unknown, no airport within 5 nm of the stop, the sim
disconnected in flight, MSFS Career Map stopped in flight and the sim did not resume it, or brought
in from another logbook mid-leg. From the card the user picks the aircraft and airports the tracker
lacked and logs it, or discards it.

**Takeoff time.** A hop's `departed_at` is its leg's takeoff time exactly as the status gave it —
the same ISO UTC string, carried unchanged from the leg in progress into a pending leg and the hop
logged from it. A page that showed the live leg and missed the `hop` event while its stream was down
finds the hop logged from that leg among the hops it reloads by that time alone (flight-panel,
PANEL-OPEN-014).

**Pending legs** wait in a list in the order they were kept, each logged or discarded on its own; a
new one never displaces another. Each carries an id, a random UUID, unique for the life of the
logbook: a counter would start again when a backup is restored, and clash with a brought-in
logbook's own, while a notification left in Windows' notification centre names its leg by that id
and must name that leg or nothing (desktop shell). Discarding one writes the checkpoint without it
before deleting its SimBrief plan (unless a hop uses the plan), so a failure between the two leaves
at worst a plan row nothing reads, never a waiting leg naming a plan that is gone.

**Ended in the air.** Each pending leg also says whether it ended in the air (`ended_in_air`): true
for a leg kept while airborne — the sim's connection ended in flight, a restored leg the sim did not
resume, a brought-in leg in progress that was airborne — and false for one that ended on the ground,
closed after landing or brought in after it had landed. The live card labels its end time by it: "down" for a touchdown, "last seen" for a leg that never came
down. The tracker sets the mark because nothing else tells such a leg apart: a leg with
touch-and-goes has landings yet can end in the air, a leg that stopped away from any airport landed
yet has no destination, and the reason is words for the pilot.

## Checkpointing

The whole tracker state — phase, sim aircraft, binding, the leg in progress, the pending legs, the
current briefing, casual mode's switch with the time it was switched on, recent samples, timers and
the last message — is kept in the single `tracker_state` row
([tracker.ts:176-197](../../../src/server/tracker.ts#L176-L197), [1363-1367](../../../src/server/tracker.ts#L1363-L1367)).
The casual path is never saved.

**When it is saved.** At most every 5 s while samples arrive, and at once when a leg starts, lands
or closes, a landing is recorded or replaced, a leg is discarded, and the binding, the current
briefing, a pending leg or casual mode changes. A server ended at any moment therefore loses at most
a few seconds of track, never a takeoff, a touchdown or a measured landing. A landing left to the
5 s throttle could come back unlanded after a restart and be rated again from a sample seconds
before the touchdown.

**A hop and its checkpoint together.** Logging a hop — from a closed leg or a pending leg — writes
the hop, its briefing's link to it and the checkpoint that no longer holds that leg in one SQLite
transaction. A server ended at any instant then leaves the flight either in the checkpoint or in the
logbook: never in both, which would log it twice at the next start, and never in neither.

**Saving on request.** The server asks the tracker to save its state now — the desktop shell asks
when Windows asks whether the session may end and as the PC suspends, and app-shell carries the
request — and the tracker writes its whole state and changes nothing else, so a sign-out called off
or a resume from sleep leaves tracking as it was.

**At shutdown.** The final save comes after the sim link has stopped (The Sim Link, Stopping) and,
when the app is quitting, after casual mode is switched off (Casual Mode, How long it lasts); the
tracker takes no sample or event after it, and turns down every action of the pilot's that would
change its state — switching casual mode, binding, importing or removing the SimBrief plan,
discarding the leg, **Log now**, logging or discarding a pending leg — which the API answers with
503 "MSFS Career Map is shutting down" (API and Event Stream) for the moment left before the server
stops listening. Nothing then changes the checkpoint after the final one: a switch to casual mode
let through in that moment would otherwise be saved after casual mode was switched off for quitting,
and be on again at the next start. Clearing the casual path and posting a sample are answered as
usual, since neither changes what is saved. The order of the server's whole shutdown is
app-shell's.

**When a save fails.** A pilot's action other than logging a hop — binding, setting or clearing the
SimBrief plan, switching casual mode, discarding a leg or a pending leg — changes the tracker and
then saves. If the save fails (a full disk, a logbook another program holds locked), the request is
answered 500 with the error written out (app-shell's error answer, APP-API-001), and the checkpoint
is left as it was, holding the state from before the action; the tracker's memory keeps the change
until its next save succeeds. Nothing flown is lost: logging a hop, the one action whose writes
would lose or double a flight if they parted, is one transaction (above), and a pending leg's
discard deletes its plan only after the checkpoint no longer holds the leg (Binding and Logging).

**Restoring** at startup reloads the state. A restored leg that began at the menu position is
dropped; one saved by an older version gains the fields it lacks; a checkpoint of an older version
holding a single pending leg in place of a list becomes a list of that one leg, with an id of its
own. A pending leg saved without the ended-in-the-air mark reads as ended in the air only when its
reason is "the sim disconnected in flight" or "MSFS Career Map stopped in flight and the sim did not
resume it", which only a leg kept in the air carries; every other leg saved without the mark was
closed after landing, so the rule never calls a landed leg "last seen". Casual mode comes back as Casual Mode says, and a
leg restored in the air waits for the sim (Leg Detection, Restored at server start).

**Fields it does not know.** A checkpoint can hold fields this version does not know: one written by
a later version, which an older installer run by hand over a newer install then runs on (desktop
distribution). The tracker ignores them and keeps each, unchanged, with the object that holds it —
the checkpoint, the leg in progress, a pending leg — in every save while that object is kept. The
older server thus neither sets the newer checkpoint aside nor strips what the newer version reads
when it comes back.

**What cannot be read is set aside — the smallest part.** A checkpoint can be damaged by a hand
edit or come from another version's shape. The tracker sets aside the smallest part it cannot read,
with the time, in a `tracker_state_aside` table that it never reads again, writes out what it set
aside, restores the rest, and writes the checkpoint without the part at once:

- **A pending leg** that is not an object, or lacks or mistypes a field this version needs — `sim`
  an object with string `title` and `livery`; `departed_at` and `arrived_at` strings;
  `duration_min` a number; `reason` a string; and, when present, `track` a list, each of its
  points a list of at least four finite numbers, `landings` a list, each of its touchdowns an object
  with a string `t`, `stats` an object and `ended_in_air` a boolean — is set aside alone, its JSON as
  the checkpoint holds it. Its SimBrief plan stays in the logbook, so the leg can be recovered whole.
- **The leg in progress**, when it is not an object or lacks or mistypes a field this version
  needs — `departed_at` a number and `track` a list, each of its points a list of at least four
  finite numbers; and, when present and not null, `landings` a list, each of its touchdowns an object
  with a string `t`, `origin` a string, and `touchdown_at`, `fuel_start_lb`, `weight_start_lb`,
  `max_alt_ft` and `max_gs_kts` numbers — is set aside alone, and the tracker starts that part from idle: no leg in
  progress, the idle phase, no takeoff or stop timer running and no last on-ground or airborne
  sample. The next sample begins tracking afresh (Leg Detection).
- **The whole checkpoint**, when the damage is anywhere else — not JSON, not a JSON object, its
  phase missing or unknown, or another field of its own present with a type this version cannot read
  (a pending list that is neither a list nor an object among them) — is set aside whole, its text
  exactly as found, and the tracker starts empty.

A field this version does not know never counts as damage (Fields it does not know, above). Set
aside, a leg or a checkpoint can still be recovered by hand; restoring the rest keeps every good
waiting leg in view and logging, rather than hiding them all behind one bad one; and starting from
idle or empty keeps the server, and tracking, running rather than failing at every start until the
desktop shell gives up.

**Bringing in a logbook.** When the server brings in a logbook from another data folder or a backup
(app-shell), it does so through a restart: the copy, with a checkpoint for it, is made ready beside
the logbook, and the next server start puts it in place. Once tracking has paused (The Sim Link,
Pausing to bring in a logbook), the tracker writes into the copy a checkpoint holding:

- its own leg in progress, current briefing, casual mode and pending legs — the flying going on
  now on this PC — with the SimBrief briefings they carry copied into the copy, and the pending
  legs' fleet aircraft cleared, since their ids name rows of the logbook being replaced;
- after them, the source's pending legs it can read, as its checkpoint holds them, with their ids,
  whose aircraft and briefings are the copy's own;
- then the source's leg in progress, if it had one it can read, as a pending leg with an id of its
  own, ending at its last sample — with the source's bound fleet aircraft and its current briefing,
  the plan of the very flight being kept, both the copy's own; the destination nearest that sample
  when it had landed, none when airborne; and the reason "brought in from another logbook mid-leg",
  since the copy that flew it no longer runs;
- the binding of the sim aircraft being flown looked up again in the copy (LIVE-BIND-001); the
  source's current briefing, when no such leg carries it, is dropped unless a hop uses it.

Pending-leg ids are random UUIDs, so the two lists never clash. If the tracker cannot read the
source's checkpoint as a whole — another version's shape, judged as at restore — it says so and the
logbook is not brought in (app-shell refuses, naming the reason): setting it aside would silently
lose the source's pending legs. A single pending leg or leg in progress of the source's that it
cannot read, judged as at restore, is set aside in the copy's own `tracker_state_aside`, with the
time, and left out of the checkpoint it writes, as the source's own server would have set it aside
at its next start; the rest of the source's flying comes across.

**Leg in progress.** The tracker's status says whether a leg is being flown, a restored leg waiting
for the sim included. The monthly airport refresh waits on it, as on the sim link being connected
(app-shell's check, APP-SRV-012; airports, APT-DATA-004), and the
desktop shell installs an update by itself only while there is none and casual mode is off
(DESK-SHELL-UPD-028).

## Casual Mode

Casual mode is for flying outside the career — sightseeing, trying out an aircraft, a flight
that belongs to no tour. The path flown is drawn behind the aircraft, and nothing is logged,
stored or tied to a fleet aircraft. The pilot switches it on and off from the live card.

**While it is on**, the tracker detects no legs: no takeoff, landing or stop, no landing measured
or rated, no pending leg. A SimBrief plan already current stays for the next logged leg, and no new
one can be imported (simbrief, SB-CUR-004). It holds the idle phase with no takeoff or stop timer
running and no last ground or airborne sample, both in memory and in the checkpoint, and its
status reports the idle phase. It still ignores the samples it always ignores (paused, in menus,
the menu position), still follows the sim aircraft and looks up its binding — so switching off
resumes with the right fleet aircraft — without calling an unbound aircraft out, and still reports
the live position. Binding from the API works as usual; the card simply does not offer it. Pending
legs already waiting stay, and can be logged or discarded as usual.

**The path** is a list of segments, each a list of track points in the leg track's format. A
sample the tracker takes becomes a point when the path is empty, after a break, or once at least
5 s have passed since the path's last point — unless the aircraft is standing still, on the ground
below 1 kt, so a sim left parked does not grow the path. A **break** — a position jump (more than
50 nm plus 700 kt × the time since the last sample, the rule legs use), a new flight loaded, or the
sim link's connection ending (never the server stopping the link) — makes the next point begin a
new segment. No line is therefore drawn across a
slew, a new flight or a reconnect somewhere else. **Clear** on the card empties the path. The path
lives in the server's memory only: it is not checkpointed and never written to the database. Its
point count is the total over all segments.

**Switching on** with no leg in progress starts an empty path. A takeoff still within its 5 s
confirmation is not yet a leg; switching on simply stops it from becoming one. With a leg in
progress:

| Leg in progress | Switching on |
|---|---|
| Landed | The leg closes where the aircraft is and is logged, or kept as pending, as for any interruption of a landed leg; the path starts empty. A touchdown whose frame-rate figures have not arrived yet keeps its provisional landing, as with **Log now** |
| Airborne, sim aircraft bound to a fleet aircraft that still exists | Only once the pilot confirms: the leg is dropped without logging, and its track becomes the path's first segment |
| Airborne, otherwise | The leg is dropped without asking, and its track becomes the path's first segment |

The server requires the confirmation: a request to switch on while a bound fleet aircraft's leg is
airborne is refused with 409 unless it says to drop the leg, and the refusal names the fleet
aircraft, the leg's origin and its takeoff time. The card then asks "NAME is flying a leg from
ORIG. Switch to casual mode? The leg will not be logged." — or "NAME is flying a leg that started
in the air." when the origin is unknown — and repeats the request with the drop if the pilot
agrees. Because the server checks, a leg that took off between the card's last status and the
click is protected too. Saying to drop the leg only ever drops an airborne leg: a leg that landed
while the question was open is closed and logged like any landed leg.

**Switching off** drops the path and resumes leg detection from the next sample, starting from the
idle phase: on the ground the tracker waits for a takeoff; in the air it starts a leg with no
departure (LIVE-LEG-003), which ends as a pending leg rather than going unrecorded.

Asking for the state casual mode is already in changes nothing: the path, its start time and any
leg in progress stay as they are. A second window or tab acting on a stale status therefore cannot
reset the path.

When the pilot switches it, the tracker reports "Casual mode on: nothing is logged" — with "; dropped
the leg from ORIG" when it dropped one — or "Casual mode off: takeoffs and landings are logged
again". A clean MSFS quit has words of its own (below); a shutdown and a run's first start switch it
off without a message.

**How long it lasts.** The switch is kept with the checkpoint, so the server's own restarts — the
desktop shell restarting a server that failed, a requested restart, a source run's `tsx watch`
restart on a save — keep casual mode on; only the path, held in memory, starts again empty. Casual
mode ends:

- when the pilot switches it off;
- when the app quits: the server switches it off as it shuts down for quitting — on the desktop
  shell's Shut down, which it sends only when the app is set to quit (Quit, the installer's or
  uninstaller's `--quit`, an update about to install, a Windows session end) — before the tracker's
  final save, so the next start finds it off (app-shell orders the shutdown, APP-SRV-016; the
  shutdown that finishes bringing in a logbook leaves it as it is);
- at the first server start of each run of the app: the desktop shell gives that start the
  fresh-run input (app-shell's `--fresh-run`, APP-SRV-011) until one server of the run has done its
  start-up work, and the tracker then starts with casual mode off whatever its checkpoint holds,
  writing that into the checkpoint before the start-up work is done. A session end can cut the
  shutdown short, and a desktop shell that crashes or is ended takes its server with it with no
  shutdown at all, either leaving casual mode saved on; the fresh run covers that, and a later
  server start in the same run, made without the input, finds it off too;
- when MSFS closes normally — SimConnect's quit event, not a sim crash or a lost connection — with
  the message "Casual mode off (MSFS closed): takeoffs and landings are logged again".

A new sim session after MSFS closed normally, or a new run of the app, therefore never starts with
logging off from the night before, while a sim crash, after which the pilot usually goes on flying
the same casual session, does not end it. A copy run from source has no desktop shell, no Shut down
and no fresh-run input, and its stop leaves casual mode as it is (APP-SRV-018): its casual mode
lasts until it is switched off or MSFS closes normally.

## API and Event Stream

| Method | Path | Does | Errors |
|---|---|---|---|
| GET | `/api/tracker` | Current status | |
| GET | `/api/tracker/events` | Event stream (below) | |
| POST | `/api/tracker/bind` | `{aircraft_id}`: bind the sim aircraft being flown | 404 unknown aircraft; 400 no sim aircraft yet |
| POST | `/api/tracker/pending/:id` | `{aircraft_id?, origin?, dest?}`: log that pending leg, codes resolved to idents → 201 + hop | 404 unknown aircraft or pending leg; 400 unknown code, or aircraft, origin or destination still missing |
| GET | `/api/tracker/pending/:id` | That pending leg in full, with its track, landings, statistics and briefing | 404 unknown pending leg |
| DELETE | `/api/tracker/pending/:id` | Discard that pending leg | 404 unknown pending leg |
| POST | `/api/tracker/complete` | Close the landed leg now (**Log now**) | 409 no leg, or not landed |
| DELETE | `/api/tracker/leg` | Discard the leg being flown | |
| PUT | `/api/tracker/casual` | `{on, drop_leg?}`: switch casual mode on or off → status; the state it is already in → status, unchanged | 400 `on` not true or false; 409 switching on while a bound fleet aircraft's leg is airborne and `drop_leg` is not true, with `{error, aircraft_id, name, origin, departed_at}` |
| DELETE | `/api/tracker/path` | Clear the casual path → status | |
| POST | `/api/tracker/sample` | Feed one synthetic sample | 403 unless the sim mode is the fake feed; 400 a required number missing |

While tracking is paused to bring in a logbook (The Sim Link, Pausing to bring in a logbook), every
route above that changes the tracker's state answers 409 `{"error": "Bringing in a logbook"}`; the
status, a pending leg in full and the event stream answer as usual.

Once the tracker has written its final checkpoint at shutdown (Checkpointing, At shutdown), the
routes for the pilot's actions — bind, log or discard a pending leg, **Log now**, discard the leg,
switch casual mode, and simbrief's import and removal of the current plan (`POST` and
`DELETE /api/tracker/briefing`) — answer 503 `{"error": "MSFS Career Map is shutting down"}`,
changing nothing; an import is turned down before the plan is fetched or stored. An import already
past that check when the final checkpoint is written — still waiting on SimBrief — checks again once
the plan has arrived and is answered the same 503, archiving nothing: the plan stays on SimBrief, to
be imported again at the next start. The 503 comes
ahead of the routes' own answers — validation, lookups, casual mode's 409 on an import, the
SimBrief fetch — but after what refuses the request itself: the 409 above while tracking is paused
to bring in a logbook, the server's request checks (app-shell, APP-API-011, APP-API-012) and a body
the server cannot read. Every other route answers as usual.

**Status** carries: the sim mode (`sim_mode`: `"link"`, `"fake"` or `"off"`, the values of the
`--sim` argument) and the host of a sim on another PC the link reaches (`sim_host`, a string,
null for a sim on this PC or no link); link connected and the sim's name; another server holding
the PC-wide sim-link claim (`link_holder`: `{holder, data_folder, text}` — `holder` `"installed"` or
`"source"` as the holder says, null when it does not say; `data_folder` its data folder, null when
it gives none; `text` the words for it — or null); in menus; paused; whether
liveries are supported; the sim aircraft (title, livery, ATC id) and the bound fleet aircraft; the
phase; the latest position (altitude, ground speed, heading, vertical speed, airspeed, fuel, on
ground, time); the leg (origin, departure, touchdown, point count, landings, and its statistics so
far as `stats` — fuel and weight at takeoff, fuel used, highest altitude and ground speed, distance
flown — in the shape a hop records them); the pending legs, each with its id and
whether it ended in the air, without its track; the current briefing; casual mode — when it was switched on and the path's point
count, or nothing while it is off; the last message and its time. The desktop shell's tray reads
its status line, dot and waiting-legs count from these fields.

**Event stream** ([routes.ts:457-474](../../../src/server/routes.ts#L457-L474)): on connect,
`status`, the leg's full `track` and the casual `path`; then `status` on every sample and change,
`point` for each recorded point, `track` when a leg starts or ends, `path` when casual mode
switches, the path is cleared or a new segment begins, `path-point` for each point added to the
last segment, `hop` when a leg is logged, `pending` when one is kept as pending, and a keep-alive
comment every 25 s. `path` is the whole casual path as a list of segments of track points, empty
while casual mode is off; sent for a new segment, it already holds that segment's first point. When
switching on drops a leg, `track` (now empty) goes before `path` (now holding the leg's track) and
`status` last.

`hop` carries `{hop, message}`: the logged hop's record, with its id, and the tracker's message for
it (LIVE-HOP-006). `pending` carries the pending leg as the status lists it: its id, sim aircraft,
reason and everything known, without its track. These are what the desktop shell's notifications
say and open.

**Reconnecting** ([client tracker.ts](../../../src/client/tracker.ts)). The page opens its event
stream again 3 s after it ends, for any reason: an EventSource that receives an error answer — such
as the 503 a server gives during its start-up work (app-shell) — closes for good rather than
retrying by itself. The server sends the full state again on every connect. On every reconnect
after the first the page also reloads the map and the lists (as LIVE-CARD-009 does, without the
toast), since a hop logged while it was away reached no page. Unlike a logged hop, a reconnect
leaves the planner's results and its hand-off to the hop form to the planner, which keeps them when
the reload brings no new hop (PLAN-RUN-006): a server restart is no reason to throw away a route
being planned. A server of another version — an update installed while a browser tab stayed open —
has the page reload itself instead (app-shell, APP-UI-036).

## The Live Card

The sidebar's **Live from the sim** card ([LivePanel.tsx](../../../src/client/components/LivePanel.tsx)),
collapsible; open on a first visit, then as the user left it (app-shell).

**Collapsed**, the card is a one-line status strip, so it can stay in view without taking room
from the planner: the status pill; the live aircraft's altitude, ground speed and heading while the
sim is connected and its position is known; "Leg waiting to be logged" in amber while a leg
waits; and the casual switch. Clicking the strip opens the card, except on the switch, which only
switches. **Open**, it shows:

- **Casual switch**, labelled "Casual", in the card's title row. Collapsed or open, the switch is in
  view whenever the app server is reachable, whatever the sim is doing, so casual mode is never on
  unseen; its label says what it is even when the pill reads "sim not running". On a narrow column
  the strip's position readout gives way to it.
  Switching it on asks for the confirmation above when the server calls for it; declining leaves
  casual mode off and the leg flying.
- **Status pill**: "no connection to the app server", "tracking off" (the sim mode is off),
  "linked to another copy" (another server holds the sim-link claim), "sim not running", "paused",
  "in menus", "casual", "airborne", "landed", "on the ground" or "connected", colored by state —
  green for connected and on the ground, blue for airborne and landed, amber for linked to another
  copy, paused and in menus, violet for casual, plain otherwise.
- **Sim aircraft**: title ("(no title yet)" while blank), livery and ATC id.
- **Fleet**: the bound aircraft, which highlights it on the map when clicked; or **Bind to…** with
  **Bind**, and **+ New** to create a fleet aircraft from what the sim reports (fleet).
- **Position**: altitude, ground speed and heading, with **Zoom** to fly the map to the aircraft.
- **Leg**: origin, takeoff time, points recorded, the badge of the first touchdown of the latest
  landing (flight-panel); **Profile** opens the
  live leg in the flight panel; **Log now** while landed; **Discard** after a confirmation.
- The SimBrief controls (simbrief).
- Hints: "This copy does not link to the sim. Start it with `npm run dev:sim` to track flights from
  MSFS." when the sim mode is off, which only a copy run from source can be; the status's words for
  another copy holding the link, with "Flights are logged there; this copy links once it lets go.";
  "Start MSFS and the tracker connects by itself…" when the sim is otherwise not connected;
  "Connected to X; waiting for the aircraft to load." when connected without an aircraft; "Linked
  to the sim on HOST: a copy of MSFS Career Map on that PC is not checked, so run only one." when
  the link reaches a sim on another PC; and "Waiting for the tracker…" before the first status.
- The tracker's last message with its time, and any error from an action.
- **Leg waiting to be logged**, one block per pending leg, oldest first: the sim aircraft, the
  reason, the takeoff time ("off HH:MM") and the touchdown time ("down HH:MM") — or, for a leg that
  ended in the air, the time it was last seen ("last seen HH:MM") — flight time and points; aircraft,
  From and To fields prefilled with what is known; **Profile** to open it in the flight panel;
  **Log hop** and **Discard** (confirmed: "Its recorded track will be lost."). A block shows "—" for
  anything its leg lacks: the card does not rely on the tracker's check at restore, and one leg
  missing a field must never fail the card and take every other leg's **Log hop** and **Discard**
  with it.

**In casual mode** the card leaves out the Fleet row and the Leg row, and adds:

- "Casual mode: the path you fly is drawn on the map and nothing is logged until you switch casual
  mode off, quit the app or close MSFS.", whether or not the sim is connected, in place of the
  not-connected hint. The words describe the installed app, the copy pilots fly; a copy run from
  source shows the same card, though stopping it leaves casual mode on (How long it lasts);
- **Path**: the number of points and the time casual mode was switched on, with **Clear**.

The sim aircraft, position, last message and pending legs show as usual. The SimBrief controls offer
no import; they show only a plan made current before casual mode was switched on, with **Remove**
(simbrief).

**Opening a pending leg from outside the card.** When the page is asked to show a pending leg —
the `#pending=<id>` hand-off that a click on the desktop shell's "Leg waiting to be logged"
notification makes — the live card opens if it is collapsed and brings that leg's block into view,
where it can be logged. App-shell owns the fragment, when it is acted on and the rest of the page's
answer to it; the flight panel shows the leg's profile (flight-panel).

When a leg is logged, the map and lists reload, planner results and any planner hand-off clear, and
a toast "Logged ORIG → DEST · time" shows for 8 s ([App.tsx:158-177](../../../src/client/App.tsx#L158-L177)).

## On the Map

The live aircraft is drawn on top of everything while the link is connected and a position is
known ([LiveLayer.tsx](../../../src/client/components/LiveLayer.tsx)): the bound aircraft's badge
(a white single-piston badge when unbound) with a heading pointer, and the leg's track in the
aircraft's color over a dark casing. Both are drawn on every world copy in view (MAP-GEO-014):
the aircraft at its own position, the track placed sample to sample (MAP-GEO-015). The tooltip reads "LIVE · name", altitude, ground speed, heading and "on
ground", and the leg's origin and point count.

In casual mode the casual path takes the leg track's place: each segment drawn in the live
aircraft's current color, **dashed**, over the same dark casing, placed sample to sample on every
world copy in view. The dashes tell at a glance that this path is not being logged. While a
position is known, the last segment runs on to the aircraft, so the line never trails behind it.
The path is drawn whenever it has points, connected or not; only the aircraft needs the link. The
tooltip reads "CASUAL · name" and the path's point count in place of the leg line.

## Development Tools

Both tools are run from the repository by a developer; neither is part of the installed app.

- **`npm run sim-fake -- ORIG DEST [options]`** ([sim-fake.ts](../../../scripts/sim-fake.ts)) flies a
  synthetic leg into a server on the fake feed (`TRACKER_FAKE=1` or `--sim=fake`, or a desktop build
  in test mode):
  20 s parked, taxi and takeoff roll, climb at 700 fpm, cruise, descent at 500 fpm, rollout, taxi
  and 45 s parked, posting one sample per virtual second. Options: `--speed` (virtual seconds per
  real second, 30), `--cruise` (150 kt), `--alt` (6,500 ft), `--title`, `--livery`, `--atc`,
  `--base` (the server's address, `http://127.0.0.1:3080` by default, since the server listens only
  on 127.0.0.1), `--touch-and-go`, `--start-airborne`, `--fpm` (180) and `--g` (1.4) for the
  touchdown. The two airports are the first two arguments that are not options or option values,
  wherever they appear, so `--base` can come first, as distribution's development example gives it
  ([sim-fake-args.ts](../../../scripts/sim-fake-args.ts), `parseSimFakeArgs`).
- **`npm run sim-probe`** prints what the sim reports each second and its events, without touching
  the database ([sim-probe.ts](../../../scripts/sim-probe.ts)). It uses the link module, not the
  server's tracking, so it neither takes nor checks the sim-link claim and runs beside a copy of the
  app that is linked to the sim.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Sim link vs logic | A thin SimConnect adapter feeding a sim-independent state machine | Logic inside the SimConnect handlers | The whole pipeline can be tested with a synthetic feed and no sim. |
| SimConnect library | node-simconnect, pure TypeScript | The SDK's native DLL | No native modules or SDK install; works with a sim on another PC. |
| Which copy links | The installed app by default; a copy run from source only with `--sim=link` (`npm run dev:sim`; the sim input, LIVE-LINK-013); never while another server holds the claim, and no copy takes it from another | The first copy to link wins; the installed app takes the link from a source copy; a source copy links by default | The HLD's choice: career flights never land in a development data folder by accident, and nothing has to hand the link from one copy to another. With both linking by default, every sim start would be a coin toss between two retry loops. |
| The claim's mechanism | A Windows named pipe the holder listens on | A named OS mutex; a lock file; a fixed TCP port | Pure Node, as the server has no native modules; every process on the PC sees the name; Windows lets one process listen and frees the name when that process ends, crash included; and the holder can say who it is. A mutex needs a native module; a lock file outlives a crash and needs a check of the process behind it; a port can be taken by an unrelated program. |
| A check of the claim that gets no answer | After 1 s, the claim counts as held by a holder that does not say who it is | Wait for an answer; count it free | A hung server still listens on the pipe and may still hold SimConnect; linking beside it could log a flight twice, while waiting would stall the retry loop for good. |
| A `SIMCONNECT_HOST` naming this PC | Counts as this PC: takes and checks the claim | Count every `SIMCONNECT_HOST` as another PC | A loopback address or the PC's own name reaches the same sim as no host at all, and would otherwise slip past the claim. |
| When the claim is held | From SimConnect opening until the connection ends or the link stops; no grace period | For the server's whole life; from the start of each attempt; kept reserved for a while after the holder's server ends | An idle copy whose sim is closed must not hold it, or the desktop shell would count the sim in use with MSFS closed and hold every update. A grace period would need a record outliving the process; with the opt-in, only a source copy the developer started on purpose can slip in during the installed server's restart, and its leg is then kept, not lost. |
| Checking before connecting | Check the claim before each attempt and open no SimConnect while it is held; close at once if the claim is lost between opening and taking it | Open every 10 s and close on finding the claim held | The sim does not see a second client come and go every 10 s; the rare race is still settled by the pipe. |
| Where the claim lives | In the server's tracking, around the link | In the link module | `sim-probe` uses the link module and must run beside a linked app, neither taking the claim (which would stop the app logging the flight being probed) nor waiting on it. |
| A link to a sim on another PC | Takes and checks no claim; the live card says the other PC's own copy is not checked | Take this PC's claim anyway | A claim on this PC says nothing about the other PC, whose copy cannot see it. Only a copy run from source can link to another PC. |
| The fake feed and the claim | Never taken, checked or reported | Treat a fake-feed server like a link | A test copy beside the installed app must neither keep it off a real flight nor stop following its own samples. |
| Stopping the link at shutdown | Marked stopping first, so nothing reaches the tracker | Treat it as a disconnect | A shutdown is the app's own doing, not the sim's; as a disconnect, every Quit, update or sign-out would turn the leg in the air into a pending leg and close a taxiing leg at the runway exit. |
| Tracking while a logbook is brought in | Paused: the link stopped, no sample or event taken, every change refused with 409; resumed as it was when the import fails before its answer | Keep tracking until the restart; stop tracking with no way back | A change made after the merged checkpoint is written would land only in the logbook being replaced and be lost; a failed import must leave tracking running, not dead until the next start. |
| Errors in one sample or event | Written out; the next goes on as usual | Let the error end the server | The desktop shell would restart the server straight into the same checkpoint and sample until it gives up mid-flight. |
| A record the link cannot read | Dropped, the connection kept; the first such record of each data definition on a connection written out in full, later ones counted and the count written out when the connection ends or the link stops | Let the error end the server; write out every failure; write out only the first per connection | An uncaught error would end the server, and the desktop shell would restart it into the same record. A short record repeats with every record of its definition, the per-frame one at the sim's frame rate, so a line for each would flood the server's log; one per definition keeps the cause of each, and the count shows whether the failure went on. |
| Livery not yet read after connecting | The link holds samples until the livery is read or rejected, at most 5 s, then passes them on with it | The tracker ignores a blank livery for a while after connecting; samples marked "livery unknown"; drop samples until the livery arrives | The blank is the link's artifact, so the link hides it and the tracker keeps one rule: a sample's livery is the livery. Holding loses no sample; the 5 s limit keeps a sim that never answers from stopping tracking. |
| Takeoff | On-ground flag off for 5 s | The first airborne sample | Bounces on the takeoff roll do not start legs. |
| End of a leg | Below 5 kt for 30 s after landing | At touchdown; at engine shutdown | A touch-and-go stays inside one hop, and the destination is where the aircraft actually stopped. |
| Naming airports | Nearest within 5 nm of the last ground point and of the stop point, with a class handicap | Ask every time; the SimBrief plan's airports | Correct almost always without input; a miss becomes a pending leg or a correction (logbook). |
| Near-tie at takeoff | Prefer the aircraft's parked airport when it ranks within 1 nm of the nearest | Nearest always; 0.5 nm; 2 nm | A career aircraft departs where it last landed; two close fields can otherwise swap. 1 nm covers a reference point a mile from the runway end without overriding a clearly nearer field. |
| Flight time | Takeoff to last touchdown, less time paused | Wall-clock elapsed | A pause mid-flight is not flying; the logbook should not grow by a dinner break. |
| Measuring a pause | The gap between the last sample before it and the first after it | The wall-clock time between the sim's Pause events | The timers and the flight time run on sample times, which a test can drive; the events carry no time of their own. The second or so of flying on either side that the gap includes is lost in whole minutes. |
| A leg under a minute | Judged on the flight time to the second | Judged on the rounded flight time | Rounding would keep legs of 30–59 s, which are bounces, not flights. |
| Reading the sim's clock | In a data definition of its own, the latest reading moved on to each sample by the time since it arrived | In the once-a-second position definition | As for the livery: a sim that rejects a clock variable loses only the sim-clock times, not every position record. |
| Time the PC sleeps | Counted like any gap between samples | Leave out every gap longer than a few seconds | The tracker cannot tell a sleep from a server restart during which the sim flew on, which is real flying; a PC put to sleep mid-flight is rare. |
| Landing measurement | Frame-rate watcher, with a provisional landing from 1 Hz data replaced within 6 s | 1 Hz only; the sim's touchdown velocity only | Frame data catches the real touchdown rate and G spike; the provisional landing keeps the fake feed and missed frames working. The sim's own figure is kept for comparison with other monitors. |
| Rating | Worse of descent-rate and peak-G classes | Descent rate only | A gentle descent with a hard G spike is still a hard landing. |
| Touchdown in the "Logged" message | The first touchdown of the final landing, with flight-panel's bounce rule repeated in the tracker | The last touchdown; a module shared by server and browser | The message names the rating the hop's badge shows. Server and browser share no code, and the rule is a few lines with one constant. |
| Interrupted legs | Landed: close where it stopped, on every interruption — a disconnect, another aircraft, a new flight, a position jump. Airborne: keep as pending after a disconnect; discard after an aircraft change, new flight or position jump | Discard every airborne leg; keep every airborne leg; discard a landed leg on a new flight or a jump, as an airborne one | A landed leg is a finished flight, whatever the pilot does next. A disconnect is usually a crash, and keeping the leg costs one click to discard while covering cases nobody anticipated; the other interruptions are the user's own choice. |
| A measured touchdown at a landed leg's interruption | Recorded on the leg when it comes with the jumping sample, at the last position before the jump; lost when it would come after a new flight loads, the hop keeping the provisional landing | Hold a leg closed by a new flight open for up to 6 s to wait for the touchdown | The touchdown rides on the next once-a-second sample, which a jump makes the interrupting one, so it is at hand as the leg closes. A new flight loads with no sample to wait for, and holding the leg open would leave a finished flight half-closed across the load for the sake of a measured rate and G, where the provisional landing already gives a rate from the once-a-second data. |
| A leg restored in the air | Continues only when the sim's first sample shows the same aircraft, airborne, within the jump bound; otherwise — the connection ending before that sample included — kept as a pending leg ending at its last sample, with the reason "MSFS Career Map stopped in flight and the sim did not resume it" | Continue on whatever comes next; discard it on a new flight, another aircraft or a jump, as a live leg would be; on a connection ending before the first sample, keep it with "the sim disconnected in flight", or hold it until the next connection's first sample | The app usually stops together with the sim — a Windows restart, a sign-out, a crash — so the next sample is often a new session. Continuing would log a hop spanning the night, rated from a sample hours old; discarding would lose the flight. A pending leg costs one click when it was not wanted. A connection that ends before the first sample — MSFS started to its menu and quit — did not stop the flight; the reason says what did. MSFS cannot resume a flight across its own restart, so holding the leg longer would only leave it counted as in progress. |
| Unknown details | Park the leg as pending with the reason | Log with guesses; drop | The user decides; nothing is guessed into the logbook. |
| Pending legs | A list, each logged or discarded on its own | One slot, newest wins | No flown leg is lost because an earlier one is still waiting. |
| Pending-leg ids | A random UUID per leg, kept in the checkpoint | A counter; the time of keeping | A counter starts again when a backup is restored and clashes with a brought-in logbook's; a notification left in Windows' notification centre must name its leg or nothing. A UUID is built into Node and needs no clock. |
| A pending leg that ended in the air | Marked by the tracker (`ended_in_air`), carried in the status, the `pending` event, the leg in full and the checkpoint; the card shows "last seen" for its end time. A leg saved without the mark reads as ended in the air only with one of the two in-the-air reasons | Infer it on the page from empty landings, a missing destination or the reason text; label every end time "down" | Touch-and-goes leave landings on a leg that still ends in the air, a leg stopped away from any airport has no destination yet landed, and reasons are words that can change. A touchdown time on a leg that never came down misleads the pilot filling in where it ended. Only legs kept in the air carry those two reasons, so the rule for older legs never mislabels one that landed. |
| Binding | Title + livery, blank livery meaning any, remembered on the fleet row | Match by title only; choose every flight | Different liveries of one model are different career aircraft; binding once is enough. |
| Checkpointing | Whole state to one row, every 5 s and at once on a takeoff, a touchdown, a landing recorded or replaced, a leg closed or discarded, and a change of binding, briefing, pending legs or casual mode | Memory only; every 5 s alone | A server restart mid-flight loses a few seconds of track at most, never a phase change or a measured landing; one row write per touchdown costs nothing. |
| A hop and its checkpoint | One SQLite transaction | Two writes | A server ended between them would either log the flight twice at the next start or lose it. |
| Saving on request | Writes the state and changes nothing else | Saving as a shutdown would | Windows can call a sign-out off, and a PC resumes from sleep; tracking must then go on as it was. |
| The pilot's actions after the final checkpoint | Turned down by the tracker and answered 503 "MSFS Career Map is shutting down" until the server exits | Let them through; make the checkpoint write do nothing once the final one is written; stop listening before the final checkpoint | Let through, a switch to casual mode would be saved after the final checkpoint and be on again at the next start. A write that does nothing would log a pending leg's hop without the checkpoint that drops the leg, and log it again at the next start. Requests already accepted on open connections still arrive after a listener stops, and the shutdown order keeps listening until the event streams close (app-shell). |
| A SimBrief import under way when the final checkpoint is written | Checks again once SimBrief has answered: answered 503 like any action after the final checkpoint, and nothing archived | Archive the fetched plan and refuse only making it the current plan | Nothing is lost either way, since the plan stays on SimBrief and is imported again at the next start. Archiving it would write a briefing after the final checkpoint that neither a hop nor the current plan points at, while the pilot is told the import failed. |
| A pilot's action whose save fails | Answered 500 and written out; the checkpoint left as it was, the tracker's memory ahead of it until the next save; a pending leg's discard writes the checkpoint before deleting its plan | One transaction per action, with the tracker's memory put back when it fails | Only logging a hop can lose or double a flight when its writes part, and it is one transaction already. For every other action the worst a failed save leaves is a change undone by a restart or a plan row nothing reads, after a failure (a full disk, a locked logbook) that stops much else too; a snapshot and restore in each action is more to get wrong than that is worth. |
| What cannot be read at restore | The smallest part set aside in its own table and written out, the rest restored and saved at once: a damaged pending leg alone; a damaged leg in progress alone, tracking starting from idle; the whole checkpoint only when it is not a JSON object, its phase is missing or unknown, or another of its own fields has a type this version cannot read | Fail the start; drop what cannot be read; set the whole checkpoint aside for any damage; read a damaged pending leg with defaults; judge a leg's track and landings as lists only, or drop the points and touchdowns that are not ones | Failing would stop tracking at every start until the desktop shell gives up; dropping would lose flights that can still be recovered by hand. Setting the whole checkpoint aside for one bad leg would hide every good waiting leg with it. Defaults would list a leg with no takeoff time or aircraft, and log a hop with made-up times. A point that is not one makes a leg's first point look like the menu position, dropping the flight, or makes every close of the leg throw, and a touchdown that is not one makes logging the leg fail; dropping those entries would log a hop from a track or landings changed by a guess. |
| A pending leg missing fields on the card | Each block shows "—" for what its leg lacks | Trust the tracker's check at restore | One leg the card cannot draw would fail the whole card, every other leg's **Log hop** and **Discard** with it; the card is the only place to log or discard a waiting leg. |
| Checkpoint fields this version does not know | Ignored, and kept unchanged in every save | Set the checkpoint aside as unreadable; drop them at the next save | An older version run over a newer logbook (an older installer run by hand) must neither hide the newer version's pending legs nor strip what the newer version reads when it comes back. |
| Bringing in a logbook | This PC's leg in progress, briefing and pending legs kept with their plans copied and their aircraft cleared, the source's pending legs added, the source's leg in progress kept as pending with its aircraft and briefing, the binding looked up again; refused when the source's checkpoint cannot be read as a whole; a source leg that cannot be read set aside in the copy | Keep only this PC's state; keep only the source's; carry ids from the replaced logbook; drop the source's current briefing | Nothing flown on either side is lost, the source's last flight keeps its plan, and no id points into the logbook that was replaced — the next leg would otherwise be logged to whichever aircraft has that id in the brought-in logbook. |
| Live updates | Server-sent events, full state resent on every connect, the page reopening the stream itself | Polling; WebSockets; EventSource's own reconnect alone | One-way updates. An EventSource closes for good on an error answer, such as the 503 of a server still starting, so the page reopens it. |
| Catching up after a reconnect | The page reloads the map and lists, leaving the planner's results to the planner (PLAN-RUN-006); a server of another version has the page reload itself (app-shell) | Replay missed events; a banner asking to reload; clear the planner as for a logged hop | The server keeps no event history, and a reload shows any hop logged meanwhile. A server restart is no reason to throw away a route being planned. |
| Hop and pending events | `hop` carries the hop with its id and the tracker's message; `pending` carries the leg as the status lists it, with its id | The bare hop; the leg with its track | The desktop shell's notifications show the tracker's own words and open the hop or leg by id, without reading the logbook. |
| Status words for another copy holding the link | Written by the tracker, shown by both the live card and the tray | The tray writes its own | The tray and the card always say the same thing. |
| Menu position | Ignore samples near 0°, 0° | Treat as real | The sim reports the aircraft "airborne" there in menus. |
| Casual mode | A tracker switch that suspends leg detection and keeps a path in server memory | Turn tracking off (the sim mode off); a throwaway fleet aircraft; discard each leg by hand; the path kept by the browser; discard each finished leg automatically | One switch from the card, nothing written to the logbook. Held by the server, the path survives a page reload and is the same in every window or tab; discarding finished legs would lose the path at every full stop. |
| How long casual mode lasts | The switch is kept with the checkpoint, so the server's own restarts keep it; it ends when switched off, when the app quits (its shutdown for quitting, and the first server start of each run), and when MSFS closes normally; the path is never saved | Off at every server start; ended only by the switch; off at every server start, with legs held as pending until the switch is touched | The desktop shell restarts a failed server unseen, so turning casual mode off at every server start would log a casual flight's next landing as a career hop. Ending it with the app and with a clean MSFS quit keeps a new run or sim session from starting with logging off from the night before; a sim crash does not end it, since the pilot usually flies on in the same casual session. The path is throwaway by intent. |
| The first server start of a run | Starts with casual mode off on the fresh-run input, and saves that at once | Rely on the shutdown alone | A Windows session end can cut the shutdown short, and a desktop shell that crashes takes its server with it with no shutdown at all, either leaving casual mode saved on. |
| Switching on mid-leg | Landed: close and log as usual. Airborne in a bound aircraft: drop only after confirming. Airborne unbound: drop. A dropped leg's track starts the path | Always drop; always ask; keep every leg as pending | A landed leg is a finished flight, closed as for any other interruption. An airborne leg in a bound aircraft is a career flight that a slip of the switch would lose. An unbound aircraft's leg would only wait as pending, and flying it is already outside the career. Keeping the track on the map loses nothing the pilot can see. |
| Where the confirmation is enforced | The server refuses with 409 unless told to drop the leg; the card asks and retries | A confirm in the card only | The server decides, the page shows; a leg that took off after the card's last status is protected too. |
| Path breaks | A new segment after a position jump, a new flight or a disconnect | One unbroken line; clear the path at a jump | No line across a slew or a new flight; the earlier parts of a session stay. |
| Look of the casual path | Dashed, in the live aircraft's color | Solid like a leg track; always white | Tells a path that is not being logged from a leg that is, without hiding which aircraft is flying. |
| Switching off | Drops the path | Keep it on the map until cleared | The path belongs to casual mode; nothing is left drawn beside career tracks and legs. |
| Keeping casual mode in view | The switch sits in the collapsed strip as well as the open card, in every sim state | The status pill alone; switch casual mode off when the sim disconnects | The pill gives way to "sim not running", "paused" and "in menus", so casual mode could be on unseen at the start of a career session. Switching off at every disconnect would also end the session, and lose the path, at every sim crash. |
| SimBrief plans in casual mode | No import while casual mode is on; a plan already current stays, with **Remove** | Import as usual; drop, on switching off, a plan imported in casual mode | A plan imported for a casual flight would otherwise wait for the next career leg and be filed with it. Recorded here, where casual mode lives; the simbrief controls carry the obligation (SB-CUR-004, SB-CTRL-001 to 003). |
| Points while standing still | None while on the ground below 1 kt; no cap on the path | A point every 5 s regardless; a cap on the point count | A sim left parked would otherwise grow the path for nothing; a flown path grows by at most 720 points an hour, small enough to keep and resend whole. |

## Open Questions & Future Decisions

### Open

1. **An airborne start that passes for a resumed flight.** When the link first connects only after
   the pilot has loaded a new flight that starts in the air in the same aircraft, within the jump
   bound of a restored leg's last sample, the restored leg continues across the gap and its hop
   spans both sessions. The sim's own clock (LIVE-LINK-008) or its flight file could tell them
   apart.
2. **A connection lost in flight without the sim quitting** (a SimConnect fault, a resume from
   sleep) keeps the leg as pending at once (LIVE-LEG-008), and the rest of the flight becomes a
   second pending leg. Holding the leg until the next sample decides, as for a restored leg
   (LIVE-LEG-016), would keep such a flight whole.
3. **A restored leg waiting for the sim** reads as a leg in the air — on the tray, at Quit, and
   holding the desktop shell's quiet-moment updates — until MSFS next runs.
4. **A checkpoint, leg or pending leg set aside** waits in `tracker_state_aside` for recovery by
   hand, even once a version that can read it runs again, and only the server's log says it was set
   aside. A later start could restore a pending leg it can read, or a whole checkpoint while the
   current one holds no leg in progress and no pending legs, and the live card could say that
   something was set aside.

### Resolved

*(none yet)*

### Deferred

1. **Two fleet rows with the same title and livery** — the older wins silently; binding one does
   not unbind the other.
2. **Wall-clock stamps** — samples are stamped on arrival, so a stalled link compresses or stretches
   the recorded timing; the sim's own time would not.
3. **Touchdowns in casual mode** are neither measured nor rated; a rating would suit casual
   flying, but nothing would keep it.
4. **A profile of the casual path** — the flight panel shows only legs.

## References

- Code: [src/server/simconnect.ts](../../../src/server/simconnect.ts),
  [src/server/tracker.ts](../../../src/server/tracker.ts), [src/server/tracking.ts](../../../src/server/tracking.ts)
  (`startTracking`: the sim mode, the link wired to the tracker, the sim-link claim as its gate),
  [src/server/sim-link-claim.ts](../../../src/server/sim-link-claim.ts) (the claim's pipe, check and answer),
  [src/server/this-pc.ts](../../../src/server/this-pc.ts) (`isThisPc`), [src/server/routes.ts](../../../src/server/routes.ts) (live tracker 446-628),
  [src/client/tracker.ts](../../../src/client/tracker.ts) (`useTracker`; `parseTrack` is shared with
  tour-map and flight-panel), [src/client/components/LivePanel.tsx](../../../src/client/components/LivePanel.tsx)
  (all but `SimbriefControls`), [src/client/components/LiveLayer.tsx](../../../src/client/components/LiveLayer.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (tracker stream, logged-hop handling, toast,
  zoom to the live aircraft), [scripts/sim-fake.ts](../../../scripts/sim-fake.ts),
  [scripts/sim-probe.ts](../../../scripts/sim-probe.ts)
- External: SimConnect via node-simconnect; Windows named pipes (through Node's `net`)
- Consumers: logbook (hops it writes), flight-panel (live leg, landings, statistics; a hop's takeoff
  time exactly as the status gave it, LIVE-HOP-001, LIVE-HOP-004), app-shell (the sim input,
  LIVE-LINK-012, LIVE-LINK-013; the live card's part of the `#pending=` hand-off, LIVE-CARD-015),
  planner (logged hop clears results), simbrief (current briefing), airports (leg in progress), desktop shell
  (status and event stream for the tray, notifications, the sim in use and quiet-moment updates;
  the sim-link claim; casual mode's lifetime; saving on request), distribution (the first release
  waits for LIVE-HOP-003, LIVE-LEG-008 and LIVE-LEG-016; the fake feed beside an installed app;
  `sim-fake`'s arguments)
