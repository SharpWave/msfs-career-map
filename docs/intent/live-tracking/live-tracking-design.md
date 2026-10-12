---
parent: high-level-design
prefix: LIVE
---

# Live Tracking

## Context and Design Philosophy

Live tracking turns flying in the sim into logbook hops without typing: the app watches the
sim, notices a takeoff and a landing, names the airports, measures the landing, records the
flown track, and logs the leg against the right fleet aircraft. When it cannot work something
out — an unknown sim aircraft, no airport where the wheels left or stopped — it keeps the leg
for the user to finish rather than guessing.

The design splits the sim from the logic. [simconnect.ts](../../../src/server/simconnect.ts) is
a thin SimConnect adapter that only produces position samples and system events.
[tracker.ts](../../../src/server/tracker.ts) is a sim-independent state machine fed one sample at
a time, so a synthetic feed (`npm run sim-fake`) can drive the whole pipeline without the sim.
The tracker checkpoints itself to the database, so a server restart mid-flight loses nothing.

This segment owns:

- the sim link — connection, the samples and events it reads, the frame-rate touchdown watcher;
- the tracker — leg phases, takeoff and stop detection, airport naming, touch-and-go, landing
  measurement and rating, the recorded track and flight statistics, checkpointing;
- binding a sim aircraft to a fleet row, and logging or parking a finished leg;
- casual mode — flying with the path drawn on the map and nothing logged;
- the tracker API and event stream (`/api/tracker*`);
- the **Live from the sim** card, the live aircraft, track and casual path on the map, and the
  "Logged" toast;
- the test tools `sim-fake` and `sim-probe`.

It relies on: fleet for the sim-binding fields and create-from-sim (FLEET-SIM); airports for
nearest-airport naming (APT-NEAR) and code resolution; logbook for the hop record it writes and
the parked position (LOG-SEQ-008); tour-map for placing the live aircraft and track and drawing them on every world copy in view;
simbrief for the briefing a leg carries; flight-panel for showing the live leg's profile and for
mapping a landing rating to its icon, word and color.

## The Sim Link

[simconnect.ts](../../../src/server/simconnect.ts) connects to the sim and retries every 10 s
while it is not running, logging only the first failure. `SIMCONNECT_HOST` / `SIMCONNECT_PORT`
reach a sim on another PC. With `TRACKER_FAKE=1` the link is not started and the tracker takes
samples from `POST /api/tracker/sample`; with `TRACKER=0` tracking is off
([index.ts:12-44](../../../src/server/index.ts#L12-L44)).

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

**Events**: Pause, Sim (false while in menus or loading) and FlightLoaded, plus quit, close and
error, each of which ends the connection and starts retrying.

**Sim-clock times** are intended: the link is also to read the sim's zulu date and time, so each
leg records its takeoff and touchdown on the sim's clock as well as the real one (logbook,
LOG-REC-002). Today only wall-clock times are recorded.

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
mile apart. Today the nearest always wins.

**Started in the air.** If tracking begins with the aircraft already airborne, a leg starts with
no origin.

**Landing.** When the on-ground flag comes on in flight, the leg is landed and its touchdown time
is set. A landing is recorded (below). If the aircraft leaves the ground again — a touch-and-go —
the same leg continues and the next touchdown replaces the touchdown time.

**Stop.** Once landed, the leg closes when ground speed has stayed under 5 kt for 30 s. Its
destination is the airport nearest the stop position, within 5 nm. **Log now** closes a landed
leg at once, for a sim that froze or was left after touchdown.

**Interruptions** ([tracker.ts:438-471](../../../src/server/tracker.ts#L438-L471), [633-664](../../../src/server/tracker.ts#L633-L664)):

| Event | Leg airborne | Leg landed |
|---|---|---|
| Sim disconnects | Kept as a pending leg ending at the last sample, destination blank (intended; today discarded) | Closed at the last sample |
| A different sim aircraft or livery | Discarded | Closed at the last sample |
| A new flight is loaded | Discarded | Closed at the last sample (intended; today nothing happens, see below) |
| Position jumps more than 50 nm + 700 kt × the time since the last sample | Discarded | Closed at the last sample before the jump (intended; today discarded) |

A landed leg is the user's flight already done, so every interruption is meant to close it where
it stopped rather than lose it. Today a new flight loaded after landing leaves the leg open, and
the next position either reads as a jump, which discards it, or — when the new flight is near
enough — closes it at the wrong airport.

A disconnect in flight is usually a sim crash, not a choice, so the leg is kept for the user to
finish or discard rather than thrown away. Changing aircraft, loading a new flight or slewing
away are the user's own doing, and the airborne leg is discarded.

**Changing aircraft.** When the sim's title or livery changes, the tracker looks up the binding
for the new pair. Since the link passes on no sample before it has read the livery (Livery first,
above), the first sample after a connection carries the real livery, so neither a leg restored
after a server restart nor one started in the air is mistaken for an aircraft change.

**Too short.** A leg is meant to be dropped when its flight time (below) is under a minute. Today
the check uses the rounded duration, so legs of 30–59 s are kept
([tracker.ts:866-871](../../../src/server/tracker.ts#L866-L871)). A dropped leg leaves the current
SimBrief briefing for the next leg.

**Pauses.** Time the sim spends paused does not count: not toward the 5 s takeoff confirmation or
the 30 s stop, and not toward flight time. Today all three use wall-clock time, so a long pause
counts in full and a stop timer running before a pause can fire on the first sample after it.

## Landings

Each touchdown in a leg becomes a landing: time, descent rate (fpm, positive down), peak G,
airspeed, the sim's own touchdown rate, pitch, bank, position, rating and source
([tracker.ts:805-847](../../../src/server/tracker.ts#L805-L847)).

- **Provisional** ("samples"): when the once-a-second data shows the wheels down, the descent rate
  and airspeed come from the last airborne sample and G is unknown.
- **Measured** ("frames"): when the frame watcher's touchdown arrives, it replaces a provisional
  landing from within 6 s, or is added as a new landing. With the fake feed the measured numbers
  come from the script.

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
- **Times**: departure at takeoff and arrival at the last touchdown, on the real-world clock (and,
  intended, the sim's); flight time as the whole minutes between them less any time paused. For a
  leg kept after a disconnect in flight, the arrival is the last sample.
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
it. Otherwise it becomes a **pending leg**, with the reason: no fleet aircraft bound (including one
deleted during the flight), departure unknown, no airport within 5 nm of the stop, or the sim
disconnected in flight. From the card the user picks the aircraft and airports the tracker lacked
and logs it, or discards it.

**Pending legs** wait in a list, oldest first, each logged or discarded on its own; a new one never
displaces another. Today only one can wait: a second replaces the first, losing it and leaving its
briefing archived but attached to nothing ([tracker.ts:913](../../../src/server/tracker.ts#L913)).

**Checkpointing** ([tracker.ts:240-282](../../../src/server/tracker.ts#L240-L282), [926-931](../../../src/server/tracker.ts#L926-L931)).
The whole tracker state — phase, sim aircraft, binding, the leg in progress, the pending legs, the
current briefing, recent samples, timers and the last message — is saved to the single
`tracker_state` row at most every 5 s and at once on every event, and reloaded at startup. A
restored leg that began at the menu position is dropped; one saved by an older version gains the
fields it lacks. Casual mode and its path are not part of the saved state.

**Leg in progress.** The tracker's status says whether a leg is being flown; the monthly airport
refresh waits on it (airports, APT-DATA-004).

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
sim disconnecting — makes the next point begin a new segment. No line is therefore drawn across a
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
leg in progress stay as they are. A second browser tab acting on a stale status therefore cannot
reset the path.

The tracker reports "Casual mode on: nothing is logged" — with "; dropped the leg from ORIG" when
it dropped one — and "Casual mode off: takeoffs and landings are logged again".

**Server start.** Casual mode is off whenever the server starts. A casual session left running
across a restart therefore falls back to recording — at worst a pending leg to discard — rather
than a career flight going unrecorded because casual mode was forgotten. While the server stays
up, the card keeps the switch in view in every state (below) for the same reason.

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
| POST | `/api/tracker/sample` | Feed one synthetic sample | 403 unless `TRACKER_FAKE=1`; 400 a required number missing |

The per-leg pending routes are intended; today `POST` and `DELETE /api/tracker/pending` act on the
single pending leg, `POST` answers 400 when there is none, and a pending leg's track cannot be
fetched at all.

**Status** carries: link connected and the sim's name; in menus; paused; whether liveries are
supported; the sim aircraft (title, livery, ATC id) and the bound fleet aircraft; the phase; the
latest position (altitude, ground speed, heading, vertical speed, airspeed, fuel, on ground,
time); the leg (origin, departure, touchdown, point count, landings, and its statistics so far —
fuel and weight at takeoff, fuel used, highest altitude and ground speed, distance flown — of
which only fuel used and highest altitude are sent today); the pending legs, each with its id and without its track; the current briefing; casual
mode — when it was switched on and the path's point count, or nothing while it is off; the last
message and its time.

**Event stream** ([routes.ts:449-472](../../../src/server/routes.ts#L449-L472)): on connect,
`status`, the leg's full `track` and the casual `path`; then `status` on every sample and change,
`point` for each recorded point, `track` when a leg starts or ends, `path` when casual mode
switches, the path is cleared or a new segment begins, `path-point` for each point added to the
last segment, `hop` when a leg is logged, `pending` when one needs details, and a keep-alive every
25 s. `path` is the whole casual path as a list of segments of track points, empty while casual
mode is off; sent for a new segment, it already holds that segment's first point. When switching
on drops a leg, `track` (now empty) goes before `path` (now holding the leg's track) and `status`
last. The browser reconnects by itself and receives the
full state again ([client tracker.ts](../../../src/client/tracker.ts)).

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
- **Status pill**: "no connection to the app server", "sim not running", "paused", "in menus",
  "casual", "airborne", "landed", "on the ground" or "connected", colored by state — green for
  connected and on the ground, blue for airborne and landed, amber for paused and in menus, violet
  for casual, plain otherwise.
- **Sim aircraft**: title ("(no title yet)" while blank), livery and ATC id.
- **Fleet**: the bound aircraft, which highlights it on the map when clicked; or **Bind to…** with
  **Bind**, and **+ New** to create a fleet aircraft from what the sim reports (fleet).
- **Position**: altitude, ground speed and heading, with **Zoom** to fly the map to the aircraft.
- **Leg**: origin, takeoff time, points recorded, the latest landing's badge; **Profile** opens the
  live leg in the flight panel; **Log now** while landed; **Discard** after a confirmation.
- The SimBrief controls (simbrief).
- Hints when not connected ("Start MSFS and the tracker connects by itself…"), connected without
  an aircraft ("Connected to X; waiting for the aircraft to load."), or before the first status.
- The tracker's last message with its time, and any error from an action.
- **Leg waiting to be logged**, one block per pending leg, oldest first: the sim aircraft, the
  reason, takeoff and touchdown times, flight time and points; aircraft, From and To fields
  prefilled with what is known; **Profile** to open it in the flight panel; **Log hop** and
  **Discard** (confirmed: "Its recorded track will be lost.").

**In casual mode** the card leaves out the Fleet row and the Leg row, and adds:

- "Casual mode: the path you fly is drawn on the map and nothing is logged. Switching casual mode
  off, or stopping the app, clears it.", whether or not the sim is connected, in place of the
  not-connected hint;
- **Path**: the number of points and the time casual mode was switched on, with **Clear**.

The sim aircraft, position, last message and pending legs show as usual. The SimBrief controls offer
no import; they show only a plan made current before casual mode was switched on, with **Remove**
(simbrief).

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

## Test Tools

- **`npm run sim-fake -- ORIG DEST [options]`** ([sim-fake.ts](../../../scripts/sim-fake.ts)) flies a
  synthetic leg into a server started with `TRACKER_FAKE=1`: 20 s parked, taxi and takeoff roll,
  climb at 700 fpm, cruise, descent at 500 fpm, rollout, taxi and 45 s parked, posting one sample
  per virtual second. Options: `--speed` (virtual seconds per real second, 30), `--cruise` (150 kt),
  `--alt` (6,500 ft), `--title`, `--livery`, `--atc`, `--base`, `--touch-and-go`,
  `--start-airborne`, `--fpm` (180) and `--g` (1.4) for the touchdown. The two airports are meant
  to be the first two arguments that are not options or option values, wherever they appear;
  today a value after an option is taken for an airport when options come first
  ([sim-fake.ts:20](../../../scripts/sim-fake.ts#L20)).
- **`npm run sim-probe`** prints what the sim reports each second and its events, without touching
  the database ([sim-probe.ts](../../../scripts/sim-probe.ts)).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Sim link vs logic | A thin SimConnect adapter feeding a sim-independent state machine | Logic inside the SimConnect handlers | The whole pipeline can be tested with a synthetic feed and no sim. |
| SimConnect library | node-simconnect, pure TypeScript | The SDK's native DLL | No native modules or SDK install; works with a sim on another PC. |
| Livery not yet read after connecting | The link holds samples until the livery is read or rejected, at most 5 s, then passes them on with it | The tracker ignores a blank livery for a while after connecting; samples marked "livery unknown"; drop samples until the livery arrives | The blank is the link's artifact, so the link hides it and the tracker keeps one rule: a sample's livery is the livery. Holding loses no sample; the 5 s limit keeps a sim that never answers from stopping tracking. |
| Takeoff | On-ground flag off for 5 s | The first airborne sample | Bounces on the takeoff roll do not start legs. |
| End of a leg | Below 5 kt for 30 s after landing | At touchdown; at engine shutdown | A touch-and-go stays inside one hop, and the destination is where the aircraft actually stopped. |
| Naming airports | Nearest within 5 nm of the last ground point and of the stop point, with a class handicap | Ask every time; the SimBrief plan's airports | Correct almost always without input; a miss becomes a pending leg or a correction (logbook). |
| Near-tie at takeoff | Prefer the aircraft's parked airport when it ranks within 1 nm of the nearest | Nearest always; 0.5 nm; 2 nm | A career aircraft departs where it last landed; two close fields can otherwise swap. 1 nm covers a reference point a mile from the runway end without overriding a clearly nearer field. |
| Flight time | Takeoff to last touchdown, less time paused | Wall-clock elapsed | A pause mid-flight is not flying; the logbook should not grow by a dinner break. |
| Landing measurement | Frame-rate watcher, with a provisional landing from 1 Hz data replaced within 6 s | 1 Hz only; the sim's touchdown velocity only | Frame data catches the real touchdown rate and G spike; the provisional landing keeps the fake feed and missed frames working. The sim's own figure is kept for comparison with other monitors. |
| Rating | Worse of descent-rate and peak-G classes | Descent rate only | A gentle descent with a hard G spike is still a hard landing. |
| Interrupted legs | Landed: close where it stopped. Airborne: keep as pending after a disconnect; discard after an aircraft change, new flight or position jump | Discard every airborne leg; keep every airborne leg | A landed leg is a finished flight. A disconnect is usually a crash, and keeping the leg costs one click to discard while covering cases nobody anticipated; the other interruptions are the user's own choice. |
| Unknown details | Park the leg as pending with the reason | Log with guesses; drop | The user decides; nothing is guessed into the logbook. |
| Pending legs | A list, each logged or discarded on its own | One slot, newest wins | No flown leg is lost because an earlier one is still waiting. |
| Binding | Title + livery, blank livery meaning any, remembered on the fleet row | Match by title only; choose every flight | Different liveries of one model are different career aircraft; binding once is enough. |
| Checkpointing | Whole state to one row, every 5 s and on each event | Memory only | A server restart mid-flight loses nothing. |
| Live updates | Server-sent events, full state resent on reconnect | Polling; WebSockets | One-way updates; the browser reconnects by itself. |
| Menu position | Ignore samples near 0°, 0° | Treat as real | The sim reports the aircraft "airborne" there in menus. |
| Casual mode | A tracker switch that suspends leg detection and keeps a path in server memory | Turn tracking off (`TRACKER=0`); a throwaway fleet aircraft; discard each leg by hand; the path kept by the browser; discard each finished leg automatically | One switch from the card, nothing written anywhere. Held by the server, the path survives a page reload and is the same in every tab; discarding finished legs would lose the path at every full stop. |
| Casual mode at server start | Always off; the path is never saved | Restored from the checkpoint with or without its path | A forgotten casual session falls back to recording — a pending leg to discard at worst — rather than a career flight going unrecorded. The path is throwaway by intent. |
| Switching on mid-leg | Landed: close and log as usual. Airborne in a bound aircraft: drop only after confirming. Airborne unbound: drop. A dropped leg's track starts the path | Always drop; always ask; keep every leg as pending | A landed leg is a finished flight, closed as for any other interruption. An airborne leg in a bound aircraft is a career flight that a slip of the switch would lose. An unbound aircraft's leg would only wait as pending, and flying it is already outside the career. Keeping the track on the map loses nothing the pilot can see. |
| Where the confirmation is enforced | The server refuses with 409 unless told to drop the leg; the card asks and retries | A confirm in the card only | The server decides, the page shows; a leg that took off after the card's last status is protected too. |
| Path breaks | A new segment after a position jump, a new flight or a disconnect | One unbroken line; clear the path at a jump | No line across a slew or a new flight; the earlier parts of a session stay. |
| Look of the casual path | Dashed, in the live aircraft's color | Solid like a leg track; always white | Tells a path that is not being logged from a leg that is, without hiding which aircraft is flying. |
| Switching off | Drops the path | Keep it on the map until cleared | The path belongs to casual mode; nothing is left drawn beside career tracks and legs. |
| Keeping casual mode in view | The switch sits in the collapsed strip as well as the open card, in every sim state | The status pill alone; switch casual mode off when the sim disconnects | The pill gives way to "sim not running", "paused" and "in menus", so casual mode could be on unseen at the start of a career session. Switching off at a disconnect would also end the session, and lose the path, at every sim crash. |
| SimBrief plans in casual mode | No import while casual mode is on; a plan already current stays, with **Remove** | Import as usual; drop, on switching off, a plan imported in casual mode | A plan imported for a casual flight would otherwise wait for the next career leg and be filed with it. Recorded here, where casual mode lives; the simbrief controls carry the obligation (SB-CUR-004, SB-CTRL-001 to 003). |
| Points while standing still | None while on the ground below 1 kt; no cap on the path | A point every 5 s regardless; a cap on the point count | A sim left parked would otherwise grow the path for nothing; a flown path grows by at most 720 points an hour, small enough to keep and resend whole. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Near-tie at takeoff** — the nearest airport always wins ([tracker.ts:697-699](../../../src/server/tracker.ts#L697-L699)).
2. **Sim-clock times** are not read or stored (LOG-REC-002).
3. **Interrupting a landed leg** — a new flight or a position jump after landing discards the leg
   or closes it at the wrong airport ([tracker.ts:468-471](../../../src/server/tracker.ts#L468-L471), [652-664](../../../src/server/tracker.ts#L652-L664)).
4. **Legs of 30–59 s are kept** ([tracker.ts:866-867](../../../src/server/tracker.ts#L866-L867)).
5. **One pending leg** — a second replaces the first and orphans its briefing ([tracker.ts:913](../../../src/server/tracker.ts#L913)).
6. **Paused time** counts toward flight time and the takeoff and stop timers.
7. **A disconnect in flight** discards the leg and its track ([tracker.ts:445-448](../../../src/server/tracker.ts#L445-L448)).
8. **`sim-fake` arguments** — option values read as airports when options come first ([sim-fake.ts:20](../../../scripts/sim-fake.ts#L20)).
9. **Two fleet rows with the same title and livery** — the older wins silently; binding one does
   not unbind the other.
10. **Wall-clock stamps** — samples are stamped on arrival, so a stalled link compresses or stretches
    the recorded timing; the sim's own time would not.
11. **A restored airborne leg whose sim is gone** — after a server restart the leg waits in the
    air until the sim reports again; a new flight then discards it as an aircraft change, new
    flight or position jump, even if the sim had crashed in the meantime.
12. **Touchdowns in casual mode** are neither measured nor rated; a rating would suit casual
    flying, but nothing would keep it.
13. **A profile of the casual path** — the flight panel shows only legs.

## References

- Code: [src/server/simconnect.ts](../../../src/server/simconnect.ts),
  [src/server/tracker.ts](../../../src/server/tracker.ts), [src/server/index.ts](../../../src/server/index.ts)
  (`startTracking`), [src/server/routes.ts](../../../src/server/routes.ts) (live tracker 445-587),
  [src/client/tracker.ts](../../../src/client/tracker.ts) (`useTracker`; `parseTrack` is shared with
  tour-map and flight-panel), [src/client/components/LivePanel.tsx](../../../src/client/components/LivePanel.tsx)
  (all but `SimbriefControls`), [src/client/components/LiveLayer.tsx](../../../src/client/components/LiveLayer.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (tracker stream, logged-hop handling, toast,
  zoom to the live aircraft), [scripts/sim-fake.ts](../../../scripts/sim-fake.ts),
  [scripts/sim-probe.ts](../../../scripts/sim-probe.ts)
- External: SimConnect via node-simconnect
- Consumers: logbook (hops it writes), flight-panel (live leg, landings, statistics), planner (logged
  hop clears results), simbrief (current briefing), airports (leg in progress)
