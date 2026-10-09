---
parent: high-level-design
prefix: FLEET
---

# Fleet

## Context and Design Philosophy

The fleet is the list of aircraft the user flies. Each fleet row is one aircraft **and livery**:
that pairing is the unit of persistence for add-ons that track wear per livery (A2A-style), and in
this career mode each pairing resumes where it last parked, so each one builds its own tour.

A fleet row carries four kinds of data:

- **Identity** — name and livery/registration, plus the sim's `TITLE` / `LIVERY NAME` it is bound
  to for live tracking.
- **Appearance** — path color, icon, visibility on the map.
- **Performance and limits** — cruise speed, block-time inputs, runway, ceiling, oxygen, crosswind
  and IFR capability. The planner is their consumer.
- **Notes** — free text.

This segment owns the aircraft record and its validation, the aircraft form (create, edit,
delete, create from the sim), icon storage, the color palette and built-in icons, and the header
of each aircraft card. It does not own how performance fields become flight times or filters
(planner), how a sim aircraft is matched to a row (live-tracking), SimBrief's type list
(simbrief), where an aircraft is parked or its hop list (logbook), or how aircraft are drawn on the
map (tour-map).

## The Aircraft Record

One row in `aircraft` ([db.ts:90-111](../../../src/server/db.ts#L90-L111); later columns added in
place at [db.ts:163-176](../../../src/server/db.ts#L163-L176)). Server validation lives at
[routes.ts:164-211](../../../src/server/routes.ts#L164-L211).

| Field | Meaning | Rule on write |
|---|---|---|
| `name` | Aircraft name, e.g. "A2A Aerostar 600" | Required, trimmed; blank → 400 "name is required" |
| `livery` | Livery or registration | Optional, `''` when blank |
| `color` | Path and badge color | `#rrggbb` only; 400 otherwise. New rows default to the first palette color no other aircraft uses (client); the server default is `#ff6b35` |
| `icon` | `builtin:<key>`, `/images/aircraft-<id>.<ext>?v=<ms>` (uploaded), or an image URL | Blank → `builtin:twin-piston` |
| `notes` | Free text | `''` when blank |
| `visible` | 1 = drawn on the map | Defaults 1; changeable only by update |
| `cruise_kts` | Cruise speed; unlocks the planner | Optional; must be > 0 and ≤ 2000 |
| `min_runway_ft` | Shortest usable runway | Optional; 0..30000, rounded; 0 → null |
| `ceiling_ft` | Service ceiling | Optional; 0..100000, rounded; 0 → null |
| `oxygen` | 1 = pressurised or carries oxygen | Boolean; defaults 0 |
| `max_xwind_kts` | Maximum crosswind | Optional; 0..100, rounded; 0 → null |
| `ifr_capable` | 0 = VFR only | Boolean; defaults 1 |
| `cruise_alt_ft`, `climb_fpm`, `climb_kts`, `descent_fpm`, `overhead_min` | Block-time model inputs | Optional, rounded; 0 or blank → null; ranges 500–60000 ft, 50–10000 fpm, 20–600 kt, 50–10000 fpm, 1–120 min |
| `simbrief_type` | ICAO type designator for SimBrief links | Optional; upper-cased; must match `^[A-Z0-9]{2,6}$` |
| `sim_title`, `sim_livery` | The sim aircraft this row is bound to | Optional; a blank `sim_livery` means any livery of that title |

**Null means "not set".** For every optional number, blank and zero are stored as null, and null
means "no limit" (runway, ceiling, crosswind) or "use the default" (block-time inputs, whose
defaults are the planner's). Cruise speed is the exception: zero is rejected rather than cleared.

Aircraft are listed by `name, livery, id` ([routes.ts:155](../../../src/server/routes.ts#L155)).

**Name + livery identifies a fleet aircraft.** A create or update whose name and livery match
another row's — compared trimmed and case-insensitively, a blank livery matching a blank livery —
is refused with `409` naming the existing aircraft. Today duplicates are accepted.

**Deleting an aircraft deletes its whole tour**: its hops go with it (foreign-key cascade), and
each hop's SimBrief plan goes with its hop (simbrief, SB-HOP-003); a plan not on any hop, such as
the tracker's current plan, stays with its aircraft link cleared. Today every plan stays, with its
hop and aircraft links cleared ([db.ts:115](../../../src/server/db.ts#L115), [144-145](../../../src/server/db.ts#L144-L145)).
Its uploaded icon file is meant to be removed as well; today the file is left in `data/images`
([routes.ts:286-291](../../../src/server/routes.ts#L286-L291)).

## Appearance

**Color.** The form offers a 16-color palette plus a free color picker
([AircraftForm.tsx:210-225](../../../src/client/components/AircraftForm.tsx#L210-L225),
[icons.ts:86-90](../../../src/client/icons.ts#L86-L90)). A new aircraft starts on the first
palette color no other aircraft uses; when all are taken, it cycles
([icons.ts:114-117](../../../src/client/icons.ts#L114-L117)). The map's alternating hop shading
derives a lighter shade from this color, which is one reason only `#rrggbb` is accepted.

**Icon.** Three sources ([AircraftForm.tsx:227-262](../../../src/client/components/AircraftForm.tsx#L227-L262)):

- **Built-in** — eight top-down silhouettes drawn in the aircraft's color: single piston (low and
  high wing), twin piston, twin turboprop, business jet, airliner, helicopter, glider
  ([icons.ts:7-64](../../../src/client/icons.ts#L7-L64)). An unknown key falls back to twin piston.
- **Upload** — a PNG, JPEG, WebP, GIF or SVG under 4 MB. The form holds it as a pending image
  until the aircraft is saved, then uploads it; the server replaces any previous upload for that
  aircraft, writes `data/images/aircraft-<id>.<ext>`, and stores the path with a version stamp so
  browsers refetch it ([routes.ts:293-311](../../../src/server/routes.ts#L293-L311)). Over 4 MB is
  `413`; anything that is not a base64 image data URL of those types is `400`.
- **URL** — an image URL, applied when the field loses focus.

The badge shows a built-in as inline SVG and anything else as an image, inside a circle ringed in
the aircraft's color ([icons.ts:74-84](../../../src/client/icons.ts#L74-L84)); the same badge
marks the parked aircraft on the map and the preview in the form.

**Visibility.** The eye button on the card toggles `visible`; a hidden aircraft is not drawn on
the map and its card is dimmed ([Sidebar.tsx:207-210](../../../src/client/components/Sidebar.tsx#L207-L210),
[268-270](../../../src/client/components/Sidebar.tsx#L268-L270)).

## Performance and Limits

The form groups these fields ([AircraftForm.tsx:264-331](../../../src/client/components/AircraftForm.tsx#L264-L331)):

- **Cruise speed** "(unlocks the planner)" and **min runway** "(optional filter)".
- **Service ceiling** and **max crosswind**, both optional.
- **Block-time model**: typical cruise altitude, climb rate, climb speed, descent rate, taxi +
  approach minutes. Blank fields mean the light-piston defaults, shown as placeholders (6500 ft,
  700 fpm, 65% of cruise, 500 fpm, 12 min). Six class presets fill all five fields
  ([AircraftForm.tsx:10-17](../../../src/client/components/AircraftForm.tsx#L10-L17)); climb speed
  is the preset's fraction of the entered cruise speed, or left blank without one:

  | Preset | Cruise alt | Climb | Climb speed | Descent | Overhead |
  |---|---|---|---|---|---|
  | Piston single | 6500 | 700 | 65% | 500 | 12 |
  | Piston twin | 8000 | 1000 | 70% | 700 | 12 |
  | Turboprop | 24000 | 1500 | 60% | 1500 | 15 |
  | Light jet | 37000 | 2500 | 60% | 2000 | 15 |
  | Airliner | 35000 | 2000 | 60% | 2000 | 20 |
  | Helicopter | 2000 | 800 | 80% | 500 | 8 |

- **Pressurised / has oxygen** "(may cruise above 12,000 ft)" and **IFR capable** checkboxes.

What the planner does with these values — block time, range ring, field-elevation limits from
ceiling and oxygen, crosswind and IFR flags — is specified in the planner segment.

## Identity and the Sim Binding

Name and livery are what the user sees everywhere ("Name · Livery"). The two sim fields hold the
sim's `TITLE` and `LIVERY NAME`; the live panel's **Bind** writes them, and they can also be typed
in the form ([AircraftForm.tsx:358-372](../../../src/client/components/AircraftForm.tsx#L358-L372)).
How the tracker matches a flying sim aircraft to a row is specified in live-tracking.

**Create from the sim.** The live panel's **+ New** opens the new-aircraft form prefilled from the
sim aircraft: name = sim title, livery = the sim's ATC ID (else its livery name), sim title and sim
livery as reported; the fleet list scrolls to the form
([Sidebar.tsx:82-86](../../../src/client/components/Sidebar.tsx#L82-L86)). A different sim
aircraft remounts the form with fresh values ([Sidebar.tsx:140-153](../../../src/client/components/Sidebar.tsx#L140-L153)).

**SimBrief type.** An optional ICAO designator, upper-cased as typed, with suggestions from
SimBrief's type list and a hint naming the type or saying "Not in SimBrief's list (it may still
accept it)" ([AircraftForm.tsx:333-356](../../../src/client/components/AircraftForm.tsx#L333-L356)).
The list and the links it feeds belong to simbrief.

## The Aircraft Form

One form creates and edits ([AircraftForm.tsx](../../../src/client/components/AircraftForm.tsx));
only one aircraft form is open at a time ([Sidebar.tsx:40](../../../src/client/components/Sidebar.tsx#L40)).

- **Validation, in order** ([127-147](../../../src/client/components/AircraftForm.tsx#L127-L147)):
  name present; cruise speed > 0 if given; min runway ≥ 0; SimBrief type a 2–6 character
  designator if given; ceiling ≥ 0; crosswind ≥ 0; each block-time field a number ≥ 0. Blank
  numbers are sent as null. The server applies its own ranges on top.
- **Save** trims text, sends blank sim fields and SimBrief type as null, creates or updates, then
  uploads a pending image if there is one ([148-175](../../../src/client/components/AircraftForm.tsx#L148-L175)).
  Errors show inline.
- **Delete** (edit only) asks "Delete NAME (LIVERY) and all of its hops?" and deletes on
  confirmation ([177-188](../../../src/client/components/AircraftForm.tsx#L177-L188)).
- **Fleet header.** **+ Aircraft** toggles the new-aircraft form; with no aircraft and no form open
  the list reads "No aircraft yet. Add the plane and livery you fly, then log its first hop."
  ([Sidebar.tsx:132-157](../../../src/client/components/Sidebar.tsx#L132-L157)).

## The Aircraft Card Header

Each fleet row renders as a card ([Sidebar.tsx:238-278](../../../src/client/components/Sidebar.tsx#L238-L278)):

- Badge and name; clicking either highlights the aircraft on the map, or clears the highlight if
  it is already highlighted.
- Meta line: livery; "parked at IDENT" or "no hops yet"; cruise speed; ceiling in thousands of
  feet; "VFR only" when not IFR capable; "🔗 sim" with the bound title/livery on hover when bound.
- Actions: visibility eye, ✎ edit (opens this aircraft's form in the card), and `▸ n` to expand
  the hop list (the list itself belongs to logbook).

## API

| Method | Path | Behaviour | Errors |
|---|---|---|---|
| GET | `/api/aircraft` | All aircraft by name, livery, id | — |
| POST | `/api/aircraft` | Create → 201 + row (`visible` not accepted) | 400 per field rule; 409 duplicate name + livery (intended) |
| PUT | `/api/aircraft/:id` | Partial update; an omitted field keeps its value | 400; 404; 409 duplicate name + livery (intended) |
| DELETE | `/api/aircraft/:id` | Delete with its hops (and, intended, its icon file) → 204 | 400; 404 |
| POST | `/api/aircraft/:id/icon` | `{dataUrl}` → store the image, return the row | 400 bad data URL; 413 over 4 MB; 404 |

Handlers: [routes.ts:231-311](../../../src/server/routes.ts#L231-L311).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Unit of the fleet | One row per aircraft + livery | One row per aircraft type, liveries as variants | Wear-tracking add-ons persist per livery, and each livery resumes where it parked, so each pairing has its own tour. |
| Duplicate pairs | Refused (409), comparing name and livery trimmed and case-insensitively | Allow duplicates | The pairing is the unit of persistence; two rows for one pairing would split a single tour in two. |
| Optional numbers | Blank or zero stored as null, meaning "no limit" or "use the default" | Store zero; require values | [inferred] Lets a user leave anything unknown blank and still use the planner with defaults; zero is never a meaningful runway, ceiling or rate. |
| Color format | `#rrggbb` only | Any CSS color | [inferred] The map's alternating hop shade is computed from the hex value; a fixed format keeps that and the palette matching working. |
| Default color | First palette color unused by the fleet | Fixed default; random | [inferred] Each new aircraft's tour stands apart on the map without the user choosing. |
| Uploaded icons | Stored as files in `data/images`, one per aircraft, version-stamped path; removed with the aircraft | Store in the database; keep every upload | [inferred] Served statically with long caching; the version stamp forces a refresh after replacement. |
| SVG uploads | Accepted alongside PNG, JPEG, WebP and GIF | Raster images only | Vector silhouettes are a natural icon format, and the app serves only its local user, so the script risk of a self-uploaded SVG is accepted. |
| Block-time defaults and presets | Blank fields fall back to light-piston defaults; the form offers six class presets | Require every field | [inferred] Most users know their cruise speed but not climb and descent figures; presets give plausible numbers in one click. |
| Sim binding fields | Stored on the fleet row; set by Bind or typed | A separate binding table | [inferred] One sim aircraft maps to one fleet row; the row is the natural home. A blank sim livery binds every livery of the title. |
| Delete | Deletes the aircraft and its whole tour, after a confirmation naming both | Refuse while hops exist; a "retired" state that keeps the hops | Removing an aircraft removes its tour; hiding it (visibility) covers keeping a tour off the map. |
| New from sim | Prefill name from the sim title and livery from the ATC ID, falling back to the livery name | Leave blank | [inferred] The ATC ID is usually the registration, which is what the livery field holds. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Name + livery is unique (see Decisions).
2. ✅ SVG uploads stay accepted (see Decisions).
3. ✅ Deleting an aircraft deletes its whole tour (see Decisions).

### Deferred

1. **Existing duplicate pairs.** A database created before the uniqueness rule may already hold
   two rows with the same name and livery; the rule refuses new ones and leaves those as they are.
2. **Uploaded bytes are not checked** against the declared image type; only the data-URL prefix
   is ([routes.ts:298-301](../../../src/server/routes.ts#L298-L301)).
3. **Two copies of the block-time defaults.** The form's placeholders and presets restate the
   planner's defaults ([AircraftForm.tsx:10-25](../../../src/client/components/AircraftForm.tsx#L10-L25)
   vs [performance.ts:27](../../../src/server/performance.ts#L27)).
4. **Boolean coercion.** `oxygen` and `ifr_capable` use JavaScript truthiness, so the string
   `"false"` becomes 1 ([routes.ts:196](../../../src/server/routes.ts#L196)). The form sends real
   booleans.
5. **Silent visibility failure.** The eye button does not catch errors
   ([Sidebar.tsx:207-210](../../../src/client/components/Sidebar.tsx#L207-L210)).
6. **Icon field quirks.** Clearing the URL field does not revert the icon, and the file input keeps
   showing a chosen file after a built-in is picked ([AircraftForm.tsx:119-125](../../../src/client/components/AircraftForm.tsx#L119-L125)).
7. **Deleting a bound aircraft mid-flight.** The tracker keeps the deleted id and, on landing,
   finds the row gone and leaves the leg pending (live-tracking).

## References

- Code: [src/server/routes.ts](../../../src/server/routes.ts) (aircraft section 116-311),
  [src/server/db.ts](../../../src/server/db.ts) (aircraft table),
  [src/client/components/AircraftForm.tsx](../../../src/client/components/AircraftForm.tsx),
  [src/client/icons.ts](../../../src/client/icons.ts) (built-ins, badge HTML, palette, `nextColor`),
  [src/client/components/Sidebar.tsx](../../../src/client/components/Sidebar.tsx) (fleet header, `AircraftCard` header, new-from-sim prefill)
- Consumers: planner (performance and limit fields), live-tracking (sim binding fields), simbrief
  (`simbrief_type`, registration from the livery), tour-map (color, icon, visibility), logbook
  (aircraft ids)
