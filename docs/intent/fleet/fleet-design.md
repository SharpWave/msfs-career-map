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
delete, create from the sim), uploaded icons and how aircraft rows name them, the color palette and
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
livery as reported; the page opens the Fleet drawer scrolled to the form (app-shell)
([App.tsx:321-324](../../../src/client/App.tsx#L321-L324)). A different sim
aircraft remounts the form with fresh values ([Fleet.tsx:42-55](../../../src/client/components/Fleet.tsx#L42-L55)).

**SimBrief type.** An optional ICAO designator, upper-cased as typed, with suggestions from
SimBrief's type list and a hint naming the type or saying "Not in SimBrief's list (it may still
accept it)" ([AircraftForm.tsx:333-356](../../../src/client/components/AircraftForm.tsx#L333-L356)).
The list and the links it feeds belong to simbrief.

## The Aircraft Form

One form creates and edits ([AircraftForm.tsx](../../../src/client/components/AircraftForm.tsx));
only one aircraft form is open at a time ([Fleet.tsx:13](../../../src/client/components/Fleet.tsx#L13)).

- **Validation, in order** ([127-147](../../../src/client/components/AircraftForm.tsx#L127-L147)):
  name present; cruise speed > 0 if given; min runway ≥ 0; SimBrief type a 2–6 character
  designator if given; ceiling ≥ 0; crosswind ≥ 0; each block-time field a number ≥ 0. Blank
  numbers are sent as null. The server applies its own ranges on top.
- **Save** trims text, sends blank sim fields and SimBrief type as null, creates or updates, then
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
| Block-time defaults and presets | Blank fields fall back to light-piston defaults; the form offers six class presets | Require every field | [inferred] Most users know their cruise speed but not climb and descent figures; presets give plausible numbers in one click. |
| Sim binding fields | Stored on the fleet row; set by Bind or typed | A separate binding table | [inferred] One sim aircraft maps to one fleet row; the row is the natural home. A blank sim livery binds every livery of the title. |
| Delete | Deletes the aircraft and its whole tour, after a confirmation naming both | Refuse while hops exist; a "retired" state that keeps the hops | Removing an aircraft removes its tour; hiding it (visibility) covers keeping a tour off the map. |
| New from sim | Prefill name from the sim title and livery from the ATC ID, falling back to the livery name | Leave blank | [inferred] The ATC ID is usually the registration, which is what the livery field holds. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Name + livery is unique (see Decisions).
2. ✅ SVG uploads stay accepted (see Decisions).
3. ✅ Deleting an aircraft deletes its whole tour (see Decisions).
4. ✅ Uploaded icons travel with the logbook: fleet names each by its aircraft's id at an address
   on the server's own origin and refuses icon addresses on this PC; app-shell carries them (see
   [Uploaded Icons and the Logbook](#uploaded-icons-and-the-logbook) and Decisions).

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

## References

- Code: [src/server/routes.ts](../../../src/server/routes.ts) (aircraft section 116-311),
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
