---
parent: high-level-design
prefix: ACP
---

# Aircraft Panel

## Context and Design Philosophy

The aircraft panel is where one aircraft's tour is looked back on as a whole. The map shows where a
tour went and the flight panel how one flight went; the aircraft panel sits between them: who this
aircraft is, what its tour adds up to, and every hop it has flown, latest first, each with how far,
how long, how it landed and what it burned. It opens beside the map when the pilot picks an aircraft
there, so the tour on the map and its list can be read together, and a hop picked from the list opens
in the flight panel below.

This segment owns:

- the panel itself — what opens it, which aircraft it shows, closing it, where it sits
  (`AircraftPanel.tsx`, [App.tsx](../../../src/client/App.tsx), [layout.ts](../../../src/client/layout.ts));
- its header and picture;
- its two map toggles, **Hide other planes** and **Hide this plane**;
- the tour block — totals, tour facts and the landing summary — and how they are worked out from the
  hops (`tour.ts`);
- its actions, which hand off to the planner, the hop form, the aircraft form and the map;
- its hop list, with each hop's SimBrief plan mark, PDF link and planned figures.

It decides nothing about an aircraft or a hop and changes neither, beyond the `visible` flag its
toggles set through fleet. Hops, their order and their flight times come from logbook; the track
statistics and landings inside them from live-tracking; which touchdown stands for a hop and how a
rating looks from flight-panel; the aircraft's name, color, icon and `visible` flag from fleet;
plans from simbrief; the highlight and everything drawn on the map from tour-map. Hops are
reordered, edited and deleted in the Fleet drawer's hop list (logbook), not here.

The panel is part of the page, so it works the same in the installed app's window, in a browser tab
and under the browser tests, and needs nothing from the desktop shell (HLD tenet The page stays a
web page). Its one outside link, a plan's PDF, leaves the app's window for the pilot's default
browser as every outside link does.

## Opening and Closing

The panel shows the **highlighted aircraft** (tour-map) and exists only while one is highlighted.
Whether it is open is the page's own state, apart from the highlight, because not every highlight
is a request to look at an aircraft: a planner search highlights its aircraft to make the plan
readable on the map, and opening the panel then would cover the candidates it was run to show.

**What opens it.** Four clicks pick an aircraft to look at, and each highlights the aircraft and
opens the panel on it:

- a parked-aircraft marker on the map;
- the live aircraft on the map, while the sim's aircraft is bound to a fleet aircraft
  (live-tracking). With the sim running, an aircraft sits at the gate where it last parked, and the
  live aircraft is drawn over its own parked marker; a click there must not fall on something that
  does nothing;
- a hop's path on the map, which also opens that hop in the flight panel and zooms to it
  (MAP-PATH-004);
- an aircraft card's badge or name in the Fleet drawer.

Clicking the marker — parked or live — or the card of the aircraft the open panel already shows
clears the highlight, which closes the panel; when that aircraft is highlighted with the panel closed, the click opens the
panel and leaves the highlight. A path click never clears the highlight.

**What does not open it.** The other things that highlight an aircraft — a planner search, the live
card's fleet aircraft button, a hop row in the Fleet drawer, a hop named in the page's address —
leave the panel as it is: closed if it was closed, and, if it was open, now showing the newly
highlighted aircraft, since the panel always shows the highlighted one.

**Closing.**

- Its close button closes it and leaves the highlight, so the tour can be read on the map at full
  width, still standing out from the others.
- Clearing the highlight closes it: **Clear highlight** in the map toolbar, a second click on the
  shown aircraft's marker or card, or the highlighted aircraft being deleted (MAP-HL-003).
- Each load of the page starts with it closed, as the flight panel does: a reload, the page
  reloading itself for a new version, or the installed app's window opened again.

Opening the panel leaves the keyboard focus where it was. Its close button moves the focus to
**Clear highlight** in the map toolbar, which is there because the highlight stays; a panel closed
any other way does not move the focus. The zoom that comes with the highlight
(MAP-ZOOM-003) or with the hop (MAP-ZOOM-004) lands in the part of the map the panel leaves clear,
because the page works that part out with the panel counted as open in the same update.

## Where It Sits

```
┌──────────────────────────────────────────────────────────────────────┐
│ [✈ Career Map] [▯]                [Show all planes] [Layers] [Fit all]│  top bar
│ ┌─────────────┐                                      ┌─────────────┐ │
│ │ Live from   │                                      │ ◉ Name    ✎ ✕│ │
│ │ the sim     │                                      │ ┌─────────┐ │ │
│ ├─────────────┤              the map                 │ │ picture │ │ │
│ │ Plan next   │                                      │ └─────────┘ │ │
│ │ hop         │                                      │ toggles     │ │
│ │             │                                      │ tour block  │ │
│ │             │ ┌──────────────────────────────────┐ │ actions     │ │
│ │             │ │ flight panel                     │ │ hop list ↕  │ │
│ └─────────────┘ └──────────────────────────────────┘ └─────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
        left column                                    aircraft panel
```

- A glass panel at the right edge of the window, one gutter (12 px) in from it, its top level with
  the left column's, under the top bar.
- As wide as the left column: 400 px, or 340 px in a window narrower than 960 px.
- As tall as what it holds, up to the room it has: down to the window's bottom gutter, or to one
  gutter above the flight panel while a flight is open. The flight panel keeps its own place and
  width, so opening either panel never moves the other. In a window too short to leave it 240 px
  above the flight panel — under 588 px high, below the 600 px the layout is designed for — it runs
  to the bottom gutter instead, over the flight panel's right end, so its controls stay reachable.
- **While the room leaves the hop list at least 240 px**, the header, picture, toggles, tour block
  and actions stay in place and the list scrolls beneath them. **With less** — a short window, or a
  flight open on a 1080 px display — everything under the header scrolls as one, so there is never
  a scroller inside a scroller and the list is never squeezed to a row or two. What the list is
  left is worked out, not measured ([layout.ts](../../../src/client/layout.ts)): the room, from the
  window's height and whether a flight is open, less a set 380 px for the parts above the list, and
  a further 180 px when the aircraft has a picture. The list therefore scrolls alone from 620 px of
  room, or 800 px with a picture.
- It is stacked with the left column and the flight panel, under the top bar's menus, and slides in
  unless the page is asked for reduced motion.
- Its frame and close button sit outside an error boundary that holds everything else in it — the
  rest of the header included — and reads "Aircraft panel failed: message" with **Retry**, so a
  malformed hop cannot take the rest of the page down. The boundary starts afresh when the panel
  shows another aircraft.

**The clear part of the map.** While the panel is open the page counts its width plus one gutter as
covered on the right, in the clear part it supplies to zooms and popups and lays out the toast, the
error banner, the empty-map card and the notices at the top of the map in (app-shell); the map's
attribution moves left of the panel so the basemap's credit stays readable. Opening or closing the
panel never moves the map.

With the left column shown, the two columns leave the window's width less 824 px between them (less
704 px under 960 px, where both are narrow). That is under 240 px in every window narrower than
1,064 px bar those 944 to 959 px wide; there zooms use the whole window (MAP-ZOOM-007), and the
sidebar toggle gives the map back. A window under 716 px wide cannot hold the two columns side by
side, and the aircraft panel lies over the left column's right part.

## Header and Picture

- **Header**: the aircraft's badge (fleet), its name, its livery in the code typeface, **Edit
  aircraft** (pencil) and the close button. Under them, "parked at IDENT · airport name", or "no
  hops yet"; and "hidden from the map" while the aircraft is hidden.
- **Picture**: when the aircraft's icon is an image — an upload or an image address, anything but a
  built-in silhouette — the image is shown under the header, whole and uncropped, centred on a dark
  backing as wide as the panel, with the aircraft's label as its alternative text. It is scaled
  down to fit the panel's width and 180 px of height and never scaled up past its own size; the
  backing is as tall as the image, and takes no room until the image has loaded. An image that does
  not load is left out rather than shown broken, and tried again when the aircraft's icon changes
  or the panel next opens. An aircraft on a built-in icon has no picture; its silhouette is the
  header's badge.

## Hiding Aircraft

Two toggles under the picture set the same `visible` flag as the eye button on an aircraft card
(fleet), so there is one notion of hidden across the page, it is kept with the logbook, and the map
looks the same after a restart.

| Toggle | Reads as on | Turning it on | Turning it off |
|---|---|---|---|
| **Hide other planes** | while the fleet has other aircraft and every one of them is hidden | hides every other aircraft | shows every other aircraft |
| **Hide this plane** | while this aircraft is hidden | hides this aircraft | shows it |

Each toggle speaks only of what its name says: **Hide other planes** never changes this aircraft and
**Hide this plane** never changes the others, so their states can be read and set independently.
**Hide other planes** is disabled while the fleet holds no other aircraft. It changes every other
aircraft in one request that names only this aircraft (fleet's `PUT /api/aircraft/visibility`); the
server works out which the others are, so they are never left half hidden and an aircraft added in
another window is not missed.

The toggles always read from the map state. A change disables both until the server has answered
and the reload of the map state that follows has ended, so they never show a value the map does
not; if that reload fails, the page's error banner says so and the toggles show the state the page
still holds. A change that
fails shows "Could not change what the map shows: message" under them; the message goes when a
later change from the panel succeeds or the panel shows another aircraft. An answer that arrives
after the panel has closed or moved to another aircraft shows nothing.

The panel stays open on an aircraft it has hidden, so the toggle can be turned back. Getting
everything back from anywhere is fleet's **Show all planes** in the map toolbar, offered while any
aircraft is hidden.

## The Tour Block

What the tour adds up to, worked out in the page from the aircraft's hops (`tour.ts`) each time the
map state loads. With no hops the block reads "No hops logged for this aircraft."

| Line | Shows |
|---|---|
| Hops | "N hops", and "· H logged" when the sum of their flight times is above zero (a hop without a flight time counting 0, as in the Fleet drawer's summary, LOG-LIST-002) |
| Distance | The sum of each hop's distance (below), "N nm" |
| Fuel burned | The sum of fuel used over the hops that recorded it, "N lb", followed by "· n of N hops" when some recorded none; "—" when none did |
| Airports | The number of different airports among the hops' origins and destinations |
| Flown | The dates of its earliest and latest hop by time (departure, else arrival), "date – date" in the PC's local time, one date when they fall on the same day; "—" when no hop has a time |
| Longest hop | "ORIG → DEST · N nm", the hop with the greatest distance, the later one on a tie; clicking it opens that hop, and pointing at it marks the hop on the map, as its row does; "—" when no hop has a distance |
| Landings | "avg N fpm" over the hops that have a touchdown, then each rating that occurs, best first, as its icon and count; "none recorded" when no hop has one |

**A hop's distance** is the distance flown that the tracker recorded with it (`stats.flown_nm`)
when that is above zero, else the direct great-circle distance between its airports — a track too
short to measure records 0, and reads as direct. A hop whose airport the map state lacks has no
distance and counts 0. Rows say which they show (below); the total mixes the two and says so on
hover: "flown where tracked, direct otherwise".

**A hop's fuel burned** is the fuel used that the tracker recorded with it (`stats.fuel_used_lb`)
when that is above zero. The tracker records the fuel at takeoff less the fuel at landing, which is
zero or negative for an aircraft that reports no fuel or was refuelled in the air; such a hop has
no fuel figure, in its row or in the total.

**Landings.** Each hop with touchdowns counts once, by the touchdown that stands for it —
flight-panel's rule, the first touchdown of its final landing (PANEL-LOOK-004) — so the summary
agrees with the badge in every row. A rating's count carries its word as its accessible name and
hover text ("3 Butter"), the icon never standing by color alone (PANEL-LOOK-001).

## Actions

A row of buttons under the tour block, each handing off to the part of the page that does the work:

| Action | Does |
|---|---|
| **Plan next hop** | Shows the sidebar in the left column, opens the planner card if it is collapsed, sets the planner's form to this aircraft — it follows the highlight only when the highlight changes, and may have been set to another by hand since — and moves the keyboard focus to its flight-time field. It runs no search |
| **Log a hop** | Opens the Log a hop drawer at its form and sets the form's aircraft to this one and its origin to where it is parked, keeping a destination, times and notes already typed (logbook) |
| **Zoom to tour** | Fits the view to this aircraft's hops, as highlighting it does (MAP-ZOOM-003); disabled while the aircraft is hidden or has no hops |
| **Edit aircraft** (the header's pencil) | Opens this aircraft's edit form in the Fleet drawer, as the planner's **Edit aircraft** does |

The panel stays open through all of them.

## The Hop List

Every hop of the aircraft, **latest first**: in the reverse of its tour order (logbook's `seq`), so
the hop that parked it where it is now is on top and hops without times keep their place. Headed
"Hops".

```
┌───────────────────────────────────────────────┐
│ 12  KORF → KPIT                   🧈 85 fpm   │
│     Oct 25, 2026, 7:14 PM                     │
│     318 nm · 1h 58m · 412 lb  SimBrief  [PDF] │
│     planned 1h 52m · 398 lb                   │
│     Smooth air over the ridges.               │
├───────────────────────────────────────────────┤
│ 11  KRIC → KORF                               │
│     no times · 72 nm direct                   │
└───────────────────────────────────────────────┘
```

**A row** shows, leaving out what the hop does not have:

- its hop number and `ORIG → DEST`;
- the compact landing badge of the touchdown that stands for it (flight-panel): rating icon and
  descent rate in fpm;
- when it was flown: the departure's date and time, else the arrival's, in the PC's local time, with
  the year; "no times" when it has neither;
- its distance — "N nm" when the tracker recorded the distance flown, "N nm direct" otherwise;
- its flight time (stored, or derived from its times, LOG-REC-012);
- the fuel it burned, "N lb", when recorded;
- "SimBrief" when a SimBrief plan is kept with it, and beside the row a **PDF** link when that plan has
  one (below);
- the planned figures, "planned 1h 52m · 398 lb", when its plan gives them (below);
- its notes.

**Clicking a row** opens that hop in the flight panel and zooms to it, exactly as its row in the
Fleet drawer does (LOG-LIST-003), and the aircraft panel stays open. A hidden aircraft's hops are
not on the map, so its row opens the flight panel and leaves the view where it is.

**The current row.** The row of the hop the flight panel shows is marked as current, so the list
and the panel below read as one. When that hop was opened from outside the list — its path on the
map, the longest-hop line, a hop row in the Fleet drawer, the page's address — the list scrolls to
bring its row into view; a click on a row never scrolls the list by itself. Opening a flight can
change how the panel scrolls, though — the flight panel takes the room that let the list scroll
alone (Where It Sits) — and the list would then sit below the picture and the tour block, out of
view; whenever the panel changes between its two ways of scrolling, it brings the current row back
into view. The list starts at its top whenever the panel shows another aircraft.

**Pointing at a row**, or reaching it by keyboard, marks that hop's path on the map (tour-map)
without moving the view. One hop is marked at a time, the one last pointed at or focused; the mark
goes when the pointer or the focus leaves it, and also when the panel closes, shows another
aircraft, or loses that hop. A hidden aircraft has no path to mark.

The list is read-only. It renders every hop; a tour of several hundred is a plain list of rows.

### SimBrief Plans in the List

Which hops have a plan is in the map state (`briefing_id`), so the "SimBrief" mark needs nothing more.
The PDF link and the planned figures come from simbrief's digest of an aircraft's plans
(`GET /api/aircraft/:id/plans`: for each of its hops with a plan, the hop, the plan's id, its time
en route, its planned burn with its unit, and its PDF address). The panel asks for it when it shows
an aircraft with at least one plan, and again when the aircraft shown changes or its hops' plan
links change.

A row uses a digest entry only while the entry's plan id is the one the row's hop links to, so a
hop whose plan was replaced or removed never shows the old plan's figures or PDF while the digest
is asked for again. An answer for an aircraft the panel no longer shows is dropped. Until the digest
arrives, or if it fails, rows show only the "SimBrief" mark; the panel says nothing of the failure,
since the plan itself is one click away in the flight panel's SimBrief card, and asks again the
next time the map state loads.

- **PDF** opens the plan's PDF outside the app — a new tab in a browser, the pilot's default browser
  from the installed app's window — and is offered only for an address simbrief's rule for addresses
  taken from a plan allows (SB-CARD-009). The PDF is on SimBrief's server and may no longer be
  served for an old plan; the plan's text, kept whole in the logbook, is in the SimBrief card.
- **Planned figures**: the plan's time en route beside the flight time, and its planned burn beside
  the fuel burned, each when the plan gives it. The burn is shown in pounds, because every flown
  fuel figure on the page is in pounds and the two are there to be compared: a plan in pounds
  (SimBrief's unit `lbs`) as it is, a plan in kilograms (`kgs`) converted at 2.20462 lb/kg and
  rounded to a whole pound. A plan in any other unit shows no planned burn.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Where the panel sits | A glass column at the right edge, the left column's width, above the flight panel | A drawer in the left column, in place of the sidebar; a map popup at the aircraft; a tab inside the flight panel | The tour on the map, its list and one hop's profile can all be read together, with the live card and the planner still in view. A drawer would hide the planner exactly when a tour is being looked over to choose the next hop; a popup cannot hold a scrolling list and closes when its world copy leaves the view; the flight panel is about one flight and is closed most of the time. The right edge was the only side with nothing on it. |
| What opens it | The clicks that pick an aircraft — its marker, parked or live, a path, its card — and nothing else that highlights | Every highlight opens it; only map clicks | A planner search highlights its aircraft so the plan reads on the map; a panel opening over the candidates would undo that. The Fleet card's click is the same gesture as the marker's, made from the list instead of the map. |
| The panel and the highlight | The panel shows the highlighted aircraft; its close button leaves the highlight; clearing the highlight closes it | An aircraft of its own, apart from the highlight; closing clears the highlight | One "current aircraft" on the page: the map's fade, the planner, the hop form and the panel never disagree about which it is. Closing without clearing lets the tour be read on the uncovered map, still standing out. |
| What "hide" means | The stored `visible` flag, the one the Fleet drawer's eye sets | A filter kept only in the page, forgotten on reload | One notion of hidden: the eye in the Fleet drawer, the panel's toggles and **Show all planes** all say the same thing, and the map looks the same after a restart. A second, temporary layer of hiding would leave an aircraft hidden for two different reasons with two different ways back. |
| **Hide other planes** and this aircraft | Changes only the others | Also shows this aircraft ("show only this one") | Each toggle does what its name says and no more, so the two never fight; with both on the map is empty, which is what was asked, and **Show all planes** is in the toolbar. |
| The picture | The aircraft's icon, shown whole and large, when it is an image | A photo field of its own beside the icon | The image a pilot gives an aircraft today is its icon, and most are pictures of the aircraft; showing it large needs no new field, upload or backup rule. A separate photo, letting the badge stay a silhouette, is deferred with bundled type photos (Deferred 1). |
| Order of the list | Latest hop first, by tour order | Tour order, first hop first, as the Fleet drawer lists them; by departure time | Looking back starts with what was flown last, and a long tour should not need scrolling to reach it. Tour order, not time, because hand-logged hops may have no times and the tour order is the logbook's own. |
| Editing hops | Not here; the Fleet drawer's hop list reorders, edits and deletes | The same row actions in both lists | This list is for reading a tour; four action buttons a row would crowd out the figures the panel exists to show. One place to change hops keeps the rules in one place. |
| A hop's distance | The distance flown as recorded with the hop, else the direct distance, the row saying which | The length of the drawn path; direct for every hop | The recorded figure is the one the flight panel's flight card shows, and it is there for a hidden aircraft too, whose paths are not built. Direct is the only distance a hand-logged hop has. |
| Which touchdown a row shows | Flight-panel's: the first touchdown of the hop's final landing | The hop's very first touchdown; the hardest | The same landing as the hop's badge everywhere else on the page; a row that disagreed with the flight panel it opens would read as a mistake. |
| Words for a hop's plan | "SimBrief" for the mark, "planned" for the figures | "plan" for both | "Plan" already names the planner's result on this page — **Plan next hop**, **Clear plan** — so a bare "plan" in a row could be read as either. |
| Planned burn's unit | Pounds, converting a plan in kilograms | The plan's own unit | It sits beside the flown burn to be compared with it, and flown fuel is in pounds everywhere on the page. The SimBrief card shows the plan in its own units. |
| The plan in a row | A "SimBrief" mark, with a **PDF** link when the plan has one; the row itself opens the hop, whose SimBrief card holds the plan's text | The mark opens the PDF; no PDF link, only the flight panel | The PDF is the quickest way to the plan as dispatched, but it lives on SimBrief's server and can go away, while the archived text is always in the SimBrief card; offering both never leaves a recorded plan unreachable. |
| Where plan figures come from | A digest per aircraft, asked for when the panel shows it | In the map state with every hop; one request per hop | The map state loads at every change and reconnect, and plans' figures are needed only while this panel is open. One request per hop would be hundreds on a long tour. |
| Totals over hops missing a figure | Summed over the hops that have it, the fuel line saying how many | "—" unless every hop has it | A tour that mixes hand-logged and tracked hops is the normal case; the count keeps a partial total honest. |
| Whether the panel was open | Not remembered across loads of the page | Kept in the page's storage with the highlighted aircraft | The highlight itself is not remembered, and a window opened again days later should show the whole fleet, as the first fit does. |
| Scrolling | The list alone while it is left at least 240 px; everything under the header as one below that | Always the list alone; always everything | With room, the totals and toggles stay in reach while the list moves. Without it, a list held to what is left under a picture and seven lines of totals would be a row or two tall; 240 px shows about three hops. |
| How the list's room is known | Worked out from set sizes for the parts above it | Measured from the rendered panel | The page already works its layout out from set sizes, so a zoom asked for in the same update that opens a panel allows for it, and the rule is testable without a browser. The set sizes are generous, so a part that wraps to another line costs the list a little height, not its scroller. |
| Focus when the panel closes | The close button sends it to **Clear highlight**; other ways of closing leave it | Back to whatever opened the panel, as a drawer does; never managed | The panel is opened mostly by a click on the map, which holds no focus to return to. The close button would otherwise drop the focus to the top of the page; **Clear highlight** is the control next in the pilot's line of thought. A panel closed by clearing the highlight was closed from a control outside it. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Photos bundled by type.** The pilot is considering shipping a photo for every type in
   SimBrief's list, gathered from public sources as the performance table's numbers were, so an
   aircraft shows a picture here without one being uploaded. It would be fleet's to design beside
   the performance table: which sources and licences allow redistribution in the program and how
   each photo is credited, how much the photos add to the installer, and whether an aircraft gains a
   photo of its own apart from its icon, an upload overriding the type's.
2. **The aircraft in the air.** While the tracker is flying this aircraft the header still reads
   "parked at" its last destination, as the aircraft card does; a "flying now" line with the live
   leg's profile one click away would fit here.
3. **Sorting, filtering and periods** — the list by date range or airport, totals for a month or a
   year.
4. **Running cost.** The HLD defers a realistic cost per tour; the fuel total here is its first
   ingredient, and the tour block is where a cost would show.
5. **Which clock rows show** follows logbook's open question on showing two clocks.
6. **Narrow windows.** Under 1,064 px wide both columns leave less than 240 px of map between them.
   Whether opening the panel should then hide the left column waits on the layout being used at
   that size.

## Relies On

What the panel takes from each segment, and what it needs each to provide for it.

- **live-tracking** — *For the panel:* a click on the live aircraft, while it is bound to a fleet
  aircraft, picks that aircraft as its parked marker does.
- **tour-map** — the highlight (which aircraft the panel shows) and its zoom. *For the panel:* a
  click on a parked marker or a path opens the panel as well as highlighting, and a second click on
  the shown aircraft's marker clears the highlight only while the panel is open; the path of the
  hop the panel marks is drawn marked on every world copy in view; the toolbar hosts fleet's
  **Show all planes**.
- **app-shell** — shared formatting of dates, durations and distances; the error boundary around a
  part of the page; drawers opened by a hand-off. *For the panel:* its place in the page's layout
  and stacking; the clear part of the map counting it on the right, with the attribution, the
  toast, the banner, the empty-map card and the notices kept clear of it; its hand-offs in the
  page's table of them.
- **fleet** — the aircraft's badge, name, livery and icon; the `visible` flag, changed for one
  aircraft with `PUT /api/aircraft/:id`; the Fleet drawer's edit form. *For the panel:*
  `PUT /api/aircraft/visibility`, `{visible, except}`, which sets the flag on every aircraft but
  the one `except` names (on every aircraft when it names none) in one change and answers the
  fleet, 404 for an `except` that names no aircraft; **Show all planes** in the map toolbar while
  any aircraft is hidden; the aircraft card's badge and name opening the panel.
- **logbook** — hops in tour order, their times and flight times (stored or derived); opening a hop
  from a row. *For the panel:* the hop form taking an aircraft handed to it, with its parked
  airport as the origin, without a destination.
- **live-tracking** — the statistics (distance flown, fuel used) and landings recorded with a
  tracked hop, absent on a hand-logged one.
- **flight-panel** — which touchdown stands for a hop, the landing badge and how a rating looks; the
  flight panel a row opens, and which hop it shows.
- **simbrief** — which hops have a plan; the rule for addresses taken from a plan (SB-CARD-009).
  *For the panel:* `GET /api/aircraft/:id/plans`, answering for each hop of the aircraft whose plan
  link names a stored plan `{hop_id, id, ete_min, fuel: {units, burn}, pdf_url}`, 404 for an
  unknown aircraft.
- **planner** — its form follows the highlighted aircraft. *For the panel:* the form taking an
  aircraft handed to it, with the focus on its flight-time field.

## References

- Code: `src/client/components/AircraftPanel.tsx` (the panel), `src/client/tour.ts` (totals, tour
  facts, the landing summary, a hop's distance), [src/client/App.tsx](../../../src/client/App.tsx)
  (whether the panel is open, its hand-offs), [src/client/layout.ts](../../../src/client/layout.ts)
  (its room, the clear part's right side), [src/client/styles.css](../../../src/client/styles.css)
  (`.aircraft-panel`, `.acp-*`)
- HLD: [docs/high-level-design.md](../../high-level-design.md) — Goals (a tour looked back on as a
  whole), Tenets (The page stays a web page), Rules every segment follows (Order and position, Time,
  The server decides, the page shows)
- Opens: flight-panel (a hop, from a row or the longest hop), planner, logbook's hop form, fleet's
  aircraft form
