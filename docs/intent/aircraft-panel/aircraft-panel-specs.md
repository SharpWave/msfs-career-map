# Aircraft Panel — EARS Specs

Design: [aircraft-panel-design.md](aircraft-panel-design.md). Prefix `ACP`; facets `OPEN` (opening,
following the highlight and closing), `LAY` (where the panel sits), `HEAD` (header and picture),
`VIS` (hiding aircraft), `TOUR` (the tour block), `ACT` (actions), `LIST` (the hop list), `PLAN`
(SimBrief plans in the list).

Every spec here is the page's: it holds alike in the installed app's window, in a browser tab (on a
copy run from source or on the installed app's own address) and under the browser tests. "The
panel" is the aircraft panel throughout, and "its aircraft" the fleet aircraft it shows.

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Opening and Closing

- [x] **ACP-OPEN-001**: When the user clicks a parked-aircraft marker on the map, the live aircraft on the map while it is bound to a fleet aircraft (LIVE-LAYER-005), a hop's path on the map, or the badge or name of an aircraft card in the Fleet drawer, the system shall highlight that aircraft and open the aircraft panel on it, unless the click is on the marker (parked or live) or card of the aircraft the open panel already shows (ACP-OPEN-002).
- [x] **ACP-OPEN-002**: When the user clicks the parked-aircraft marker, the live aircraft bound to it, or the aircraft card's badge or name, of the aircraft the open aircraft panel shows, the system shall clear the highlight.
- [x] **ACP-OPEN-003**: While the aircraft panel is open, it shall show the highlighted aircraft, changing to another aircraft whenever the highlight moves to it, however it moves (a click of ACP-OPEN-001, a planner search, the live card's fleet-aircraft button, a hop row in the Fleet drawer, a hop named in the page's address).
- [x] **ACP-OPEN-004**: When an aircraft becomes highlighted other than by a click of ACP-OPEN-001 — by a planner search, the live card's fleet-aircraft button, a hop row in the Fleet drawer, or a hop named in the page's address — the system shall leave a closed aircraft panel closed.
- [x] **ACP-OPEN-005**: When the user clicks the aircraft panel's close button, the system shall close the panel, keep the highlight, and move the keyboard focus to **Clear highlight** in the map toolbar.
- [x] **ACP-OPEN-006**: When the highlight is cleared — by **Clear highlight** in the map toolbar, by a click of ACP-OPEN-002, or because the highlighted aircraft was deleted (MAP-HL-003) — the system shall close the aircraft panel.
- [x] **ACP-OPEN-007**: When the page loads — reloaded, reloading itself for a new version of the app (APP-UI-036), or shown again in the installed app's window after that window was closed — the system shall keep the aircraft panel closed until a click of ACP-OPEN-001 opens it.
- [x] **ACP-OPEN-008**: When the aircraft panel opens, the system shall leave the keyboard focus where it was.
- [x] **ACP-OPEN-009**: If the aircraft panel's content fails to render, then the system shall show "Aircraft panel failed: message" with **Retry** inside the panel's frame, keep the frame's close button and the rest of the page working, and render the content afresh when the panel shows another aircraft.

## Where It Sits

- [x] **ACP-LAY-001**: The aircraft panel shall float over the map at the window's right edge, 12 px in from it, with its top level with the left column's under the top bar, as wide as the left column (400 px, or 340 px in a window narrower than 960 px), and as tall as what it holds up to its room: down to 12 px above the window's bottom edge, or to 12 px above the flight panel while the flight panel is open — unless that would leave it less than 240 px (a window under 588 px high), when it runs to 12 px above the window's bottom edge, over the flight panel.
- [x] **ACP-LAY-002**: While the aircraft panel's room (ACP-LAY-001), less 380 px and less a further 180 px when its aircraft's icon is an image (ACP-HEAD-003), is at least 240 px, the panel shall keep everything above the hop list in place and scroll the hop list alone; otherwise it shall scroll everything under its header as one, the hop list not scrolling by itself.
- [x] **ACP-LAY-003**: While the aircraft panel is open, the page shall count the panel's width plus 12 px at the window's right edge as covered in the clear part of the map (APP-UI-020), a zoom requested in the same update that opens the panel counting it as open.
- [x] **ACP-LAY-004**: When the aircraft panel opens or closes, the system shall keep the map filling the window and the flight panel in its place at its width, the panel changing only where zoom requests land (ACP-LAY-003).
- [x] **ACP-LAY-005**: The page shall stack the aircraft panel with the left column and the flight panel (APP-UI-022), and slide it in as it opens unless the page is asked for reduced motion (APP-UI-028).

## Header and Picture

- [x] **ACP-HEAD-001**: The aircraft panel's header shall show its aircraft's badge (FLEET-LOOK-009), name and livery, an **Edit aircraft** button and a close button, and under them "parked at IDENT · airport name" for the destination of the aircraft's last hop (LOG-SEQ-008) — the ident alone when the map state lacks that airport — or "no hops yet" when it has none.
- [x] **ACP-HEAD-002**: While its aircraft is hidden from the map, the aircraft panel's header shall read "hidden from the map".
- [x] **ACP-HEAD-003**: While its aircraft's icon is an image — an uploaded icon or an image address, not a built-in icon — the aircraft panel shall show that image under the header, whole and uncropped, centred on a dark backing as wide as the panel, scaled down to fit the panel's width and 180 px of height and never scaled up past the image's own size, with the aircraft's name and livery as its alternative text, taking no room until the image has loaded; for an aircraft on a built-in icon it shall show no picture.
- [x] **ACP-HEAD-004**: If the aircraft panel's picture does not load, then the panel shall show no picture and leave no room for one, and try the image again when the aircraft's icon changes or the panel next opens.

## Hiding Aircraft

- [x] **ACP-VIS-001**: The aircraft panel shall offer the toggle **Hide this plane**, on while its aircraft is hidden from the map (fleet's map-visibility flag, which the aircraft card's eye button also sets, FLEET-LOOK-010); turning it on shall hide that aircraft and turning it off shall show it, changing no other aircraft.
- [x] **ACP-VIS-002**: The aircraft panel shall offer the toggle **Hide other planes**, on while the fleet holds other aircraft and every one of them is hidden from the map, and disabled while the fleet holds no other aircraft; turning it on shall hide every other fleet aircraft and turning it off shall show every other fleet aircraft, in one request that leaves the panel's own aircraft as it is (FLEET-LOOK-013).
- [x] **ACP-VIS-003**: When the user changes either of the aircraft panel's toggles, the panel shall disable both until the server has answered and the reload of the map state that follows has ended, loaded or failed, and shall show each toggle as the map state the page holds has it.
- [x] **ACP-VIS-004**: If a change from one of the aircraft panel's toggles fails, then the panel shall show "Could not change what the map shows: message" under the toggles until a later change from the panel succeeds or the panel shows another aircraft; a failure answered after the panel has closed or changed to another aircraft shall show nothing.
- [x] **ACP-VIS-005**: While its aircraft is hidden from the map, whichever control hid it, the aircraft panel shall stay open on it.

## The Tour Block

- [x] **ACP-TOUR-001**: The aircraft panel shall work out its tour block and hop list from its aircraft's hops in the map state each time the map state loads, so a hop logged, edited, moved or deleted while the panel is open shows without reopening it.
- [x] **ACP-TOUR-002**: The tour block shall show "N hops", followed by "· H logged" when the sum of the hops' flight times — stored or derived (LOG-REC-012), a hop without one counting 0 — is above zero; while the aircraft has no hops it shall read "No hops logged for this aircraft." in place of all its lines.
- [x] **ACP-TOUR-003**: The aircraft panel shall take a hop's distance to be the distance flown recorded with the hop when that is above zero, else the direct great-circle distance between its origin and destination, and shall treat a hop whose origin or destination is missing from the map state as having no distance.
- [x] **ACP-TOUR-004**: The tour block shall show as Distance the sum of the hops' distances (ACP-TOUR-003) in whole nautical miles, a hop without a distance counting 0, with the hover text "flown where tracked, direct otherwise".
- [x] **ACP-TOUR-005**: The aircraft panel shall take a hop's fuel burned to be the fuel used recorded with the hop when that is above zero, and shall treat any other hop — hand-logged, reporting no fuel, or with a recorded figure of zero or less — as having no fuel figure.
- [x] **ACP-TOUR-006**: The tour block shall show as Fuel burned the sum of the hops' fuel burned (ACP-TOUR-005) in whole pounds, followed by "· n of N hops" when only n of the aircraft's N hops have a fuel figure, or "—" when none has.
- [x] **ACP-TOUR-007**: The tour block shall show as Airports the number of different airports among the hops' origins and destinations.
- [x] **ACP-TOUR-008**: The tour block shall show as Flown the dates, in the PC's local time, of the aircraft's earliest and latest hop by time — a hop's time being its real-world departure, else its arrival — as "date – date", as one date when both fall on the same day, or "—" when no hop has a time.
- [x] **ACP-TOUR-009**: The tour block shall show as Longest hop "ORIG → DEST · N nm" for the hop with the greatest distance (ACP-TOUR-003), the later hop in tour order on a tie, as a control that opens that hop as its row does (ACP-LIST-004) and marks it on the map while pointed at or focused (ACP-LIST-007), or "—" when no hop has a distance.
- [x] **ACP-TOUR-010**: The tour block shall show as Landings, over the hops that have a touchdown, each counted once by the touchdown that stands for it (PANEL-LOOK-004), "avg N fpm" — the mean descent rate at touchdown, rounded — followed by each landing rating that occurs, from butter to graveyard, as its icon and its count with the rating's word as accessible name and hover text ("3 Butter"), or "none recorded" when no hop has a touchdown.

## Actions

- [x] **ACP-ACT-001**: When the user clicks **Plan next hop** in the aircraft panel, the system shall show the sidebar in the left column (APP-UI-044) and hand the panel's aircraft to the planner, which opens its card, switches its form to that aircraft and takes the keyboard focus (PLAN-FORM-013), without running a search.
- [x] **ACP-ACT-002**: When the user clicks **Log a hop** in the aircraft panel, the system shall hand the panel's aircraft to the "Log a hop" form, which opens in its drawer on that aircraft with the origin where it is parked (LOG-FORM-013).
- [x] **ACP-ACT-003**: When the user clicks **Zoom to tour** in the aircraft panel, the system shall fit the view to its aircraft's hops as highlighting the aircraft does (MAP-ZOOM-003); the button shall be disabled while the aircraft is hidden from the map or has no hops.
- [x] **ACP-ACT-004**: When the user clicks **Edit aircraft** in the aircraft panel's header, the system shall open its aircraft's edit form in the Fleet drawer, as the planner's **Edit aircraft** does (PLAN-FORM-003).
- [x] **ACP-ACT-005**: When the user uses any of the aircraft panel's actions (ACP-ACT-001 to ACP-ACT-004), the system shall keep the panel open on its aircraft.

## The Hop List

- [x] **ACP-LIST-001**: The aircraft panel shall list every hop of its aircraft under the heading "Hops" in the reverse of the aircraft's hop order (LOG-SEQ-007), the highest-numbered hop first.
- [x] **ACP-LIST-002**: Each row of the aircraft panel's hop list shall show the hop's number and "ORIG → DEST"; the compact landing badge of the touchdown that stands for the hop (PANEL-LOOK-003, PANEL-LOOK-004) when it has touchdowns; its distance as "N nm" when it is the distance flown and "N nm direct" when it is the direct distance (ACP-TOUR-003); its flight time, stored or derived (LOG-REC-012), when it has one; its fuel burned as "N lb" when it has a fuel figure (ACP-TOUR-005); and its notes when it has any.
- [x] **ACP-LIST-003**: Each row of the aircraft panel's hop list shall show when the hop was flown as its real-world departure's date, year and time in the PC's local time, else its arrival's, or "no times" when it has neither.
- [x] **ACP-LIST-004**: When the user clicks a row of the aircraft panel's hop list, the system shall open that hop in the flight panel and zoom to it as its row in the Fleet drawer does (LOG-LIST-003), keeping the aircraft panel open; for a hop of an aircraft hidden from the map it shall open the hop and leave the view where it is.
- [x] **ACP-LIST-005**: While the flight panel shows a hop of the aircraft panel's aircraft, the hop list shall mark that hop's row as the current one.
- [x] **ACP-LIST-006**: When a hop of the aircraft panel's aircraft is opened in the flight panel from outside the hop list — its path on the map, the longest-hop line, its hop row in the Fleet drawer, or the page's address — the hop list shall scroll to bring that hop's row into view; a click on a row shall not by itself scroll the list; when the panel changes between scrolling its hop list alone and scrolling everything under its header as one (ACP-LAY-002) — as when the click on a row opens the flight panel beside it — it shall bring the current row (ACP-LIST-005) back into view; and the list shall start at its top whenever the panel shows another aircraft.
- [x] **ACP-LIST-007**: While the pointer is over a row of the aircraft panel's hop list, or the keyboard focus is on it, the aircraft panel shall mark that hop on the map (MAP-HL-004) — one hop at a time, the one last pointed at or focused — and shall stop marking it when the pointer or focus leaves it, when the panel closes or shows another aircraft, or when that hop is no longer among the aircraft's hops.
- [x] **ACP-LIST-008**: The aircraft panel's hop list shall offer no control that reorders, edits or deletes a hop.

## SimBrief Plans in the List

- [x] **ACP-PLAN-001**: Each row of the aircraft panel's hop list whose hop links to a SimBrief plan in the map state shall show "SimBrief".
- [x] **ACP-PLAN-002**: When the aircraft panel shows an aircraft with at least one hop that links to a SimBrief plan, the panel shall ask for the digest of that aircraft's plans (SB-HOP-006), and ask again when the aircraft it shows changes, when the plan links of its aircraft's hops change, and, after a request that failed, when the map state next loads.
- [x] **ACP-PLAN-003**: The aircraft panel shall use a digest entry for a row only while the entry's plan id is the one the row's hop links to in the map state, and shall drop a digest answered for an aircraft it no longer shows; until a digest arrives, and if the request fails, rows shall show only "SimBrief" (ACP-PLAN-001) and the panel shall show no error.
- [x] **ACP-PLAN-004**: While a row's digest entry gives a PDF address that simbrief's rule for addresses taken from a plan allows (SB-CARD-009: resolved against the page's own address, an http or https address with a host on another origin than the page's), the aircraft panel shall offer **PDF** beside the row, a link that opens that address in a new window — a new tab in a browser, the pilot's default browser from the installed app's window — without opening the hop.
- [x] **ACP-PLAN-005**: While a row's digest entry gives a time en route or a planned burn, the row shall show "planned" followed by the time en route and by the planned burn in whole pounds — a burn in SimBrief's unit `lbs` as given, one in `kgs` multiplied by 2.20462, and none for a plan in any other unit — leaving out whichever the plan does not give.
