---
parent: high-level-design
prefix: MAP
---

# Tour Map

## Context and Design Philosophy

The map is the app's main view. Its job is to show each aircraft's tour as a big, colorful
hop-to-hop path, where every aircraft is parked now, and when each airport was visited — with the
real flown track wherever the sim recorded one.

This segment owns:

- the map itself: basemaps, the initial view, resizing, and the map toolbar — the **Layers** menu
  (basemap, night shading, hazard toggles), the hazard count, **Fit all** and **Clear highlight**
  ([MapToolbar.tsx](../../../src/client/components/MapToolbar.tsx));
- **map geometry** — turning hops into paths, airport dots and parked positions, placing shapes
  across the antimeridian, the world copies every layer is drawn on, and the zoom-to-fit points —
  shared by every map layer and by the zoom logic ([paths.ts](../../../src/client/paths.ts),
  [geo.ts](../../../src/client/geo.ts));
- tours (hop paths, direction chevrons, hop tooltips), visited-airport dots and their tooltips,
  parked-aircraft markers, highlighting and zooming;
- the night and weather-hazard overlays.

The map also hosts layers owned elsewhere: the planner's range ring and candidate dots (planner),
the live aircraft and its growing track (live-tracking), and SimBrief routes (simbrief); this
segment places them and draws them on every world copy in view like its own layers. The airport
popup opened from a dot is airports'. Hops, their order and where an aircraft is parked
come from logbook; aircraft color, icon and visibility from fleet.

## Map Geometry

All positions a layer draws come from one pass over the state
([paths.ts](../../../src/client/paths.ts)), so paths, dots, parked markers and zoom-to-fit always
agree.

**World copies.** The map wraps. The basemap repeats on every world copy, and so does every layer
drawn over it: hop paths and chevrons, airport dots, parked markers, the planner's ring and
candidates, SimBrief routes, the live aircraft, its track and the casual path (live-tracking),
hazard areas and night shading. Each
shape is placed once, around its own longitude, and drawn again shifted by every whole turn of
360° that brings any part of it into a world copy in view. Two copies of a region in view therefore
always show the same things, and a shape that crosses the 180° meridian reads as one continuous
shape on either side of it. Popups and hover tooltips are not layers: each opens only on the copy
where it was opened.

**Placing a shape.** A shape's first point keeps its own longitude, and every next point, the last
included, is shifted by whole turns of 360° to within 180° of the one before it. A shape crossing
the meridian therefore runs on past ±180° instead of jumping across the map, and its copy one turn
over completes it on the other side. Hop paths run from the origin to the destination, recorded
tracks and SimBrief routes sample to sample, hazard areas vertex to vertex. A point that stands
alone — an airport dot, a parked marker, a planner candidate, the live aircraft — sits at its own
longitude, and the range ring is centred on the plan's origin at its own longitude. Night shading
arrives already placed — closed along a pole when it covers one, a full turn wide — and keeps its
geometry as computed.

**Copies in view.** A world copy is the band of longitude from −180° + 360°k to 180° + 360°k. The
copies in view are those the view touches once widened by a quarter of its width on each side; the
map's vector layers are rendered with the same margin, so a short pan finds everything already in
place. Each shape is drawn at every shift of whole turns that brings its own span of longitude
into those copies; the range ring's span is the plan's zoom box.

The set is recomputed whenever the map comes to rest after a pan, zoom or resize, which is also
when Leaflet redraws its vector layers, and a zoom request adds the copies around where it will land
before the map moves. A copy that stays in view is left as it is, so a popup or tooltip open on it
stays open; a copy that leaves the view is removed with anything open on it, an airport popup or a
planner candidate's popup included. A planner candidate counts as a shape of its own, so each one
is drawn once per copy in view rather than the whole set spreading across every copy any of them
reaches. Shifted geometry is
kept per shape and copy, so re-rendering the map — the live tracker does so every second —
redraws nothing that has not changed.

The view itself may sit on any copy: panning carries on across the antimeridian without jumping
back to the first world (MAP-VIEW-004), since every copy looks the same.

**Per-aircraft chains.** Each visible aircraft's hops are taken in logbook order; hidden aircraft
draw nothing. A hop whose airport is unknown to the map state is skipped, and the aircraft's
parked position comes from its last drawn hop.

**Hop paths.** Each hop is placed on its own, starting at its origin's own longitude. A hop with a
recorded track of at least two samples is drawn along the track, with the two airport positions
first and last so the line is tied to the dots at both ends. Any other hop is drawn as a great
circle from the origin to the destination: points about every 25 nm (2–96 segments), a straight
pair under 1 nm ([geo.ts](../../../src/client/geo.ts)). Either way the path is placed point by
point, so a Pacific crossing is one short line, not a jump across the map, and the path ends at the
destination's position on whichever copy it reaches, where that copy's dot sits. Each hop also carries its direct
airport-to-airport distance and, when tracked, the length flown along the drawn path.

**Airport dots.** One dot per airport, at the airport's own position, drawn on every world copy in
view. Each dot collects a "departed" event per hop leaving it and an "arrived" event per hop
reaching it, sorted by time with untimed events last, then by aircraft, then by hop number,
arrivals before departures.

**Parked positions.** An aircraft with hops is parked at its last drawn hop's destination airport.
Several aircraft parked at the same airport fan out: the first sits on the dot, each next one
30 px away, stepping 60° clockwise from straight up.

**Planner results.** The ring and the candidates are placed like any other shape and drawn on every
world copy in view, so a candidate across the 180° meridian from the origin appears beside the
ring, on whichever side of it the candidate lies. The zoom box for a plan is the ring's bounding
box, latitudes clamped to ±85° and at most a full turn wide; its zoom points run along the box's
edges no more than 30° of longitude apart, so a box wider than 180° is gathered whole (see
Highlighting and Zooming) rather than the other way round the globe.

**Zoom points.** Fitting to hops uses each hop's first and last point plus, for tracked hops, every
10th point so detours are included. A long great circle contributes only its endpoints, so its
poleward bulge can fall outside the fit. Which world copy a zoom lands on is the zoom's choice
(see Highlighting and Zooming), not the points'.

## Tours on the Map

Layers are drawn bottom to top: hazards and night shading; planner ring and candidates; SimBrief
routes; path casings; colored paths; chevrons; airport dots; parked markers; the live aircraft
([MapView.tsx:214-362](../../../src/client/components/MapView.tsx#L214-L362)).

- **Paths.** Every hop gets a dark casing (weight 9) under a colored line (weight 5). Odd-numbered
  hops use the aircraft's color and even-numbered hops a 38% lighter shade, so the leg that landed
  at an airport and the one that left it stay distinguishable when zoomed in
  ([icons.ts:106-112](../../../src/client/icons.ts#L106-L112)). Hidden aircraft are not drawn at all.
- **Chevrons.** Hops of at least 8 nm direct get a direction arrow at the middle point of their
  path, in the path's color ([MapView.tsx:295-309](../../../src/client/components/MapView.tsx#L295-L309)).
- **Hop tooltip** (hover): the aircraft in its color; `ORIG → DEST · hop n · direct nm`, plus
  "· N nm flown (tracked)" for tracked hops; departure, arrival and duration when known; the final
  landing's badge and its G; the notes; "Click for the flight profile" when tracked
  ([MapView.tsx:521-552](../../../src/client/components/MapView.tsx#L521-L552)).
- **Clicking a path** opens that hop in the flight panel, selects its aircraft and zooms to the hop.
- **Airport dots** are filled with the visiting aircraft's color when exactly one aircraft has been
  there, white otherwise. The tooltip lists the airport, its location, up to three runways, every
  arrival and departure ("(time not logged)" when untimed, with the hop number), "Currently here:"
  with the parked aircraft, and "Click for photo, weather and links". Clicking opens the airport
  popup ([MapView.tsx:311-330](../../../src/client/components/MapView.tsx#L311-L330),
  [555-579](../../../src/client/components/MapView.tsx#L555-L579)).
- **Parked markers** show the aircraft's badge (fleet) at its parked position; the tooltip reads the
  aircraft and "parked at IDENT · name". Clicking a marker highlights that aircraft, or clears the
  highlight if it is already highlighted ([MapView.tsx:332-354](../../../src/client/components/MapView.tsx#L332-L354)).
- **Empty map.** With no hops at all, the map shows "Nothing on the map yet" and how to start
  ([App.tsx:474-479](../../../src/client/App.tsx#L474-L479)).

## Highlighting and Zooming

**Highlight.** One aircraft can be highlighted, from its card, its parked marker or a path. While
one is, every other aircraft fades: paths to 0.45 opacity (casing 0.25), parked markers to 0.6,
airport dots that aircraft never visited to 0.5, and their chevrons are hidden; the highlighted
marker is drawn on top ([MapView.tsx:30](../../../src/client/components/MapView.tsx#L30)). The
**Clear highlight** button appears while one is set. Deleting the highlighted aircraft clears it
([App.tsx:246-249](../../../src/client/App.tsx#L246-L249)).

**Zoom requests** ([App.tsx:226-279](../../../src/client/App.tsx#L226-L279),
[layout.ts:31-44](../../../src/client/layout.ts#L31-L44), [fit.ts:32-104](../../../src/client/fit.ts#L32-L104),
[MapView.tsx:582-600](../../../src/client/components/MapView.tsx#L582-L600)):

| Trigger | Zooms to |
|---|---|
| First load of the map state | Every path |
| **Fit all** | Every path |
| Highlighting an aircraft | That aircraft's paths |
| Opening a hop (path click, hop row) | That hop |
| A new planner result | The plan's ring |
| Focusing a planner candidate | The candidate |

A request whose points collapse to one place flies there at zoom 9 or closer; otherwise the map
flies to the points' bounds with 60 px padding, no closer than zoom 11, over 0.6 s. A request that
names its zoom — the live card's **Zoom** (zoom 10) and `?view=` — goes to that point at that zoom.
An empty request is ignored. Repeating the same request still zooms.

Every request lands on the world copy nearest the view. Its points are first gathered onto the
narrowest band of longitude that holds them all — across the 180° meridian when that is narrower —
and the band is then shifted by whole turns of 360° so its middle lies within 180° of the centre
of the part of the map the panels leave clear, an exact tie going east. Whether the points lie at
one place is judged after gathering, so 180° and −180° are one place. A tour or ring that crosses
the Pacific is fitted as one region, and a zoom never flies around the world to a copy that looks
the same as one close by.

Panels float over the map (app-shell), so every request lands in the part of the map they leave
clear: the point, or the bounds with their 60 px padding, are centred in that part rather than in
the window. The page supplies the clear part with each request; when it is smaller than 240 × 160
px, the request uses the whole window. While the browser asks for reduced motion, the map jumps to
the request's view instead of flying.

## Basemaps and View Preferences

- **Basemaps** ([MapView.tsx:44-63](../../../src/client/components/MapView.tsx#L44-L63)): Dark
  (Esri dark gray with a label overlay), Light (OpenStreetMap), Satellite (Esri imagery), all
  keyless. Every basemap zooms to 19, over-zooming tiles past their native maximum.
- **Initial view** centres on the continental US at zoom 4 until the first fit; minimum zoom 2;
  panning carries on across the antimeridian onto the next world copy, without limit.
- **Remembered in the browser**: basemap (default Dark), night shading (default on) and the hazard
  toggles (default off) ([App.tsx:29-89](../../../src/client/App.tsx#L29-L89),
  [prefs.ts:3-18](../../../src/client/prefs.ts#L3-L18)).
- **URL options**, applied once after the first load ([App.tsx:292-301](../../../src/client/App.tsx#L292-L301)):
  `?view=lat,lon,zoom` sets the view; `?wx=1` turns on every hazard toggle and `?wx=A,B` the listed
  ones; `?night=1` (or anything else) sets night shading on (off). URL options do not change the
  remembered preferences.
- The map fills the window and resizes with it; panels opening or closing over it never move it.

**Map toolbar** ([MapToolbar.tsx](../../../src/client/components/MapToolbar.tsx)), at the top right:
**Layers**; the hazard count while any hazard toggle is on (see below); **Fit all**; and **Clear
highlight** and **Clear plan** (planner) while they apply.

**Layers menu.** One menu holds the choices made once a session and then left alone:

- **Basemap** — Dark, Light or Satellite, one at a time.
- **Night shading** — on or off.
- **Weather hazards** — the four hazard toggles, each with what it covers, and the hazards' source.

The **Layers** button marks what is on: a moon while night shading is on, and a dot in its hazard
color for each hazard toggle that is on. The menu opens and closes like the page's other menus
(app-shell): it closes on Esc, when its button is clicked again, and when the pointer goes down
outside it, and the app menu and the Layers menu close each other. Choices apply at once and the
menu stays open, so several can be changed in one visit.

## Night Overlay

Two translucent, non-interactive polygons — where the sun is below the horizon, and where it is
more than 6° below (civil twilight over) — overlap so full night reads darker than dusk. They are
drawn on every world copy in view and recomputed every minute
([NightLayer.tsx](../../../src/client/components/NightLayer.tsx), [App.tsx:62-66](../../../src/client/App.tsx#L62-L66)).
The sun's position comes from a low-precision solar model good to a fraction of a degree; the
night region is the spherical cap around the anti-solar point, closed along the pole when it
covers one ([sun.ts](../../../src/client/sun.ts)). The same model's "dark" test (sun below −6°)
feeds the planner's night checks.

## Weather Hazard Overlay

**Source** ([hazards.ts](../../../src/server/hazards.ts)): aviationweather.gov G-AIRMETs (US:
icing, turbulence, IFR, mountain obscuration), US SIGMETs and international SIGMETs, fetched in
parallel and normalised to one polygon shape with kind, label, severity, base and top altitude,
validity, forecast hour (G-AIRMET), FIR and raw text. Labels map to seven kinds — icing,
turbulence, IFR, mountain obscuration, convective, volcanic ash, tropical cyclone — and anything
else is dropped, as are G-AIRMETs that are not areas, SIGMET outlooks, and polygons with fewer than
three points. G-AIRMET altitudes are hundreds of feet ("SFC" = 0). `GET /api/hazards` serves the
set cached for 10 minutes; a source that fails is listed in the set's errors while the others are
served; when all three fail, the previous set is served if there is one.

**Display** ([HazardLayer.tsx](../../../src/client/components/HazardLayer.tsx)):

- Four toggles in the Layers menu, each covering a group: **Ice** (icing), **Turb** (turbulence), **IFR** (IFR
  and mountain obscuration), **Storms** (convective, volcanic ash, tropical cyclones). A toggle that
  is on takes its hazard color ([MapToolbar.tsx:14-20](../../../src/client/components/MapToolbar.tsx#L14-L20),
  [108-124](../../../src/client/components/MapToolbar.tsx#L108-L124), [App.tsx:21-27](../../../src/client/App.tsx#L21-L27)).
- With any toggle on, the layer fetches the set and refreshes it every 10 minutes. Of the
  G-AIRMETs it keeps only the forecast snapshot whose valid time is nearest now; SIGMETs are always
  shown. It draws the enabled kinds as shaded polygons — solid outline for G-AIRMETs, dashed for
  SIGMETs — each placed vertex to vertex and drawn on every world copy in view, so an area that
  straddles the antimeridian is whole on both sides of it.
- Tooltip: kind and severity in the kind's color; label and FIR; "base – top" ("SFC" / "above" for
  open ends) or "altitudes not given"; validity, with "G-AIRMET +Nh" for forecast snapshots; the
  raw text up to 220 characters.
- The toolbar shows "N areas" for what is drawn — each area once, however many world copies show
  it — or "hazards unavailable" when the fetch failed, with the fetch time on hover.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Antimeridian handling | The map wraps: every shape is placed once around its own longitude and drawn on every world copy in view | Draw each layer once, unwrapping each aircraft's chain onto one copy; always draw three copies (−360°, 0, +360°); one world with panning stopped at the antimeridian; split lines at ±180° | Two copies of a region in view must never differ — a ring beside one copy of an airport with its candidates beside the other is the failure this rules out. Drawing only the copies in view keeps the cost to one or two copies when zoomed in, where a fixed three always triples every layer and still leaves bare copies at the edges of a wide window zoomed out. Stopping at the antimeridian, or splitting lines there, cuts every Pacific tour in two. |
| Hop placement | Each hop placed from its own origin, point by point | Unwrap each aircraft's whole chain hop after hop | With every copy drawn, consecutive hops meet at their dots on every copy anyway. Placing hops one by one keeps each path near its origin's own longitude, so a tour that circles the globe does not drift a further world away with every lap and need ever more copies drawn. |
| Panning across copies | The view pans freely onto any copy | Leaflet's world-copy jump back to the first world past the antimeridian | With every copy drawn, jumping back gains nothing, and Leaflet redraws vector layers only when the map comes to rest, so a jump in the middle of a drag would blank them until the mouse is released. |
| When the copies are recomputed | When the map comes to rest, plus the target's copies before a zoom moves | On every frame of a pan or flight | Leaflet redraws vector layers only at rest anyway; recomputing every frame would rebuild thousands of planner candidates in the middle of a flight. |
| Zooms across world copies | Gather the points onto their narrowest band of longitude, then use the copy nearest the view | Zoom to the points as placed | Points placed shape by shape can sit on either side of the meridian; gathering them fits a Pacific tour as one region, and the nearest copy means a zoom never travels around the world to a copy that looks the same as one close by. |
| One geometry module | `paths.ts` computes every drawn position and the zoom points | Each layer computes its own | Paths, dots, parked markers and zoom-to-fit must agree; a shared computation keeps them in sync. |
| Tracked hop geometry | The recorded track, pinned to both airport dots | The track alone; always a great circle | The real flown path is the point of tracking; pinning keeps the line attached to the airports. |
| Consecutive hops | Alternate the aircraft color with a 38% lighter shade by hop number | One color per aircraft; per-hop random colors | Two legs meeting at an airport stay distinguishable while the tour still reads as one aircraft. |
| Airport dots | One per airport, drawn on every world copy in view, colored by the sole visitor or white | One per airport per world copy a chain reaches | Every copy shows every path, so one dot per airport meets them all; a dot per copy reached would stack copies of the same dot, each with part of the airport's visits. |
| Several aircraft parked together | Fan out around the dot | Stack | Every parked aircraft stays visible and clickable. |
| Highlight | Fade every other aircraft rather than hide it | Hide others; no highlight | [inferred] Keeps the whole fleet in context while one tour stands out. |
| Basemaps | Esri and OpenStreetMap tiles, no API keys | Keyed providers (Mapbox etc.) | [inferred] Nothing to sign up for or configure in a local hobby tool. |
| Night shading | Two overlapping layers at 0° and −6° sun elevation, every world copy in view, minute refresh | One terminator line; no shading | [inferred] Shows dusk and full night apart, which matters for VFR planning, without visual noise. |
| Hazard sources | aviationweather.gov G-AIRMET and SIGMETs, cached 10 minutes | A commercial weather API; none | [inferred] Free and keyless; the same areas SimBrief briefs. |
| Hazard toggles | Four groups instead of seven kinds | A toggle per kind | [inferred] Mountain obscuration, ash and cyclones are rare and belong with IFR and storms respectively. |
| View preferences | Basemap, night and hazard toggles remembered in the browser; URL options apply to one load | Server-side settings | [inferred] Per-browser display choices; URLs for bookmarks and testing. |
| Layer controls | One Layers menu; its button marks what is on | A row of toggle buttons along the top of the map | Layers are set once a session and left alone; a row of eight toggles crowded the top of the map for choices rarely changed. The marks on the button keep what is on visible without opening it. |
| Zooms under floating panels | Centre each request in the part the panels leave clear | Centre in the window; shrink the map to the uncovered part | Centring in the window would put a fitted hop under the sidebar or the flight panel; the map keeps its full size so the glass panels have it behind them. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Cost of copies zoomed out** — at the minimum zoom, with its margin, a 2560 px window touches up
   to five world copies and a 3840 px one up to seven, and every layer, several thousand planner
   candidates included, is drawn on each.
2. **Zoom to a long great circle** uses only its endpoints, so a poleward arc can be clipped
   ([paths.ts:297](../../../src/client/paths.ts#L297)).
3. **Partial hazard outages are not shown** — the toolbar says "N areas" even when one or two of the
   three sources failed; only a failed fetch shows "hazards unavailable"
   ([MapToolbar.tsx:60-64](../../../src/client/components/MapToolbar.tsx#L60-L64)).
4. **Which clock tooltips show** — hop and airport tooltips show real-world times; how sim-clock
   times appear is the logbook's open question.
5. **Fan-out repeats** after six aircraft at one airport ([paths.ts:199](../../../src/client/paths.ts#L199)).
6. **Chevron position** is the middle sample of the path, not its middle distance, so on a tracked
   hop it sits wherever half the samples fall ([MapView.tsx:298](../../../src/client/components/MapView.tsx#L298)).
7. **Shapes around a pole** — a hazard area that encircles a pole is placed vertex to vertex like
   any other, so its closing edge runs the width of the map; the range ring is Leaflet's circle,
   which near a pole departs from the true range.
8. **Dusk uses 0° sun elevation**, not the −0.833° of published sunset, so shading starts a few
   minutes late ([NightLayer.tsx:17](../../../src/client/components/NightLayer.tsx#L17)).

## References

- Code: [src/client/paths.ts](../../../src/client/paths.ts), [src/client/geo.ts](../../../src/client/geo.ts),
  [src/client/components/WorldCopies.tsx](../../../src/client/components/WorldCopies.tsx) (the copies in view),
  [src/client/components/MapView.tsx](../../../src/client/components/MapView.tsx) (all but
  `CandidateLayer` and the plan ring and popup, which are planner's, and `PopupPadding`, which is
  app-shell's), [src/client/fit.ts](../../../src/client/fit.ts) (`applyFocus`, `gatherPoints`),
  [src/client/components/MapToolbar.tsx](../../../src/client/components/MapToolbar.tsx) (toolbar, Layers
  menu, `HAZARD_TOGGLES`),
  [src/client/sun.ts](../../../src/client/sun.ts), [src/client/components/NightLayer.tsx](../../../src/client/components/NightLayer.tsx),
  [src/client/components/HazardLayer.tsx](../../../src/client/components/HazardLayer.tsx),
  [src/server/hazards.ts](../../../src/server/hazards.ts),
  [src/client/icons.ts](../../../src/client/icons.ts) (`shade`, `hopStroke`),
  [src/client/App.tsx](../../../src/client/App.tsx) (selection, focus (`requestFocus`), basemap and
  overlay preferences, URL view options), [src/server/routes.ts](../../../src/server/routes.ts)
  (`/state` 826-840, `/hazards` 800)
- External: Esri ArcGIS Online and OpenStreetMap tiles; aviationweather.gov G-AIRMET / AIRMET-SIGMET
  / ISIGMET APIs
- Hosted layers: planner (ring, candidates, candidate popup), live-tracking (`LiveLayer`), simbrief
  (`BriefingLayer`)
