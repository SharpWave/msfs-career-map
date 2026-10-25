# Flight Panel — EARS Specs

Design: [flight-panel-design.md](flight-panel-design.md). Prefix `PANEL`; facets `OPEN` (opening,
switching and closing), `HEAD` (header), `CHART` (profile chart), `LAND` (landing card), `LOOK`
(how a rating looks, the landing badge), `STAT` (flight card).

Every spec here is the page's: it holds alike in the installed app's window, in a browser tab (on a
copy run from source or on the installed app's own address) and under the browser tests.

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Opening and Closing

- [x] **PANEL-OPEN-001**: When the user opens a hop (from its map path or its hop row) or the live leg (from the live card's **Profile**), the system shall show that flight in the flight panel across the bottom of the map, replacing any flight already shown.
- [ ] **PANEL-OPEN-002**: When the user clicks **Profile** on a pending leg in the live card, the system shall show that pending leg in the flight panel, replacing any flight already shown.
- [x] **PANEL-OPEN-003**: When the user clicks the flight panel's close button, the system shall close the panel.
- [x] **PANEL-OPEN-004**: When the hop shown in the flight panel is deleted, the system shall close the panel.
- [x] **PANEL-OPEN-005**: When the live leg shown in the flight panel is logged as a hop, the system shall show that hop in the panel instead.
- [ ] **PANEL-OPEN-006**: When the pending leg shown in the flight panel is logged with **Log hop** in the live card on the same page, the system shall show the new hop in the panel instead; when that leg leaves the tracker's pending list in any other way (discarded on any page, or logged in another window or tab), the system shall close the panel.
- [x] **PANEL-OPEN-007**: If the flight panel fails to render, then the system shall confine the failure to the panel and keep the rest of the app working.
- [x] **PANEL-OPEN-008**: While the flight panel is narrower than 720 px, the system shall stack the panel's cards under the chart and scroll the panel's body; otherwise it shall show the chart on the left and the cards on the right.
- [ ] **PANEL-OPEN-009**: When the page acts on a `#hop=<id>` fragment in its address that names an existing hop (app-shell's fragment route, APP-UI-032; the desktop shell sets it when the pilot clicks a "Hop logged" notification), the system shall show that hop in the flight panel, replacing any flight already shown, as opening it from its hop row does.
- [ ] **PANEL-OPEN-010**: When the page acts on a `#pending=<id>` fragment in its address that names a pending leg the tracker holds (app-shell's fragment route, APP-UI-032; the desktop shell sets it when the pilot clicks a "Leg waiting to be logged" notification), the system shall show that pending leg in the flight panel, replacing any flight already shown, as its **Profile** in the live card does (PANEL-OPEN-002).
- [ ] **PANEL-OPEN-011**: If the page acts on a `#hop=<id>` fragment in its address naming no existing hop, or a `#pending=<id>` fragment naming no pending leg the tracker holds (app-shell's fragment route, APP-UI-032, which then shows a short note such as "That leg has already been logged or discarded", APP-UI-035), then the system shall leave the flight panel as it was, showing the flight it showed or staying closed.
- [x] **PANEL-OPEN-012**: When the page loads — reloaded, reloading itself for a new version of the app (APP-UI-036), or shown again in the installed app's window after that window was closed — the system shall keep the flight panel closed until the user opens a flight or the page's address names one (PANEL-OPEN-009, PANEL-OPEN-010), never reopening the flight a previous load showed.
- [ ] **PANEL-OPEN-013**: If a hop is logged from a pending leg — with **Log hop** on this page, or in another window or tab — while the flight panel shows the live leg, then the system shall keep showing the live leg in the panel rather than switch to that hop.
- [ ] **PANEL-OPEN-014**: When the tracker's event stream connects again while the flight panel shows the live leg, and the leg the panel showed is no longer in progress, the system shall show in the panel the hop whose takeoff time is that leg's, when the hops the page reloads (LIVE-API-005) hold one (a hop logged while the stream was down brings no `hop` event).

## Header

- [x] **PANEL-HEAD-001**: The flight panel header shall show the flight's fleet aircraft as its color dot and label, or the sim aircraft's title when the live leg has no fleet aircraft, and a close button.
- [x] **PANEL-HEAD-002**: When the flight panel shows a hop, the header shall show "ORIG → DEST", "hop N", and the departure date and time and the flight time when known.
- [x] **PANEL-HEAD-003**: While the flight panel shows the live leg, the header shall show a "live" pill and, while airborne, "ORIG → …" ("?" for an unknown departure) with "airborne since TIME · N points", or "Live" with "nothing being flown" when no leg is in progress.
- [ ] **PANEL-HEAD-004**: While the flight panel shows the live leg after touchdown, the header shall show "off TIME · landed TIME · N points".
- [ ] **PANEL-HEAD-005**: When the flight panel shows a pending leg, the header shall show its route with "?" for an unknown airport, "waiting to be logged", its takeoff and touchdown times and its flight time, and the sim aircraft's title when the leg has no fleet aircraft.

## Profile Chart

- [x] **PANEL-CHART-001**: The profile chart shall plot altitude (ft), ground speed (kt), vertical speed (fpm), IAS (kt) and fuel (lb) against elapsed time in one plot, each scaled to its own minimum and maximum, in fixed colors (blue, orange, green, amber, pink) that do not change when a series is hidden.
- [x] **PANEL-CHART-002**: The profile chart shall leave out a series with fewer than two values or the same value throughout.
- [x] **PANEL-CHART-003**: The profile chart legend shall show each series with its real range ("min–max unit") and hide or show the series when clicked.
- [x] **PANEL-CHART-004**: The profile chart shall label elapsed time with at most seven ticks, using the first step of 1, 2, 5, 10, 15 or 30 minutes or 1, 2 or 4 hours that fits (8 hours beyond), written as "45m", "1h" or "1h30".
- [x] **PANEL-CHART-005**: The profile chart shall mark each touchdown that falls within the track with a vertical line labelled with the rating icon and fpm.
- [x] **PANEL-CHART-006**: While the pointer is over the plot, the profile chart shall mark the sample nearest in time on each visible series and show "+elapsed · time of day" (the time of day in the PC's local time) with each visible series' value and unit.
- [x] **PANEL-CHART-007**: When the user turns on **Table**, the profile chart shall replace the plot with a table of every sample's elapsed time and series values.
- [x] **PANEL-CHART-008**: When a flight has fewer than two track points, the profile chart shall read "No profile: this hop was logged by hand or its track is too short."
- [x] **PANEL-CHART-009**: While the flight panel shows the live leg, the profile chart shall extend as each new track point arrives, and whenever the tracker's event stream connects again (after a server restart, say) shall redraw from the whole track the server sends, never keeping points drawn before the reconnect.
- [x] **PANEL-CHART-010**: The profile chart shall fill the panel's width, at least 240 px, and be 190 px tall.

## Landing Card

- [x] **PANEL-LAND-001**: The landing card shall show the first touchdown of the flight's final landing: the rating's icon, word and caption; the descent rate, with "sim says N" when the sim's touchdown rate is known; the peak G or "not measured"; and the touchdown IAS and the attitude ("N° pitch · N° left/right bank") when known.
- [x] **PANEL-LAND-002**: When a flight has more than one touchdown, the landing card shall list every touchdown as its rating icon and fpm.
- [x] **PANEL-LAND-003**: The landing card shall say "Measured every frame at touchdown." for a measured landing and "From once-a-second samples; the per-frame watcher was not available." for a provisional one.
- [ ] **PANEL-LAND-004**: When the user opens the landing card's **scale**, the card shall list the five ratings with their fpm bands (≤ 100, 101–250, 251–500, 501–800, > 800) and the note "A peak G of 1.6 / 2.0 / 2.6 / 3.5 or more bumps the class up regardless of fpm."
- [x] **PANEL-LAND-005**: When a flight has no touchdown, the landing card shall read "No touchdown recorded."

## How a Rating Looks

- [x] **PANEL-LOOK-001**: The system shall show the landing ratings as butter "🧈 Butter — nobody looked up from their book" (#3bceac), solid "👍 Solid — the coffee stayed in the cups" (#86b6ef), hard "💥 Hard — a few gasps from the cabin" (#fbbf24), hospital "🏥 Hospital — someone is calling a lawyer" (#f97316) and graveyard "🪦 Graveyard — nobody is walking away from that one" (#ef4444), and never by color alone, wherever the page shows a rating, apart from the tracker's own message (LIVE-HOP-006), which words the rating as plain text.
- [x] **PANEL-LOOK-002**: The landing badge shall show the rating's icon, word and fpm in the rating's color, or the icon and fpm when compact, with the hover text "Word: caption · N fpm" followed by ", G.GG G" when the G is known.
- [x] **PANEL-LOOK-003**: The system shall use the full landing badge in a hop's map tooltip, and the compact badge in hop rows and in the live card.
- [x] **PANEL-LOOK-004**: The system shall stand for a flight with touchdowns by the first touchdown of its final landing (for the live leg, its latest landing so far) in the landing card, the hop's map tooltip, the hop's row and the live card, counting a touchdown less than 30 s after the flight's previous touchdown as a bounce within the same landing and any other touchdown as the start of a new landing.

## Flight Card

- [x] **PANEL-STAT-001**: The flight card shall show the distance as "N nm flown · N nm direct" for a tracked flight and "N nm direct" otherwise, the highest altitude and ground speed, the fuel used with "start → end lb" when both are known, the weight "at takeoff" and "at landing", and the number of samples, showing "—" for anything unknown.
- [ ] **PANEL-STAT-002**: While the flight panel shows the live leg, the flight card shall show fuel at takeoff and now, fuel used, weight at takeoff, the highest altitude and ground speed, and the distance flown so far.
- [ ] **PANEL-STAT-003**: When the flight panel shows a pending leg, the flight card shall show the statistics recorded when the leg closed, and its direct distance when both airports are known.
