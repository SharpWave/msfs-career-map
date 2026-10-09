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
- **map geometry** — turning hops into paths, airport dots and parked positions, longitude
  unwrapping across the antimeridian, and the zoom-to-fit points — shared by every map layer and by
  the zoom logic ([paths.ts](../../../src/client/paths.ts), [geo.ts](../../../src/client/geo.ts));
- tours (hop paths, direction chevrons, hop tooltips), visited-airport dots and their tooltips,
  parked-aircraft markers, highlighting and zooming;
- the night and weather-hazard overlays.

The map also hosts layers owned elsewhere: the planner's range ring and candidate dots (planner),
the live aircraft and its growing track (live-tracking), and SimBrief routes (simbrief). The
airport popup opened from a dot is airports'. Hops, their order and where an aircraft is parked
come from logbook; aircraft color, icon and visibility from fleet.

## Map Geometry

All positions a layer draws come from one pass over the state
([paths.ts:89-161](../../../src/client/paths.ts#L89-L161)), so paths, dots, parked markers and
zoom-to-fit always agree.

**Per-aircraft chains.** Each visible aircraft's hops are taken in logbook order. Longitudes are
*unwrapped* along the chain: each hop's origin is shifted by whole turns of 360° to sit within
180° of the previous hop's destination, and its destination within 180° of its origin
([paths.ts:63-68](../../../src/client/paths.ts#L63-L68), [117-118](../../../src/client/paths.ts#L117-L118)).
A Pacific crossing is then one short line rather than a jump across the map, and everything
attached to the chain uses the same shifted coordinates. A hop whose airport is unknown to the map
state is skipped and the chain continues from the previous hop.

**Hop paths.** A hop with a recorded track of at least two samples is drawn along the track,
itself unwrapped sample by sample starting from the origin, with the two airport positions
prepended and appended so the line is tied to the dots at both ends
([paths.ts:119-122](../../../src/client/paths.ts#L119-L122), [71-80](../../../src/client/paths.ts#L71-L80)).
Any other hop is drawn as a great circle: points about every 25 nm (2–96 segments), a straight
pair under 1 nm ([geo.ts:29-55](../../../src/client/geo.ts#L29-L55)). Each hop also carries its
direct airport-to-airport distance and, when tracked, the length flown along the drawn path.

The great circle starts and ends exactly at the hop's unwrapped airport positions: it is unwrapped
from the origin's longitude as given, so a hop after an antimeridian crossing is drawn on the same
world copy as its airport dots, chevron and zoom points.

**Airport dots.** One dot per airport per world copy: the same airport reached by chains on two
world copies gets two dots. Each dot collects a "departed" event per hop leaving it and an
"arrived" event per hop reaching it, sorted by time with untimed events last, then by aircraft,
then by hop number, arrivals before departures ([paths.ts:92-101](../../../src/client/paths.ts#L92-L101),
[150-158](../../../src/client/paths.ts#L150-L158)).

**Parked positions.** An aircraft with hops is parked at its last hop's unwrapped destination.
Several aircraft parked at the same dot fan out: the first sits on the dot, each next one 30 px
away, stepping 60° clockwise from straight up ([paths.ts:137-146](../../../src/client/paths.ts#L137-L146)).

**Planner results on the right world copy.** When a plan starts where the planning aircraft is
parked, its ring and candidates are shifted by the same whole turns as that aircraft's parked
position; the zoom box for a plan is the ring's bounding box on that copy, latitudes clamped to
±85° ([paths.ts:163-184](../../../src/client/paths.ts#L163-L184)). Each candidate is meant to sit
within 180° of longitude of the origin as drawn, so one just across the 180° meridian from the
origin appears beside the ring. Today candidates take only the plan's shift, so such a candidate
is drawn, zoomed to and opened a world copy away
([MapView.tsx:411](../../../src/client/components/MapView.tsx#L411), [App.tsx:278](../../../src/client/App.tsx#L278)).

**Zoom points.** Fitting to hops uses each hop's first and last point plus, for tracked hops, every
10th point so detours are included ([paths.ts:186-197](../../../src/client/paths.ts#L186-L197)).
A long great circle contributes only its endpoints, so its poleward bulge can fall outside the fit.

## Tours on the Map

Layers are drawn bottom to top: hazards and night shading; planner ring and candidates; SimBrief
routes; path casings; colored paths; chevrons; airport dots; parked markers; the live aircraft
([MapView.tsx:175-316](../../../src/client/components/MapView.tsx#L175-L316)).

- **Paths.** Every hop gets a dark casing (weight 9) under a colored line (weight 5). Odd-numbered
  hops use the aircraft's color and even-numbered hops a 38% lighter shade, so the leg that landed
  at an airport and the one that left it stay distinguishable when zoomed in
  ([icons.ts:106-112](../../../src/client/icons.ts#L106-L112)). Hidden aircraft are not drawn at all.
- **Chevrons.** Hops of at least 8 nm direct get a direction arrow at the middle point of their
  path, in the path's color ([MapView.tsx:245-262](../../../src/client/components/MapView.tsx#L245-L262)).
- **Hop tooltip** (hover): the aircraft in its color; `ORIG → DEST · hop n · direct nm`, plus
  "· N nm flown (tracked)" for tracked hops; departure, arrival and duration when known; the final
  landing's badge and its G; the notes; "Click for the flight profile" when tracked
  ([MapView.tsx:453-485](../../../src/client/components/MapView.tsx#L453-L485)).
- **Clicking a path** opens that hop in the flight panel, selects its aircraft and zooms to the hop.
- **Airport dots** are filled with the visiting aircraft's color when exactly one aircraft has been
  there, white otherwise. The tooltip lists the airport, its location, up to three runways, every
  arrival and departure ("(time not logged)" when untimed, with the hop number), "Currently here:"
  with the parked aircraft, and "Click for photo, weather and links". Clicking opens the airport
  popup ([MapView.tsx:265-283](../../../src/client/components/MapView.tsx#L265-L283),
  [487-512](../../../src/client/components/MapView.tsx#L487-L512)).
- **Parked markers** show the aircraft's badge (fleet) at its parked position; the tooltip reads the
  aircraft and "parked at IDENT · name". Clicking a marker highlights that aircraft, or clears the
  highlight if it is already highlighted ([MapView.tsx:286-309](../../../src/client/components/MapView.tsx#L286-L309)).
- **Empty map.** With no hops at all, the map shows "Nothing on the map yet" and how to start
  ([App.tsx:474-479](../../../src/client/App.tsx#L474-L479)).

## Highlighting and Zooming

**Highlight.** One aircraft can be highlighted, from its card, its parked marker or a path. While
one is, every other aircraft fades: paths to 0.45 opacity (casing 0.25), parked markers to 0.6,
airport dots that aircraft never visited to 0.5, and their chevrons are hidden; the highlighted
marker is drawn on top ([MapView.tsx:29](../../../src/client/components/MapView.tsx#L29)). The
**Clear highlight** button appears while one is set. Deleting the highlighted aircraft clears it
([App.tsx:246-249](../../../src/client/App.tsx#L246-L249)).

**Zoom requests** ([App.tsx:226-279](../../../src/client/App.tsx#L226-L279),
[layout.ts:31-44](../../../src/client/layout.ts#L31-L44), [fit.ts:30-68](../../../src/client/fit.ts#L30-L68),
[MapView.tsx:514-522](../../../src/client/components/MapView.tsx#L514-L522)):

| Trigger | Zooms to |
|---|---|
| First load of the map state | Every path |
| **Fit all** | Every path |
| Highlighting an aircraft | That aircraft's paths |
| Opening a hop (path click, hop row) | That hop |
| A new planner result | The plan's ring |
| Focusing a planner candidate | The candidate, on the plan's world copy |

A request whose points collapse to one place flies there at zoom 9 or closer; otherwise the map
flies to the points' bounds with 60 px padding, no closer than zoom 11, over 0.6 s. A request that
names its zoom — the live card's **Zoom** (zoom 10) and `?view=` — goes to that point at that zoom.
An empty request is ignored. Repeating the same request still zooms.

Panels float over the map (app-shell), so every request lands in the part of the map they leave
clear: the point, or the bounds with their 60 px padding, are centred in that part rather than in
the window. The page supplies the clear part with each request; when it is smaller than 240 × 160
px, the request uses the whole window. While the browser asks for reduced motion, the map jumps to
the request's view instead of flying.

## Basemaps and View Preferences

- **Basemaps** ([MapView.tsx:41-60](../../../src/client/components/MapView.tsx#L41-L60)): Dark
  (Esri dark gray with a label overlay), Light (OpenStreetMap), Satellite (Esri imagery), all
  keyless. Every basemap zooms to 19, over-zooming tiles past their native maximum.
- **Initial view** centres on the continental US at zoom 4 until the first fit; minimum zoom 2;
  panning past the antimeridian jumps to the next world copy.
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
drawn on three world copies so panning stays seamless, and recomputed every minute
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
  SIGMETs.
- Tooltip: kind and severity in the kind's color; label and FIR; "base – top" ("SFC" / "above" for
  open ends) or "altitudes not given"; validity, with "G-AIRMET +Nh" for forecast snapshots; the
  raw text up to 220 characters.
- The toolbar shows "N areas" for what is drawn, or "hazards unavailable" when the fetch failed,
  with the fetch time on hover.

Polygons are drawn on one world copy only, so after panning across the antimeridian they are
missing from the copy in view; the intent is that, like night shading, they appear on every copy.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Antimeridian handling | Unwrap longitudes per aircraft chain; shift planner results to the parked aircraft's copy | Split lines at ±180°; normalise everything to −180..180 | A tour crossing the Pacific stays one continuous line, and everything attached to it lines up on the same copy. |
| One geometry module | `paths.ts` computes every drawn position and the zoom points | Each layer computes its own | Paths, dots, parked markers and zoom-to-fit must agree; a shared computation keeps them in sync. |
| Tracked hop geometry | The recorded track, pinned to both airport dots | The track alone; always a great circle | The real flown path is the point of tracking; pinning keeps the line attached to the airports. |
| Consecutive hops | Alternate the aircraft color with a 38% lighter shade by hop number | One color per aircraft; per-hop random colors | Two legs meeting at an airport stay distinguishable while the tour still reads as one aircraft. |
| Airport dots | One per airport per world copy, colored by the sole visitor or white | One dot per airport | A dot must sit where the chain that reached it is drawn. |
| Several aircraft parked together | Fan out around the dot | Stack | Every parked aircraft stays visible and clickable. |
| Highlight | Fade every other aircraft rather than hide it | Hide others; no highlight | [inferred] Keeps the whole fleet in context while one tour stands out. |
| Basemaps | Esri and OpenStreetMap tiles, no API keys | Keyed providers (Mapbox etc.) | [inferred] Nothing to sign up for or configure in a local hobby tool. |
| Night shading | Two overlapping layers at 0° and −6° sun elevation, three world copies, minute refresh | One terminator line; no shading | [inferred] Shows dusk and full night apart, which matters for VFR planning, without visual noise. |
| Hazard sources | aviationweather.gov G-AIRMET and SIGMETs, cached 10 minutes | A commercial weather API; none | [inferred] Free and keyless; the same areas SimBrief briefs. |
| Hazard toggles | Four groups instead of seven kinds | A toggle per kind | [inferred] Mountain obscuration, ash and cyclones are rare and belong with IFR and storms respectively. |
| View preferences | Basemap, night and hazard toggles remembered in the browser; URL options apply to one load | Server-side settings | [inferred] Per-browser display choices; URLs for bookmarks and testing. |
| Layer controls | One Layers menu; its button marks what is on | A row of toggle buttons along the top of the map | Layers are set once a session and left alone; a row of eight toggles crowded the top of the map for choices rarely changed. The marks on the button keep what is on visible without opening it. |
| Zooms under floating panels | Centre each request in the part the panels leave clear | Centre in the window; shrink the map to the uncovered part | Centring in the window would put a fitted hop under the sidebar or the flight panel; the map keeps its full size so the glass panels have it behind them. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Hazards on one world copy** — polygons are not repeated on adjacent copies, nor unwrapped when
   they straddle the antimeridian ([HazardLayer.tsx:78-80](../../../src/client/components/HazardLayer.tsx#L78-L80)).
2. **Zoom to a long great circle** uses only its endpoints, so a poleward arc can be clipped
   ([paths.ts:192](../../../src/client/paths.ts#L192)).
3. **Partial hazard outages are not shown** — the toolbar says "N areas" even when one or two of the
   three sources failed; only a failed fetch shows "hazards unavailable"
   ([MapToolbar.tsx:60-64](../../../src/client/components/MapToolbar.tsx#L60-L64)).
4. **Which clock tooltips show** — hop and airport tooltips show real-world times; how sim-clock
   times appear is the logbook's open question.
5. **Fan-out repeats** after six aircraft at one airport ([paths.ts:143](../../../src/client/paths.ts#L143)).
6. **Chevron position** is the middle sample of the path, not its middle distance, so on a tracked
   hop it sits wherever half the samples fall ([MapView.tsx:247](../../../src/client/components/MapView.tsx#L247)).
7. **Dusk uses 0° sun elevation**, not the −0.833° of published sunset, so shading starts a few
   minutes late ([NightLayer.tsx:12](../../../src/client/components/NightLayer.tsx#L12)).
8. **Markers are rebuilt every render** — chevron and parked-marker icons are recreated on each
   live-tracker update ([MapView.tsx:254-259](../../../src/client/components/MapView.tsx#L254-L259), [292-297](../../../src/client/components/MapView.tsx#L292-L297)).
9. **Planner candidates across the 180° meridian from the origin** are placed a world copy away
   from the ring ([MapView.tsx:411](../../../src/client/components/MapView.tsx#L411),
   [App.tsx:278](../../../src/client/App.tsx#L278)).

## References

- Code: [src/client/paths.ts](../../../src/client/paths.ts), [src/client/geo.ts](../../../src/client/geo.ts),
  [src/client/components/MapView.tsx](../../../src/client/components/MapView.tsx) (all but
  `CandidateLayer` and the plan ring and popup, which are planner's, and `PopupPadding`, which is
  app-shell's), [src/client/fit.ts](../../../src/client/fit.ts) (`applyFocus`),
  [src/client/components/MapToolbar.tsx](../../../src/client/components/MapToolbar.tsx) (toolbar, Layers
  menu, `HAZARD_TOGGLES`),
  [src/client/sun.ts](../../../src/client/sun.ts), [src/client/components/NightLayer.tsx](../../../src/client/components/NightLayer.tsx),
  [src/client/components/HazardLayer.tsx](../../../src/client/components/HazardLayer.tsx),
  [src/server/hazards.ts](../../../src/server/hazards.ts),
  [src/client/icons.ts](../../../src/client/icons.ts) (`shade`, `hopStroke`),
  [src/client/App.tsx](../../../src/client/App.tsx) (selection, focus (`requestFocus`), basemap and
  overlay preferences, URL view options), [src/server/routes.ts](../../../src/server/routes.ts)
  (`/state` 797-811, `/hazards` 771)
- External: Esri ArcGIS Online and OpenStreetMap tiles; aviationweather.gov G-AIRMET / AIRMET-SIGMET
  / ISIGMET APIs
- Hosted layers: planner (ring, candidates, candidate popup), live-tracking (`LiveLayer`), simbrief
  (`BriefingLayer`)
