# Logbook — EARS Specs

Design: [logbook-design.md](logbook-design.md). Prefix `LOG`; facets `REC` (the hop record),
`SEQ` (ordering and parked position), `EDIT` (correcting a tracked hop), `FORM` (the hop form),
`LIST` (the hop list in an aircraft card).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## The Hop Record

- [x] **LOG-REC-001**: The system shall store each hop with its fleet aircraft, its position in that aircraft's sequence, an origin and a destination airport, optional real-world departure and arrival times, an optional flight time in whole minutes, and notes.
- [ ] **LOG-REC-002**: The system shall store each hop's departure and arrival on the sim's clock (the sim's zulu date and time) as well as on the real-world clock, each optional.
- [x] **LOG-REC-003**: When a hop is created or updated with an airport code (ICAO ident, GPS, IATA or local code), the system shall store the canonical OurAirports ident that the code resolves to.
- [x] **LOG-REC-004**: If a hop is created or updated with a blank origin or destination, then the system shall reject it with HTTP 400 "origin is required" or "destination is required".
- [x] **LOG-REC-005**: If a hop is created or updated with an airport code that matches no airport, then the system shall reject it with HTTP 400 naming the unknown code.
- [x] **LOG-REC-006**: The system shall accept a hop whose origin and destination are the same airport.
- [x] **LOG-REC-007**: When a hop is created or updated with a real-world departure or arrival time, the system shall store a blank value as null and any other value as an ISO 8601 UTC timestamp.
- [x] **LOG-REC-008**: If a hop is created or updated with a real-world departure or arrival time that cannot be parsed as a date and time, then the system shall reject it with HTTP 400.
- [ ] **LOG-REC-009**: If a hop is created or updated through the hop API with a real-world arrival time earlier than its real-world departure time, then the system shall reject it with HTTP 400.
- [x] **LOG-REC-010**: When a hop is created or updated with a flight time, the system shall store it rounded to whole minutes, and store a blank flight time as null.
- [ ] **LOG-REC-011**: If a hop is created or updated through the hop API with a negative flight time, then the system shall reject it with HTTP 400.
- [x] **LOG-REC-012**: While a hop has no stored flight time but has both real-world departure and arrival times, the system shall show its flight time as their difference in whole minutes, provided the difference is not negative, without storing it.
- [x] **LOG-REC-013**: When a hop is updated through the hop API, the system shall leave its recorded track, landings and flight stats unchanged.

## Ordering and the Parked Position

- [x] **LOG-SEQ-001**: When a hop is added to an aircraft, whether hand-logged or auto-logged by the tracker, the system shall give it the sequence number one greater than that aircraft's highest.
- [x] **LOG-SEQ-002**: When a hop is deleted, the system shall renumber the remaining hops of its aircraft to 1..n, keeping their order.
- [x] **LOG-SEQ-003**: When a hop is moved to another aircraft, the system shall place it at the end of the target aircraft's sequence and renumber the source aircraft's remaining hops to 1..n, keeping their order.
- [ ] **LOG-SEQ-004**: When a hop is deleted or moved to another aircraft, the system shall apply the change and the renumbering it causes as one atomic operation, so a failure leaves both aircraft's sequences unchanged.
- [x] **LOG-SEQ-005**: When an aircraft's hops are reordered with the complete list of that aircraft's hop ids, the system shall set each hop's sequence number to its position in the list as one atomic operation.
- [x] **LOG-SEQ-006**: If a reorder request's ids are not an array, or are not exactly the aircraft's hop ids, then the system shall reject it with HTTP 400 and change nothing.
- [x] **LOG-SEQ-007**: The system shall return hops ordered by aircraft and then by sequence number from every hop read, including the whole-map state.
- [x] **LOG-SEQ-008**: The system shall treat an aircraft as parked at the destination of its highest-sequence hop, and as having no position while it has no hops.
- [x] **LOG-SEQ-009**: The system shall accept a hop whose origin differs from the destination of the same aircraft's previous hop.

## Correcting a Tracked Hop

- [ ] **LOG-EDIT-001**: When the origin of a hop whose recorded track begins within 5 nm of its current origin is changed, the system shall accept the new origin only if it lies within 5 nm of where the track begins, and otherwise reject the change with HTTP 400 naming the airport and its distance from the track's start.
- [ ] **LOG-EDIT-002**: When the destination of a hop whose recorded track ends within 5 nm of its current destination is changed, the system shall accept the new destination only if it lies within 5 nm of where the track ends, and otherwise reject the change with HTTP 400 naming the airport and its distance from the track's end.
- [x] **LOG-EDIT-003**: When an origin or destination is changed on a hand-logged hop (no recorded track), or on an end of a tracked hop that its track does not begin or end within 5 nm of, the system shall accept any known airport.

## The Hop Form

- [x] **LOG-FORM-001**: When the "Log a hop" form is shown, the system shall preselect the aircraft highlighted in the fleet or on the map, else the first fleet aircraft, and fill the origin with where that aircraft is parked.
- [x] **LOG-FORM-002**: When the user chooses a different aircraft in the "Log a hop" form, the system shall fill the origin with where that aircraft is parked.
- [x] **LOG-FORM-003**: When the user highlights a different aircraft in the fleet or on the map, the system shall switch the "Log a hop" form to that aircraft; clearing the highlight shall leave the form's aircraft unchanged.
- [x] **LOG-FORM-004**: When the planner hands over a picked destination (its **Use** action on a candidate airport), the system shall switch the "Log a hop" form to the planned aircraft, fill the origin with where it is parked and the destination with the picked airport, and scroll the form into view.
- [x] **LOG-FORM-005**: When a hop is saved from the "Log a hop" form, the system shall fill the next origin with the destination just logged, clear the remaining fields, confirm "Logged ORIG → DEST", and clear the active planner search.
- [x] **LOG-FORM-006**: If the user submits the hop form without an aircraft, an origin or a destination, then the system shall show which is missing and not save.
- [x] **LOG-FORM-007**: If the user submits the hop form with a real-world arrival before the departure, or a flight time that is not a number of minutes ≥ 0, then the system shall show the problem and not save.
- [x] **LOG-FORM-008**: If saving from the hop form fails, then the system shall show the server's error and keep the entered values.
- [x] **LOG-FORM-009**: While the fleet has no aircraft, the "Log a hop" card shall show "Add an aircraft to the fleet first, then log hops here." in place of the form.
- [x] **LOG-FORM-010**: If the aircraft chosen in the "Log a hop" form is deleted, then the system shall switch the form to the first fleet aircraft.
- [x] **LOG-FORM-011**: When the user edits a hop inline, the system shall offer every fleet aircraft in the form so the hop can be moved to another aircraft.
- [x] **LOG-FORM-012**: The hop form shall enter and show real-world departure and arrival times in the browser's local time zone.

## The Hop List in an Aircraft Card

- [x] **LOG-LIST-001**: When an aircraft card is expanded, the system shall list that aircraft's hops in sequence, each with its number, origin → destination, the final landing's badge when it has landings, its real-world departure and arrival times, its flight time, and its notes, or "no times" when it has none of those.
- [x] **LOG-LIST-002**: When an aircraft card is expanded, the system shall show "n hop(s)" with the sum of its hops' flight times when that sum is above zero, or "No hops logged for this aircraft." when it has none.
- [x] **LOG-LIST-003**: When the user clicks a hop row, the system shall open that hop in the flight panel and zoom the map to it.
- [x] **LOG-LIST-004**: When the user clicks ↑ or ↓ on a hop row, the system shall swap the hop with its neighbour and save the new order; ↑ shall be disabled on the first hop and ↓ on the last.
- [x] **LOG-LIST-005**: When the user clicks ✕ on a hop row and confirms "Delete hop ORIG → DEST?", the system shall delete the hop.
- [x] **LOG-LIST-006**: While a reorder or delete from an aircraft card is in flight, the system shall disable that card's hop actions.
- [ ] **LOG-LIST-007**: If a reorder or delete from an aircraft card fails, then the system shall show the error on that card.
