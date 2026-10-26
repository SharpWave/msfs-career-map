# Arrow: fleet

The aircraft + livery rows the user flies: identity, appearance, performance and limits, the sim
binding fields, the aircraft form, the performance table of SimBrief's types, and the aircraft card
header.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`, updated 2026-10-23 for the desktop app (uploaded
icons travel with the logbook); not yet audited. Brownfield skeleton: the LLD describes current
behaviour plus confirmed intended changes; specs drafted, 3 of them tested. The performance table
(2026-10-25) was designed fresh: its code — the table's file and checks, the two routes, **Fill from
table** and **Sources** in the form, and the scripts — is built and tested; its research is under way.

## References

### HLD
- docs/high-level-design.md (System Design → fleet; System Design → the data folder, whose uploaded
  icons are backed up and brought in with the logbook; Rules every segment follows → Identity)

### Related
- docs/intent/app-shell/app-shell-design.md and its specs — relies on fleet: APP-BAK-003,
  APP-BAK-011 and APP-IMP-003 carry the icon files the rows name (FLEET-LOOK-006) into backups, a
  restore and a logbook brought in
- docs/intent/desktop/desktop-design.md — cited, no dependency (Decisions → Where the page comes
  from: its rationale assumes the page's icon addresses are relative to its origin, FLEET-LOOK-006)
- docs/intent/desktop/shell/shell-design.md — cited, no dependency (The Window: the page's own requests load unfiltered,
  DESK-SHELL-WIN-011; the delete confirmation as a Windows message box, DESK-SHELL-WIN-013, closed
  as cancelled when the app quits, DESK-SHELL-QUIT-002, which FLEET-FORM-003 states; the page
  reloaded after a lost renderer or a logbook brought in, DESK-SHELL-WIN-020, DESK-SHELL-SRV-043)

### LLD
- docs/intent/fleet/fleet-design.md

### EARS
- docs/intent/fleet/fleet-specs.md (61 specs)

### Tests
- tests/fleet/fleet-list.test.tsx — FLEET-CARD-002, FLEET-LOOK-010
- tests/fleet/aircraft-types-check.test.ts, aircraft-types-api.test.ts, aircraft-types-script.test.ts,
  aircraft-form-table.test.tsx — FLEET-TYPE-001 to 008, 010 to 018, FLEET-SIM-004
- tests/app-shell/page.test.tsx — FLEET-SIM-003
- tests/app-shell/api.test.ts — cites APP-SRV-002 and APP-DATA-002 only, but its upload test checks
  FLEET-LOOK-006's file name `aircraft-<id>.png` and address `/images/aircraft-<id>.png?v=<ms>`

### Code
- src/server/routes.ts — aircraft section (116-311)
- src/server/db.ts — `aircraft` table (90-111, 163-176)
- src/client/components/AircraftForm.tsx
- src/client/icons.ts — built-in icons, badge HTML, palette, `nextColor`; src/client/icon-keys.ts — the
  built-in keys; src/client/presets.ts — the class presets
- src/server/aircraft-types.json (the performance table), aircraft-types.ts (`TABLE`, `typeList`,
  `typeEntry`), aircraft-types-check.ts (`checkTable`, `missingTypes`); scripts/aircraft-types.ts
  (`npm run aircraft-types:missing`, `aircraft-types:check`)
- src/client/components/Fleet.tsx — fleet list with the new-aircraft form (25-82), `AircraftCard` header (102-199)
- src/client/App.tsx — new-from-sim prefill `newFromSim` (320-324), the Fleet drawer and its **+ Aircraft** (412-427)

## Architecture

**Purpose:** Keep one row per aircraft + livery with what the user sees (name, livery, color,
icon), what the planner needs (speed, block-time inputs, limits), and what the tracker binds to
(sim title and livery).

**Key Components:**
1. Aircraft routes (`routes.ts`) — field validation, create/update/delete, icon upload
2. `AircraftForm` — create, edit, delete, presets, icon choice, create-from-sim prefill
3. `icons.ts` — built-in silhouettes, badge HTML, palette and next unused color
4. `AircraftCard` header — highlight, meta line, visibility, edit, expand

**Relied on by app-shell:** an uploaded icon is one file per aircraft, `aircraft-<id>.<ext>`; an
upload first removes every file named for that id and deleting the aircraft removes them once its
row is gone (FLEET-LOOK-006, FLEET-REC-017); the row names it as `/images/aircraft-<id>.<ext>?v=<ms>`
on the server's own origin, so the icons a logbook uses are found from its rows alone; and only an
upload sets an `/images/` address, for its own aircraft, while no new or changed row names this
PC's own server (FLEET-REC-018). app-shell carries those files with the database: a backup holds a
copy of each in its `backup_icons` table (APP-BAK-003), a logbook brought in, from another data
folder or another logbook's backup, carries them the same way (APP-IMP-003), and opening a restored
or brought-in logbook puts its icons in place of the icons folder's, keeping none of the logbook it
replaces (APP-BAK-011).

**Cited by desktop (no dependency):** desktop-design's "Where the page comes from" assumes the
page's icon addresses are relative to its origin (FLEET-LOOK-006), so the window shows uploads from
`http://127.0.0.1:<port>/` as a browser tab does; no DESK spec cites a FLEET ID.

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Aircraft record | FLEET-REC-001 to 018 | 14 | 0 | 4 |
| Color, icon, visibility | FLEET-LOOK-001 to 011 | 10 | 0 | 1 |
| Performance and limit fields | FLEET-PERF-001 to 003 | 3 | 0 | 0 |
| Sim binding and SimBrief type | FLEET-SIM-001 to 004 | 4 | 0 | 0 |
| Performance table | FLEET-TYPE-001 to 018 | 18 | 0 | 0 |
| Aircraft form | FLEET-FORM-001 to 005 | 5 | 0 | 0 |
| Card header | FLEET-CARD-001 to 002 | 2 | 0 | 0 |

**Summary:** 56 of 61 specs implemented; 5 gaps; none deferred. The performance table is complete
and tested (FLEET-TYPE-001 to 018, FLEET-SIM-004): every type of the 2026-10-25 snapshot is an entry
or left out for want of any accepted source (FLEET-TYPE-008, which `npm run aircraft-types:check`
reports), each entry researched and checked by a second reader (FLEET-TYPE-009). Of the other specs,
three have a test (FLEET-CARD-002, FLEET-LOOK-010, FLEET-SIM-003); 35 implemented specs have none.

## Key Findings

1. **Null means "not set"** — blank or zero optional numbers are stored as null across the record
   (routes.ts:172-211), and the planner reads null as "no limit" or "default".
2. **Two copies of the block-time defaults** — AircraftForm.tsx:10-25 and performance.ts:27.
3. **Icon files outlive their aircraft** — delete (routes.ts:286-291) does not remove
   `images/aircraft-<id>.*`. Once it does (FLEET-REC-017), a backup restored without its icons
   shows a broken badge for every aircraft deleted since, so the backup carries them (app-shell,
   APP-BAK-003, APP-BAK-011).
4. **Duplicate name + livery accepted** — no check in POST/PUT (routes.ts:233-284), though the
   pairing is the unit of persistence.
5. **Uploaded icons are already addressed for any port** — the upload removes every
   `aircraft-<id>.*` file (routes.ts:303-305) and stores `/images/aircraft-<id>.<ext>?v=<ms>` with no
   host (routes.ts:306-309), so a logbook served at another port shows them once app-shell carries
   the files, and a file left under an id — a restore from an older backup winds the `AUTOINCREMENT`
   counter (db.ts:91) back — never shows for a later aircraft with that id.
6. **Any text is accepted as an icon** — POST and PUT store `b.icon` as given (routes.ts:245, 268),
   so an address copied from the page (`http://127.0.0.1:3080/images/aircraft-5.png?v=…`) ties a row
   to one copy's port and to another aircraft's upload.
7. **A badge whose image fails shows only its alt text** — `iconInnerHtml` (icons.ts:74-79) has no
   fallback to a built-in silhouette (Deferred 10).

## Work Required

### Must Fix
*(none identified)*

### Should Fix
1. Refuse a duplicate name + livery with 409 (FLEET-REC-003; routes.ts:233-284).
2. Remove every `aircraft-<id>.*` file once the aircraft's row is deleted, leaving and logging a
   file Windows will not let go of and still answering 204 (FLEET-REC-017; routes.ts:286-291).
3. Refuse a new or changed non-blank icon that is neither a built-in nor an http or https address
   off this PC (host read as parsed), keeping a blank one's twin-piston default and an unchanged one
   (FLEET-REC-018; routes.ts:245, 268).
4. Show an error when the visibility toggle fails (FLEET-LOOK-011; Fleet.tsx:109-112).
5. Delete the hops' SimBrief plans with the aircraft (FLEET-REC-016; with SB-HOP-003).
6. Add API tests for the icon contract app-shell's backups and logbook import rely on (APP-BAK-003,
   APP-BAK-011, APP-IMP-003), before app-shell builds on it: an upload's file name and origin-relative address, and its removal of
   every file named for the id, whatever the type (FLEET-LOOK-006; cite it in
   tests/app-shell/api.test.ts or test it in tests/fleet/); removal with the aircraft
   (FLEET-REC-017); and the address rule (FLEET-REC-018).
7. Nothing left to cascade to desktop/shell: DESK-SHELL-WIN-011 lets aircraft icons load from any
   http or https address, as fleet accepts them on other hosts (FLEET-REC-018, FLEET-LOOK-008).

### Nice to Have
8. One source for the block-time defaults shared by form and planner.
9. Check uploaded bytes against the declared image type.
10. Remove an upload once a built-in or URL icon replaces it, so the icons folder holds only icons
    some row names (Deferred 8).
11. Fall back to a built-in silhouette when a badge's image does not load (Deferred 10).
12. Upload in the safe order: write the new file, set the row, then remove the other files named
    for the id (Deferred 11; routes.ts:303-308).
