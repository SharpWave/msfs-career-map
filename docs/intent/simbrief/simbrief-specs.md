# SimBrief — EARS Specs

Design: [simbrief-design.md](simbrief-design.md). Prefix `SB`; facets `LINK` (dispatch link),
`TYPE` (aircraft type list), `USER` (alias setting), `OFP` (fetching and parsing a plan), `PICK`
(preview and confirm), `CUR` (current plan for the flight being flown), `HOP` (plans on hops),
`CTRL` (SimBrief controls in the live card), `CARD` (SimBrief card in the flight panel, the OFP text
and links from a plan included), `ROUTE` (planned route and its airports on the map). The desktop app's first release
waits for the OFP text shown as SB-CARD-006 and SB-CARD-009 to 011 say (DESK-DIST-REL-012).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Dispatch Link

- [x] **SB-LINK-001**: When building a SimBrief dispatch link for a leg, the system shall link to `https://dispatch.simbrief.com/options/custom` with `orig` and `dest` set to each airport's ICAO code when it has one and its OurAirports ident otherwise, `type` set to the aircraft's SimBrief type when set, `airline` set to the aircraft's ICAO airline designator when set, and no cruise level.
- [ ] **SB-LINK-002**: When building a SimBrief dispatch link, the system shall pass the aircraft's livery, upper-cased, as `reg` only when it is one or two letters or digits, an optional hyphen, then two to five letters or digits, and contains a digit or a hyphen.
- [x] **SB-LINK-003**: The SimBrief link in a planner candidate's popup shall have the hover text "Start a SimBrief plan ORIG → DEST as TYPE", or "Start a SimBrief plan ORIG → DEST (set a SimBrief type on the aircraft to pre-fill it)" when the aircraft has no SimBrief type.

## Aircraft Type List

- [x] **SB-TYPE-001**: When `GET /api/simbrief/aircraft` is called and the cached type list is less than a day old, the system shall return it marked `cache`.
- [x] **SB-TYPE-002**: When `GET /api/simbrief/aircraft` is called and no cached type list is less than a day old, the system shall fetch SimBrief's `inputs.list.json` with a 10 s timeout, keep each designator of 2–6 letters or digits with its name, sort them, cache them with the time, and return them marked `simbrief`, treating a list of fewer than 20 as a failure.
- [x] **SB-TYPE-003**: If fetching SimBrief's type list fails, then the system shall return the last cached list, however old, marked `cache`, or else a built-in list of 35 common types marked `fallback`.
- [x] **SB-TYPE-004**: If the aircraft form cannot get the type list from the server, then it shall suggest its own list of common types.

## Alias Setting

- [x] **SB-USER-001**: When `PUT /api/settings` is called with `simbrief_username`, the system shall store it trimmed, or clear it when blank; `GET /api/settings` shall return it, or null when unset.

## Fetching a Plan

- [x] **SB-OFP-001**: When fetching the latest SimBrief plan, the system shall call SimBrief's `xml.fetcher.php` with `userid` for an all-digit alias and `username` otherwise, asking for `json=v2`, with a 20 s timeout.
- [x] **SB-OFP-002**: If a SimBrief plan is requested with no alias set, then the system shall refuse with HTTP 400 "set your SimBrief alias or pilot ID first"; if SimBrief reports an error or does not answer with JSON, then it shall answer HTTP 502 "SimBrief: " followed by SimBrief's message.
- [x] **SB-OFP-003**: When a SimBrief plan is fetched, the system shall reduce it to a summary — OFP and static ids, generation time, airline, flight number, callsign, aircraft type, name and registration, origin and destination with planned runways and positions (latitude and longitude), the first alternate, route, route distance (else great-circle distance), initial cruise altitude, time en route in minutes, fuel (units, ramp, takeoff, landing, burn), weights (passengers, cargo, payload, ZFW, TOW, LDW), PDF link and navlog fixes — accepting both the `v2` and the older all-strings shape and treating missing or non-numeric values as unknown.
- [x] **SB-OFP-004**: When `GET /api/simbrief/latest` is called, the system shall return the latest plan's summary and whether it has OFP text, without storing it, for the `username` given or else the stored alias.

## Preview and Confirm

- [ ] **SB-PICK-001**: When the user confirms a previewed SimBrief plan with **Use this plan**, the system shall store exactly that plan, identified by its OFP id.
- [ ] **SB-PICK-002**: If SimBrief's latest plan is no longer the previewed one when the user confirms, then the system shall refuse with HTTP 409 and preview the newer plan for confirmation instead.
- [x] **SB-PICK-003**: When the user cancels a SimBrief preview, the system shall store nothing.

## Current Plan for the Flight Being Flown

- [x] **SB-CUR-001**: When a SimBrief plan is confirmed in the live card, the system shall archive it whole (summary, OFP text and raw OFP) linked to the bound fleet aircraft or none, make it the tracker's current plan, and delete the previous current plan if no hop uses it.
- [x] **SB-CUR-002**: When the user removes the current SimBrief plan in the live card, the system shall clear it and delete it if no hop uses it.
- [x] **SB-CUR-003**: While the tracker has a current SimBrief plan, the tracker status shall carry its summary, including the navlog fixes.
- [x] **SB-CUR-004**: If `POST /api/tracker/briefing` is called while the tracker is in casual mode (LIVE-CASUAL), then the system shall refuse it with HTTP 409 and leave the current plan as it is.

## Plans on Hops

- [ ] **SB-HOP-001**: When a SimBrief plan is confirmed for a logged hop, the system shall archive it whole linked to the hop and its aircraft, make it the hop's plan, and delete the plan the hop had before.
- [x] **SB-HOP-002**: When the user removes a hop's SimBrief plan, after confirming "Remove the SimBrief plan from this hop?", the system shall delete the plan and clear the hop's link to it.
- [ ] **SB-HOP-003**: When a hop is deleted, alone or with its fleet aircraft, the system shall delete its SimBrief plan.
- [x] **SB-HOP-004**: When `GET /api/briefings/:id` is called, the system shall return that plan's summary, OFP text, hop and aircraft, or HTTP 404 when there is no such plan.
- [ ] **SB-HOP-005**: When `GET /api/hops/:id/briefing` is called, the system shall return the plan the hop links to, and HTTP 404 when the hop does not exist or links to no plan.

## SimBrief Controls in the Live Card

- [x] **SB-CTRL-001**: While the sim is connected with an aircraft, the tracker is not in casual mode and no SimBrief alias is set, the live card shall offer a "SimBrief alias or pilot ID" field with **Save**, which Enter also triggers.
- [x] **SB-CTRL-002**: While the tracker is not in casual mode, a SimBrief alias is set and the flight being flown has no current plan, the live card shall offer **Import SimBrief plan** and show the alias, which opens the alias field with **Cancel** when clicked.
- [x] **SB-CTRL-003**: While the tracker is not in casual mode and a SimBrief plan is previewed in the live card, the preview shall show "Latest SimBrief plan · callsign", "ORIG/RWY → DEST/RWY", and the aircraft type and registration, passengers, distance, time en route and generation time, with **Use this plan** and **Cancel**.
- [x] **SB-CTRL-004**: While the flight being flown has a current SimBrief plan, the live card shall show "Plan ORIG → DEST · callsign · N pax" with **Remove**.

## SimBrief Card in the Flight Panel

- [x] **SB-CARD-001**: When the flight panel shows a hop or the live leg, the system shall load that flight's full SimBrief plan — the hop's plan, or the tracker's current plan — and load it again after the plan changes.
- [ ] **SB-CARD-002**: When the flight panel shows a pending leg, the SimBrief card shall show that leg's plan.
- [ ] **SB-CARD-003**: While the flight panel shows a hop without a SimBrief plan, the SimBrief card shall read "No plan attached to this flight." and offer **Attach my latest SimBrief plan**, which shows the preview described in SB-CTRL-003 before anything is attached.
- [x] **SB-CARD-004**: While the flight panel shows a flight with a SimBrief plan, the SimBrief card shall show Flight (callsign, else airline and flight number, with the aircraft type and registration), Plan ("ORIG/RWY → DEST/RWY", "alt ALTN"), Route, "Cruise / dist / ETE", Payload (passengers, cargo and TOW in the plan's units), Fuel (burn, ramp, landing) and Generated, with "—" for an unknown cruise altitude, distance, time en route, passenger count, fuel burn or generation time.
- [x] **SB-CARD-005**: When a SimBrief plan has no callsign, airline or flight number, the SimBrief card shall show "—" as its Flight.
- [x] **SB-CARD-006**: When the user opens **Show OFP**, the SimBrief card shall show the plan's OFP text (SimBrief's HTML, shown on the page's own origin) as text and layout only, cleaned through an allowlist each time it is shown, whatever the stored plan holds: keeping the text; the elements `div`, `span`, `p`, `br`, `hr`, `pre`, `h1`–`h6`, `b`, `strong`, `i`, `em`, `u`, `s`, `small`, `big`, `sub`, `sup`, `code`, `tt`, `font`, `center`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, `col` and `colgroup`; links only as SB-CARD-009 allows (resolved against the page's own address, an http or https address with a host on another origin, else the link's text alone); and only the attributes `style` (as SB-CARD-010 and SB-CARD-011 allow), `title`, and the table layout attributes `align`, `valign`, `width`, `height`, `colspan`, `rowspan`, `border`, `cellpadding` and `cellspacing`; and removing everything else, among them scripts, event-handler attributes, `<style>`, `<link>`, `<base>`, `<meta>`, forms and their controls, frames, `object`, `embed`, SVG, MathML, `font`'s `color`, `size` and `face`, and every `id`, `name`, `class`, `data-*`, `aria-*` and `role` attribute, keeping the text inside a removed layout element and dropping the contents of a removed script, style sheet, frame, object, SVG or MathML.
- [x] **SB-CARD-007**: While a SimBrief plan has a PDF whose address SB-CARD-009 allows (resolved against the page's own address, an http or https address with a host on another origin than the page's), the SimBrief card shall offer **PDF**, styled like the card's other buttons, as a link opening the PDF as a new window (`target="_blank"`): a new tab in a browser, and the pilot's default browser from the installed app's window (the desktop shell's routing, DESK-SHELL-WIN-007).
- [x] **SB-CARD-008**: While the flight panel shows a hop with a SimBrief plan, the SimBrief card shall offer **Remove**.
- [x] **SB-CARD-009**: When the SimBrief card shows an address taken from a SimBrief plan — the plan's PDF, or a link inside its OFP text — it shall resolve it as the page would, against the page's own address, and make it a link only when the result is an http or https address with a host on another origin than the page's own, writing that resolved, re-serialised address as the link and opening it as a new window (`target="_blank"`, `rel="noopener noreferrer"`): a new tab in a browser, and the pilot's default browser from the installed app's window (the desktop shell's routing, DESK-SHELL-WIN-007); otherwise it shall offer no **PDF** and show a link inside the OFP text (relative, fragment-only, resolving to the page's own origin, any other scheme, or with no address) as its text alone.
- [x] **SB-CARD-010**: When the SimBrief card shows a plan's OFP text, it shall show it with nothing in it able to load from any address, removing images and media and every other attribute that names an address (a table cell's `background`), a link's own `href` aside, and removing the whole `style` attribute of any element whose inline style names an address (`url(…)`, `image-set(…)` or `-webkit-image-set(…)`, in any upper or lower case) or holds a CSS escape (`\`).
- [x] **SB-CARD-011**: The SimBrief card shall show a plan's OFP text in a light scrolling box of its own, in the box's own monospaced type and colours, which no style in the plan overrides (every kept inline style has `!important` taken off its declarations), clipping the plan to the box so that nothing in it, positioned content included, is drawn outside the box.

## Planned Route on the Map

- [x] **SB-ROUTE-001**: The system shall draw the route of the flight being flown's current SimBrief plan in the bound aircraft's color (white when unbound), and the route of the plan of the flight open in the flight panel, when that is a different plan, in that flight's aircraft color.
- [x] **SB-ROUTE-002**: The system shall draw a SimBrief route as a thin dashed line over a soft dark casing through the navlog fixes, with a dot at each fix (larger for airports) whose tooltip shows the ident, the name when different, "via AIRWAY" unless direct, and the planned altitude, else the fix type.
- [x] **SB-ROUTE-003**: The system shall draw a SimBrief route on every world copy in view (MAP-GEO-014), placed fix to fix (MAP-GEO-015), so a route across the antimeridian is continuous on both sides of it.
- [x] **SB-ROUTE-004**: If a SimBrief route fails to draw, then the system shall leave it out without affecting the rest of the map.
- [x] **SB-ROUTE-005**: While the tracker holds a current SimBrief plan (from its import, on the ground or in the air, until the leg it goes with is logged or kept as pending, or the plan is removed), the system shall mark the plan's origin and destination each with a circle at the position the plan gives for that airport, of a 16 px radius at every zoom, with a dashed outline in the bound aircraft's color (white when unbound) over a faint fill of the same color, drawn on every world copy in view, beneath that plan's route line and fix dots, and taking no pointer events; it shall draw no circle for an airport the plan gives no position for, one circle where origin and destination share a position, and no circles for a plan that is not the tracker's current plan.
- [x] **SB-ROUTE-006**: While the plan's airport circles (SB-ROUTE-005) are drawn, the system shall turn their dashes round each circle, one turn about every 12 s, and hold them still while reduced motion is asked for (the browser's `prefers-reduced-motion`, which the installed app's window reports from Windows' animation effects).
