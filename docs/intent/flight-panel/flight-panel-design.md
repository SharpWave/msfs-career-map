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

- the panel itself — what opens it, what it shows for a hop and for the live leg, closing it
  ([FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx), [App.tsx](../../../src/client/App.tsx));
- the profile chart ([ProfileChart.tsx](../../../src/client/components/ProfileChart.tsx));
- the landing card and the flight card;
- how a landing rating looks everywhere in the app — icon, word, caption and color — and the
  landing badge used in hop tooltips, hop rows and the live card
  ([landing.ts](../../../src/client/landing.ts), [LandingBadge.tsx](../../../src/client/components/LandingBadge.tsx)).

It does not decide anything about a flight. The track, landings, ratings and statistics come from
live-tracking (LIVE-REC, LIVE-LAND); hops and their times from logbook; the aircraft's name and
color from fleet. The panel hosts the SimBrief card, which is simbrief's.

## Opening and Closing

The panel opens for a hop when its path is clicked on the map (MAP-PATH-004) or its row in an
aircraft card (LOG-LIST-003), for the live leg from the live card's **Profile** (LIVE-CARD-005),
and for a pending leg from that leg's **Profile** in the live card (LIVE-CARD-010). One flight
shows at a time; opening another replaces it ([App.tsx:172-212](../../../src/client/App.tsx#L172-L212)).
Pending legs cannot be opened today.

- **✕** closes it.
- When its hop is deleted, or its pending leg discarded, it closes.
- When the live leg or pending leg it shows is logged, it switches to the new hop, so the flight
  stays on screen as it moves into the logbook. (Today only the live leg does.)
- It takes the bottom 40% of the map area and sits inside an error boundary, so a malformed record
  cannot take the rest of the app down.

## Header

([FlightPanel.tsx:67-78](../../../src/client/components/FlightPanel.tsx#L67-L78))

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
([FlightPanel.tsx:47](../../../src/client/components/FlightPanel.tsx#L47)).

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
  and a readout of "+elapsed · local clock time" and each visible series' real value.
- **Table**: a toggle that replaces the plot with every sample — elapsed time and each series' value.
- **Too short**: with fewer than two track points, "No profile: this hop was logged by hand or its
  track is too short."
- It follows the panel's width (at least 240 px) and is 190 px tall. For the live leg it grows as
  each new point arrives.

## Landing Card

([FlightPanel.tsx:103-180](../../../src/client/components/FlightPanel.tsx#L103-L180))

The card shows the flight's final landing — its last touchdown, the one that ended the hop:

- the rating's icon, word and caption;
- the descent rate, with "sim says N" when the sim's own touchdown rate was recorded;
- the peak G, or "not measured";
- the touchdown airspeed, and the attitude ("N° pitch · N° left/right bank") when known;
- with more than one touchdown (touch-and-goes), every touchdown as a chip of icon and fpm;
- where the numbers came from: "Measured every frame at touchdown." or "From once-a-second samples;
  the per-frame watcher was not available.";
- a **scale** toggle listing the five ratings with their fpm bands, and how peak G bumps the class.

Without a landing it reads "No touchdown recorded."

The scale's G note says "A peak G above 1.6 / 2.0 / 2.6 / 3.5 bumps the class up", but a G of
exactly a threshold already counts (LIVE-LAND-003); it is meant to read "of 1.6 / 2.0 / 2.6 / 3.5
or more" ([FlightPanel.tsx:175](../../../src/client/components/FlightPanel.tsx#L175)).

## How a Rating Looks

The rating is decided on the server (LIVE-LAND-003); the browser only maps it to how it reads
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
live card the compact one.

## Flight Card

([FlightPanel.tsx:182-223](../../../src/client/components/FlightPanel.tsx#L182-L223))

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
([FlightPanel.tsx:51-62](../../../src/client/components/FlightPanel.tsx#L51-L62)).

For a pending leg the card shows the statistics recorded when the leg closed, and the direct
distance once both airports are known; the leg is fetched in full, track included, when the panel
opens it (LIVE-API-007).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Where the panel sits | Across the bottom of the map, 40% of its height | A modal; a side drawer; a separate page | [inferred] The path on the map and its profile can be read together. |
| Many series in one chart | Each series scaled to its own range, real values in the legend and crosshair | Dual or multiple y-axes; one small chart per series | Dual axes invite false comparisons between unrelated scales; one plot keeps the moments of a flight lined up. |
| Series colors | A fixed categorical order validated for the dark surface | Reassign colors to visible series | A series keeps its color when others are hidden, so the legend never shifts meaning. |
| Rating colors | Always with icon and word | Color alone | Readable without color vision and at a glance. |
| Where ratings are decided | Server; the browser maps rating → look only | Rate in the browser | One rating per landing, stored with the hop and identical everywhere. |
| Landing shown | The final touchdown, with every touchdown as chips | The worst; the first | The last touchdown is the one that ended the flight; touch-and-goes stay visible. |
| Live leg following into the logbook | The panel switches to the logged hop | Close it; stay on an empty live view | [inferred] The flight being watched stays on screen as it becomes a hop. |
| Pending legs | Openable in the panel like any flight | Only the summary line in the live card | A leg kept after a crash or a missed airport can be judged from its profile before it is logged or discarded. |
| Table view | Every sample as a row | None | [inferred] Exact values for inspection and an accessible alternative to the plot. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Live header after touchdown** says "airborne since" ([FlightPanel.tsx:47](../../../src/client/components/FlightPanel.tsx#L47)).
2. **Live flight card** shows only fuel used, current fuel and highest altitude ([FlightPanel.tsx:51-62](../../../src/client/components/FlightPanel.tsx#L51-L62)).
3. **Scale wording** says "above" for G thresholds that apply at the threshold ([FlightPanel.tsx:175](../../../src/client/components/FlightPanel.tsx#L175)).
4. **Rating bands restated** — the scale's fpm bands and G note repeat the server's thresholds
   ([landing.ts:17-23](../../../src/client/landing.ts#L17-L23), [tracker.ts:52-55](../../../src/server/tracker.ts#L52-L55)).
5. **Another great-circle formula** — the direct distance is computed in the panel
   ([FlightPanel.tsx:93-101](../../../src/client/components/FlightPanel.tsx#L93-L101)).
6. **"At landing" weight** is read where the aircraft stopped, after taxiing in.
7. **Which clock the header shows** follows logbook's open question on showing two clocks.
8. **Table size** — every sample is a row, so a long flight renders thousands
   ([ProfileChart.tsx:236-243](../../../src/client/components/ProfileChart.tsx#L236-L243)).
9. **Pending legs cannot be opened** — the tracker status leaves out their tracks and the live card
   has no way to open one.

## References

- Code: [src/client/components/FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx) (all
  but `BriefingCard`, which is simbrief's), [src/client/components/ProfileChart.tsx](../../../src/client/components/ProfileChart.tsx),
  [src/client/landing.ts](../../../src/client/landing.ts), [src/client/components/LandingBadge.tsx](../../../src/client/components/LandingBadge.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (panel source, closing on delete, following the
  live leg, mounting), [src/client/styles.css](../../../src/client/styles.css) (`.flight-panel`, `.fp-*`,
  `.profile*`, `.landing-badge`)
- Consumes: live-tracking (track, landings, ratings, statistics, live status), logbook (hops),
  fleet (aircraft label and color), airports (positions for the direct distance)
- Hosted: simbrief's SimBrief card
