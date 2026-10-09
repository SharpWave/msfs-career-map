---
parent: high-level-design
prefix: PLAN
---

# Planner

## Context and Design Philosophy

The planner answers the career-mode question "where can this aircraft go next?": given an
aircraft, where it is parked and a maximum flight time, it finds every airport the aircraft can
reach and use, draws them on the map around a range ring, and checks each one against live
weather and darkness. Picking one hands it to the hop form as the next destination.

It is a destination chooser, not a flight planner. Times come from a small block-time model with
a handful of numbers per aircraft, close enough to choose between destinations; routing, winds
and fuel are SimBrief's job once a destination is chosen.

This segment owns:

- the block-time model and its defaults ([performance.ts](../../../src/server/performance.ts));
- the candidate search — origin, range, the hard filters (airport type, runway length, paved,
  field elevation against ceiling and oxygen), timing, ordering and the result cap
  (`GET /api/plan`, [routes.ts:694-766](../../../src/server/routes.ts#L694-L766);
  `planCandidates`, [airports.ts:491-551](../../../src/server/airports.ts#L491-L551));
- the live checks — fetching METARs for candidates and flagging IFR, crosswind and darkness
  ([constraints.ts](../../../src/client/constraints.ts), [App.tsx:102-153](../../../src/client/App.tsx#L102-L153));
- the terrain check along a leg ([terrain.ts](../../../src/server/terrain.ts), `GET /api/terrain`);
- the planner card in the sidebar ([Planner.tsx](../../../src/client/components/Planner.tsx));
- the planner's map layers: range ring, candidate dots, candidate tooltips, and what the airport
  popup shows for a candidate ([MapView.tsx](../../../src/client/components/MapView.tsx) `CandidateLayer`,
  rings and candidate popup; [AirportPopup.tsx](../../../src/client/components/AirportPopup.tsx) `TerrainBlock`).

It relies on other segments for: the aircraft's performance and limit fields (fleet); where an
aircraft is parked (logbook, LOG-SEQ-008); airport records, the runway summary, METAR fetching,
freshness and flight categories, and which airports may be offered at all (airports — an airport
kept only because a hop references it is never a candidate, APT-DATA-008); which world copy the
ring and dots are drawn on and the zoom behaviour (tour-map, MAP-GEO-010, MAP-ZOOM-005/006); the
SimBrief dispatch link for a leg (simbrief); and the hop form that receives a picked destination
(logbook, LOG-FORM-004).

## Block-Time Model

A leg's block time is fixed ground-and-pattern overhead, a climb at climb speed, cruise, and a
descent — the same shape SimBrief uses, with five numbers per aircraft instead of performance
tables ([performance.ts](../../../src/server/performance.ts)). Wind is ignored.

**Profile.** Cruise speed is required. Every other input falls back to a light-piston default
when the aircraft leaves it blank ([performance.ts:27-38](../../../src/server/performance.ts#L27-L38)):

| Input | Default |
|---|---|
| Cruise altitude | 6,500 ft (a per-search override wins over the aircraft's value) |
| Climb rate | 700 fpm |
| Climb speed | 65% of cruise speed, rounded |
| Descent rate | 500 fpm |
| Overhead (taxi, takeoff, departure, approach, landing) | 12 min |

**Leg time** ([performance.ts:41-62](../../../src/server/performance.ts#L41-L62)). The leg cruises
at the profile's altitude or 1,000 ft above the higher of the two fields, whichever is higher. It
climbs from the origin's elevation at climb rate and climb speed and descends to the
destination's at descent rate and cruise speed. If the leg is long enough to reach cruise
altitude, block time is overhead + climb + cruise for the remaining distance + descent.
Otherwise the aircraft climbs only as high as the distance allows and descends straight away:
overhead + the climb and descent to that height. An airport with unknown elevation counts as sea
level.

**Range ring.** The ring's radius is the longest leg that fits the maximum time for a destination
at the origin's elevation, found by bisection
([performance.ts:65-75](../../../src/server/performance.ts#L65-L75)). A time no longer than the
overhead gives a zero ring. Each candidate is then timed with its own elevation, so a destination
higher than the origin (less descent) can lie just outside the ring and one lower can fall short
of it. The result also reports the naive range, cruise speed × time, for comparison.

## Finding Candidates

`GET /api/plan` ([routes.ts:701-766](../../../src/server/routes.ts#L701-L766)):

| Parameter | Meaning | Rules |
|---|---|---|
| `aircraft_id` | The planning aircraft | 404 when unknown; 400 when it has no cruise speed |
| `max_minutes` | Maximum block time | 1–1440, else 400 |
| `from` | Origin airport code | Default: where the aircraft is parked; 400 when it has no hops and no `from`, or the code is unknown |
| `types` | Comma list of airport types | Default large, medium and small airports; an unknown type is a 400 |
| `paved` | `1` for paved runways only | |
| `cruise_alt_ft` | Cruise altitude override | 500–60,000 ft, else 400; blank or 0 uses the aircraft's |
| `min_runway_ft` | Runway minimum override | Default: the aircraft's minimum runway |
| `limit` | Most candidates returned | Default 5,000, at most 20,000 |

**Hard filters** — a candidate must ([airports.ts:508-551](../../../src/server/airports.ts#L508-L551)):

- be one of the requested types and not the origin;
- with a runway minimum, have an open runway at least that long — airports without runway data
  are left out;
- with paved only, have a paved open runway;
- sit no higher than the aircraft's highest usable field: its service ceiling minus a 2,000 ft
  pattern margin, and, without oxygen or pressurisation, 10,500 ft (fields above that put the
  pattern over the 12,500 ft oxygen altitude), whichever is lower
  ([routes.ts:150-153](../../../src/server/routes.ts#L150-L153), [214-229](../../../src/server/routes.ts#L214-L229));
- lie within 1.1 × the ring radius by great-circle distance — the search box wraps across the
  180° meridian and drops the longitude bound when it would span the whole globe;
- have an estimated block time, rounded to the minute, within the maximum.

**Oxygen altitude.** An aircraft without oxygen or pressurisation is limited to 12,500 ft, the
altitude above which US rules (FAR 91.211) start requiring crew oxygen. The same figure drives
the field-elevation limit above, the cruise-altitude warning in the form and the terrain
warning. The code uses 12,000 ft (fields above 10,000 ft left out) in all three places today
([routes.ts:153](../../../src/server/routes.ts#L153), [Planner.tsx:199-227](../../../src/client/components/Planner.tsx#L199-L227)).

**Results.** Candidates are sorted nearest first and carry distance, initial bearing and
estimated minutes. The first `limit` are returned with `total` (how many passed), `truncated`
and `shown_nm` (the distance of the farthest one returned), plus the profile used, the ring
radius, the naive range, the filters applied and the field-elevation limit with its reason. Each
candidate carries the runway summary but not its runway list, to keep large results small.

`total` is meant to count every airport that passed. Today the search keeps only the nearest
2 × `limit` airports in the 1.1 × radius before timing them, so in a very dense search `total`
stops at that many and understates the count
([routes.ts:733-746](../../../src/server/routes.ts#L733-L746)).

## Live Checks: Weather and Darkness

Conditions that change by the minute are checked in the browser against the current result, so
they update without a new search ([constraints.ts](../../../src/client/constraints.ts)).

**METARs for candidates** ([App.tsx:102-139](../../../src/client/App.tsx#L102-L139)). After each
search, the large and medium candidates with a METAR station, and the small candidates whose
station is a four-letter ICAO code, are looked up in batches of 150. Each batch is merged in as
it arrives, so the map colors in progressively. A station looked up in the last 5 minutes is not
asked for again. A failed batch leaves those stations unknown until the next search. Only a
fresh METAR counts (airports, APT-WX-006). Small airports are not looked up at all today.

**Flags** ([constraints.ts:43-71](../../../src/client/constraints.ts#L43-L71)), recomputed when
METARs arrive and every minute:

| Flag | When | Text | Rules it out |
|---|---|---|---|
| IFR | The aircraft is not IFR capable and the fresh category is IFR or LIFR | "IFR conditions, VFR-only aircraft" (or LIFR) | Yes |
| X-wind | The aircraft has a crosswind limit and, with a fresh METAR, the smallest crosswind across the open runways exceeds it | "Crosswind N kt on best runway, limit M kt" | Yes |
| Dark | The sun is more than 6° below the horizon at the candidate at the ETA, and no runway is lit | "Dark at ETA and no runway lighting" | Yes |
| Night | As Dark, but a runway is lit | "Night arrival (runway lit)" | No |

The crosswind uses the gust when it is higher than the steady wind, and is zero in calm. A
variable or missing wind direction, or no runway headings, means no crosswind check. Headings
come from the open runways' low-end headings, or from the runway summary's headings when the
runway list is not loaded. The ETA is now plus the candidate's estimated minutes; "dark" is the
tour-map's sun test (MAP-NIGHT-002). With no fresh METAR an airport gets no weather flag.

**Hiding ruled-out airports.** "Hide airports ruled out by live weather or darkness" is on by
default for the session and shows how many are ruled out. While it is on, ruled-out candidates
are dropped from the list and faded on the map; they stay hoverable so the reason can be read.

## Terrain Along a Leg

Opening a candidate's popup checks the terrain on the direct leg from the plan's origin
(`GET /api/terrain?from=lat,lon&to=lat,lon[&n=24]`, [routes.ts:777-793](../../../src/server/routes.ts#L777-L793)).

- **Samples**: `n` + 1 points (`n` 4–99, default 24) evenly spaced along the great circle, with
  elevations from Open-Meteo's API (Copernicus DEM, 90 m); the sea counts as 0 ft
  ([terrain.ts](../../../src/server/terrain.ts)). Up to 100 points go in one request, with a 12 s
  timeout. Each elevation is cached in server memory by its coordinate rounded to 0.001°.
- **Minimum altitude**: the highest sample plus 1,000 ft clearance, or 2,000 ft when that sample
  is above 5,000 ft, rounded up to the next 500 ft. The response also carries the 12,000 ft
  oxygen altitude.
- **Display** ([AirportPopup.tsx:119-125](../../../src/client/components/AirportPopup.tsx#L119-L125),
  [189-210](../../../src/client/components/AirportPopup.tsx#L189-L210)): "Checking terrain along
  the leg…" while loading; then "Highest terrain en route X · plan at least Y (Z clearance)",
  with a warning when that altitude is above the 12,500 ft oxygen altitude for an aircraft
  without oxygen, or above its service ceiling; "Terrain check unavailable." when the lookup fails.
- A malformed or out-of-range `from` or `to` is a 400.

## The Planner Card

The sidebar's **Plan next hop** card, collapsible, open by default
([Sidebar.tsx:107-113](../../../src/client/components/Sidebar.tsx#L107-L113)). With no aircraft it
reads "Add an aircraft with a cruise speed to plan its next hop."

**Form** ([Planner.tsx:152-244](../../../src/client/components/Planner.tsx#L152-L244)):

- **Aircraft** — every aircraft, labelled with its cruise speed or "no cruise speed". It starts
  on, and follows, the highlighted aircraft; otherwise the first with a cruise speed. If the chosen
  aircraft is deleted it falls back the same way. An aircraft without a cruise speed shows "Set a
  cruise speed on this aircraft to unlock the planner." with an **Edit aircraft** link, and the
  search button is disabled.
- **Max flight time, min** — default 90, with quick picks 30 min, 1 h, 1 h 30, 2 h, 3 h, 4 h.
- **From** — an airport input (airports' `AirportInput`), "(default: where it's parked)", with the
  parked airport as its placeholder.
- **Cruise altitude, ft** "(for climb/descent time)" — filled with the aircraft's cruise altitude
  whenever the aircraft changes; blank uses the default. Without oxygen, a value above 12,500 ft
  shows "Above 12,500 ft without oxygen or pressurisation." The label today still says "also sent
  to SimBrief", which stopped being true when SimBrief links began leaving the altitude to
  SimBrief ([Planner.tsx:196](../../../src/client/components/Planner.tsx#L196)).
- **Airport types** — Large, Medium, Small (on by default), Seaplane, Heliport; and **Paved only**.
- **Limits line** — the aircraft's runway minimum ("Only airports with a runway of at least X
  (aircraft setting; airports without runway data are left out).", or that none is set), its
  ceiling limit, and the no-oxygen limit ("fields above 10,500 ft are out"), in words.
- **Find airports in range** ("Searching…" while running) and **Clear**. Client-side checks before
  searching: an aircraft, a cruise speed, a positive time, at least one type, a starting airport
  when the aircraft has no hops, a cruise altitude of at least 500 ft. These and server errors
  show under the form.

**Results** ([Planner.tsx:246-343](../../../src/client/components/Planner.tsx#L246-L343)):

- Summary: "N airports within R nm of ORIGIN (time at S kts)"; the block-time model in words with
  the naive range; when truncated, "Too many to show them all: the nearest N are drawn, reaching
  only D out (inner ring)…" with how to narrow the search.
- Legends for dot fill (surface), size (class) and ring color (flight category), saying which
  airports are checked: large and medium, and small ones with an ICAO code, METAR under 90 min old.
- The hide-ruled-out toggle with its count.
- A filter box once there are more than 8 candidates: code, name or city containing the text, or
  an exact IATA code.
- The list, at most 80 rows, with "N more not listed. All M are on the map; filter above to narrow
  the list." beyond that and "Nothing matches that filter." when empty. Each row: ident, name,
  flight-category badge and flag tags (IFR, X-wind, Dark, Night); distance · ~time · bearing ·
  class; runway summary · location. A ruled-out row is styled as blocked. Clicking a row zooms to
  the candidate. **SB** opens SimBrief's dispatch page for the leg; **Use** hands the airport to
  the hop form (LOG-FORM-004) and zooms to it.

**Plan lifecycle** ([App.tsx:169-188](../../../src/client/App.tsx#L169-L188), [274-313](../../../src/client/App.tsx#L274-L313)).
A new result highlights the planning aircraft and zooms to the ring. The card's **Clear**, the
map toolbar's **Clear plan**, logging a hop from the form (LOG-FORM-005) and the live tracker
logging a leg all remove the result. `?plan=<aircraft id>&minutes=N[&paved=1]` runs one search
after the first load, with the default types, and the form takes on that search's settings.

## On the Map

The planner's layers sit under everything but the hazard and night overlays (MAP-PATH-005), on
the parked aircraft's world copy, with each candidate beside the ring even when it lies across
the 180° meridian from the origin (MAP-GEO-010, MAP-GEO-013).

- **Range ring**: a dashed circle of the ring radius in the planning aircraft's color with a faint
  fill, not clickable. When truncated, a thin white inner ring at `shown_nm` marks how far the
  drawn candidates reach ([MapView.tsx:170-186](../../../src/client/components/MapView.tsx#L170-L186)).
- **Candidate dots** ([MapView.tsx:59-91](../../../src/client/components/MapView.tsx#L59-L91),
  [348-442](../../../src/client/components/MapView.tsx#L348-L442)): filled by runway surface —
  paved when any runway is, else the first surface class (paved near-black, grass lime, gravel and
  dirt amber, water cyan, snow white, unknown grey), colors chosen to stay clear of the
  flight-category colors; sized and outlined by class (large 12 px with a white outline, medium
  7.5 px white, small 4 px grey, others 3 px grey). A fresh flight category recolors the outline
  and thickens it. Ruled-out dots fade while hiding is on. The dots are drawn on a canvas outside
  React and restyled in place as METARs and flags change, so thousands stay responsive.
- **Candidate tooltip**: "IDENT · Name"; location; distance · ~time · bearing; class, elevation and
  runway summary (or "no runway data"); the category badge and METAR summary, or "METAR stale (…)";
  each flag; "Click for photo, weather, terrain, links, and to use as the next destination"
  ([MapView.tsx:322-346](../../../src/client/components/MapView.tsx#L322-L346)).
- **Candidate popup**: clicking a dot opens the airport popup (airports) with the planner's leg
  line, the flags, the terrain check, a SimBrief link for the leg and **Use as next
  destination**, which hands the airport to the hop form and closes the popup. A new result
  closes an open candidate popup ([MapView.tsx:188-206](../../../src/client/components/MapView.tsx#L188-L206)).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Range model | Block time from overhead, climb, cruise and descent with five per-aircraft numbers and light-piston defaults | Cruise speed × time; full performance tables | Close to how SimBrief times a leg without needing tables; speed × time overstates reach, most of all on short legs where overhead and climb dominate. |
| Wind | Ignored | Forecast winds aloft | [inferred] The planner chooses a destination; the SimBrief plan for the chosen leg accounts for winds. |
| Minimum cruise altitude | 1,000 ft above the higher field | Always the profile altitude | A leg cannot cruise below the field it starts or ends at. |
| Search radius | 1.1 × the ring, then time each candidate with its own elevation | Only the ring | A destination above the origin needs less descent and can be reachable just beyond the ring. |
| Where checks run | Static filters on the server; weather and darkness in the browser | Everything on the server | Static filters shrink the result before it is sent; weather and darkness change by the minute and are re-evaluated without a new search. |
| Field-elevation limit | Service ceiling − 2,000 ft; oxygen altitude − 2,000 ft without oxygen | Warn only; ignore | The pattern above a field flies about 2,000 ft over it, so the aircraft must be able to fly there legally and physically. |
| Oxygen altitude | 12,500 ft | 12,000 ft as a conservative margin; 14,000 ft (oxygen at all times) | Matches the US rule (FAR 91.211) where crew oxygen first becomes required. |
| Unknown weather | No flag | Flag as "weather unknown" | [inferred] Many fields have no station; flagging them all would bury the flags that matter. |
| METAR lookups | Large and medium candidates with a station, and small ones with a four-letter ICAO code | Large and medium only; every candidate with a station | A small field with an ICAO code often has an automated station, and that is where a VFR-only aircraft most needs the IFR flag; small fields without one rarely report, so asking would waste requests. |
| Ruled-out airports | Hidden from the list, faded on the map, on by default | Removed from the map; shown normally | The list stays focused while the map still shows what is out there and why. |
| Darkness | Sun more than 6° below the horizon at the ETA; a lit runway makes it advisory | Sunset time; ignore | [inferred] Landing after civil twilight on an unlit strip is the real hazard; a lit runway makes it the pilot's choice. |
| Crosswind | Smallest crosswind across the open runways, using the gust when higher | Steady wind only; one runway | [inferred] The pilot will choose the best runway; gusts are what exceed a limit. |
| Candidate rendering | Canvas markers outside React, restyled in place | A React component per marker | Thousands of candidates stay responsive. |
| Result cap | Nearest 5,000, with an inner ring showing how far they reach | No cap; paging | [inferred] Keeps the response and map responsive; the inner ring makes the cut visible. |
| Terrain source | Open-Meteo elevations, 25 samples per leg, cached in memory | A bundled elevation model; none | [inferred] Free, keyless and worldwide; 25 samples fit in one request per leg. |
| Terrain clearance | 1,000 ft, 2,000 ft above 5,000 ft terrain, rounded up to 500 ft | A fixed margin | Mirrors the FAR 91.177 minimum IFR altitudes (1,000 ft, 2,000 ft in mountainous areas). |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Result count stops early in dense searches** — `total` counts only the nearest 2 × `limit`
   airports searched ([routes.ts:733-746](../../../src/server/routes.ts#L733-L746)).
2. **Stale cruise-altitude label** — "also sent to SimBrief" ([Planner.tsx:196](../../../src/client/components/Planner.tsx#L196)).
3. **Oxygen altitude** is 12,000 ft in the code, not 12,500 ft ([routes.ts:153](../../../src/server/routes.ts#L153),
   [Planner.tsx:199-227](../../../src/client/components/Planner.tsx#L199-L227)).
4. **Small airports get no weather** — METARs are looked up for large and medium candidates only
   ([App.tsx:111](../../../src/client/App.tsx#L111)).
5. **Short legs between fields at different heights** — when a leg is too short to reach cruise
   altitude, the climb and descent are sized as if both fields were at the same height
   ([performance.ts:57-61](../../../src/server/performance.ts#L57-L61)), so a short leg up to a
   high field is timed too short.
6. **Terrain sample spacing** — 25 samples whatever the leg's length, so a 300 nm leg is sampled
   every 12.5 nm and a narrow ridge can fall between samples ([terrain.ts:61-62](../../../src/server/terrain.ts#L61-L62)).
7. **Limits restated in the browser** — the limits line and the cruise-altitude hint hard-code
   the pattern margin, field limit and oxygen altitude ([Planner.tsx:199-229](../../../src/client/components/Planner.tsx#L199-L229))
   although the server returns the field-elevation limit with its reason and the oxygen altitude.
8. **Block-time defaults restated** — the aircraft form's placeholders and presets
   ([AircraftForm.tsx:10-25](../../../src/client/components/AircraftForm.tsx#L10-L25)) and the
   planner's "aircraft default (6,500)" placeholder repeat `DEFAULTS`.
9. **Darkness assumes leaving now** — there is no departure time, so a flight planned for later
   in the day is still checked as if it left now.
10. **A plan outlives logbook changes** — deleting or reordering hops, or deleting the planning
    aircraft, leaves the result on the map from the old origin; only logging a hop clears it.
11. **Rounding before the time check** — estimates are rounded to the minute before being compared
    with the maximum, so a leg up to 30 s over is kept ([routes.ts:743-744](../../../src/server/routes.ts#L743-L744)).
12. **Terrain cache has no bound** — it grows for the life of the server process ([terrain.ts:10](../../../src/server/terrain.ts#L10)).

## References

- Code: [src/server/performance.ts](../../../src/server/performance.ts),
  [src/server/routes.ts](../../../src/server/routes.ts) (limits 150-153, `maxFieldElevation`
  214-229, `/plan` 694-766, `/terrain` 773-793),
  [src/server/airports.ts](../../../src/server/airports.ts) (`planCandidates`, `distanceNm`,
  `bearingDeg` 473-551), [src/server/terrain.ts](../../../src/server/terrain.ts),
  [src/client/constraints.ts](../../../src/client/constraints.ts),
  [src/client/components/Planner.tsx](../../../src/client/components/Planner.tsx),
  [src/client/components/MapView.tsx](../../../src/client/components/MapView.tsx) (surface colors,
  candidate styles, rings, `CandidateLayer`, candidate tooltip and popup),
  [src/client/components/AirportPopup.tsx](../../../src/client/components/AirportPopup.tsx)
  (terrain fetch, flags, `TerrainBlock`, **Use**), [src/client/App.tsx](../../../src/client/App.tsx)
  (METAR batching, flags, plan lifecycle, URL auto-plan)
- External: Open-Meteo elevation API; aviationweather.gov METARs (through airports)
- Consumes: fleet (performance and limit fields), logbook (parked position, hop form hand-off),
  airports (records, runway summary, METARs, geodesy, retained-airport exclusion), tour-map (world
  copy, zoom, sun test), simbrief (dispatch link)
