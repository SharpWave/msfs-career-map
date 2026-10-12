# Tour Map — EARS Specs

Design: [tour-map-design.md](tour-map-design.md). Prefix `MAP`; facets `GEO` (map geometry),
`PATH` (hop paths and layer order), `DOT` (visited-airport dots), `PARK` (parked-aircraft
markers), `HL` (highlighting), `ZOOM` (zoom requests), `VIEW` (basemaps and view preferences),
`NIGHT` (day/night shading), `HAZ` (weather hazard overlay).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Map Geometry

- [x] **MAP-GEO-001**: When building the map, the system shall draw each visible aircraft's hops as one chain in logbook order, and draw nothing for aircraft hidden from the map.
- [x] **MAP-GEO-002**: When building a hop's path, the system shall start it at the origin's own position and place it point by point (MAP-GEO-015), independently of the aircraft's other hops.
- [x] **MAP-GEO-003**: When a hop has a recorded track of at least two samples, the system shall draw its path through the track's samples, with the origin and destination positions as its first and last points.
- [x] **MAP-GEO-004**: When a hop has no usable recorded track, the system shall draw its path as a great circle with a point about every 25 nm (2 to 96 segments), or as a straight segment when its airports are less than 1 nm apart.
- [x] **MAP-GEO-005**: The system shall end each hop path exactly at the destination's position on the world copy the placed path reaches, where that copy's dot for the destination sits.
- [x] **MAP-GEO-006**: If a hop's origin or destination is missing from the map state, then the system shall skip that hop.
- [x] **MAP-GEO-007**: The system shall place one dot per visited airport, at the airport's own position, holding every departure from and arrival at that airport.
- [x] **MAP-GEO-008**: When an aircraft has drawn hops, the system shall place its parked marker at its last drawn hop's destination airport, at that airport's own position.
- [x] **MAP-GEO-009**: When several aircraft are parked at the same airport, the system shall place the first on the dot and each next one 30 px from it, stepping 60° clockwise from straight up.
- [x] **MAP-GEO-011**: When fitting the view to hops, the system shall use each hop's first and last points and, for tracked hops, every 10th point of the path.
- [ ] **MAP-GEO-012**: When fitting the view to great-circle hops, the system shall include points along each arc so its full extent is in view.
- [x] **MAP-GEO-013**: When a planner candidate lies across the 180° meridian from the plan's origin, the system shall show it beside the range ring on every copy of the ring in view.
- [x] **MAP-GEO-014**: The system shall draw every map layer — hop paths and chevrons, airport dots, parked markers, the planner's range ring and candidates, SimBrief routes, the live aircraft, its track and the casual path, hazard areas and night shading — on every world copy in view, at each shift of whole turns of 360° that brings part of the shape into those copies.
- [x] **MAP-GEO-015**: When placing a line or area on the map — a hop path, a recorded or live track, a casual-path segment, a SimBrief route, a hazard area — the system shall keep its first point's own longitude and shift each next point, the last included, by whole turns of 360° to within 180° of the point before it.
- [x] **MAP-GEO-016**: The system shall place airport dots, parked markers, planner candidates and the live aircraft at their own longitude, centre the range ring on the plan's origin at its own longitude, and draw night shading as computed.
- [x] **MAP-GEO-017**: The system shall treat as in view every world copy, from −180° + 360°k to 180° + 360°k, that the view touches once widened by a quarter of its width on each side, render vector layers with at least that margin, and recompute the copies in view whenever the map comes to rest after a pan, zoom or resize.
- [x] **MAP-GEO-018**: When a zoom request is carried out, the system shall add the world copies around where it will land before the map moves.
- [x] **MAP-GEO-019**: While a world copy stays in view, the system shall leave what is drawn on it in place, keeping any popup or tooltip open on it; when a copy leaves the view, the system shall remove what is drawn on it, with anything open there, airport and planner-candidate popups included.
- [x] **MAP-GEO-020**: The system shall keep each shape's shifted geometry per world copy, so a re-render that changes neither the shape nor the copies in view redraws nothing.
- [x] **MAP-GEO-021**: When zooming to a plan, the system shall use the range ring's bounding box — latitudes clamped to ±85°, at most 360° of longitude wide — as points along its edges no more than 30° of longitude apart.

## Hop Paths and Layers

- [x] **MAP-PATH-001**: The system shall draw every hop as a colored line over a dark casing, in its aircraft's path color for odd-numbered hops and a 38% lighter shade of it for even-numbered hops.
- [x] **MAP-PATH-002**: When a hop's direct distance is at least 8 nm and its aircraft is not faded by a highlight, the system shall draw a direction chevron in the path's color at the middle point of the hop's path, pointing along the path.
- [x] **MAP-PATH-003**: When the user hovers a hop's path, the system shall show the aircraft; origin → destination, hop number and direct distance, plus the flown distance for a tracked hop; the departure, arrival and duration when known; the final landing's badge and G when the hop has landings; the notes; and "Click for the flight profile" for a tracked hop.
- [x] **MAP-PATH-004**: When the user clicks a hop's path, the system shall open that hop in the flight panel, highlight its aircraft and zoom to the hop.
- [x] **MAP-PATH-005**: The system shall draw map layers from bottom to top: hazard areas and night shading; planner ring and candidates; SimBrief routes; path casings; paths; chevrons; airport dots; parked markers; the live aircraft.
- [x] **MAP-PATH-006**: While there are no hops at all, the system shall show "Nothing on the map yet" over the map with how to add an aircraft and log a first hop.

## Visited-Airport Dots

- [x] **MAP-DOT-001**: The system shall fill a visited-airport dot with the visiting aircraft's path color when exactly one visible aircraft has been there, and white otherwise.
- [x] **MAP-DOT-002**: When the user hovers a visited-airport dot, the system shall show the airport's ident, name and location, up to three runways, every arrival and departure there — with aircraft, time or "(time not logged)", and hop number, sorted by time with untimed ones last, then by aircraft, then by hop number, arrivals first — "Currently here:" with the aircraft parked there, and "Click for photo, weather and links".
- [x] **MAP-DOT-003**: When the user clicks a visited-airport dot, the system shall open the airport popup for that airport.

## Parked-Aircraft Markers

- [x] **MAP-PARK-001**: The system shall show each parked aircraft as its badge at its parked position, with a hover tooltip naming the aircraft and "parked at IDENT · name".
- [x] **MAP-PARK-002**: When the user clicks a parked-aircraft marker, the system shall highlight that aircraft, or clear the highlight if that aircraft is already highlighted.

## Highlighting

- [x] **MAP-HL-001**: While an aircraft is highlighted, the system shall fade every other aircraft's paths (0.45 opacity, casing 0.25) and parked markers (0.6), fade airport dots the highlighted aircraft never visited (0.5), hide other aircraft's chevrons, and draw the highlighted aircraft's marker above the others.
- [x] **MAP-HL-002**: While an aircraft is highlighted, the map toolbar shall offer "Clear highlight", which clears it.
- [x] **MAP-HL-003**: When the highlighted aircraft is deleted, the system shall clear the highlight.

## Zooming

- [x] **MAP-ZOOM-001**: When the map state first loads, the system shall fit the view to every hop.
- [x] **MAP-ZOOM-002**: When the user clicks **Fit all**, the system shall fit the view to every hop.
- [x] **MAP-ZOOM-003**: When an aircraft becomes highlighted, the system shall fit the view to that aircraft's hops.
- [x] **MAP-ZOOM-004**: When a hop is opened, from its path or its hop row, the system shall fit the view to that hop.
- [x] **MAP-ZOOM-005**: When a new planner result arrives, the system shall fit the view to the plan's range ring.
- [x] **MAP-ZOOM-006**: When the user focuses a planner candidate, the system shall zoom to that candidate.
- [x] **MAP-ZOOM-007**: When a zoom request's points, once gathered (MAP-ZOOM-011), all lie at one place, the system shall fly there at zoom 9 or the current zoom if closer; otherwise it shall fly to the points' bounds with 60 px padding, no closer than zoom 11, over 0.6 s; either way it shall centre the view in the clear part of the map the page supplies (APP-UI-020), or in the whole window when that part is smaller than 240 × 160 px.
- [x] **MAP-ZOOM-008**: When a zoom request has no points, the system shall ignore it; when an identical request is repeated, the system shall zoom again.
- [x] **MAP-ZOOM-009**: When a zoom request names its zoom (the live card's **Zoom**, the `?view=` option), the system shall show its point at that zoom, centred in the clear part of the map (APP-UI-020), or in the whole window when that part is smaller than 240 × 160 px.
- [x] **MAP-ZOOM-010**: While the browser asks for reduced motion, the system shall jump to a zoom request's view instead of flying there.
- [x] **MAP-ZOOM-011**: When carrying out a zoom request, the system shall gather its points onto the narrowest band of longitude that holds them all — across the 180° meridian when that is narrower — and shift the band by whole turns of 360° so its middle lies within 180° of the centre of the clear part of the map (APP-UI-020), or of the whole window when that part is smaller than 240 × 160 px, an exact tie going east.

## Basemaps and View Preferences

- [x] **MAP-VIEW-001**: The system shall offer three keyless basemaps — Dark (Esri dark gray with a label overlay), Light (OpenStreetMap) and Satellite (Esri imagery) — each zoomable to level 19 by over-zooming past its native maximum.
- [x] **MAP-VIEW-002**: The system shall remember in the browser the chosen basemap (default Dark), whether night shading is on (default on), and which hazard toggles are on (default none).
- [x] **MAP-VIEW-003**: When the page is opened with `?view=lat,lon,zoom`, `?wx=1` or `?wx=A,B`, or `?night=1` (any other value: off), the system shall apply them once after the first load without changing the remembered preferences.
- [x] **MAP-VIEW-004**: The system shall open the map over the continental US at zoom 4 until the first fit, allow zooming out to level 2, and let the user pan across the antimeridian onto any world copy without jumping back to the first.
- [x] **MAP-VIEW-005**: When the window changes size, the system shall resize the map to fill it; panels opening or closing over the map shall not move it.
- [x] **MAP-VIEW-006**: The map toolbar shall offer **Layers**, which opens a menu holding the basemap choice (Dark, Light or Satellite), night shading on or off, and the four hazard toggles with what each covers and their source; a choice shall apply at once and leave the menu open.
- [x] **MAP-VIEW-007**: While night shading or any hazard toggle is on, the **Layers** button shall mark it: a moon for night shading, and a dot in its hazard color for each hazard toggle that is on.

## Night Shading

- [x] **MAP-NIGHT-001**: While night shading is on, the system shall shade where the sun is below the horizon and, darker where the two overlap, where it is more than 6° below the horizon, on every world copy in view, recomputed every minute.
- [x] **MAP-NIGHT-002**: The system shall consider a place dark when the sun is more than 6° below its horizon (civil twilight over).

## Weather Hazard Overlay

- [x] **MAP-HAZ-001**: When hazard areas are requested, the system shall fetch G-AIRMETs, US SIGMETs and international SIGMETs from aviationweather.gov in parallel and serve the normalised set, cached for 10 minutes.
- [x] **MAP-HAZ-002**: When hazard reports are normalised, the system shall classify each by label as icing, turbulence, IFR, mountain obscuration, convective, volcanic ash or tropical cyclone, and drop reports of any other kind, G-AIRMETs that are not areas, SIGMET outlooks, and polygons with fewer than three points.
- [x] **MAP-HAZ-003**: When G-AIRMET altitudes are normalised, the system shall read them as hundreds of feet, with "SFC" as 0.
- [x] **MAP-HAZ-004**: If some hazard sources fail, then the system shall serve the others with the failed sources listed; if all three fail and an earlier set exists, then the system shall serve the earlier set.
- [x] **MAP-HAZ-005**: The Layers menu shall offer four hazard toggles — Ice (icing), Turb (turbulence), IFR (IFR and mountain obscuration), Storms (convective, volcanic ash, tropical cyclones) — each shown in its hazard color while on.
- [x] **MAP-HAZ-006**: While any hazard toggle is on, the system shall fetch hazard areas and refresh them every 10 minutes, keep the G-AIRMET forecast snapshot whose valid time is nearest now and every SIGMET, and draw the enabled kinds as shaded polygons, outlined solid for G-AIRMETs and dashed for SIGMETs.
- [x] **MAP-HAZ-007**: When the user hovers a hazard area, the system shall show its kind and severity, label and FIR, altitude band ("SFC" or "above" for open ends, or "altitudes not given"), validity with "G-AIRMET +Nh" for forecast snapshots, and up to 220 characters of the raw report.
- [x] **MAP-HAZ-008**: While any hazard toggle is on, the map toolbar shall show the number of areas drawn, each counted once however many world copies show it, or "hazards unavailable" when fetching failed, with the fetch time on hover.
- [ ] **MAP-HAZ-009**: When one or two hazard sources failed, the map toolbar shall say which are unavailable alongside the number of areas drawn.
- [x] **MAP-HAZ-010**: The system shall place each hazard area vertex to vertex (MAP-GEO-015) and draw it on every world copy in view, so an area that straddles the antimeridian is whole on both sides of it.
