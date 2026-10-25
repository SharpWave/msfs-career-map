# Arrow: simbrief

SimBrief in and out: dispatch links for a leg, SimBrief's aircraft type list, the alias setting,
importing and archiving OFPs, the current plan for the flight being flown, plans on logged hops,
the SimBrief card and controls, the OFP text shown safely on the page's own origin, and the planned
route on the map.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted; first tests in place.
Cascaded 2026-10-23 from the desktop app's HLD, the desktop design and its shell and distribution
LLDs, and the desktop edge audit's review of the OFP text: the OFP text is shown as text and layout
only — cleaned through an allowlist, links resolved against the page's own address and kept only when
they reach an http or https address on another origin, nothing loaded, kept inline styles without
`!important`, the plan clipped to its box (SB-CARD-006, 009 to 011) — which the desktop app's first
release waits for (DESK-DIST-REL-012); the PDF and links from a plan open as a new window, which the
installed app's window sends to the pilot's default browser (SB-CARD-007, 009). The LLD's Briefings
section states how plans are carried into a brought-in logbook, as live-tracking's merged checkpoint
does it (LIVE-SAVE-008, LIVE-SAVE-010, LIVE-SAVE-011); the LLD has no open questions.

## References

### HLD
- docs/high-level-design.md (Approach → Planning hands off; Tenets → Hand off to the specialists,
  The page stays a web page, Keyless and local; System Design, outside links via the desktop shell;
  Segments → simbrief; Key Design Decisions → Planning)

### LLD
- docs/intent/simbrief/simbrief-design.md

### EARS
- docs/intent/simbrief/simbrief-specs.md (43 specs)

### Tests
- tests/tour-map/copies.test.ts — SB-ROUTE-003 (the route placed fix to fix; drawn on every copy by the map's shared copies)
- tests/simbrief/live-card-controls.test.tsx — SB-CTRL-001, 002, 003, 004 (no import in casual mode)
- tests/live-tracking/casual-api.test.ts — SB-CUR-004 (import refused in casual mode)

### Code
- src/client/simbrief.ts
- src/server/simbrief.ts
- src/server/ofp.ts
- src/server/routes.ts — settings and briefings (589-721)
- src/server/db.ts — `briefings`, `settings`, `kv_cache`
- src/client/components/LivePanel.tsx — `SimbriefControls`
- src/client/components/FlightPanel.tsx — `BriefingCard`
- src/client/components/BriefingLayer.tsx
- src/client/App.tsx — panel plan loading, routes to draw
- src/client/styles.css — `.ofp-html` (the OFP box)

## Architecture

**Purpose:** Plan in SimBrief as usual, and keep each plan with the flight it was for.

**Key Components:**
1. `simbriefUrl` / `legFor` — dispatch links
2. `simbriefAircraftTypes` — type list with cache and fallback
3. `fetchLatestOfp` / `parseOfp` — fetch and reduce the OFP
4. Briefing routes — preview, current plan, hop plans, archive
5. `SimbriefControls`, `BriefingCard`, `BriefingLayer`
6. The OFP text cleaner (planned) — DOMPurify with the card's allowlist, links and no loads

**Consumers outside the map:** the desktop design relies on a plan safe to show on the page's
origin, and distribution's first release waits for it (DESK-DIST-REL-012, which names SB-CARD-006
and SB-CARD-009 to 011). The desktop shell's window sends the card's new windows to the default
browser (DESK-SHELL-WIN-007) and refuses one on the page's own origin, which SB-CARD-009 never makes;
the shell's Relies On cites SB-CARD-009 for this, but the HLD graph and index.yaml have no simbrief →
shell edge.

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Dispatch link | SB-LINK-001 to 003 | 2 | 0 | 1 |
| Aircraft type list | SB-TYPE-001 to 004 | 4 | 0 | 0 |
| Alias setting | SB-USER-001 | 1 | 0 | 0 |
| Fetching a plan | SB-OFP-001 to 004 | 4 | 0 | 0 |
| Preview and confirm | SB-PICK-001 to 003 | 1 | 0 | 2 |
| Current plan | SB-CUR-001 to 004 | 4 | 0 | 0 |
| Plans on hops | SB-HOP-001 to 005 | 2 | 0 | 3 |
| Live card controls | SB-CTRL-001 to 004 | 4 | 0 | 0 |
| Flight panel card | SB-CARD-001 to 011 | 3 | 0 | 8 |
| Route on the map | SB-ROUTE-001 to 004 | 4 | 0 | 0 |

**Summary:** 29 of 43 specs implemented; 14 gaps; none deferred. 6 specs have tests.

## Key Findings

1. **OFP text inserted as it comes** on the page's own origin, where it acts as the page —
   FlightPanel.tsx:341; the box already forces its own type and colours (styles.css `.ofp-html *`;
   but see Finding 9) but clips only what flows inside it, so a fixed-position element escapes. Blocks the desktop
   app's first release.
2. **PDF offered whatever its address** — FlightPanel.tsx:329-333; it is otherwise styled as a button
   and opens in a new window (`rel="noreferrer"`), as SB-CARD-007 asks.
3. **Use this plan fetches again** instead of keeping the previewed plan — LivePanel.tsx:72-76, routes.ts:675-682.
4. **Re-attaching keeps the old plan** pointing at the hop — routes.ts:695-716.
5. **Any short livery is sent as a registration** — simbrief.ts:15-18.
6. **Plans of deleted hops stay in the table**, and the panel attaches a plan with no preview.
7. **SimBrief requests' User-Agent** — the plan fetch sends none and the type list an old "0.6"
   with no contact (ofp.ts:72, server simbrief.ts:5); app-shell's APP-API-005 closes it for every
   outside request.
8. **The release gate names all four** — DESK-DIST-REL-012 (distribution) waits for SB-CARD-006 and
   SB-CARD-009 to 011, since the OFP text is safe only with all of them; SB-CARD-006 refers to
   SB-CARD-009 for its links.
9. **Inline `!important` beats the box** — the box's `.ofp-html *` rules are marked important, but an
   important inline style still overrides them (styles.css:2331-2336), until SB-CARD-011 takes
   `!important` off kept inline styles.
10. **Plans in a brought-in logbook** — the LLD's Briefings section carries them as live-tracking's
    merged checkpoint does (LIVE-SAVE-008, LIVE-SAVE-010, LIVE-SAVE-011), and SB-CUR-001 and
    SB-CUR-002 hold for a carried plan as for any other. A plan copied whole from this PC's logbook would
    keep its own aircraft link (`briefings.aircraft_id`, db.ts:145), which names a row of the logbook being
    replaced; LIVE-SAVE-008 clears the carried pending legs' fleet aircraft and looks the binding up
    again, but says nothing of the copied plans' aircraft links — live-tracking's to settle.

## Work Required

### Must Fix
1. Clean the OFP text before showing it, test-first (SB-CARD-006, SB-CARD-009 to 011;
   FlightPanel.tsx:341): DOMPurify with the card's allowlist (ALLOW_DATA_ATTR and ALLOW_ARIA_ATTR
   off), applied as the card shows it; links resolved against the page's own address and kept, in
   that resolved form, only when they reach an http or https address on another origin, opening in
   a new window, the PDF included; nothing loaded; `!important` taken off kept inline styles; the
   box clipping the plan (CSS paint containment on `.ofp-html`). Component tests for each removed
   kind (script, event-handler attribute, `<style>`, `<link>`, `<base>`, `<meta>` refresh, form and
   controls, iframe, object, embed, SVG, MathML, `id`/`name`/`class`, `data-*`, `aria-*`, `role`,
   `font`'s `color`/`size`/`face`, image, a cell's `background`, and a style holding `url(…)`, an upper-case
   `URL(…)`, an escaped `\75 rl(…)`, `image-set(…)` or `-webkit-image-set(…)`), for an inline style
   marked `!important` losing to the box's type and colours, and for each link kind (https, http,
   `http:/api/hops`, `//example.com/x`, an upper-case or space-padded `HTTPS://…`, relative,
   fragment-only, the page's own origin, `javascript:`, `java\tscript:` with a tab, `data:`,
   `file:`, `mailto:`, no `href`, the PDF's address); and a browser test that a fixed-position
   element in a plan stays inside the box. Add DOMPurify to the client's dependencies. The desktop
   app's first release waits for it (DESK-DIST-REL-012).

### Should Fix
2. Preview, then store exactly the previewed plan, in both the live card and the panel; 409 when
   the latest plan changed (SB-PICK-001, SB-PICK-002, SB-CARD-003).
3. Replace a hop's old plan when attaching, delete plans with their hops, and return only the
   linked plan (SB-HOP-001, SB-HOP-003, SB-HOP-005; with FLEET-REC-016).
4. Show a pending leg's plan in the panel (SB-CARD-002).
5. Ask live-tracking to clear a copied plan's aircraft link when its merged checkpoint copies the plan
   into a brought-in logbook (LIVE-SAVE-008; Finding 10).

### Nice to Have
6. Tighten the registration test (SB-LINK-002).
7. "—" for a plan with no flight identity (SB-CARD-005).
8. One fallback type list instead of two.
