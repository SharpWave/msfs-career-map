---
parent: high-level-design
prefix: LOG
---

# Logbook

## Context and Design Philosophy

This segment keeps each fleet aircraft's hops: the ordered list of legs it has flown. The career
premise is that every aircraft + livery resumes where it last parked, so its hops are also the record
of where each plane *is*: an aircraft is parked at the destination of its last hop. Everything else that
shows a tour (the map's paths and parked icons, the planner's starting point, the "parked at" line
on an aircraft card, the tracker's choice of departure airport) reads that position from here.

Hops enter the logbook two ways:

- **Hand-logged** through the Log a hop drawer or an inline edit — owned by this segment.
- **Auto-logged** by the live tracker when a flown leg completes — the tracker writes the row
  ([tracker.ts:346-365](../../../src/server/tracker.ts#L346-L365)) and must follow this segment's
  record rules (sequence, canonical idents, time fields). What it records inside the hop (track,
  landings, stats) belongs to live-tracking.

This segment owns the hop record and its invariants, the rules for correcting a hop, the
hand-logging form, and the hop list inside each aircraft card. It does not own how hops are drawn
(tour-map), the flight panel a hop opens (flight-panel), the SimBrief plan linked to a hop
(simbrief), the aircraft rows hops belong to (fleet; deleting an aircraft deletes its hops), or the
logbook database as a whole (app-shell): the SQLite file in the data folder that holds the hops
beside the fleet, the tracker's checkpoint and the airport tables, with its location, backups, schema
upgrades and bringing in a logbook from another data folder. Here, as in the HLD, "the logbook" is
that database file; this segment owns the hops in it.

## The Hop Record

One row in `hops` ([db.ts:113-126](../../../src/server/db.ts#L113-L126), later columns added in
place at [db.ts:177-179](../../../src/server/db.ts#L177-L179)).

| Field | Meaning | Written by |
|---|---|---|
| `id` | The hop's own id, never given to a second hop in the same logbook (below) | the database, on insert |
| `aircraft_id` | Owning fleet aircraft | logbook, tracker |
| `seq` | Position in that aircraft's tour, 1..n | logbook (renumbering), tracker (append) |
| `origin`, `dest` | Canonical OurAirports idents; may be the same airport | logbook, tracker |
| `departed_at`, `arrived_at` | Real-world departure and arrival, ISO 8601 UTC, optional | logbook, tracker |
| `sim_departed_at`, `sim_arrived_at` | The same moments on the sim's own clock (its zulu date and time), ISO 8601, optional — **intended; not yet in the schema** | tracker; logbook on edit |
| `duration_min` | Flight time in whole real-world minutes, optional | logbook (typed), tracker (measured) |
| `notes` | Free text, `''` when empty | logbook |
| `track`, `landings`, `stats` | JSON payloads of a flown leg; null on hand-logged hops | tracker only |
| `briefing_id` | Archived SimBrief plan | tracker, simbrief |
| `created_at` | When the hop was logged, ISO 8601 UTC — not when it was flown; the one time every hop has, hand-logged hops without times included | the database, on insert; never changed, the hop edited, moved, reordered or brought in with its logbook included |

Edits from the hop form (`PUT /hops/:id`) never touch `track`, `landings`, `stats` or `briefing_id`,
since that route updates only the columns it names
([routes.ts:407-409](../../../src/server/routes.ts#L407-L409)); the plan link changes only through
simbrief's attach and remove. Readers of those payloads must tolerate null.

**Hop ids.** A hop's id is SQLite's `AUTOINCREMENT` key ([db.ts:114](../../../src/server/db.ts#L114)),
so no id is ever given to a second hop in the same logbook, even after the first is deleted. Whatever
names a hop by its id therefore finds that hop or none, never another: the flight panel, a SimBrief
plan's link, and the page's `#hop=<id>` address, which a hop notification opens
([desktop shell › Notifications](../desktop/shell/shell-design.md#notifications)) and which may be
clicked days later from Windows' notification centre; if the hop was deleted meanwhile, the page says
it no longer exists (app-shell). The counter belongs to the logbook database, so a link made in one
logbook may name another hop in whichever logbook replaces it: a backup restored by hand, a logbook
brought in from another data folder (which arrives whole, through SQLite's own backup, with its hops'
ids and its own counter), or a new logbook started in place of a deleted data folder. Hops accept
that, since opening a hop only shows it; a pending leg's link leads to Log or Discard, so its id is
one that no restore can rewind (live-tracking, desktop shell).

**Where hops live.** Hops are rows of the logbook database in the data folder, whose location,
backups and schema upgrades app-shell owns. The `hops` table only ever gains columns, added in place,
each nullable or with a default, as SQLite requires of a column added in place — the sim-clock
columns arrive that way — and hops logged before them, or by an older version since, have none;
readers tolerate null. A column added to `hops` holds a value of its own, never one worked out from
fields an older version may edit; such values are derived when read, as a missing flight time is.
Every insert and update names the columns it sets, so a version older than the logbook's schema — an
older release run on a logbook a newer one upgraded, or the installed app on a logbook brought in
from a copy run from source that is ahead of it — leaves the fields it does not know as they were
when it edits a hop, and at their defaults when it logs one. Bringing in a logbook from another data
folder never replaces a logbook that holds hops, not even one whose first hop was logged while the
copy was being made; that copy is discarded (app-shell checks again just before the swap).

## Ordering and the Parked Position

Each aircraft's hops are ordered by `seq`, and the server keeps the sequence contiguous:

- **Append.** A new hop gets `MAX(seq)+1` for its aircraft, whether hand-logged
  ([routes.ts:382](../../../src/server/routes.ts#L382)) or auto-logged by the tracker.
- **Delete.** Deleting a hop renumbers the remaining hops of that aircraft to 1..n in their
  existing `(seq, id)` order, touching only rows whose number changes
  ([routes.ts:360-366](../../../src/server/routes.ts#L360-L366), [414-420](../../../src/server/routes.ts#L414-L420)).
- **Move to another aircraft.** Changing a hop's `aircraft_id` appends it at the end of the target
  aircraft's sequence and renumbers the source aircraft
  ([routes.ts:399-410](../../../src/server/routes.ts#L399-L410)).
- **Reorder.** The client sends the aircraft's complete list of hop ids in the new order. The
  server rejects the request unless the list is exactly that aircraft's hops, then rewrites `seq`
  as list position + 1 in one transaction ([routes.ts:422-443](../../../src/server/routes.ts#L422-L443)).

A move or delete and the renumbering it causes are meant to apply together; today they run as
separate statements outside a transaction ([routes.ts:407-410](../../../src/server/routes.ts#L407-L410),
[417-418](../../../src/server/routes.ts#L417-L418)), so a failure between them can leave a gap.

Every read returns hops sorted by `seq, id` per aircraft (all hops: `aircraft_id, seq, id`)
([routes.ts:333-334](../../../src/server/routes.ts#L333-L334)), including the whole-map `/state`
payload ([routes.ts:827-840](../../../src/server/routes.ts#L827-L840)). Clients rely on that order
and do not re-sort.

**Parked position.** An aircraft is parked at the `dest` of its highest-`seq` hop; with no hops it
has no position. The position is derived, never stored, so reordering or deleting the last hop
moves the plane. The rule is evaluated in several places: the aircraft card
([Fleet.tsx:106](../../../src/client/components/Fleet.tsx#L106)), the hop form
([HopForm.tsx:28-32](../../../src/client/components/HopForm.tsx#L28-L32)), and, outside this
segment, the planner, the map's parked icons, the `/plan` origin, and live tracking, which prefers
the parked airport when a takeoff position is nearly tied between two airports.

**Gaps are allowed.** A hop's origin need not equal the previous hop's destination. The form makes
the continuous case the default instead (below).

## Airport Codes and Times

- **Codes.** Origin and destination accept any code the airport lookup knows (ICAO ident, GPS,
  IATA, local code). The server resolves each to the canonical OurAirports `ident` and stores that;
  a blank code is `400 "<label> is required"`, an unknown one `400 "<label>: unknown airport \"X\""`
  ([routes.ts:343-350](../../../src/server/routes.ts#L343-L350)). Origin and destination may be
  the same airport, for pattern work and local flights. A stored ident keeps resolving: the airport
  lists' refreshes never drop an airport a hop uses (airports).
- **Two clocks.** A hop records when it was flown in the real world and when it happened in the
  sim's world, which runs its own date and time of day. Real-world times are the ones in use today;
  sim-clock times are intended and not yet stored. Flight time (`duration_min`) is real-world
  minutes, which can differ from elapsed sim time when the sim runs faster than real time; a
  flight time the tracker measures leaves out time the sim was paused (live-tracking).
- **Real-world times.** `departed_at` / `arrived_at` are optional. Blank is stored as null; anything
  `Date` cannot parse is `400 "<label>: invalid date/time"`; otherwise the value is stored as
  ISO 8601 UTC ([routes.ts:352-358](../../../src/server/routes.ts#L352-L358)). The form edits them
  as `datetime-local` in the page's own time zone and converts both ways
  ([format.ts:48-62](../../../src/client/format.ts#L48-L62)), and the hop list shows them in that
  time zone through app-shell's shared formatting. That zone is the pilot's PC's: app-shell has the
  server answer only on 127.0.0.1, so the page — in the app's window or a browser tab — is shown only
  on the PC the server runs on. Arrival before departure and negative flight times are rejected by the form
  ([HopForm.tsx:84-86](../../../src/client/components/HopForm.tsx#L84-L86)) and are meant to be
  rejected by the API too, which today accepts them
  ([routes.ts:379-381](../../../src/server/routes.ts#L379-L381)).
- **Duration.** `duration_min` is optional and rounded to whole minutes on write. When a hop has no
  stored duration but has both real-world times, its displayed duration is the rounded difference,
  provided it is not negative; otherwise it has none ([format.ts:38-46](../../../src/client/format.ts#L38-L46)).
  The derived value is never written back.

## Correcting a Tracked Hop

The tracker names a leg's airports from where the aircraft actually was: the nearest airport to
the takeoff point and to where it stopped. Where two airports sit close together it can name the
wrong one, so the airports of a tracked hop stay editable, but only to plausible corrections.

The recorded track vouches for an airport when the track's end lies within 5 nm of it — the same
radius the tracker uses to name an airport at all. The intended rule:

- **Origin.** If the track begins within 5 nm of the hop's current origin, a new origin is accepted
  only if it also lies within 5 nm of where the track begins.
- **Destination.** If the track ends within 5 nm of the hop's current destination, a new
  destination is accepted only if it also lies within 5 nm of where the track ends.
- **Otherwise unrestricted.** An end the track does not vouch for — a leg whose tracking started in
  the air, or one that stopped away from any airport and was completed by hand — can be set to any
  known airport, as can either end of a hand-logged hop (no track).

A refused change is a `400` that names the airport and its distance from the track's end. Today
`PUT /hops/:id` applies any airport change without this check.

## Hand-Logging a Hop

The **Log a hop** drawer, opened from the page's menu (app-shell), holds a create-mode `HopForm`
([App.tsx:396-411](../../../src/client/App.tsx#L396-L411)); the same form edits an existing hop
inline in the aircraft card.

**Create-mode defaults** ([HopForm.tsx:34-41](../../../src/client/components/HopForm.tsx#L34-L41)):

- Aircraft: the aircraft highlighted in the fleet or on the map, else the first aircraft.
- Origin: where that aircraft is parked. Choosing a different aircraft resets the origin to that
  aircraft's parked position ([46-49](../../../src/client/components/HopForm.tsx#L46-L49)), and
  highlighting another aircraft retargets the form; clearing the highlight leaves it as is
  ([51-55](../../../src/client/components/HopForm.tsx#L51-L55)).
- If the chosen aircraft is deleted, the form falls back to the first aircraft
  ([69-73](../../../src/client/components/HopForm.tsx#L69-L73)).
- With no aircraft at all, the drawer shows "Add an aircraft to the fleet first, then log hops
  here." instead of the form ([121-123](../../../src/client/components/HopForm.tsx#L121-L123)).

**Planner hand-off.** When the planner's **Use** picks a destination, it sends a preset
`{key, aircraftId, dest}`. On each new key the form switches to that aircraft, sets the origin to
its parked position and the destination to the picked airport, and clears messages
([57-67](../../../src/client/components/HopForm.tsx#L57-L67)); the page opens the Log a hop drawer
and scrolls it to this form (app-shell). After a hop is saved from the drawer the app clears both
the plan and the preset ([App.tsx:404-408](../../../src/client/App.tsx#L404-L408)).

**Validation, in order** ([79-86](../../../src/client/components/HopForm.tsx#L79-L86)): an
aircraft is chosen; origin present; destination present; arrival not before departure when both
are given; duration, if given, a finite number ≥ 0. Codes are trimmed and upper-cased, notes
trimmed ([88-96](../../../src/client/components/HopForm.tsx#L88-L96)).

**After a successful create** the form rolls forward for the next leg: origin becomes the
destination just logged; destination, times, duration and notes clear; a "Logged ORIG → DEST"
confirmation shows ([102-113](../../../src/client/components/HopForm.tsx#L102-L113)). In edit mode
it saves and closes. The buttons disable while a save is in flight.

**A failed save** shows its error inline with the entered values kept
([114-118](../../../src/client/components/HopForm.tsx#L114-L118)), whatever the cause: the server
refusing the hop or failing while handling it, a server still doing its start-up work (which answers
503), or no answer at all from a server restarting behind an open page (the desktop shell restarting
it, or a copy run from source restarting on a code change). The pilot saves again; the form never
resends by itself, since a save whose answer was lost may already be in the logbook. A hop logged
twice that way shows as two rows in the aircraft card, where one is deleted.

## The Hop List in an Aircraft Card

Expanding an aircraft card (the chevron with its hop count) lists its hops in sequence
([Fleet.tsx:201-260](../../../src/client/components/Fleet.tsx#L201-L260)).

- **Summary line.** "n hop(s) · total logged", where the total is the sum of each hop's duration
  (stored or derived), missing ones counting 0, shown only when above zero
  ([107](../../../src/client/components/Fleet.tsx#L107), [203-209](../../../src/client/components/Fleet.tsx#L203-L209)).
  With no hops: "No hops logged for this aircraft."
- **Row.** Sequence number, `ORIG → DEST`, the compact badge of the first touchdown of its final
  landing when the hop has touchdowns (flight-panel), departure and arrival times, the duration, "no times" when none of those exist, and
  the notes ([226-248](../../../src/client/components/Fleet.tsx#L226-L248)).
- **Row click** opens the hop: the flight panel shows it and the map zooms to it
  ([App.tsx:261-266](../../../src/client/App.tsx#L261-L266)).
- **Move earlier / Move later** (arrow icons) swap the hop with its neighbour and send the full
  new order; Move earlier is disabled on the first hop and Move later on the last ([Fleet.tsx:114-127](../../../src/client/components/Fleet.tsx#L114-L127),
  [250-251](../../../src/client/components/Fleet.tsx#L250-L251)).
- **Edit hop** (pencil) replaces the row with an inline edit form that lists every aircraft, so a hop can be moved
  to another aircraft ([212-224](../../../src/client/components/Fleet.tsx#L212-L224)).
- **Delete hop** (trash can) asks "Delete hop ORIG → DEST?" and deletes on confirmation
  ([129-138](../../../src/client/components/Fleet.tsx#L129-L138)).
- While a reorder or delete is in flight, every hop action on that card is disabled. A failed
  reorder or delete is meant to show its error on the card; today the failure is silent
  ([Fleet.tsx:114-138](../../../src/client/components/Fleet.tsx#L114-L138)).

## API

| Method | Path | Behaviour | Errors |
|---|---|---|---|
| GET | `/api/hops[?aircraft_id=]` | All hops by `aircraft_id, seq, id`, or one aircraft's by `seq, id` | — |
| POST | `/api/hops` | Create at the end of the aircraft's sequence → 201 + row | 404 aircraft; 400 code, time or duration |
| PUT | `/api/hops/:id` | Partial update; an omitted field keeps its value; a new `aircraft_id` moves the hop | 400; 404 hop or aircraft |
| DELETE | `/api/hops/:id` | Delete and renumber the aircraft → 204 | 400; 404 |
| PUT | `/api/aircraft/:id/hops/order` | `{ids}` → the aircraft's hops in the new order | 400 not an array / not exactly this aircraft's hops; 404 |

Handlers are at [routes.ts:368-443](../../../src/server/routes.ts#L368-L443). They follow
app-shell's conventions for API routes: errors are `{error}` bodies via the shared error middleware,
they answer 503 while the server's start-up work runs, and they accept no change from another site's
page.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| How hops are ordered | Explicit per-aircraft `seq` | Order by departure time | [inferred] Hand-logged hops may have no times, so time cannot order every hop; an explicit sequence also lets a misordered leg be fixed by hand. |
| Shape of the sequence | Contiguous 1..n, restored by server renumbering after delete or move; no database uniqueness constraint | Allow gaps; fractional ordering keys; `UNIQUE(aircraft_id, seq)` | [inferred] The UI shows `seq` as the hop number and enables ↑/↓ by comparing it to 1 and the hop count, which assumes contiguity. |
| Where an aircraft is parked | Derived from its highest-`seq` hop, never stored | A stored position on the aircraft row | [inferred] A derived position cannot drift from the logbook, and reorders or deletes move the plane with no extra write. |
| Airport codes | Store the canonical OurAirports `ident`, whatever was typed | Store the code as typed | [inferred] One key per airport, so map nodes, parked positions and lookups agree whether the user typed `BOS` or `KBOS`. |
| Gaps in a tour | Allowed; the form defaults the origin to the parked position instead | Reject or warn when origin ≠ previous destination | A rejected gap would block corrections when a recorded airport was wrong, and a sim session can legitimately begin elsewhere. Making the continuous case the default costs nothing. |
| Origin equal to destination | Allowed | Reject | Pattern work and local flights leave from and return to the same field. |
| Correcting a tracked hop's airports | Allow a change only to an airport within 5 nm of the track end that vouched for the old one; other ends unrestricted | Allow any change; refuse all changes; clear the track on change | Nearest-airport naming can pick the wrong one of two close fields, so plausible corrections must be possible; a change the recorded track contradicts is a mistake, not a correction. 5 nm matches the tracker's naming radius. |
| Clocks recorded | Both real-world and sim-clock departure and arrival | Real-world only; sim only | Real-world time records when the user flew; the sim's clock is the career's own calendar and time of day. Each answers a different question about a hop. |
| Time storage | ISO 8601 UTC; real-world times entered and shown in the page's local time zone | Store local time | [inferred] An unambiguous stored form that sorts lexically; the page converts to and from its own time zone, which is the pilot's PC's because the server answers only on 127.0.0.1 (app-shell). |
| Hop ids | SQLite's `AUTOINCREMENT` key: an id is never given to a second hop in the same logbook | The plain row id, which hands the id of a deleted newest hop to the next one; random or time-based ids, which no restore or import could repeat | A link to a hop — a hop notification can wait days in Windows' notification centre — must find that hop or none, never another logged since. `AUTOINCREMENT` gives that with the existing integer ids and no change to the table. Its counter belongs to the logbook database, so a link made in one logbook may name another hop in whichever logbook replaces it (a backup restored by hand, a logbook brought in, a new one started in place of a deleted data folder). Opening a hop only shows it, so that stale link is harmless and ids that survive a replaced logbook are not worth a change to the table; a pending leg's link leads to Log or Discard, which is why its id is one no restore can rewind (live-tracking). |
| Writes to `hops` | Every insert and update names the columns it sets | Read-modify-write of the whole row; inserts that give every value without naming columns | The `hops` table only gains columns, and an older release may run on a logbook a newer one upgraded, or the installed app on one brought in from a copy run from source that is ahead of it. Naming columns leaves the fields it does not know as they were on an edit and at their defaults on an insert; a whole-row write would clear them, and an insert that named no columns would fail outright on a table wider than it knows, losing a tracked flight. |
| Duration | Optional real-world minutes; stored only when typed or measured, otherwise derived at display from real-world times | Compute and store on every write; make it required | [inferred] A typed flight time stays authoritative over the clock difference, and hops with no times at all remain valid. |
| Moving a hop between aircraft | Append at the end of the target's sequence, renumber the source | Insert by time; refuse the move | [inferred] The simplest well-defined position; the user can reorder afterwards. |
| Reorder request | Full id list, validated as exactly the aircraft's hops, applied in one transaction | A per-hop "move up/down" endpoint | [inferred] One atomic request; no partially applied order. |
| Create form after saving | Rolls forward: next origin = the destination just logged | Clear the form | Logging consecutive legs of a tour is the main use. |
| A failed save from the hop form | The error shown with the entered values kept; the pilot saves again | Resending by itself until the server answers, as the page retries its first loads while the server starts; a key chosen by the form, so a resent hop write is stored once; a warning on an unanswered save that the hop may already be logged | A save whose answer was lost — the server ended by a crash or a restart just after writing — may already be in the logbook, and resending it would log the hop twice. A read is safe to repeat; a hop write is not. Losing the answer needs the server to end between storing the hop and answering; an unanswered save is nearly always one sent while the server was down, which never reached it, so a warning would almost always be wrong. A key would add a column and server bookkeeping against a rare case whose cost is a second row in the aircraft card, deleted there with one click. Kept values make saving again one click. |
| Flown-leg payloads | `track`, `landings`, `stats` written only by the tracker; hand edits never change them | Allow editing them | They are measurements, not user input. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Gaps in a tour are allowed (see Decisions).
2. ✅ Origin equal to destination is allowed (see Decisions).
3. ✅ A tracked hop's airports can be corrected within 5 nm of the track end that vouched for them
   (see Correcting a Tracked Hop).
4. ✅ Hops record both real-world and sim-clock times (see Two clocks).

### Deferred

1. **Showing two clocks.** Which clock the hop list, map tooltips and flight panel show by default,
   and where the other appears.
2. **Sim times on hand-logged hops.** Whether the hop form offers sim-clock fields, and how.
3. **Bad `aircraft_id` errors.** A missing or non-numeric `aircraft_id` on `POST /hops` yields
   `404 "aircraft NaN not found"` rather than a 400 ([routes.ts:375-376](../../../src/server/routes.ts#L375-L376));
   `GET /hops?aircraft_id=abc` silently returns `[]` ([370](../../../src/server/routes.ts#L370)).
4. **One parked-position rule, many evaluations.** The rule is re-derived in the aircraft card, the
   hop form, the planner, the map, `/plan` and the tracker, each relying on hops arriving sorted. A
   shared helper would keep them aligned.
5. **Move earlier / Move later enablement** compares `seq` to 1 and the hop count
   ([Fleet.tsx:250-251](../../../src/client/components/Fleet.tsx#L250-L251)), correct only
   while the sequence is contiguous.

## Relies On

- **app-shell** — the page's own retry of a 503 during the server's start-up work covers its loads
  only and never resends a write, so a hop save is sent once; the page opens `#hop=<id>` and says
  when that hop no longer exists; the server answers only on 127.0.0.1, so the page's time zone is
  the pilot's PC's; a logbook brought in from another data folder arrives whole, through SQLite's own
  backup, and never replaces one that holds hops; schema changes to `hops` go through
  `addColumnIfMissing()`, so every added column is nullable or has a default.
- **airports** — the airport lists' refreshes never drop an airport a hop uses, so a stored ident
  keeps resolving.

## References

- Code: [src/server/routes.ts](../../../src/server/routes.ts) (hops section 313-443, `/state` 826-840),
  [src/server/db.ts](../../../src/server/db.ts) (hops table),
  [src/client/components/HopForm.tsx](../../../src/client/components/HopForm.tsx),
  [src/client/components/Fleet.tsx](../../../src/client/components/Fleet.tsx) (`AircraftCard` hop list),
  [src/client/App.tsx](../../../src/client/App.tsx) (the Log a hop drawer, the planner hand-off `pickCandidate`),
  [src/client/format.ts](../../../src/client/format.ts) (`hopDurationMin`, datetime conversion)
- HLD: [docs/high-level-design.md](../../high-level-design.md) — System Design (the data folder; the
  server listening only on 127.0.0.1) and Rules every segment follows (Order and position, Airport
  codes, Time, Schema changes)
- Writes from other segments: live-tracking `insertHop` ([tracker.ts:346-365](../../../src/server/tracker.ts#L346-L365)),
  which is also to capture sim-clock times; simbrief `POST /hops/:id/briefing`
- Consumers of the parked position and hop order: tour-map (`paths.ts`), planner (`Planner.tsx`,
  `/plan`), live-tracking (takeoff airport tie-break)
- Consumers of hop ids: flight-panel, simbrief (a plan's hop), the page's `#hop=<id>` address
  (app-shell), opened by the desktop shell's hop notifications
  ([shell-design.md](../desktop/shell/shell-design.md#notifications))
- Readers of a whole logbook's hops: app-shell's first-run offer, which names each offered logbook
  with its hop count and newest hop, and brings a logbook in only over one that holds none
  ([desktop-design.md](../desktop/desktop-design.md#relies-on))
- The logbook database as a whole — data folder, backups, schema upgrades, bringing in a logbook:
  [app-shell-design.md](../app-shell/app-shell-design.md)
