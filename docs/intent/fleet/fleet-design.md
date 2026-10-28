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
delete, create from the sim), the performance table of SimBrief's types and the method that builds it, uploaded icons and how aircraft rows name them, the color palette and
built-in icons, and the header of each aircraft card. It does not own how performance fields become
flight times or filters (planner), how a sim aircraft is matched to a row (live-tracking),
SimBrief's type list (simbrief), where an aircraft is parked or its hop list (logbook), how
aircraft are drawn on the map (tour-map), or the data folder that holds the logbook and its
uploaded icons, and how backups, a restore and a logbook brought in — from another data folder or
from another logbook's backup — carry them (app-shell).

The fleet behaves the same wherever its page is shown — the installed app's window, or a browser
tab on a copy run from source or a test server — since the same server serves the same page to
each, at a port of each copy's own (HLD, System Design).

## The Aircraft Record

One row in `aircraft` ([db.ts:90-111](../../../src/server/db.ts#L90-L111); later columns added in
place at [db.ts:163-176](../../../src/server/db.ts#L163-L176)). Server validation lives at
[routes.ts:164-211](../../../src/server/routes.ts#L164-L211).

| Field | Meaning | Rule on write |
|---|---|---|
| `name` | Aircraft name, e.g. "A2A Aerostar 600" | Required, trimmed; blank → 400 "name is required" |
| `livery` | Livery or registration | Optional, `''` when blank |
| `color` | Path and badge color | `#rrggbb` only; 400 otherwise. New rows default to the first palette color no other aircraft uses (client); the server default is `#ff6b35` |
| `icon` | `builtin:<key>`, `/images/aircraft-<id>.<ext>?v=<ms>` (uploaded), or an image URL | Blank → `builtin:twin-piston`. A new or changed non-blank value must be a built-in (any key) or an http or https address on a host other than this PC, else 400; an unchanged value is kept (intended; see [Uploaded Icons and the Logbook](#uploaded-icons-and-the-logbook)); today any text is accepted |
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
| `airline` | ICAO airline designator for SimBrief links, e.g. `JBU` | Optional; trimmed and upper-cased; must be three letters (`^[A-Z]{3}$`), 400 otherwise; blank → null |
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
Once the row is deleted, every uploaded icon file named for its id is removed as well, so the icons
folder keeps no file for an aircraft that no longer exists ([Uploaded Icons and the
Logbook](#uploaded-icons-and-the-logbook)). A file Windows will not let go of (an antivirus scan, an
Explorer thumbnail) is left and logged, and the delete still answers `204`: a file left under a
deleted id is harmless, since no row names it and none can be made to (FLEET-REC-018), rows saved
before that rule aside (Deferred 9). Removing the files only after the row means a failure never
leaves a surviving aircraft naming a removed file (FLEET-REC-017). Today the files are left in the
icons folder ([routes.ts:286-291](../../../src/server/routes.ts#L286-L291)).

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
- **Upload** — a PNG, JPEG, WebP, GIF or SVG under 4 MB, picked with the page's file input
  (Windows' file dialog, in a browser tab and the installed app's window alike). The form holds it as a pending image until the aircraft is
  saved, then uploads it; the server removes every file named for that aircraft's id, writes
  `aircraft-<id>.<ext>` to the icons folder (`images/` beside the database, app-shell), and sets
  the icon to `/images/aircraft-<id>.<ext>?v=<ms>`, whose version stamp makes the page fetch the
  new image rather than one it has cached
  ([routes.ts:293-311](../../../src/server/routes.ts#L293-L311)). Over 4 MB is `413`; anything that
  is not a base64 image data URL of those types is `400`.
- **URL** — an http or https image address on another host, applied when the field loses focus.
  The page loads it from that host, in a browser tab and in the installed app's window alike, since
  the window leaves the page's own requests unfiltered (desktop shell, DESK-SHELL-WIN-011); the
  logbook holds only the address, so the badge shows only while that host serves the image.

The badge shows a built-in as inline SVG and anything else as an image, inside a circle ringed in
the aircraft's color ([icons.ts:74-84](../../../src/client/icons.ts#L74-L84)); the same badge
marks the parked aircraft on the map and the preview in the form.

### Uploaded Icons and the Logbook

An uploaded icon is part of the logbook: the HLD keeps uploaded icons in the data folder beside the
database and backs them up with it, and a logbook restored from a backup, or brought in on a first
run — from another data folder, such as a copy run from source, or from another logbook's backup —
shows the same badges it showed where it came from. Where the icons are kept, and how a backup, a
restore and a logbook brought in carry them with the database, is app-shell's: a backup holds a
copy of each icon file the rows name (APP-BAK-003), a logbook brought in carries them the same way
(APP-IMP-003), and opening a restored or brought-in logbook puts its icons in place of the icons
folder's (APP-BAK-011). Fleet guarantees what that work relies on:

- **One upload per aircraft, named by its id.** An aircraft's uploaded icon is the one file
  `aircraft-<id>.<ext>` in the icons folder — the aircraft's id and the image's type (`png`, `jpg`,
  `webp`, `gif` or `svg`). An upload first removes every file named for that id, whatever its type
  (FLEET-LOOK-006), and deleting the aircraft removes them too (FLEET-REC-017).
- **A row names an upload only by making it.** Only an upload sets an aircraft's icon to an
  `/images/` address, and only for its own aircraft (FLEET-REC-018), having just replaced every file
  named for that id. A file left in the folder under an id therefore never shows for another
  aircraft (rows saved before the rule aside, Deferred 9). Ids are never reused within a logbook
  (`AUTOINCREMENT`) until a restore from an older backup winds the counter back; an aircraft that
  then takes the id names no `/images/` address until its own upload replaces the file. Two
  logbooks can each hold an aircraft with the same id, so their icons must never mix: a logbook
  brought in comes with its own icons and keeps none of the logbook it replaces (app-shell,
  APP-IMP-003, APP-BAK-011), or a brought-in row would show the replaced logbook's file of the same
  name.
- **An address on the server's own origin.** The row names its upload as
  `/images/aircraft-<id>.<ext>?v=<ms>` — no scheme, host or port — so the same row shows its badge
  whichever port serves the page: a copy run from source, the installed app, a test server. The
  file is the address's path after `/images/`, up to the `?`, so the icons a logbook uses are found
  from its rows alone. The version stamp is the upload's time in milliseconds, so a page that cached
  an earlier image under another stamp — in a browser tab, or in the window, whose cache outlives a
  logbook brought in or restored — never shows it in place of the image the row names.
- **No row names another aircraft's upload, or this PC's own server.** A new or changed non-blank
  icon is a built-in or an http or https address on a host other than this PC — its host, read as
  the URL parser reads it, being none of `localhost` or a name ending in `.localhost`, a
  `127.x.x.x` address, `[::1]` or `0.0.0.0` (FLEET-REC-018). An address copied from the page —
  `http://127.0.0.1:3080/images/aircraft-5.png?v=…`, the natural way to give a second livery the
  first one's image — would tie the row to that copy's port and to another aircraft's file, which a
  later upload or delete replaces or removes; the pilot uploads the image again for the second
  livery instead. So the uploaded icons a logbook uses are exactly the files its rows' `/images/`
  addresses name, each named by its own row's id (rows saved before the rule aside, Deferred 9).

A logbook's database is not whole without those files. A backup restored without them shows a
broken badge for every aircraft deleted since, or whose upload has since been replaced by an image
of another type, since the file its row names is gone, and one replaced by an image of the same
type shows the later image; a logbook brought in without them shows none of its uploads. So a
backup, a restore and a logbook brought in carry the files the rows name together with the
database (app-shell, APP-BAK-003, APP-BAK-011, APP-IMP-003).

The window adds nothing of its own: it loads `/images/` from the server as a browser tab does,
and image addresses on other hosts as they are (desktop shell). An upload replaced by a built-in or
URL icon stays in the folder, unnamed by any row, until that aircraft uploads again or is deleted
(Deferred 8).

**Visibility.** The eye button on the card toggles `visible`; a hidden aircraft is not drawn on
the map and its card is dimmed ([Fleet.tsx:109-112](../../../src/client/components/Fleet.tsx#L109-L112),
[174](../../../src/client/components/Fleet.tsx#L174)).

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
  | Light jet | 37000 | 2500 | 90% | 2000 | 15 |
  | Airliner | 35000 | 2000 | 90% | 2000 | 20 |
  | Helicopter | 2000 | 800 | 80% | 500 | 8 |

- **Pressurised / has oxygen** "(may cruise above 12,000 ft)" and **IFR capable** checkboxes.

What the planner does with these values — block time, range ring, field-elevation limits from
ceiling and oxygen, crosswind and IFR flags — is specified in the planner segment.

## The Performance Table

Looking up a type's numbers is the slowest part of adding an aircraft, and numbers each pilot finds
on their own vary in what they mean and where they came from, which skews the planner. So the app
ships a **performance table**: for every type in SimBrief's type list, the values the form asks for,
researched once by the method below, each with where it came from. Choosing a type in the form and
asking for its numbers fills them in; the pilot can change any of them before saving, and a type the
table does not hold is typed in by hand as before.

### What an entry holds

One entry per ICAO designator in the SimBrief type list the table was built from (its snapshot date
is recorded in the table):

- **type** and **name** — the designator and SimBrief's name for it at the snapshot;
- **variant** — what the numbers describe, in words: the model, and the engines where the type has
  more than one choice (for "737-800": "737-800 with winglets, CFM56-7B26"). SimBrief's name decides
  the variant; where it covers several, the variant most built, and where no record settles which
  was built most, the one MSFS add-ons model (which chooses the variant, not a number), and where no
  accepted source gives the chosen variant's numbers, the variant of the same type whose numbers are
  published, noted; where the variant
  is certified at several weights, the heaviest the manufacturer's planning documents give (its maximum
  design weights);
- **preset** — the form's class preset the type belongs to, which gives taxi + approach minutes and
  any preset value: Piston single for one engine and Piston twin for two or more, Turboprop for any turboprop (single
  or twin), Light jet for any business jet whatever its size, Airliner for jet transports (airline
  and military), Helicopter for rotorcraft;
- **icon** — the built-in icon whose shape fits (a single-engine turboprop takes a single piston
  silhouette, its wing low or high as built);
- **pressurised** — yes or no;
- **the eight numbers** — cruise speed, minimum runway, service ceiling, maximum crosswind, typical
  cruise altitude, climb rate, climb speed and descent rate.

Each of the eight numbers, and pressurised, is either blank or a value with its **provenance**:

- **published** — given by a source the method accepts, cited by title, publisher, the page or
  table, and an address where anyone can read it (a copy on the publisher's site, or an archived
  copy of it);
- **derived** — worked out from published figures by a stated calculation, the calculation written
  out and each figure it uses cited (an average climb rate from a published time to climb, a true
  airspeed from a published Mach number and altitude in the standard atmosphere);
- **preset** — the class preset's value, for a block-time input (climb rate, climb speed, descent
  rate, cruise altitude) that no accepted source gives, said as such wherever the value is shown.
  The entry holds it as a number like any other: a climb speed is the preset's fraction of the
  entry's cruise speed, rounded to 5 kt (blank when the entry has no cruise speed); a cruise
  altitude is the preset's, lowered to the type's ceiling where that is lower and to 12,000 ft for
  an unpressurised type.
- **estimated** — for a cruise speed or minimum runway that no accepted source gives: the same
  number of the nearest similar type in the table, taken as it stands and naming that type, said as
  such wherever the value is shown ("estimated from 737-300"). The similar type's number must be
  published or derived, so an estimate never rests on another estimate; a preset climb speed is
  worked from an estimated cruise speed like any other.

The nearest similar type is, in order: a version of the same family by the same maker (the 737-300
for the 737-200, the Dash 8-400 for the -100), whatever its size; else a type of the same class
preset and engine kind whose maximum takeoff weight is closest, a type by the same maker winning
when its weight is within a fifth of the type's. Outside the family, the similar type's maximum
takeoff weight must lie between two-thirds and one and a half times the type's own, and it must not
plainly fly differently for that number (a fast commuter's cruise speed for a slow STOL design);
where no type qualifies, the value stays blank. The value's note names the similar type and why it
was chosen.

A ceiling or crosswind no accepted source gives stays blank: a blank one means "no limit" to the
planner (FLEET-REC-006), which is better than a guessed limit. Every entry records when it was researched and when its values were checked (below),
as dates (`YYYY-MM-DD`). The table ships only checked entries, and an entry with all eight numbers
blank is left out; each type of the snapshot that is left out is listed in the table with the reason,
which is always that no accepted source gives any of its numbers — never that it is not researched
yet, so a release carries the whole snapshot (distribution, DESK-DIST-REL-012).

An entry's sources are listed once, each with an id the values cite, an MSFS add-on's manual marked
as one so the table's checks can hold it to the values it may give (Sources shows it like any
other); a value's calculation (derived)
and a note — a lower-ranked source that disagreed, the published figure's own conditions — are
text on the value.

**Rounding.** Published figures are kept as published, in whole units, and so is a published
figure only converted between units (miles per hour to knots, metres to feet). Other derived values are rounded as
the planner can use them and a checker can rework them: speeds to the nearest 5 kt, rates to the
nearest 50 fpm, a cruise altitude to the nearest 500 ft, and a runway length up to the next 100 ft.

Taxi + approach minutes always come from the preset: nothing publishes them, and they describe the
career's flying more than the airframe.

### What each number means

The table's numbers mean what the planner uses them for (planner, Block-Time Model), so a value
from a source is converted to that meaning, the conversion stated as a derivation:

| Field | Meaning in the table |
|---|---|
| Cruise speed, kt | True airspeed in normal cruise at the typical cruise altitude, standard atmosphere: for jets, the manufacturer's typical or economy cruise Mach, else its headline (maximum or high-speed) cruise, noted as such; for pistons and turboprops, the manufacturer's headline cruise figure where it names its power and altitude, else the POH's cruise at 75% power (pistons) or normal cruise power (turboprops) at the altitude where that power is fastest, else the manufacturer's headline cruise speed noted as such (naming neither power nor altitude) |
| Min runway, ft | The longer of the takeoff field length and the landing field length, sea level, standard day, dry paved runway, at typical load: for airliners and business jets, takeoff at the weight midway between maximum landing weight and maximum takeoff weight read from the manufacturer's airport-planning chart, landing at maximum landing weight; for piston and turboprop types, the POH or flight manual's figures at maximum gross weight (over a 50 ft obstacle where it gives both). An airport-planning chart's field lengths are taken as it gives them (the regulatory takeoff and landing field lengths), read between plotted weights in a straight line, on the curve for the flap setting the manufacturer gives for normal operation, else the shortest. Where no chart gives the typical weight, the figure at maximum takeoff weight |
| Service ceiling, ft | The certified maximum operating altitude; for a type with none certified, the manufacturer's published service ceiling |
| Max crosswind, kt | The maximum demonstrated crosswind from the flight manual or POH, or the manufacturer's published crosswind guidance where it gives no demonstrated value, or, where neither is public, the crosswind limit an authority's type certificate data sheet certifies (gusts included, noted as a limit); for a dry runway, and the lower of the takeoff and landing values where it gives both |
| Typical cruise altitude, ft | The altitude at which the manufacturer quotes the cruise speed above, or its published typical or initial cruise altitude |
| Climb rate, fpm | The average rate from sea level to the typical cruise altitude: that altitude divided by the published time to climb to it |
| Climb speed, kt | The average true airspeed over that climb, which the planner uses for the distance covered while climbing: the published distance to climb divided by the time, or the published climb schedule (indicated speed and Mach) converted to true airspeed in the standard atmosphere and averaged over the climb's time |
| Descent rate, fpm | The average rate from the typical cruise altitude to the field: that altitude divided by the published time to descend, or the manufacturer's published normal descent rate |

Published times and distances to climb and descend are taken as published — from brake release or
from 1,500 ft, to the field or to 1,500 ft above it, at the weight the source gives — with the
conditions noted, not corrected: the planner's model is coarser than the difference. Where the only published time
to climb is to an altitude other than the typical cruise altitude, the climb rate is the average to that
altitude, noted as such: a better figure than the class preset.

Two versions of one airframe with the same maximum operating Mach but different engines (an A320neo
beside the A320, a Challenger 300 beside the 350) share a cruise Mach: where no accepted source gives
one version's own, it takes the other's published cruise Mach, as a derived cruise speed noted as the
sister version's figure. Only
the cruise speed: runway, climb, descent and every other number depend on the engines and need the
version's own source. The planner
flies the descent at cruise speed (planner, Block-Time Model); the table's descent rate is the
type's own all the same.

### Accepted sources

In order of preference:

1. Type certificate data sheets from an aviation authority (FAA, EASA, Transport Canada, ANAC and
   the like) — ceilings, pressurisation, weights. A complete, unaltered copy of a data sheet counts wherever it is hosted when the
   authority's own copy cannot be opened, cited as the authority's document with its revision.
2. The manufacturer's own publications — airport-planning manuals, the POH or pilot's information
   manual, the flight manual, flight crew operating and training manuals where the manufacturer
   publishes them, specification sheets and brochures — current, or an archived copy of the
   manufacturer's own document, or a complete, unaltered copy of it that an aviation authority or
   agency hosts (cited as the manufacturer's document, at that address), or a complete, unaltered
   copy or legible scan of one of the manufacturer's published documents — its handbook (POH, owner's
   manual, flight manual), a data sheet or brochure — for the right model, wherever it is hosted (the
   Internet Archive preferred), cited with its title, part number or date — never an excerpt, a
   retyped copy or an owner's checklist. For a conversion (a turbine Bonanza, say), the holder of its
   supplemental type certificate counts as the manufacturer, and the authority's record of that
   certificate as a type certificate data sheet.
3. Government and military publications — official fact sheets, an authority's or research
   agency's technical reports (FAA, NASA, NTSB).
4. Reputable aviation references and trade journals with editors who answer for them, where the
   three above give nothing — Jane's All the World's Aircraft, Flight International (FlightGlobal),
   Aviation Week and Business & Commercial Aviation, Aircraft Commerce, and the flight tests and pilot
   reports of AOPA and Flying, among them — cited by publication, issue or edition, and page.
5. The manual of an MSFS 2020 or 2024 add-on that models the entry's variant, for the cruise speed,
   minimum runway, service ceiling, maximum crosswind or pressurisation where the four above give
   nothing under the rules on this page — the sister version's cruise Mach and the published-variant
   fallback included — and for a type they leave out altogether; with a cruise speed it supplies, the
   altitude the manual quotes that speed at, as the typical cruise altitude. Never for any other
   block-time input (climb rate, climb speed, descent rate, or a cruise altitude on its own), which
   keeps its class preset. Where several
   add-ons model the variant: the manual with the most performance detail (tables or charts that
   reproduce the real flight manual's, ahead of the developer's own guidance for flying it in the
   sim), the add-on's MSFS 2024 version ahead of its 2020 one. Only a manual the developer publishes
   where anyone can read it without buying the add-on (on its own site — its own forum included,
   where the developer's staff post it — or a store's documentation page, or an archived copy of
   either), cited by add-on, developer, manual version or date, and page;
   its figures mean what the table above says, converted as for any other source.

An encyclopedia's figure counts only through the source it cites: the researcher follows its
reference and cites that source, if the method accepts it.

Not accepted as a source: encyclopedias and wikis (Wikipedia included), forums, airline and
enthusiast sites, flight-simulation community sites and file libraries (an add-on's manual there
counts only through the developer's own copy), add-ons' store descriptions and the files installed
with them, and databases whose terms forbid republishing their figures without permission —
EUROCONTROL's Aircraft Performance Database and the SKYbrary pages drawn from it among them. These
may still point the researcher to a primary source or flag a value that disagrees with them, but no
value cites them. A source the checker cannot open does not count.

### Researching and checking

The table is built in two passes, each type by one reader, then checked by another:

1. **Research.** A reader finds the accepted sources for the type, records each value with its
   provenance as above, and leaves blank (or preset) what none gives. Where two accepted sources
   disagree, the higher-ranked one wins, and the other is noted.
2. **Check.** A second reader, without the first one's reasoning, opens every cited source, confirms
   each published value is there as cited, reworks each derivation, and confirms the variant. A
   value that does not hold is corrected from the source, or blanked; the entry records the check's
   date.

Estimates come last, once every tier has been tried: the similar type is chosen by the rule above,
the choice is reviewed with the pilot, and the table's checks hold each estimate to the similar
type's current number, so a later correction to that type shows up as a problem until the estimate
follows it. A type left out keeps its place among the left out: an estimate fills a gap in an entry,
never makes one.

The fifth tier is brought to entries already checked by one pass over the types with a value it may
fill, and one reader: it adds only those values, leaving the rest as checked, and its reader reads each
figure back from the manual before recording it; the entry's dates become that pass's.

The table is built for the types in the pilot's own fleet first, compared with the values the pilot
already uses, then for the rest. A new SimBrief type is added by the same two passes; a script lists
the types in SimBrief's current list that the table lacks.

### In the form

The form loads the table's list of types once per page, as it does SimBrief's list. When its
SimBrief type, upper-cased and trimmed, is a type the table holds — whether or not SimBrief's current
list still holds it — the type hint (FLEET-SIM-004) names the type (SimBrief's name, else the
table's) and also offers **Fill from table** and **Sources**. While the list is loading, or if it
could not be loaded, neither is offered and the form works as before.

**Fill from table** fetches the entry and fills the form, saving nothing:

- each of the eight numbers the entry gives as published or derived replaces the field's value; one
  it gives as preset or estimated fills the field only while it is blank, so a figure the pilot typed
  is never replaced by a class figure or another type's; a number the entry leaves blank leaves the
  field as it is;
- taxi + approach minutes from the entry's preset, while that field is blank;
- **Pressurised / has oxygen** is ticked when the type is pressurised, and never unticked (an
  unpressurised aircraft may carry oxygen);
- the icon becomes the entry's built-in icon only while the aircraft's icon is a built-in one (a new
  aircraft's default included) and no image is picked or typed; an uploaded, picked or URL icon
  stays;
- **IFR capable**, name, livery, color, notes, the SimBrief type and the sim binding are untouched.

An entry that arrives after the type field has changed is dropped, so only the type the form names
fills it; one that cannot be fetched fills nothing and the form says so. The form then says which
values it filled from which type ("Filled 9 values from 737-800"); the note stays until the next
fill or until the form closes, and values the pilot edits afterwards are theirs, a filled climb
speed included (it is not reworked when cruise speed changes).

**Sources** shows the entry without filling anything: its variant, research and check dates, and for
each value its provenance — the source's title, publisher and page with a link to it, the
calculation of a derived value, its note, "class preset", or "estimated from" the similar type's
name. It is there for any type the table
holds, so a saved aircraft's form shows where its type's numbers come from, though nothing records
which of its values came from the table: what is saved is the values alone.

A saved aircraft never changes by itself when the table changes in a later release; the pilot can
open its form and fill again.

The table is the server's (`GET /api/aircraft-types`, the list; `GET /api/aircraft-types/:type`, one
entry with its sources), bundled into the server with the rest of its code, so a browser tab and the
installed app's window show the same and it needs no network. The class presets' figures are the
form's (FLEET-PERF-003); the table's preset values are checked against them.

A development script lists the types in SimBrief's current list that the table neither holds nor
lists as left out, sending the server's User-Agent; the app itself never runs it.

## Identity and the Sim Binding

Name and livery are what the user sees everywhere ("Name · Livery"). The two sim fields hold the
sim's `TITLE` and `LIVERY NAME`; the live panel's **Bind** writes them, and they can also be typed
in the form ([AircraftForm.tsx:358-372](../../../src/client/components/AircraftForm.tsx#L358-L372)).
How the tracker matches a flying sim aircraft to a row is specified in live-tracking.

**Create from the sim.** The live panel's **+ New** opens the new-aircraft form prefilled from the
sim aircraft: name = sim title, livery = the sim's ATC ID (else its livery name), sim title and sim
livery as reported; the page opens the Fleet drawer scrolled to the form (app-shell)
([App.tsx:321-324](../../../src/client/App.tsx#L321-L324)). A different sim
aircraft remounts the form with fresh values ([Fleet.tsx:42-55](../../../src/client/components/Fleet.tsx#L42-L55)).

**SimBrief type.** An optional ICAO designator, upper-cased as typed, with suggestions from
SimBrief's type list and a hint naming the type or saying "Not in SimBrief's list (it may still
accept it)" ([AircraftForm.tsx:333-356](../../../src/client/components/AircraftForm.tsx#L333-L356)).
The list and the links it feeds belong to simbrief.

**Airline.** An optional three-letter ICAO airline designator (`JBU`, `BAW`), beside the SimBrief
type and upper-cased as typed, for the airline an aircraft flies for in the career. It fills the
airline box of SimBrief's dispatch page in the links simbrief builds for the aircraft; nothing else
reads it. An aircraft flown for no airline leaves it blank.

## The Aircraft Form

One form creates and edits ([AircraftForm.tsx](../../../src/client/components/AircraftForm.tsx));
only one aircraft form is open at a time ([Fleet.tsx:13](../../../src/client/components/Fleet.tsx#L13)).

- **Validation, in order** ([127-147](../../../src/client/components/AircraftForm.tsx#L127-L147)):
  name present; cruise speed > 0 if given; min runway ≥ 0; SimBrief type a 2–6 character
  designator if given; airline three letters if given; ceiling ≥ 0; crosswind ≥ 0; each block-time field a number ≥ 0. Blank
  numbers are sent as null. The server applies its own ranges on top.
- **Save** trims text, sends blank sim fields, SimBrief type and airline as null, creates or updates, then
  uploads a pending image if there is one ([148-175](../../../src/client/components/AircraftForm.tsx#L148-L175)).
  Errors show inline. Unsaved values, a picked image among them, live only in the page: closing the
  window or anything that reloads the page — the pilot, or the window after a lost renderer
  (DESK-SHELL-WIN-020) or a logbook brought in (DESK-SHELL-SRV-043) — discards them, as closing a
  browser tab does.
- **Delete** (edit only; **Delete aircraft**) asks "Delete NAME (LIVERY) and all of its hops?" and
  deletes only on confirmation; a question cancelled or closed unanswered deletes nothing
  (FLEET-FORM-003; [177-188](../../../src/client/components/AircraftForm.tsx#L177-L188)). In the
  installed app's window the question is a Windows message box, never answered for the pilot, and
  closed as if cancelled when the app begins to quit (desktop shell, DESK-SHELL-WIN-013,
  DESK-SHELL-QUIT-002).
- **Fleet header.** **+ Aircraft** toggles the new-aircraft form; with no aircraft and no form open
  the list reads "No aircraft yet. Add the plane and livery you fly, then log its first hop."
  ([App.tsx:415-422](../../../src/client/App.tsx#L415-L422), [Fleet.tsx:42-59](../../../src/client/components/Fleet.tsx#L42-L59)).

## The Aircraft Card Header

Each fleet row renders as a card ([Fleet.tsx:142-181](../../../src/client/components/Fleet.tsx#L142-L181)):

- Badge and name; clicking either highlights the aircraft on the map, or clears the highlight if
  it is already highlighted.
- Meta line: livery; "parked at IDENT" or "no hops yet"; cruise speed; ceiling in thousands of
  feet; "VFR only" when not IFR capable; a link icon with "sim", and the bound title/livery on
  hover, when bound. The items wrap as whole items, never mid-item.
- Actions: visibility (an eye, or a crossed-out eye while hidden), **Edit aircraft** (pencil; opens
  this aircraft's form in the card), and a chevron with the hop count to expand the hop list (the
  list itself belongs to logbook).

The fleet list lives in the **Fleet** drawer, opened from the page's menu (app-shell); the drawer's
header holds **+ Aircraft**.

## API

| Method | Path | Behaviour | Errors |
|---|---|---|---|
| GET | `/api/aircraft` | All aircraft by name, livery, id | — |
| GET | `/api/aircraft-types` | The performance table's snapshot date and its types (designator, name, variant) | — |
| GET | `/api/aircraft-types/:type` | One entry, designator matched upper-cased and trimmed: type, name, variant, preset, icon, pressurised, the eight numbers each with its provenance (kind, cited source ids, calculation, note), the sources it cites (id, title, publisher, page, address), research and check dates | 404 not in the table, a malformed designator included |
| POST | `/api/aircraft` | Create → 201 + row (`visible` not accepted); a blank icon becomes `builtin:twin-piston` | 400 per field rule, a non-blank icon neither built-in nor an http or https address off this PC among them (intended); 409 duplicate name + livery (intended) |
| PUT | `/api/aircraft/:id` | Partial update; an omitted field keeps its value, and an icon sent unchanged is kept as it is | 400 (a changed non-blank icon as for POST, intended); 404; 409 duplicate name + livery (intended) |
| DELETE | `/api/aircraft/:id` | Delete with its hops, then (intended) remove every icon file named for its id, leaving and logging one that cannot be removed → 204 | 400; 404 |
| POST | `/api/aircraft/:id/icon` | `{dataUrl}` → remove every icon file named for the id, store the image as `aircraft-<id>.<ext>`, set the icon to `/images/aircraft-<id>.<ext>?v=<ms>`, return the row | 400 bad data URL; 413 over 4 MB; 404 |

Handlers: [routes.ts:231-311](../../../src/server/routes.ts#L231-L311).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Unit of the fleet | One row per aircraft + livery | One row per aircraft type, liveries as variants | Wear-tracking add-ons persist per livery, and each livery resumes where it parked, so each pairing has its own tour. |
| Duplicate pairs | Refused (409), comparing name and livery trimmed and case-insensitively | Allow duplicates | The pairing is the unit of persistence; two rows for one pairing would split a single tour in two. |
| Optional numbers | Blank or zero stored as null, meaning "no limit" or "use the default" | Store zero; require values | [inferred] Lets a user leave anything unknown blank and still use the planner with defaults; zero is never a meaningful runway, ceiling or rate. |
| Color format | `#rrggbb` only | Any CSS color | [inferred] The map's alternating hop shade is computed from the hex value; a fixed format keeps that and the palette matching working. |
| Default color | First palette color unused by the fleet | Fixed default; random | [inferred] Each new aircraft's tour stands apart on the map without the user choosing. |
| Uploaded icons | One per aircraft, named `aircraft-<id>.<ext>`, kept as files in the icons folder beside the database; an upload replaces every file named for its aircraft's id, and deleting the aircraft removes them once its row is gone | Keep every upload; keep the image in the logbook database itself | Files are what the HLD's data folder holds beside the database, are served straight from disk with a year-long cache, and keep image bytes of up to 4 MB each out of the live logbook database that every request reads; the version stamp in the address forces a refresh after replacement. The cost is that a backup, a restore and a logbook brought in must carry the icons the rows name as well as the database: a backup holds copies of them in a table of its own, which a restore puts back as files (app-shell, APP-BAK-003, APP-BAK-011, APP-IMP-003). One file per aircraft, named by its id and replaced whole by each upload, lets the data folder's owner find every icon a logbook uses from its rows alone and keeps the folder from growing with every replaced image. Which folder holds the icons, and how backups, a restore and a logbook brought in carry them, is app-shell's; these naming rules hold wherever that is. |
| Icon address of an upload | `/images/aircraft-<id>.<ext>?v=<ms>`, on the server's own origin | An absolute address with host and port; the file name alone, made into an address by the page | The same logbook is served at different ports — a copy run from source, the installed app, a test server — and moves between them when brought in or restored; an address without host or port shows the badge on each. The page and every reader of the row already treat the icon as an image address, so an origin-relative one needs no second kind of value. |
| Icons a create or change accepts | A blank icon (the built-in twin piston), a built-in with any key (an unknown one drawn as twin piston), or an http or https address on a host other than this PC, its host read as the URL parser reads it; anything else — an address on this PC, another aircraft's upload, a `data:` address — refused (400, asking for an upload instead); an icon an update leaves unchanged kept | Accepting any text; copying the named upload as the aircraft's own; rewriting the address to the current origin; accepting only the eight built-in keys; comparing the host as typed | An address on `127.0.0.1` or `localhost` works only while that copy runs on that port, and one naming another aircraft's upload breaks when that aircraft's icon is replaced or it is deleted; neither travels with the logbook. A `data:` address would carry the whole image in every fleet list the page loads, and other text is no image address at all. Copying or rewriting would guess at what the pilot meant; uploading the image again is one step. Keeping an unchanged icon lets rows saved before the rule still be edited. Any built-in key is accepted because the badge already draws an unknown one as twin piston. The host is read as parsed because `LOCALHOST`, `127.1` and `localhost.` all reach this PC while reading differently as typed. |
| SVG uploads | Accepted alongside PNG, JPEG, WebP and GIF | Raster images only | Vector silhouettes are a natural icon format. The page shows an upload only as an image, where an SVG's scripts never run; the server listens only on this PC and refuses changes asked for by other sites' pages (app-shell), and the page has no bridge into the installed app's desktop shell, so the script risk of a self-uploaded SVG is accepted. |
| The jets' preset climb speed | 90% of cruise for Light jet and Airliner | 60%, like the turboprops | The planner uses climb speed as the average true airspeed over the whole climb, and a jet climbs at a high and rising true airspeed: Airbus's own climb tables put the A320's average at 420 kt against a 450 kt cruise. 60% made a jet's climb cover too little ground and its block times too long. |
| Block-time defaults and presets | Blank fields fall back to light-piston defaults; the form offers six class presets | Require every field | [inferred] Most users know their cruise speed but not climb and descent figures; presets give plausible numbers in one click. |
| Sim binding fields | Stored on the fleet row; set by Bind or typed | A separate binding table | [inferred] One sim aircraft maps to one fleet row; the row is the natural home. A blank sim livery binds every livery of the title. |
| Delete | Deletes the aircraft and its whole tour, after a confirmation naming both | Refuse while hops exist; a "retired" state that keeps the hops | Removing an aircraft removes its tour; hiding it (visibility) covers keeping a tour off the map. |
| A performance table for SimBrief's types | Researched once by the written method, shipped in the program, served by the server, offered by the form's **Fill from table** | Pilots type every number; class presets only; a lookup at run time | One method gives every pilot the same numbers with the same meaning, each traceable to its source. No free, keyless service publishes these numbers for every type, and the table needs no network. SimBrief's list is the natural scope: it is the designator field's own list, and the planner hands off to SimBrief. Cost: the table is as current as the program. |
| Which sources count | Authority type certificate data sheets, then the manufacturer's own publications, then government and military publications, then trade journals, then MSFS add-ons' manuals, each readable at a cited address; never wikis, forums, community sites or databases whose terms forbid republishing | Any well-known reference; EUROCONTROL's Aircraft Performance Database, which covers nearly every type | The table is public with the app, so each number must stand on a source that would not embarrass it. EUROCONTROL's database requires its permission to reuse its figures, which the project does not hold. A source the checker cannot open cannot be checked. |
| A number no accepted source gives | Cruise speed and runway: the nearest similar type's, marked "estimated from" it; ceiling and crosswind: blank; a block-time input (cruise altitude, climb rate, climb speed, descent rate): the class preset, marked as such | Blank for all; an estimate for all | A blank ceiling or crosswind is "no limit" to the planner, safer than a guessed one. Cruise speed and runway are the numbers the planner leans on most: without a cruise speed it has no block time, and a blank runway admits every airport, so a named estimate serves the pilot better than a blank. A blank block-time input would fall back to the light-piston default, wrong for anything bigger, while the class preset is the form's own one-click answer; marked "class preset", it claims nothing. |
| How an estimate is made | The nearest similar type's number as it stands — a version of the same family first, else the same class and engine kind closest in maximum takeoff weight — its own number published or derived; filled into the form only while the field is blank | Scaling the similar type's number by weight and power; a class average over similar weights; a chain of estimates; filling like a sourced number | A number taken as it stands can be checked against the type it names; a scaling formula would claim a precision it does not have, and an average hides which aircraft the number came from. An estimate built on an estimate drifts from any source. Filling only blank fields keeps the pilot's own figure ahead of another type's. |
| Scans of a manufacturer's handbook | Accepted when complete and legible, for the right model, the checker confirming it is the whole original | Only copies on the manufacturer's site or an archive of it | For older light aircraft the handbook is the real source and its maker no longer publishes it; a whole scan carries its own title page and part number, so its figures are as checkable as the original's, where an excerpt or retyped copy is not. |
| Trade press and references | A fourth tier, after authority, manufacturer and government documents: reputable references and trade journals with editors who answer for them (Jane's, Flight International, Aviation Week, Aircraft Commerce, AOPA's and Flying's flight tests among them) | Wikipedia as a last resort; the first three tiers only | Many older and light types have no manufacturer publication online, and these titles measure or report the figures under editors who answer for them; an encyclopedia repeats such figures, often without saying where from, so it is followed to its source instead of cited. |
| MSFS add-ons' manuals | A fifth tier, after every real-world source: the most detailed publicly readable manual of an MSFS 2020 or 2024 add-on of the variant, for a cruise speed, runway, ceiling, crosswind or pressurisation the real-world sources leave blank, and for a type they leave out, a cruise speed it supplies bringing the altitude the manual quotes it at; cited like any other source | Real-world sources only, leaving their gaps blank; add-on manuals for the block-time inputs as well; a manual's cruise speed beside the class preset's cruise altitude; marking add-on figures apart from the others in Sources; any add-on's manual, or the default aircraft's first | The table serves a flight sim: where no real-world document gives a number, the add-on the pilot flies gives the figure that add-on flies, and the detailed manuals reproduce the real flight manual's tables. Coming last, an add-on's figure never displaces a real-world one. The block-time inputs keep their class presets, which the form fills only into blank fields, so the pass stays on the limits and cruise speed where a blank costs most; the one exception is the altitude a manual's cruise speed is quoted at, since a cruise speed means the true airspeed at the typical cruise altitude and is flown there. The manual's title already says what it is, so Sources needs no second marking. The manual with the most performance detail is the likeliest to carry the real figures, and an MSFS 2024 version the likeliest to be maintained; a manual readable only after buying cannot be checked. Cost: an add-on's figure may follow its flight model rather than the aircraft. |
| A re-engined version without its own cruise figure | The base type's published cruise Mach, derived and noted as such, cruise speed only | Blank; the class preset | Airlines fly a re-engined airframe at the cruise Mach its predecessor flew, and its maker often publishes only the shared limit; the base type's own figure is a better number than none, while engine-dependent numbers stay the version's own. |
| A jet with only a maximum cruise published | Its headline (maximum or high-speed) cruise, noted as such | Blank; the class preset | The planner needs a cruise speed to work at all, and the manufacturer's own headline figure is more rigorous than any estimate; block times come out a little short, which a reach that reads a little optimistic already allows for. |
| Numbers by meaning, not as published | Each number converted to what the planner uses — true airspeeds, averages over the climb and descent, field length at a typical load — the conversion written out as a derivation | Copy the published figure whatever it measures | A published indicated climb speed or initial climb rate fed to the planner's averages gives wrong block times; written out, a conversion can be checked. |
| Typical load for the runway | Airliners and business jets: takeoff midway between maximum landing and maximum takeoff weight, landing at maximum landing weight; pistons and turboprops: maximum gross weight | Maximum takeoff weight for all; a weight per typical sector | Maximum weight overstates what a typical flight needs, most for long-haul types, and rules out airports the type uses every day; the midpoint is a concrete weight anyone can rework from published weights and charts. Light aircraft fly near maximum gross weight and their manuals give that. |
| Two readers per type | A researcher, then a checker who opens every cited source; the fifth tier's values by one reader, who reads each back from the manual | One pass for every tier; a checker for the fifth tier too | A misread chart or a number from the wrong variant is the likeliest error, and only re-reading the source catches it. An add-on manual's figure fills a value that would otherwise be blank and is the lowest-ranked in the table, so its pass is kept to one reader; the table's checks still hold it to the values a manual may give. Cost: a misread figure there goes unchecked. |
| Filling the form | Only on the pilot's **Fill from table**: published and derived numbers replace the fields, preset numbers fill only blank ones, pressurised only ticked, only a built-in icon changed; nothing saved until Save | Fill as soon as a type is chosen; fill only blank fields; update saved aircraft when the table changes; record on the aircraft which values came from the table | Choosing a type for SimBrief links must not overwrite numbers the pilot set; one click with the values shown and editable keeps the pilot in charge. A researched number is worth replacing the pilot's guess with when asked; a class figure is not. Pilots who fly a type differently keep their numbers across releases. Recording each value's origin on the aircraft would add columns for a note the Sources view already gives for the type. |
| New from sim | Prefill name from the sim title and livery from the ATC ID, falling back to the livery name | Leave blank | [inferred] The ATC ID is usually the registration, which is what the livery field holds. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Name + livery is unique (see Decisions).
2. ✅ SVG uploads stay accepted (see Decisions).
3. ✅ Deleting an aircraft deletes its whole tour (see Decisions).
4. ✅ Uploaded icons travel with the logbook: fleet names each by its aircraft's id at an address
   on the server's own origin and refuses icon addresses on this PC; app-shell carries them (see
   [Uploaded Icons and the Logbook](#uploaded-icons-and-the-logbook) and Decisions).

### Open

1. **Permission from EUROCONTROL.** With permission to reuse its Aircraft Performance Database's
   figures, its climb and descent data could replace class presets for the airliners whose
   manufacturers publish no climb or descent figures.

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
   ([Fleet.tsx:109-112](../../../src/client/components/Fleet.tsx#L109-L112)).
6. **Icon field quirks.** Clearing the URL field does not revert the icon, and the file input keeps
   showing a chosen file after a built-in is picked ([AircraftForm.tsx:119-125](../../../src/client/components/AircraftForm.tsx#L119-L125)).
7. **Deleting a bound aircraft mid-flight.** The tracker keeps the deleted id and, on landing,
   finds the row gone and leaves the leg pending (live-tracking).
8. **An upload replaced by a built-in or URL icon** stays in the icons folder, named by its
   aircraft's id, until that aircraft uploads again or is deleted. No row names it, so nothing
   shows it, and a backup, which carries only the icons rows name (APP-BAK-003), leaves it behind.
9. **Icons set before the address rule** (FLEET-REC-018) that name this PC's own server, or another
   aircraft's upload, stay as they are until the pilot changes them, in a logbook brought in or
   restored as well, and show only while that address answers.
10. **A badge whose image does not load** — a URL whose host no longer serves it, an address set
    before the rule, an upload missing from the icons folder — shows the aircraft's name as the
    image's alternative text inside the ring, not a built-in silhouette
    ([icons.ts:74-79](../../../src/client/icons.ts#L74-L79)).
11. **The upload's order.** An upload removes the files named for the id before it writes the new
    one ([routes.ts:303-308](../../../src/server/routes.ts#L303-L308)), so a write that fails
    leaves the row naming a removed file. Writing the new file, then setting the row, then removing
    the other files named for the id would leave at worst an unnamed file behind.
12. **The sim's own type.** The sim reports an `ATC MODEL` for the aircraft; **+ New** from the sim
    could pick the SimBrief type, and so the table's entry, from it.

## References

- Code: [src/server/routes.ts](../../../src/server/routes.ts) (aircraft section 116-311),
  the performance table (intended: the table's data file and the server module serving it),
  [src/server/db.ts](../../../src/server/db.ts) (aircraft table),
  [src/client/components/AircraftForm.tsx](../../../src/client/components/AircraftForm.tsx),
  [src/client/icons.ts](../../../src/client/icons.ts) (built-ins, badge HTML, palette, `nextColor`),
  [src/client/components/Fleet.tsx](../../../src/client/components/Fleet.tsx) (fleet list, `AircraftCard` header),
  [src/client/App.tsx](../../../src/client/App.tsx) (the Fleet drawer and its **+ Aircraft**, new-from-sim prefill `newFromSim`)
- HLD: [docs/high-level-design.md](../../high-level-design.md) — System Design (the data folder:
  the logbook database, uploaded icons and airport lists, backed up; a logbook brought in on first
  run), Rules every segment follows (Identity)
- Consumers: planner (performance and limit fields), live-tracking (sim binding fields), simbrief
  (`simbrief_type`, registration from the livery), tour-map (color, icon, visibility), logbook
  (aircraft ids), app-shell (the uploaded icons a logbook's rows name, carried into backups, a
  restore and a logbook brought in: APP-BAK-003, APP-BAK-011, APP-IMP-003 on FLEET-LOOK-006)
- Related designs: [app-shell](../app-shell/app-shell-design.md) (the data folder and its icons
  folder, backups, bringing in a logbook), [desktop](../desktop/desktop-design.md) (the page served
  from the server's own origin, whose rationale assumes icon addresses relative to that origin,
  FLEET-LOOK-006), [desktop shell](../desktop/shell/shell-design.md) (the window, which loads the
  page's images as a browser tab does, shows its confirm dialogs as Windows message boxes and
  closes them as cancelled when the app quits, and reloads the page after a lost renderer or a
  logbook brought in)
