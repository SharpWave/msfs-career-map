# Arrow: fleet

The aircraft + livery rows the user flies: identity, appearance, performance and limits, the sim
binding fields, the aircraft form, and the aircraft card header.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour plus confirmed intended changes; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → fleet)

### LLD
- docs/intent/fleet/fleet-design.md

### EARS
- docs/intent/fleet/fleet-specs.md (42 specs)

### Tests
- tests/fleet/fleet-list.test.tsx — FLEET-CARD-002, FLEET-LOOK-010
- tests/app-shell/page.test.tsx — FLEET-SIM-003

### Code
- src/server/routes.ts — aircraft section (116-311)
- src/server/db.ts — `aircraft` table (90-111, 163-176)
- src/client/components/AircraftForm.tsx
- src/client/icons.ts — built-in icons, badge HTML, palette, `nextColor`
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

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Aircraft record | FLEET-REC-001 to 017 | 14 | 0 | 3 |
| Color, icon, visibility | FLEET-LOOK-001 to 011 | 10 | 0 | 1 |
| Performance and limit fields | FLEET-PERF-001 to 003 | 3 | 0 | 0 |
| Sim binding and SimBrief type | FLEET-SIM-001 to 004 | 4 | 0 | 0 |
| Aircraft form | FLEET-FORM-001 to 005 | 5 | 0 | 0 |
| Card header | FLEET-CARD-001 to 002 | 2 | 0 | 0 |

**Summary:** 38 of 42 specs implemented; 4 gaps; none deferred. No spec has a test.

## Key Findings

1. **Null means "not set"** — blank or zero optional numbers are stored as null across the record
   (routes.ts:172-211), and the planner reads null as "no limit" or "default".
2. **Two copies of the block-time defaults** — AircraftForm.tsx:10-25 and performance.ts:27.
3. **Icon files outlive their aircraft** — delete (routes.ts:286-291) does not remove
   `images/aircraft-<id>.*`.
4. **Duplicate name + livery accepted** — no check in POST/PUT (routes.ts:233-284), though the
   pairing is the unit of persistence.

## Work Required

### Must Fix
*(none identified)*

### Should Fix
1. Refuse a duplicate name + livery with 409 (FLEET-REC-003; routes.ts:233-284).
2. Remove an aircraft's uploaded icon when the aircraft is deleted (FLEET-REC-017; routes.ts:286-291).
3. Show an error when the visibility toggle fails (FLEET-LOOK-011; Fleet.tsx:109-112).
4. Delete the hops' SimBrief plans with the aircraft (FLEET-REC-016; with SB-HOP-003).

### Nice to Have
5. One source for the block-time defaults shared by form and planner.
6. Check uploaded bytes against the declared image type.
