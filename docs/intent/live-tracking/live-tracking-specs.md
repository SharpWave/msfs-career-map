# Live Tracking — EARS Specs

Design: [live-tracking-design.md](live-tracking-design.md). Prefix `LIVE`; facets `LINK` (sim
link), `LEG` (leg detection and interruptions), `NAME` (naming the airports), `LAND` (landings and
rating), `REC` (what a leg records), `BIND` (binding a sim aircraft), `HOP` (logging and pending
legs), `SAVE` (checkpointing), `API` (tracker API and event stream), `CARD` (live card), `LAYER`
(live aircraft on the map), `TOOL` (sim-fake and sim-probe).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Sim Link

- [x] **LIVE-LINK-001**: While live tracking is enabled and not faked, the system shall connect to the sim and, whenever the sim is unreachable or the connection ends, retry every 10 s, logging only the first failed attempt in a row.
- [x] **LIVE-LINK-002**: When `SIMCONNECT_HOST` is set, the system shall connect to the sim at that host on `SIMCONNECT_PORT`, default 500.
- [x] **LIVE-LINK-003**: When the server starts with `TRACKER_FAKE=1`, the system shall not connect to the sim and shall take samples from `POST /api/tracker/sample`; when it starts with `TRACKER=0`, the system shall not track at all.
- [x] **LIVE-LINK-004**: While connected to the sim, the system shall read the user aircraft's latitude, longitude, altitude, on-ground flag, ground speed, true heading, vertical speed, indicated airspeed, G, total fuel, total weight, the sim's touchdown velocity, pitch and bank, title, ATC id and livery once a second, stamping each sample with the time it arrived.
- [x] **LIVE-LINK-005**: If the sim rejects the livery variable, then the system shall continue with a blank livery and report liveries as unsupported.
- [x] **LIVE-LINK-006**: When the wheels touch down, the system shall take from the per-frame data the descent rate and airspeed of the last airborne frame and the peak G over the following second, and pass them, with the sim's touchdown velocity as fpm, pitch and bank, on the next once-a-second sample.
- [x] **LIVE-LINK-007**: When the sim reports a pause change, the sim starting or stopping (menus and loading), a flight loaded, or the connection ending, the system shall pass the event to the tracker.
- [ ] **LIVE-LINK-008**: While connected to the sim, the system shall read the sim's zulu date and time with each once-a-second sample.
- [x] **LIVE-LINK-009**: If the livery has been neither read nor rejected 5 s after the first sample held on a new sim connection, then the system shall pass the held samples, and those that follow until the livery is read, to the tracker with a blank livery.

## Leg Detection

- [x] **LIVE-LEG-001**: While the sim is paused or not running, the tracker shall ignore samples, and it shall ignore any sample whose position is not finite or lies within 0.05° of both latitude 0 and longitude 0.
- [x] **LIVE-LEG-002**: When the aircraft has been off the ground for 5 s after being on the ground, the tracker shall start a leg whose departure time is the first airborne sample and whose track begins at the last on-ground sample.
- [x] **LIVE-LEG-003**: When tracking begins with the aircraft already airborne, the tracker shall start a leg with no departure airport.
- [x] **LIVE-LEG-004**: When the aircraft touches down during a leg, the tracker shall mark the leg landed and set its touchdown time.
- [x] **LIVE-LEG-005**: When a landed aircraft leaves the ground again, the tracker shall continue the same leg as airborne and clear its touchdown time.
- [x] **LIVE-LEG-006**: When a landed aircraft has stayed below 5 kt ground speed for 30 s, the tracker shall close the leg at that sample.
- [x] **LIVE-LEG-007**: When the user asks to log a landed leg now (**Log now**, `POST /api/tracker/complete`), the tracker shall close it at the latest sample, and refuse with HTTP 409 when no leg is landed.
- [ ] **LIVE-LEG-008**: When the sim disconnects while a leg is airborne, the tracker shall keep the leg as a pending leg ending at the last sample, with no destination and the reason "the sim disconnected in flight".
- [x] **LIVE-LEG-009**: When the sim disconnects, or the sim aircraft's title or livery changes, while a leg is landed, the tracker shall close the leg at the last sample.
- [x] **LIVE-LEG-010**: When the sim aircraft's title or livery changes, a new flight is loaded, or the position jumps more than 50 nm plus 700 kt × the time since the last sample while a leg is airborne, the tracker shall discard the leg.
- [ ] **LIVE-LEG-011**: When a new flight is loaded, or the position jumps more than 50 nm plus 700 kt × the time since the last sample, while a leg is landed, the tracker shall close the leg at the last sample before the event.
- [x] **LIVE-LEG-012**: When the sim link connects, the system shall hold the samples it reads until it has read the livery or the sim has rejected the livery variable, then pass them to the tracker in order with that livery, so a livery not yet read never counts as a change of sim aircraft.
- [ ] **LIVE-LEG-013**: When a closed leg's flight time is under one minute, the tracker shall drop it without logging and leave the current SimBrief briefing for the next leg.
- [ ] **LIVE-LEG-014**: The tracker shall not count time the sim is paused toward the 5 s takeoff confirmation or the 30 s stop.
- [x] **LIVE-LEG-015**: When the user discards the leg being flown, the tracker shall drop it without logging.

## Naming the Airports

- [x] **LIVE-NAME-001**: When a leg starts on the ground, the tracker shall name as its departure the nearest airport within 5 nm of the last on-ground sample, ranked by distance plus class handicap (APT-NEAR-001), or none when there is none.
- [ ] **LIVE-NAME-002**: When a leg starts on the ground with a bound fleet aircraft whose parked airport is within 5 nm of the last on-ground sample and ranks within 1 nm of the nearest airport by distance plus class handicap, the tracker shall name the parked airport as the departure.
- [x] **LIVE-NAME-003**: When a leg closes, the tracker shall name as its destination the nearest airport within 5 nm of where it stopped, ranked as for departures, or none.

## Landings and Rating

- [x] **LIVE-LAND-001**: When the once-a-second samples show a touchdown and no measured touchdown has arrived within 6 s, the tracker shall record a provisional landing with the descent rate and airspeed of the last airborne sample, no G, and the touchdown position.
- [x] **LIVE-LAND-002**: When a measured touchdown arrives during a leg, the tracker shall replace a provisional landing from within 6 s of it, or else add a new landing, with the measured descent rate, peak G, airspeed, the sim's touchdown rate, pitch, bank and the position.
- [x] **LIVE-LAND-003**: When rating a landing, the system shall take the worse of its descent-rate class (butter up to 100 fpm, solid up to 250, hard up to 500, hospital up to 800, graveyard above) and, when its G is known, its peak-G class (butter below 1.6, solid below 2.0, hard below 2.6, hospital below 3.5, graveyard from 3.5).
- [x] **LIVE-LAND-004**: When a landing is recorded, the tracker shall report "Landed at IDENT: N fpm, rating" or "Landed away from any airport: N fpm, rating", and for a measured touchdown "Touchdown N fpm, G.GG G: rating".

## What a Leg Records

- [x] **LIVE-REC-001**: While a leg is airborne or landed, the tracker shall add a track point at most every 5 s, and add the closing sample when the leg closes, each as `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts, fuel_lb]`.
- [x] **LIVE-REC-002**: When a leg closes, the tracker shall record its real-world departure at takeoff and its arrival at the last touchdown, or at the closing sample when it has not touched down.
- [ ] **LIVE-REC-003**: When a leg closes, the tracker shall record its flight time as the whole minutes from takeoff to arrival, less any time the sim was paused in between.
- [ ] **LIVE-REC-004**: When a leg closes, the tracker shall record its departure and arrival on the sim's clock as well as the real-world clock.
- [x] **LIVE-REC-005**: When a leg closes, the tracker shall record fuel at takeoff and at the closing sample, fuel used, weight at takeoff and at the closing sample, the highest altitude, the highest ground speed and the distance flown along the track, storing a zero fuel or weight reading as unknown.

## Binding a Sim Aircraft

- [x] **LIVE-BIND-001**: When the sim aircraft's title or livery changes, the tracker shall bind it to the fleet aircraft whose sim title matches and whose sim livery matches or is blank, preferring an exact livery and then the oldest aircraft, or to none.
- [x] **LIVE-BIND-002**: When the user binds the sim aircraft to a fleet aircraft, the system shall store the sim title and livery on that aircraft and bind it, refusing with HTTP 400 while there is no sim aircraft and HTTP 404 for an unknown aircraft.
- [ ] **LIVE-BIND-003**: When the user binds the sim aircraft to a fleet aircraft, the system shall set that aircraft on every pending leg flown in the same sim title and livery that has no aircraft.

## Logging and Pending Legs

- [x] **LIVE-HOP-001**: When a leg closes with a bound fleet aircraft that still exists and both airports named, the tracker shall log it as a hop at the end of that aircraft's sequence with its track, landings, statistics and the current SimBrief briefing, and clear the current briefing.
- [x] **LIVE-HOP-002**: When a leg closes without a bound fleet aircraft that still exists, a departure or a destination, the tracker shall keep it as a pending leg with its sim aircraft, everything known, the current SimBrief briefing, and the reason: "no fleet aircraft is bound to this sim aircraft", "the departure airport is unknown" or "no airport within 5 nm of where it stopped".
- [ ] **LIVE-HOP-003**: The tracker shall keep pending legs in a list, oldest first, and never let a new pending leg replace an earlier one.
- [x] **LIVE-HOP-004**: When the user logs a pending leg, the system shall resolve any airport codes given to idents, apply the aircraft and airports supplied, and log it as a hop, refusing with HTTP 400 while its aircraft, departure or destination is still missing.
- [x] **LIVE-HOP-005**: When the user discards a pending leg, the system shall drop it and delete its SimBrief briefing unless a hop uses it.
- [x] **LIVE-HOP-006**: When the tracker logs a hop, it shall report "Logged ORIG → DEST, time" (with the last landing's "N fpm rating" when there is one) and send the hop on the event stream.

## Checkpointing

- [x] **LIVE-SAVE-001**: The tracker shall save its whole state to the database at most every 5 s while samples arrive, and at once when a leg closes or is discarded and when the binding, the current briefing or a pending leg changes.
- [x] **LIVE-SAVE-002**: When the server starts, the tracker shall restore its saved state, dropping a saved leg that began within 0.05° of latitude 0 and longitude 0, and giving a leg saved without landings or statistics empty ones.
- [x] **LIVE-SAVE-003**: The tracker shall report whether a leg is in progress.

## Tracker API and Event Stream

- [x] **LIVE-API-001**: When `GET /api/tracker` is called, the system shall return the tracker status: link state and the sim's name, whether the sim is running and paused, whether liveries are supported, the sim aircraft and bound fleet aircraft, the phase, the latest position, the leg in progress with its landings, the pending legs without their tracks, the current briefing, and the last message with its time.
- [x] **LIVE-API-002**: When a client opens `GET /api/tracker/events`, the system shall send the status and the current leg's full track, then the status on every sample and change, each new track point, the full track when a leg starts or ends, each logged hop, each new pending leg, and a keep-alive every 25 s.
- [ ] **LIVE-API-003**: The system shall address each pending leg by its own id, logging it with `POST /api/tracker/pending/:id` and discarding it with `DELETE /api/tracker/pending/:id`, and answer HTTP 404 for an unknown id.
- [x] **LIVE-API-004**: If `POST /api/tracker/sample` is called on a server not started with `TRACKER_FAKE=1`, then the system shall refuse it with HTTP 403; otherwise it shall feed the sample to the tracker, first marking the link connected as "fake feed".
- [x] **LIVE-API-005**: When the tracker event stream drops, the browser shall reconnect and take the full state the server sends again.
- [ ] **LIVE-API-006**: While a leg is in progress, the tracker status shall carry the leg's statistics so far: fuel and weight at takeoff, fuel used, the highest altitude and ground speed, and the distance flown along the track.
- [ ] **LIVE-API-007**: When `GET /api/tracker/pending/:id` is called, the system shall return that pending leg in full, with its track, landings, statistics and briefing, and answer HTTP 404 for an unknown id.

## Live Card

- [x] **LIVE-CARD-001**: The live card shall show a status pill reading, by precedence, "no connection to the app server", "sim not running", "paused", "in menus", "airborne", "landed", "on the ground" or "connected".
- [x] **LIVE-CARD-002**: While the sim is connected with an aircraft, the live card shall show the aircraft's title ("(no title yet)" while blank), livery and ATC id.
- [x] **LIVE-CARD-003**: While the sim aircraft is bound, the live card shall show its fleet aircraft, highlighting it on the map when clicked; otherwise the card shall offer **Bind to…** a fleet aircraft and **+ New** to create one from what the sim reports.
- [x] **LIVE-CARD-004**: While the live aircraft's position is known, the live card shall show its altitude, ground speed and heading, with **Zoom** to fly the map to it at zoom 10.
- [x] **LIVE-CARD-005**: While a leg is in progress, the live card shall show its origin (or "?"), takeoff time, points recorded and latest landing's badge, with **Profile** to open the live leg in the flight panel, **Log now** while landed, and **Discard** after confirming "Discard the leg being flown? It will not be logged."
- [x] **LIVE-CARD-006**: The live card shall show "Start MSFS and the tracker connects by itself. Takeoffs and landings are logged as hops with the flown track." while the sim is not connected, "Connected to X; waiting for the aircraft to load." while connected without an aircraft, and "Waiting for the tracker…" before the first status.
- [x] **LIVE-CARD-007**: The live card shall show the tracker's last message with its time, and the error from a failed action.
- [ ] **LIVE-CARD-008**: For each pending leg, oldest first, the live card shall show "Leg waiting to be logged" with the sim aircraft and livery, the reason, takeoff and touchdown times, flight time and points; aircraft, From and To fields prefilled with what is known; **Log hop**; and **Discard** after confirming "Discard this leg? Its recorded track will be lost."
- [x] **LIVE-CARD-009**: When the tracker logs a hop, the system shall reload the map and sidebar and show "Logged ORIG → DEST · time" for 8 s.
- [ ] **LIVE-CARD-010**: For each pending leg, the live card shall offer **Profile**, which opens that leg in the flight panel.

## Live Aircraft on the Map

- [x] **LIVE-LAYER-001**: While the sim is connected and a position is known, the system shall draw the live aircraft above every other map layer as the bound aircraft's badge (a white single-piston badge when unbound) with a heading pointer, and the leg's track in the aircraft's color over a dark casing.
- [x] **LIVE-LAYER-002**: The system shall draw the live aircraft and its track on the world copy of the bound aircraft's parked position.
- [x] **LIVE-LAYER-003**: When the user hovers the live aircraft, the system shall show "LIVE · name", altitude, ground speed, heading, "on ground" while on the ground, and the leg's origin and points.

## Test Tools

- [x] **LIVE-TOOL-001**: When `npm run sim-fake -- ORIG DEST` is run against a server started with `TRACKER_FAKE=1`, the tool shall fly a synthetic leg between the two airports — 20 s parked, taxi, takeoff roll, climb at 700 fpm, cruise, descent at 500 fpm, rollout, taxi and 45 s parked — posting one sample per virtual second at the chosen speed.
- [x] **LIVE-TOOL-002**: The sim-fake tool shall accept `--speed` (default 30), `--cruise` (150 kt), `--alt` (6,500 ft), `--title`, `--livery`, `--atc`, `--base`, `--fpm` (180) and `--g` (1.4), and the flags `--touch-and-go` (one bounce at the destination before the full stop) and `--start-airborne` (start mid-route with no departure).
- [ ] **LIVE-TOOL-003**: The sim-fake tool shall take as the two airports the first two arguments that are neither options nor option values, wherever they appear.
- [x] **LIVE-TOOL-004**: When `npm run sim-probe` runs, the tool shall print each sample's aircraft, position, altitude, ground speed, heading and ground state, and each sim event, without touching the database.
