# Planner — EARS Specs

Design: [planner-design.md](planner-design.md). Prefix `PLAN`; facets `TIME` (block-time model and
range ring), `FIND` (candidate search), `FLAG` (live weather and darkness checks), `TERR` (terrain
along a leg), `FORM` (planner form), `LIST` (results in the planner card), `RUN` (plan lifecycle),
`DRAW` (planner layers on the map).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Block-Time Model

- [x] **PLAN-TIME-001**: When timing a leg, the system shall use the aircraft's cruise speed and, for each block-time input the aircraft leaves blank, a light-piston default: cruise altitude 6,500 ft, climb rate 700 fpm, climb speed 65% of cruise speed rounded, descent rate 500 fpm, overhead 12 min.
- [x] **PLAN-TIME-002**: When a planner search gives a cruise-altitude override, the system shall time its legs at that altitude instead of the aircraft's.
- [x] **PLAN-TIME-003**: When timing a leg, the system shall cruise at the profile's cruise altitude or 1,000 ft above the higher of the two fields, whichever is higher.
- [x] **PLAN-TIME-004**: When a leg is long enough to climb to cruise altitude and descend from it, the system shall estimate its block time as the overhead, plus the climb from the origin's elevation at climb rate (covering ground at climb speed), plus cruise at cruise speed for the remaining distance, plus the descent to the destination's elevation at descent rate (covering ground at cruise speed).
- [x] **PLAN-TIME-005**: When a leg is too short to reach cruise altitude, the system shall estimate its block time as the overhead plus a climb and a descent to the greatest height the distance allows.
- [x] **PLAN-TIME-006**: When an airport's elevation is unknown, the system shall treat it as sea level for leg timing and for the field-elevation limit.
- [x] **PLAN-TIME-007**: When a planner search runs, the system shall set the range ring's radius to the longest leg whose block time fits the maximum for a destination at the origin's elevation, or zero when the maximum is no longer than the overhead.

## Candidate Search

- [x] **PLAN-FIND-001**: When `GET /api/plan` is called, the system shall reject an unknown aircraft with HTTP 404, an aircraft without a cruise speed with HTTP 400, and a maximum time outside 1–1440 minutes with HTTP 400.
- [x] **PLAN-FIND-002**: When `GET /api/plan` is called without `from`, the system shall start from where the aircraft is parked and reject the request with HTTP 400 when the aircraft has no hops; with `from`, it shall start from that airport and reject an unknown code with HTTP 400.
- [x] **PLAN-FIND-003**: When `GET /api/plan` is called, the system shall search the listed airport types, by default large, medium and small airports, and reject an unknown type with HTTP 400.
- [x] **PLAN-FIND-004**: When `GET /api/plan` is called, the system shall accept a cruise-altitude override of 500–60,000 ft (blank or 0 meaning none) and reject other values with HTTP 400, take the runway minimum from `min_runway_ft` when given and from the aircraft otherwise, and return at most `limit` candidates (default 5,000, at most 20,000).
- [x] **PLAN-FIND-005**: When searching for planner candidates, the system shall offer only airports of the requested types other than the origin, with an open runway at least as long as the runway minimum when one is set (leaving out airports without runway data), and with a paved open runway when paved only is requested.
- [ ] **PLAN-FIND-006**: When searching for planner candidates, the system shall leave out airports above the aircraft's highest usable field: its service ceiling minus 2,000 ft and, for an aircraft without oxygen or pressurisation, 10,500 ft (the 12,500 ft oxygen altitude minus 2,000 ft), whichever is lower.
- [x] **PLAN-FIND-007**: When searching for planner candidates, the system shall consider airports within 1.1 × the range ring's radius by great-circle distance, including across the 180° meridian, and keep those whose estimated block time, timed with the candidate's own elevation and rounded to the minute, is within the maximum.
- [x] **PLAN-FIND-008**: When a planner search completes, the system shall return its candidates nearest first, each with its distance, initial bearing, estimated minutes and runway summary, together with the profile used, the ring radius, the naive range (cruise speed × time), the filters applied, and the field-elevation limit with its reason.
- [x] **PLAN-FIND-009**: When more planner candidates pass than the limit, the system shall return the nearest `limit` of them, mark the result truncated, and give the distance of the farthest one returned.
- [ ] **PLAN-FIND-010**: When a planner search completes, the system shall report as its total the number of airports that passed every filter, however many there are.

## Live Checks

- [ ] **PLAN-FLAG-001**: When a planner result arrives, the system shall look up METARs for its large and medium candidates that have a METAR station and for its small candidates whose METAR station is four letters, in batches of up to 150, merging each batch as it arrives and skipping stations looked up in the last 5 minutes.
- [x] **PLAN-FLAG-002**: If a planner METAR batch fails, then the system shall leave those stations without weather until the next search.
- [x] **PLAN-FLAG-003**: While the planning aircraft is not IFR capable and a candidate's fresh flight category is IFR or LIFR, the system shall flag the candidate "IFR conditions, VFR-only aircraft" (or "LIFR conditions, …") and rule it out.
- [x] **PLAN-FLAG-004**: While the planning aircraft has a crosswind limit and a candidate has a fresh METAR, the system shall flag the candidate "Crosswind N kt on best runway, limit M kt" and rule it out when the smallest crosswind component across its open runways exceeds the limit.
- [x] **PLAN-FLAG-005**: When computing a planner crosswind component, the system shall use the gust when it is higher than the steady wind, give zero in calm, and skip the check when the wind direction is variable or missing or no runway heading is known.
- [x] **PLAN-FLAG-006**: When the sun is more than 6° below the horizon at a candidate at its ETA (now plus its estimated minutes), the system shall flag it "Night arrival (runway lit)" without ruling it out when it has a lit runway, and "Dark at ETA and no runway lighting", ruling it out, when it has none.
- [x] **PLAN-FLAG-007**: While a planner result is shown, the system shall re-evaluate candidate flags when METARs arrive and every minute.
- [x] **PLAN-FLAG-008**: While a candidate has no fresh METAR, the system shall raise no weather flag for it.
- [x] **PLAN-FLAG-009**: While "Hide airports ruled out by live weather or darkness" is on (the default on each page load), the system shall leave ruled-out candidates out of the planner list, draw them faded on the map, and show how many are ruled out beside the option.

## Terrain Along a Leg

- [x] **PLAN-TERR-001**: When `GET /api/terrain` is called with `from` and `to` positions, the system shall sample n + 1 points (n 4–99, default 24) evenly along the great circle between them, with elevations from Open-Meteo in feet and the sea as 0 ft, and return the samples and the highest point.
- [x] **PLAN-TERR-002**: If `GET /api/terrain` is called with a `from` or `to` that is not `lat,lon` within ±90° and ±180°, then the system shall reject the request with HTTP 400.
- [x] **PLAN-TERR-003**: When returning a terrain profile, the system shall give a minimum altitude of the highest sample plus 1,000 ft clearance, or 2,000 ft when that sample is above 5,000 ft, rounded up to the next 500 ft.
- [x] **PLAN-TERR-004**: When fetching terrain elevations, the system shall request at most 100 points per call and reuse each point's elevation, cached in memory by its coordinates rounded to 0.001°.
- [x] **PLAN-TERR-005**: When a planner candidate's airport popup opens, the system shall check terrain along the direct leg from the plan's origin, showing "Checking terrain along the leg…", then "Highest terrain en route X · plan at least Y (Z clearance)", or "Terrain check unavailable." when the check fails.
- [x] **PLAN-TERR-006**: When a candidate's terrain check needs a minimum altitude above the planning aircraft's service ceiling, the popup shall warn "Needs Y en route, above the C service ceiling."
- [ ] **PLAN-TERR-007**: When a candidate's terrain check needs a minimum altitude above 12,500 ft and the planning aircraft has no oxygen or pressurisation, the popup shall warn "Needs Y en route: above 12,500 ft without oxygen or pressurisation."

## Planner Form

- [x] **PLAN-FORM-001**: While there are no aircraft, the planner card shall read "Add an aircraft with a cruise speed to plan its next hop."
- [x] **PLAN-FORM-002**: The planner form shall list every aircraft with its cruise speed or "no cruise speed", start on the highlighted aircraft (else the first with a cruise speed, else the first), follow the highlight as it changes, and fall back the same way when its aircraft is deleted.
- [x] **PLAN-FORM-003**: While the planner form's aircraft has no cruise speed, the form shall show "Set a cruise speed on this aircraft to unlock the planner." with an **Edit aircraft** link that opens that aircraft's edit form in the Fleet drawer, and disable the search button.
- [x] **PLAN-FORM-004**: The planner form shall offer a maximum flight time in minutes, 90 by default, with quick picks of 30 min, 1 h, 1 h 30, 2 h, 3 h and 4 h.
- [x] **PLAN-FORM-005**: The planner form shall offer a From airport that defaults to where the aircraft is parked, shown as the field's placeholder.
- [ ] **PLAN-FORM-006**: The planner form shall offer a cruise altitude labelled "for climb/descent time", filled with the aircraft's cruise altitude whenever the form's aircraft changes, with blank meaning the default.
- [ ] **PLAN-FORM-007**: While the planner form's aircraft has no oxygen or pressurisation and its cruise altitude is above 12,500 ft, the form shall warn "Above 12,500 ft without oxygen or pressurisation."
- [x] **PLAN-FORM-008**: The planner form shall offer the airport types Large, Medium and Small (on by default), Seaplane and Heliport, and a Paved only option (off by default).
- [ ] **PLAN-FORM-009**: The planner form shall state its aircraft's limits: "Only airports with a runway of at least X (aircraft setting; airports without runway data are left out)." or "No minimum runway length set for this aircraft, so every airport in range is included."; with a service ceiling C, "Fields above C − 2,000 ft are out (ceiling C minus a 2,000 ft pattern)."; and without oxygen, "No oxygen/pressurisation, so fields above 10,500 ft are out."
- [x] **PLAN-FORM-010**: When the user searches, the planner form shall refuse, with a message under the form, a missing aircraft, an aircraft without a cruise speed, a time that is not a positive number, no airport type, no starting airport for an aircraft without hops, or a cruise altitude below 500 ft, and shall show server errors in the same place.
- [x] **PLAN-FORM-011**: While a planner search runs, the search button shall read "Searching…" and be disabled.

## Results in the Planner Card

- [x] **PLAN-LIST-001**: When a planner result is shown, the planner card shall summarise it as "N airports within R of ORIGIN (time at S kts)" and describe the block-time model used: overhead, climb rate and speed, cruise altitude, descent rate, and the naive range.
- [x] **PLAN-LIST-002**: When a planner result is truncated, the planner card shall say that only the nearest N are drawn, reaching D out (the inner ring), and suggest unticking small airports, paved only, or a shorter time.
- [ ] **PLAN-LIST-003**: While a planner result is shown, the planner card shall show legends for dot fill (paved, grass, gravel/dirt, water; bigger dot = bigger airport) and ring color (VFR, MVFR, IFR, LIFR), the latter naming the airports checked: large and medium, and small ones with an ICAO code, METAR under 90 min old.
- [x] **PLAN-LIST-004**: While a planner result has more than 8 candidates, the planner card shall offer a filter that keeps candidates whose code, name or city contains the text, or whose IATA code equals it, ignoring case.
- [x] **PLAN-LIST-005**: The planner list shall show at most 80 candidates in result order, then "N more not listed. All M are on the map; filter above to narrow the list.", and "Nothing matches that filter." when none match.
- [x] **PLAN-LIST-006**: The planner list shall show for each candidate its ident, name, fresh flight-category badge and flag tags (IFR, X-wind, Dark, Night); its distance, ~time, bearing and class; and its runway summary (or "no runway data") and location; styled as blocked when it is ruled out.
- [x] **PLAN-LIST-007**: When the user clicks a candidate row in the planner list, the system shall zoom the map to that candidate.
- [x] **PLAN-LIST-008**: When the user clicks a candidate's **SB** in the planner list, the system shall open SimBrief's dispatch page for the leg from the plan's origin to that candidate in a new tab.
- [x] **PLAN-LIST-009**: When the user clicks **Use** on a candidate, in the planner list or its popup, the system shall hand that airport to the hop form as the planning aircraft's next destination and zoom the map to it.

## Plan Lifecycle

- [x] **PLAN-RUN-001**: When a new planner result arrives, the system shall highlight the planning aircraft and show the result in the planner card and on the map.
- [x] **PLAN-RUN-002**: When the user clicks **Clear** in the planner card or **Clear plan** in the map toolbar, the system shall remove the planner result.
- [x] **PLAN-RUN-003**: When the live tracker logs a hop, the system shall remove the planner result and any destination the planner handed to the hop form.
- [x] **PLAN-RUN-004**: When the page is opened with `?plan=<aircraft id>` (optionally `minutes`, default 90, and `paved=1`), the system shall run one planner search for that aircraft with the default airport types after the first load.
- [x] **PLAN-RUN-005**: When a planner result arrives, the planner form shall take on its aircraft, maximum time, airport types, paved option and cruise altitude.

## Planner Layers on the Map

- [x] **PLAN-DRAW-001**: While a planner result is shown, the system shall draw the range ring as a dashed, non-interactive circle of the ring radius around the origin in the planning aircraft's color with a faint fill, and, when the result is truncated, a thin white inner ring at the distance of the farthest candidate returned.
- [x] **PLAN-DRAW-002**: While a planner result is shown, the system shall draw each candidate as a dot filled by runway surface — paved when any runway is paved, else its first surface class: paved near-black, grass lime, gravel amber, dirt darker amber, water cyan, snow white, unknown grey — sized and outlined by class: large 12 px white, medium 7.5 px white, small 4 px grey, other types 3 px grey.
- [x] **PLAN-DRAW-003**: When a candidate has a fresh flight category, the system shall color its dot's outline with the category's color and thicken it to 3.5 px for a large airport and 3 px otherwise.
- [x] **PLAN-DRAW-004**: When the user hovers a candidate dot, the system shall show "IDENT · Name", the location, distance · ~time · bearing, class, elevation and runway summary (or "no runway data"), the flight category with a METAR summary or "METAR stale (…)", each flag, and "Click for photo, weather, terrain, links, and to use as the next destination".
- [x] **PLAN-DRAW-005**: When the user clicks a candidate dot, the system shall open the airport popup with the leg's distance · ~time · bearing, the candidate's flags, the terrain check, a SimBrief link for the leg, and **Use as next destination**, which closes the popup after handing the airport over.
- [x] **PLAN-DRAW-006**: When a new planner result arrives or the result is removed, the system shall close any open candidate popup.
