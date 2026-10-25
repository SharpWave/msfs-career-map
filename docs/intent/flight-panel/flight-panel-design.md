---
parent: high-level-design
prefix: PANEL
---

# Flight Panel

## Context and Design Philosophy

The flight panel is where one flight is examined: how it climbed, cruised and descended, how it
landed, how far it went and what it burned. It opens across the bottom of the map for a logged hop,
the leg being flown right now, or a finished leg still waiting to be logged, so the path on the map
and its profile can be read together — and a waiting leg can be judged before it is logged or
discarded.

This segment owns:

- the panel itself — what opens it, what it shows for a hop, the live leg and a pending leg, closing it
  ([FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx), [App.tsx](../../../src/client/App.tsx));
- the profile chart ([ProfileChart.tsx](../../../src/client/components/ProfileChart.tsx));
- the landing card and the flight card;
- how a landing rating looks everywhere on the page — icon, word, caption and color — the
  landing badge used in hop tooltips, hop rows and the live card, and which touchdown stands for
  a flight in all of them
  ([landing.ts](../../../src/client/landing.ts), [LandingBadge.tsx](../../../src/client/components/LandingBadge.tsx)).

It does not decide anything about a flight. The track, landings, ratings and statistics come from
live-tracking (LIVE-REC, LIVE-LAND); hops and their times from logbook; the aircraft's name and
color from fleet. The panel hosts the SimBrief card, which is simbrief's. The tracker's own message
for a logged hop (LIVE-HOP-006) — shown on the live card and as the text of the desktop app's "Hop
logged" notification — words its rating itself, as plain text; it picks the touchdown by this
segment's rule, so it names the same landing as the hop's badge.

The panel is part of the page, so it works the same in the installed app's window, in a browser tab
— on a copy run from source or on the installed app's own address — and under the browser tests, and
needs nothing from the desktop shell (HLD: the page stays a web page). It has no link out of its own:
the only ones in it — the plan's PDF and the links in its text — are the SimBrief card's (simbrief),
and leave the app's window for the pilot's default browser as every outside link does.

## Opening and Closing

The panel opens for a hop when its path is clicked on the map (MAP-PATH-004) or its row in an
aircraft card (LOG-LIST-003), for the live leg from the live card's **Profile** (LIVE-CARD-005),
and for a pending leg from that leg's **Profile** in the live card (LIVE-CARD-010). One flight
shows at a time; opening another replaces it ([App.tsx:279-291](../../../src/client/App.tsx#L279-L291)).

The page's address can also name a flight to open: `#hop=<id>` opens that hop as its row does, and
`#pending=<id>` opens that pending leg as its **Profile** does. The desktop shell sets this fragment
when the pilot clicks a notification for a logged hop or a leg waiting to be logged; typed into a
browser tab, it works the same. Reading the fragment is app-shell's: its route (APP-UI-032) acts on it
when the page loads, once the map and the first tracker status have loaded (before that status no
pending leg is known), and again whenever the fragment changes, then clears the fragment, so a second
click on the same notification acts again. For a pending leg the route also shows the left column and
opens the live card at that leg's block, where the leg is logged; for a hop the map fits it, as for
any hop opened in the panel (tour-map, MAP-ZOOM-004). For an id that names nothing — "That hop no
longer exists", "That leg has already been logged or discarded" — the route shows a short note, and
the panel stays as it was: the flight it showed, or closed.

Which flight is open belongs to one load of the page. Each load starts with the panel closed — a
reload, the page reloading itself for a new version of the app (app-shell, APP-UI-036), or the
installed app's window opened again, since closing the window discards its page — and only an
address naming a flight opens one then.

A pending leg is held by its id (LIVE-API-003), which is never given to another leg, not even across
a server restart or a logbook restored from an older backup (live-tracking), so neither the panel nor
a notification's link ends up showing a later leg in its place. A hop is held by its id, which
logbook never gives to another hop (LOG-REC-014).

- Its close button closes it.
- When its hop is deleted, it closes.
- When the live leg it shows is logged, it switches to the new hop, so the flight stays on screen as
  it moves into the logbook. A pending leg logged with **Log hop** on the same page does the same.
  While the panel shows the live leg, a hop logged from a pending leg (on this page, or in another
  window or tab) is another flight and leaves the panel on the live leg. The page knows the live
  leg's hop by the takeoff time of the leg the panel last showed; the tracker writes that time
  unchanged into the hop it logs (live-tracking). A hop logged while the event stream was down
  brings no `hop` event. So when the stream reconnects and the leg the panel showed is no longer in
  progress, the panel switches to the hop with that leg's takeoff time, if the reloaded hops hold
  one.
- When its pending leg leaves the tracker's list other than by **Log hop** on this page — discarded
  on any page, or logged in another window or tab — it closes.
- It floats over the bottom of the map as a glass sheet, from the left column's right edge (the
  window's edge when the column is hidden) to the window's right edge, 40% of the window's height
  and at least 260 px; the map keeps its size behind it and zooms land above it (app-shell). It
  sits inside an error boundary that keeps the panel's place and close button, so a malformed
  record cannot take the rest of the app down.
- The chart sits left and the cards right; when the panel is narrower than 720 px, the cards
  stack under the chart and the panel's body scrolls. The panel's own width decides this, not the
  window's, since the left column takes a different share of the window as it opens and closes.

## Header

([FlightPanel.tsx:131-138](../../../src/client/components/FlightPanel.tsx#L131-L138))

- The aircraft's color dot and label; for an unbound live leg, the sim aircraft's title.
- The route: `ORIG → DEST` for a hop; `ORIG → …` for the live leg (`?` when the departure is
  unknown), or "Live" when nothing is being flown.
- A line of detail: for a hop, "hop N", the departure date and time and the flight time when known;
  for the live leg, "airborne since TIME · N points", or "nothing being flown".
- A "live" pill for the live leg.
- For a pending leg: the route with "?" for an unknown airport, "waiting to be logged", the takeoff
  and touchdown times and the flight time; the sim aircraft's title when no fleet aircraft is set.

Once the live leg has touched down, the detail line is meant to say so — "off TIME · landed TIME ·
N points". Today it keeps saying "airborne since" until the leg is logged
([FlightPanel.tsx:109](../../../src/client/components/FlightPanel.tsx#L109)).

## Profile Chart

([ProfileChart.tsx](../../../src/client/components/ProfileChart.tsx))

Every recorded series is drawn against elapsed time in one plot. Each is scaled to its own
minimum–maximum, so altitude in thousands of feet and vertical speed in hundreds of fpm share the
plot without a second axis; the real values live in the legend and the crosshair.

| Series | Unit | Color |
|---|---|---|
| Altitude | ft | blue `#3987e5` |
| Ground speed | kt | orange `#d95926` |
| Vertical speed | fpm | green `#199e70` |
| IAS | kt | amber `#c98500` |
| Fuel | lb | pink `#d55181` |

- **Legend**: each series with its real range ("min–max unit"); clicking one hides or shows it.
  Colors are fixed per series and never reassigned when one is hidden.
- **Left out**: a series with fewer than two values, or the same value throughout (fuel on an
  aircraft that reports none). A track recorded by an older version has altitude only.
- **Time axis**: elapsed time from the first point, with at most seven ticks at the first of 1, 2,
  5, 10, 15 or 30 min, or 1, 2 or 4 h steps that fits (8 h beyond), labelled "45m", "1h", "1h30".
- **Landings**: a vertical mark at each touchdown inside the track, labelled with the rating icon
  and fpm.
- **Crosshair**: under the pointer, the nearest sample by time, with a dot on each visible series
  and a readout of "+elapsed · time of day", the time of day in the PC's local time, and each
  visible series' real value.
- **Table**: a toggle that replaces the plot with every sample — elapsed time and each series' value.
- **Too short**: with fewer than two track points, "No profile: this hop was logged by hand or its
  track is too short."
- It follows the panel's width (at least 240 px) and is 190 px tall.
- **Live leg**: the chart grows as each new point arrives. When the tracker's event stream
  reconnects (after the desktop shell restarts a failed server, say), the chart is redrawn from the
  whole track the server sends again. It then shows exactly the server's track: no stretch twice,
  and no points the restarted server never kept. The seconds the server was down hold no samples,
  and the chart draws across them as across any gap between samples. A restart can cost the leg its
  last few seconds (HLD).

## Landing Card

([FlightPanel.tsx:170-248](../../../src/client/components/FlightPanel.tsx#L170-L248))

The card shows the touchdown that stands for the flight — the first touchdown of its final
landing (below, **Which Touchdown Stands for a Flight**):

- the rating's icon, word and caption;
- the descent rate, with "sim says N" when the sim's own touchdown rate was recorded;
- the peak G, or "not measured";
- the touchdown airspeed, and the attitude ("N° pitch · N° left/right bank") when known;
- with more than one touchdown (bounces, touch-and-goes), every touchdown as a chip of icon and fpm;
- where the numbers came from: "Measured every frame at touchdown." or "From once-a-second samples;
  the per-frame watcher was not available.";
- a **scale** toggle listing the five ratings with their fpm bands, and how peak G bumps the class.

Without a landing it reads "No touchdown recorded."

The scale's G note says "A peak G above 1.6 / 2.0 / 2.6 / 3.5 bumps the class up", but a G of
exactly a threshold already counts (LIVE-LAND-003); it is meant to read "of 1.6 / 2.0 / 2.6 / 3.5
or more" ([FlightPanel.tsx:243](../../../src/client/components/FlightPanel.tsx#L243)).

## Which Touchdown Stands for a Flight

([landing.ts](../../../src/client/landing.ts))

A flight can touch down more than once: a bounce puts the wheels back on the runway seconds later,
a touch-and-go flies a whole circuit before the next touchdown, a go-around after a bounce comes
back minutes later. The tracker records and rates every touchdown alike (LIVE-LAND). Wherever one
touchdown has to stand for the flight — the landing card, a hop's map tooltip, its hop row, the
live card — it is the **first touchdown of the flight's final landing**:

- a touchdown less than 30 s after the flight's previous touchdown is a bounce, part of the same
  landing;
- any other touchdown starts a new landing;
- the final landing is the flight's last one; for the live leg, the latest so far.

A bounced arrival is judged by its first contact, the one the approach flew into, while pattern
work and go-arounds still show the landing that ended the flight. Touchdowns are grouped from their
recorded times when a flight is shown, so every hop reads the same way whenever it was logged.

## How a Rating Looks

The rating is decided on the server (LIVE-LAND-003); the page only maps it to how it reads
([landing.ts:8-23](../../../src/client/landing.ts#L8-L23)). The color always travels with the icon and
word, never alone.

| Rating | Icon | Word | Caption | Color |
|---|---|---|---|---|
| butter | 🧈 | Butter | nobody looked up from their book | `#3bceac` |
| solid | 👍 | Solid | the coffee stayed in the cups | `#86b6ef` |
| hard | 💥 | Hard | a few gasps from the cabin | `#fbbf24` |
| hospital | 🏥 | Hospital | someone is calling a lawyer | `#f97316` |
| graveyard | 🪦 | Graveyard | nobody is walking away from that one | `#ef4444` |

**Landing badge** ([LandingBadge.tsx](../../../src/client/components/LandingBadge.tsx)): a pill in the
rating's color with icon, word and fpm ("🧈 Butter · 85 fpm"), or icon and fpm when compact; its
hover text is "Word: caption · N fpm, G.GG G". Hop tooltips use the full badge; hop rows and the
live card the compact one. Each shows the touchdown that stands for its flight.

## Flight Card

([FlightPanel.tsx:249-290](../../../src/client/components/FlightPanel.tsx#L249-L290))

| Line | Shows |
|---|---|
| Distance | "N nm flown · N nm direct" for a tracked hop; "N nm direct" otherwise; "—" when neither is known |
| Max altitude | Highest altitude, ft |
| Max ground speed | Highest ground speed, kt |
| Fuel used | Fuel used, lb, with "start → end lb" when both are known |
| Weight | "N lb at takeoff · N lb at landing" |
| Samples | Number of track points |

Anything unknown shows "—"; a hand-logged hop has only its direct distance and samples.

For the live leg the card is meant to show everything known so far: fuel at takeoff and now, fuel
used, weight at takeoff, highest altitude and ground speed, distance flown so far, and samples;
the tracker's status carries those figures (LIVE-API-006). Today it carries only fuel used,
current fuel and highest altitude, so the rest reads "—"
([FlightPanel.tsx:112-124](../../../src/client/components/FlightPanel.tsx#L112-L124)).

For a pending leg the card shows the statistics recorded when the leg closed, and the direct
distance once both airports are known; the leg is fetched in full, track included, when the panel
opens it (LIVE-API-007).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Where the panel sits | A glass sheet across the bottom of the map, right of the left column, 40% of the window's height | A modal; a side drawer; a separate page; docked under a shrunken map | The path on the map and its profile can be read together; floating keeps the map whole behind it, and zooms land in the part it leaves clear. |
| Many series in one chart | Each series scaled to its own range, real values in the legend and crosshair | Dual or multiple y-axes; one small chart per series | Dual axes invite false comparisons between unrelated scales; one plot keeps the moments of a flight lined up. |
| Series colors | A fixed categorical order validated for the dark surface | Reassign colors to visible series | A series keeps its color when others are hidden, so the legend never shifts meaning. |
| Rating colors | Always with icon and word | Color alone | Readable without color vision and at a glance. |
| Where ratings are decided | Server; the page maps rating → look only | Rate in the page | One rating per landing, stored with the hop and identical everywhere. |
| Landing shown | The first touchdown of the final landing, with every touchdown as chips | The last touchdown; the hop's first touchdown; the worst | The first contact is the landing the approach flew into; the bounces after it are its aftermath and would replace its rating with theirs. The final landing is the one that ended the flight, so a touch-and-go circuit flown earlier does not stand in for it. Every touchdown stays visible as a chip. |
| Bounce window | Touchdowns less than 30 s apart belong to one landing | Measure the airborne time between touchdowns; a window of a few seconds | Bounces come seconds apart and the tightest circuit takes minutes, so 30 s separates them with room to spare. Each touchdown already carries its time, so no new measurement is needed. |
| Where bounces are grouped | In the page, when a flight is shown | The tracker merges bounces into one landing record | Every touchdown stays recorded as measured, and hops logged before the grouping read the same way without a migration. |
| Live leg following into the logbook | The panel switches to the hop the live leg became, and to no other | Close it; stay on an empty live view; switch to any hop logged while it shows the live leg | The flight being watched stays on screen as it becomes a hop. A hop logged from a pending leg while the panel shows the live leg is a different flight; switching to it would take the leg still being flown off the screen. |
| Telling the live leg's hop from others | The hop whose takeoff time is that of the leg the panel last showed | The `hop` event naming the leg it came from; matching route and aircraft | Two legs never share a takeoff time, while route and aircraft repeat when a leg is flown again. The tracker already writes the takeoff time into the hop, so this needs nothing new on the event stream, and it also finds the hop among the reloaded hops after a reconnect, when no `hop` event came. |
| The live chart after a reconnect | Redrawn from the whole track the server sends again | Keep the points already drawn and append the new ones | The server's track is the record. Points drawn before a server restart can include seconds the restarted server never kept, and appending across a reconnect would skip or double a stretch. |
| The open flight across loads of the page | Not kept: each load starts with the panel closed, and an address naming a flight opens it | Remember it in the browser's storage, as the cards' open state is | The window is discarded when closed and opened again later, often after the flight it showed was logged or discarded. In the installed app a new version comes only with a restart of the app — on Quit, on Restart to update, or at a quiet moment with no leg in progress — so the page reloads itself when the pilot chose the interruption or was flying nothing. A notification names the flight it is about, and any other is one click away on the map, a hop row or the live card. |
| Pending legs | Openable in the panel like any flight | Only the summary line in the live card | A leg kept after a crash or a missed airport can be judged from its profile before it is logged or discarded. |
| A pending leg logged or discarded elsewhere | The panel closes | Follow it to the hop it became (the hop with its takeoff time); keep showing the leg as it was | The pilot acted in another window or tab, which has the flight on screen. Here the leg leaving the list closes the panel by one rule whether it was logged or discarded — a discard brings no hop to follow — and a logged one is a click away on the map or its row. A leg no longer waiting shown as waiting would invite logging it twice. |
| What a notification's hop or waiting leg opens | The flight in the panel, as its row or **Profile** would — beside the live card's block for a waiting leg, which app-shell opens | Only the hop's row, or only the live card's block | The pilot clicked to see that flight, and the panel is where one flight is examined; the live card's block is where a waiting leg is logged, so the pilot sees both. |
| An address naming nothing | The panel stays as it was, beside app-shell's short note | Close the panel; open it empty | The note says why nothing opened, and a stale link — a "Hop logged" notification whose hop was deleted after it showed — should not take away the flight the pilot had open. |
| Table view | Every sample as a row | None | [inferred] Exact values for inspection and an accessible alternative to the plot. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Live header after touchdown** says "airborne since" ([FlightPanel.tsx:109](../../../src/client/components/FlightPanel.tsx#L109)).
2. **Live flight card** shows only fuel used, current fuel and highest altitude ([FlightPanel.tsx:112-124](../../../src/client/components/FlightPanel.tsx#L112-L124)).
3. **Scale wording** says "above" for G thresholds that apply at the threshold ([FlightPanel.tsx:243](../../../src/client/components/FlightPanel.tsx#L243)).
4. **Rating bands restated** — the scale's fpm bands and G note repeat the server's thresholds
   ([landing.ts:17-23](../../../src/client/landing.ts#L17-L23), [tracker.ts:57-60](../../../src/server/tracker.ts#L57-L60)).
5. **Another great-circle formula** — the direct distance is computed in the panel
   ([FlightPanel.tsx:163-168](../../../src/client/components/FlightPanel.tsx#L163-L168)).
6. **"At landing" weight** is read where the aircraft stopped, after taxiing in.
7. **Which clock the header shows** follows logbook's open question on showing two clocks.
8. **Table size** — every sample is a row, so a long flight renders thousands
   ([ProfileChart.tsx:236-243](../../../src/client/components/ProfileChart.tsx#L236-L243)).
9. **A live leg kept as a pending leg** — when the sim disconnects in flight (LIVE-LEG-008), or a leg
   restored at server start cannot continue (live-tracking), the leg leaves the live view for the
   pending list, and the panel showing it falls back to "nothing being flown". Whether it follows the
   leg into the list, as a logged leg follows into the logbook, waits on the tracker saying which
   pending leg the live leg became.

## References

- Code: [src/client/components/FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx) (all
  but `BriefingCard`, which is simbrief's), [src/client/components/ProfileChart.tsx](../../../src/client/components/ProfileChart.tsx),
  [src/client/landing.ts](../../../src/client/landing.ts), [src/client/components/LandingBadge.tsx](../../../src/client/components/LandingBadge.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (panel source, closing on delete, following the
  live leg, mounting), [src/client/styles.css](../../../src/client/styles.css) (`.flight-panel`, `.fp-*`,
  `.profile*`, `.landing-badge`)
- Consumes: live-tracking (track, landings, ratings, statistics, live status, pending legs by id;
  the live leg's whole track on every connect of the event stream, LIVE-API-002, LIVE-API-005; the
  leg's takeoff time kept unchanged in the hop logged from it, LIVE-HOP-001, LIVE-HOP-004; the hops
  reloaded after a reconnect, LIVE-API-005), logbook (hops; hop ids never given twice,
  LOG-REC-014), fleet (aircraft label and color), airports (positions for the direct distance)
- Opened from: tour-map (a hop's path), logbook (a hop row), live-tracking (the live card's
  **Profile**), app-shell (the page's address fragment, APP-UI-032, which the desktop shell's
  notifications set)
- Hosted: simbrief's SimBrief card
