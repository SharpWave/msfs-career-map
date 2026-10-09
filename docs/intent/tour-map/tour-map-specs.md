# Tour Map — EARS Specs

Design: [tour-map-design.md](tour-map-design.md). Prefix `MAP`; facets `GEO` (map geometry),
`PATH` (hop paths and layer order), `DOT` (visited-airport dots), `PARK` (parked-aircraft
markers), `HL` (highlighting), `ZOOM` (zoom requests), `VIEW` (basemaps and view preferences),
`NIGHT` (day/night shading), `HAZ` (weather hazard overlay).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Map Geometry

- [x] **MAP-GEO-001**: When building the map, the system shall draw each visible aircraft's hops as one chain in logbook order, and draw nothing for aircraft hidden from the map.
- [x] **MAP-GEO-002**: When building an aircraft's chain, the system shall shift each hop's origin longitude by whole turns of 360° to within 180° of the previous hop's shifted destination, and the hop's destination to within 180° of its shifted origin.
- [x] **MAP-GEO-003**: When a hop has a recorded track of at least two samples, the system shall draw its path through the track's samples — each longitude shifted to within 180° of the previous point, starting from the origin — with the shifted origin and destination positions as its first and last points.
- [x] **MAP-GEO-004**: When a hop has no usable recorded track, the system shall draw its path as a great circle with a point about every 25 nm (2 to 96 segments), or as a straight segment when its airports are less than 1 nm apart.
- [ ] **MAP-GEO-005**: The system shall start and end each great-circle hop path exactly at the hop's shifted origin and destination positions, including after the aircraft's chain has crossed the antimeridian.
- [x] **MAP-GEO-006**: If a hop's origin or destination is missing from the map state, then the system shall skip that hop and continue the aircraft's chain from its previous drawn hop.
- [x] **MAP-GEO-007**: The system shall place one airport dot per airport per world copy on which a chain reaches that airport.
- [x] **MAP-GEO-008**: When an aircraft has drawn hops, the system shall place its parked marker at its last drawn hop's shifted destination.
- [x] **MAP-GEO-009**: When several aircraft are parked at the same airport dot, the system shall place the first on the dot and each next one 30 px from it, stepping 60° clockwise from straight up.
- [x] **MAP-GEO-010**: When a plan starts at the airport where the planning aircraft is parked, the system shall draw the plan's range ring and candidates on the same world copy as that aircraft's parked marker.
- [x] **MAP-GEO-011**: When fitting the view to hops, the system shall use each hop's first and last points and, for tracked hops, every 10th point of the path.
- [ ] **MAP-GEO-012**: When fitting the view to great-circle hops, the system shall include points along each arc so its full extent is in view.
- [ ] **MAP-GEO-013**: When drawing, zooming to or opening a planner candidate, the system shall place it within 180° of longitude of the plan's origin as drawn, so a candidate across the antimeridian from the origin appears beside the range ring.

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
- [x] **MAP-ZOOM-005**: When a new planner result arrives, the system shall fit the view to the plan's range ring on the plan's world copy.
- [x] **MAP-ZOOM-006**: When the user focuses a planner candidate, the system shall zoom to that candidate on the plan's world copy.
- [x] **MAP-ZOOM-007**: When a zoom request's points all lie at one place, the system shall fly there at zoom 9 or the current zoom if closer; otherwise it shall fly to the points' bounds with 60 px padding, no closer than zoom 11, over 0.6 s.
- [x] **MAP-ZOOM-008**: When a zoom request has no points, the system shall ignore it; when an identical request is repeated, the system shall zoom again.

## Basemaps and View Preferences

- [x] **MAP-VIEW-001**: The system shall offer three keyless basemaps — Dark (Esri dark gray with a label overlay), Light (OpenStreetMap) and Satellite (Esri imagery) — each zoomable to level 19 by over-zooming past its native maximum.
- [x] **MAP-VIEW-002**: The system shall remember in the browser the chosen basemap (default Dark), whether night shading is on (default on), and which hazard toggles are on (default none).
- [x] **MAP-VIEW-003**: When the page is opened with `?view=lat,lon,zoom`, `?wx=1` or `?wx=A,B`, or `?night=1` (any other value: off), the system shall apply them once after the first load without changing the remembered preferences.
- [x] **MAP-VIEW-004**: The system shall open the map over the continental US at zoom 4 until the first fit, allow zooming out to level 2, and continue onto the next world copy when the user pans past the antimeridian.
- [x] **MAP-VIEW-005**: When the map's area changes size, such as when the sidebar opens or closes, the system shall resize the map to fill it.

## Night Shading

- [x] **MAP-NIGHT-001**: While night shading is on, the system shall shade where the sun is below the horizon and, darker where the two overlap, where it is more than 6° below the horizon, on three world copies, recomputed every minute.
- [x] **MAP-NIGHT-002**: The system shall consider a place dark when the sun is more than 6° below its horizon (civil twilight over).

## Weather Hazard Overlay

- [x] **MAP-HAZ-001**: When hazard areas are requested, the system shall fetch G-AIRMETs, US SIGMETs and international SIGMETs from aviationweather.gov in parallel and serve the normalised set, cached for 10 minutes.
- [x] **MAP-HAZ-002**: When hazard reports are normalised, the system shall classify each by label as icing, turbulence, IFR, mountain obscuration, convective, volcanic ash or tropical cyclone, and drop reports of any other kind, G-AIRMETs that are not areas, SIGMET outlooks, and polygons with fewer than three points.
- [x] **MAP-HAZ-003**: When G-AIRMET altitudes are normalised, the system shall read them as hundreds of feet, with "SFC" as 0.
- [x] **MAP-HAZ-004**: If some hazard sources fail, then the system shall serve the others with the failed sources listed; if all three fail and an earlier set exists, then the system shall serve the earlier set.
- [x] **MAP-HAZ-005**: The map toolbar shall offer four hazard toggles — Ice (icing), Turb (turbulence), IFR (IFR and mountain obscuration), Storms (convective, volcanic ash, tropical cyclones) — each shown in its hazard color while on.
- [x] **MAP-HAZ-006**: While any hazard toggle is on, the system shall fetch hazard areas and refresh them every 10 minutes, keep the G-AIRMET forecast snapshot whose valid time is nearest now and every SIGMET, and draw the enabled kinds as shaded polygons, outlined solid for G-AIRMETs and dashed for SIGMETs.
- [x] **MAP-HAZ-007**: When the user hovers a hazard area, the system shall show its kind and severity, label and FIR, altitude band ("SFC" or "above" for open ends, or "altitudes not given"), validity with "G-AIRMET +Nh" for forecast snapshots, and up to 220 characters of the raw report.
- [x] **MAP-HAZ-008**: While any hazard toggle is on, the map toolbar shall show the number of areas drawn, or "hazards unavailable" when fetching failed, with the fetch time on hover.
- [ ] **MAP-HAZ-009**: When one or two hazard sources failed, the map toolbar shall say which are unavailable alongside the number of areas drawn.
- [ ] **MAP-HAZ-010**: The system shall draw hazard areas on every world copy in view, including areas that straddle the antimeridian.
