# Fleet — EARS Specs

Design: [fleet-design.md](fleet-design.md). Prefix `FLEET`; facets `REC` (the aircraft record),
`LOOK` (color, icon, visibility), `PERF` (performance and limit fields in the form), `SIM` (sim
binding fields and SimBrief type), `FORM` (the aircraft form), `CARD` (the aircraft card header).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## The Aircraft Record

- [x] **FLEET-REC-001**: The system shall store each fleet aircraft with a name, a livery or registration, a path color, an icon, notes, a map-visibility flag, optional performance and limit fields, an optional SimBrief type designator, and an optional sim title and sim livery.
- [x] **FLEET-REC-002**: If a fleet aircraft is created or updated with a blank name, then the system shall reject it with HTTP 400 "name is required".
- [ ] **FLEET-REC-003**: If a fleet aircraft is created or updated with the same name and livery as another fleet aircraft, compared trimmed and case-insensitively, then the system shall reject it with HTTP 409 naming the existing aircraft.
- [x] **FLEET-REC-004**: If a fleet aircraft is created or updated with a path color that is not of the form `#rrggbb`, then the system shall reject it with HTTP 400.
- [x] **FLEET-REC-005**: If a fleet aircraft is created or updated with a cruise speed that is not greater than 0 and at most 2000 knots, then the system shall reject it with HTTP 400.
- [x] **FLEET-REC-006**: When a fleet aircraft is created or updated with a minimum runway, service ceiling or maximum crosswind, the system shall round it to a whole number and store zero as null (not set).
- [x] **FLEET-REC-007**: If a fleet aircraft is created or updated with a minimum runway outside 0–30,000 ft, a service ceiling outside 0–100,000 ft, or a maximum crosswind outside 0–100 kt, then the system shall reject it with HTTP 400.
- [x] **FLEET-REC-008**: When a fleet aircraft is created or updated with a block-time input (cruise altitude, climb rate, climb speed, descent rate, taxi + approach minutes), the system shall round it to a whole number and store zero or blank as null (use the planner's default).
- [x] **FLEET-REC-009**: If a fleet aircraft is created or updated with a non-zero block-time input outside its range (cruise altitude 500–60,000 ft, climb rate 50–10,000 fpm, climb speed 20–600 kt, descent rate 50–10,000 fpm, taxi + approach 1–120 min), then the system shall reject it with HTTP 400 naming the field and its range.
- [x] **FLEET-REC-010**: When a fleet aircraft is created or updated with a SimBrief type, the system shall upper-case it and reject it with HTTP 400 unless it is 2–6 letters or digits.
- [x] **FLEET-REC-011**: When a fleet aircraft is created without oxygen or IFR-capability values, the system shall store it as having no oxygen or pressurisation and as IFR capable.
- [x] **FLEET-REC-012**: When a fleet aircraft is created, the system shall make it visible on the map.
- [x] **FLEET-REC-013**: When a fleet aircraft is created or updated with a blank icon, the system shall use the built-in twin-piston icon.
- [x] **FLEET-REC-014**: When a fleet aircraft is updated, the system shall keep the current value of every field the update omits.
- [x] **FLEET-REC-015**: The system shall list fleet aircraft ordered by name and then livery.
- [ ] **FLEET-REC-016**: When a fleet aircraft is deleted, the system shall delete all of its hops together with their SimBrief briefings, and clear the aircraft link of any briefing not on a hop (such as the tracker's current plan).
- [ ] **FLEET-REC-017**: When a fleet aircraft is deleted, the system shall, once the aircraft's row is deleted, remove every file in the uploaded-icons folder named for its id (`aircraft-<id>.<ext>`, whatever the type, FLEET-LOOK-006), leaving in place and logging any file it cannot remove (one Windows holds open, for example) and answering the delete with HTTP 204 all the same.
- [ ] **FLEET-REC-018**: If a fleet aircraft is created with a non-blank icon, or updated with a non-blank icon that differs from the one it holds, and that icon is neither a built-in icon (`builtin:` with any key, an unknown key drawn as the twin-piston icon) nor an http or https address on a host other than this PC (its host, once the address is parsed as a URL — which lower-cases it and writes `127.1` as `127.0.0.1` — and with any trailing dot dropped, being none of `localhost`, a name ending in `.localhost`, a `127.x.x.x` address, `[::1]` or `0.0.0.0`), then the system shall reject it with HTTP 400 asking for the image to be uploaded instead (a blank icon taking the built-in twin-piston icon, FLEET-REC-013; an unchanged icon, its own upload's address FLEET-LOOK-006 among them, kept).

## Color, Icon and Visibility

- [x] **FLEET-LOOK-001**: When the new-aircraft form opens, the system shall preselect the first of the 16 palette colors that no other fleet aircraft uses, cycling through the palette once all are in use.
- [x] **FLEET-LOOK-002**: The aircraft form shall offer the 16-color palette and a free color picker for the path color.
- [x] **FLEET-LOOK-003**: The aircraft form shall offer eight built-in icons — single piston (low wing), single piston (high wing), twin piston, twin turboprop, business jet, airliner, helicopter, glider — drawn in the aircraft's path color.
- [x] **FLEET-LOOK-004**: If the user picks an image file larger than 4 MB in the aircraft form, then the system shall refuse it with "Image must be under 4 MB."
- [x] **FLEET-LOOK-005**: When the aircraft form is saved with a picked image file, the system shall save the aircraft first and then upload the image as its icon.
- [x] **FLEET-LOOK-006**: When an icon image (PNG, JPEG, WebP, GIF or SVG, as a base64 data URL) is uploaded for a fleet aircraft, the system shall remove every file in the uploaded-icons folder (the `images` folder beside the database, app-shell) named for that aircraft's id (`aircraft-<id>.<ext>`, whatever the type), store the new image there as `aircraft-<id>.<ext>`, named by the aircraft's id and the image's type (`png`, `jpg`, `webp`, `gif` or `svg`), and set the aircraft's icon to `/images/aircraft-<id>.<ext>?v=<upload time in ms>`: an address on the server's own origin, with no scheme, host or port, so the row shows its badge whichever port serves the page, and a version stamp that makes the page fetch the new image rather than a cached one.
- [x] **FLEET-LOOK-007**: If an uploaded icon is not a base64 PNG, JPEG, WebP, GIF or SVG data URL, then the system shall reject it with HTTP 400; if it decodes to more than 4 MB, then the system shall reject it with HTTP 413.
- [x] **FLEET-LOOK-008**: When the user enters an image URL in the aircraft form and leaves the field, the system shall use that URL as the icon.
- [x] **FLEET-LOOK-009**: The system shall show a fleet aircraft's badge as its icon inside a circle ringed in its path color, in the aircraft card, the form preview and the parked-aircraft marker on the map.
- [x] **FLEET-LOOK-010**: When the user clicks the visibility (eye) button on an aircraft card, the system shall toggle whether that aircraft is drawn on the map and dim the card while it is hidden, the button showing a crossed-out eye while it is.
- [ ] **FLEET-LOOK-011**: If toggling an aircraft's visibility fails, then the system shall show the error on its card.

## Performance and Limit Fields

- [x] **FLEET-PERF-001**: The aircraft form shall offer cruise speed, minimum runway, service ceiling, maximum crosswind, the five block-time inputs, "Pressurised / has oxygen" and "IFR capable".
- [x] **FLEET-PERF-002**: While a block-time input in the aircraft form is blank, the system shall show the light-piston default as its placeholder: 6500 ft, 700 fpm, 65% of cruise, 500 fpm, 12 min.
- [x] **FLEET-PERF-003**: When the user picks a class preset (Piston single, Piston twin, Turboprop, Light jet, Airliner, Helicopter) in the aircraft form, the system shall fill the five block-time inputs with that class's values, with climb speed as the class's fraction of the entered cruise speed, or blank when no cruise speed is entered.

## Sim Binding and SimBrief Type

- [x] **FLEET-SIM-001**: The system shall store with each fleet aircraft an optional sim title and sim livery, where a blank sim livery stands for every livery of that title.
- [x] **FLEET-SIM-002**: The aircraft form shall let the user view and edit the sim title and sim livery.
- [x] **FLEET-SIM-003**: When the user asks to create a fleet aircraft from the sim aircraft (**+ New** in the live card), the system shall open the new-aircraft form prefilled with the sim title as name, the sim's ATC ID (else its livery name) as livery, and the sim title and livery as the binding, in the Fleet drawer scrolled to that form.
- [x] **FLEET-SIM-004**: When the user types a SimBrief type in the aircraft form, the system shall upper-case it, suggest designators from SimBrief's type list, and show the matching type's name, or "Not in SimBrief's list (it may still accept it)" when none matches.

## The Aircraft Form

- [x] **FLEET-FORM-001**: If the user submits the aircraft form without a name, with a cruise speed not greater than 0, with a negative minimum runway, ceiling, crosswind or block-time input, or with a SimBrief type that is not 2–6 letters or digits, then the system shall show the problem and not save.
- [x] **FLEET-FORM-002**: If saving the aircraft form fails, then the system shall show the server's error and keep the entered values.
- [x] **FLEET-FORM-003**: When the user clicks **Delete aircraft** in an aircraft's form, the system shall ask "Delete NAME (LIVERY) and all of its hops?" and delete the aircraft only when the user confirms, deleting nothing when the question is cancelled or closed unanswered (in the installed app's window, a Windows message box the desktop shell closes as cancelled when the app quits, DESK-SHELL-WIN-013, DESK-SHELL-QUIT-002).
- [x] **FLEET-FORM-004**: The system shall keep at most one aircraft form open at a time.
- [x] **FLEET-FORM-005**: While the fleet has no aircraft and no new-aircraft form is open, the fleet list shall show "No aircraft yet. Add the plane and livery you fly, then log its first hop."

## The Aircraft Card Header

- [x] **FLEET-CARD-001**: When the user clicks an aircraft card's badge or name, the system shall highlight that aircraft on the map, or clear the highlight if that aircraft is already highlighted.
- [x] **FLEET-CARD-002**: The aircraft card shall show the livery; "parked at IDENT", or "no hops yet" when it has no hops; the cruise speed when set; the service ceiling in thousands of feet when set; "VFR only" when not IFR capable; and a link icon with "sim", with the bound sim title and livery on hover, when bound — wrapping between these items, never inside one.
