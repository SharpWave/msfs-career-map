# Airports — EARS Specs

Design: [airports-design.md](airports-design.md). Prefix `APT`; facets `DATA` (reference data
import and refresh), `FIND` (code lookup, search, the airport input), `NEAR` (nearest airport),
`POP` (the airport popup), `RWY` (runway display), `WX` (METAR), `WIKI` (Wikipedia summaries).

`[x]` implemented · `[ ]` intended, not yet implemented · `[D]` deferred

## Reference Data

- [x] **APT-DATA-001**: When the server starts with no airports in the database, the system shall download the OurAirports airport list if it is not on disk and import it before accepting requests.
- [x] **APT-DATA-002**: When the server starts with no runways, or with no runway that has a heading, the system shall download the OurAirports runway list if it is not on disk and import it before accepting requests.
- [ ] **APT-DATA-003**: When more than 30 days have passed since the airport and runway lists were last downloaded, the system shall download both again and re-import them, checking at startup and once a day, without delaying startup.
- [ ] **APT-DATA-004**: While the live tracker has a leg in progress, the system shall postpone an automatic airport-data re-import until the leg has ended.
- [ ] **APT-DATA-005**: If an automatic airport-data download or re-import fails, then the system shall keep the existing airport data and try again at the next check.
- [x] **APT-DATA-006**: When the airport list is imported, the system shall replace every airport not retained under APT-DATA-007 in one transaction, skipping airports of type `closed` and rows without numeric coordinates.
- [ ] **APT-DATA-007**: When airport data is re-imported, the system shall keep the last-known record and runways of every airport that a hop references and that the new lists omit or mark closed, flagged as no longer listed.
- [ ] **APT-DATA-008**: The system shall resolve an airport kept under APT-DATA-007 by its codes like any other airport, and shall not offer it as a planner candidate or return it as a nearest airport.
- [ ] **APT-DATA-009**: When the airport popup shows an airport kept under APT-DATA-007, the system shall state "No longer listed by OurAirports".
- [x] **APT-DATA-010**: When the runway list is imported, the system shall replace every runway in one transaction, skipping rows without an airport ident, rounding length and width, storing blank or non-positive lengths and widths as null, and treating lighted and closed as true only for "1".
- [x] **APT-DATA-011**: When a runway is imported, the system shall set each end's heading from the list's true heading normalised to 0–360°, else from a two-digit runway number with an optional L/R/C suffix (number × 10, 36 → 0°), else null, and set a missing high-end heading to the low-end heading + 180°.
- [x] **APT-DATA-012**: When a runway is imported, the system shall classify its surface text as paved, grass, gravel, dirt, water, snow or unknown by testing the upper-cased text against each class's tokens in that order, the first match winning (e.g. ASP, CON → paved; GRS, TURF → grass; GRVL, GRAVEL → gravel; DIRT, SAND → dirt; WATER → water; SNOW, ICE → snow; single letters G, S, C, D → grass, dirt, paved, dirt), and keep the original text.
- [x] **APT-DATA-013**: When the runway list has been imported, the system shall rebuild each airport's runway summary from its open runways only: longest length, widest width, count, distinct surface classes, whether any is paved, whether any is lit, and the distinct rounded headings.
- [x] **APT-DATA-014**: If an airport or runway list lacks a required column, then the system shall fail the import naming the file and the column, and leave the existing data unchanged.
- [x] **APT-DATA-015**: When `npm run import-airports` is run, the system shall re-import both lists, first downloading any list missing on disk, or both lists with `--fresh`.
- [x] **APT-DATA-016**: When `POST /api/airports/reimport` is called, the system shall re-import both lists from disk, first downloading both with `?download=1`, and return the airport and runway counts.

## Finding Airports

- [x] **APT-FIND-001**: When an airport code is looked up, the system shall match it, trimmed and upper-cased, against the ident, ICAO, GPS, IATA and local codes, preferring an ident match, then ICAO, then GPS, then the others.
- [x] **APT-FIND-002**: When `GET /api/airports/:code` is called, the system shall return the airport with all of its runways, open ones first and then longest first, or HTTP 404 "airport not found: X" when no airport matches.
- [x] **APT-FIND-003**: When airports are searched with a non-blank query, the system shall prefix-match the codes and substring-match the name and city, ranking exact code matches first, then code-prefix matches, then name matches, then by class (large, medium, small, seaplane base, heliport, other), then by name.
- [x] **APT-FIND-004**: When airports are searched, the system shall return nothing for a blank query and cap `GET /api/airports/search` at 1–50 results, 12 by default.
- [x] **APT-FIND-005**: When the user has typed at least two characters in an airport input, the system shall search 120 ms after the last keystroke and show up to 10 results, each with its ident, name, and city and country.
- [ ] **APT-FIND-006**: While an airport input is showing search results, the system shall show only the results for its latest text, discarding responses to earlier text.
- [x] **APT-FIND-007**: While an airport input's result list is open, the system shall move through results with ↑/↓ (wrapping around), pick the highlighted result with Enter, and close the list with Escape.
- [x] **APT-FIND-008**: When the user leaves an airport input or presses Enter with no result list open, the system shall commit the text trimmed and upper-cased.
- [x] **APT-FIND-009**: When an airport input holds a committed code of two or more characters, the system shall show beneath it the airport's name, city and runway summary, or "Unknown airport code" when the code matches no airport.
- [x] **APT-FIND-010**: When an airport input's value is set from outside the input, the system shall replace the text unless the user is typing in it.

## Nearest Airport

- [x] **APT-NEAR-001**: When the nearest airport to a point within a radius is requested, the system shall return the airport within that radius with the lowest distance plus class handicap (large 0, medium 0.3 nm, small 0.8 nm, any other type 2 nm), or none when no airport is within the radius.
- [ ] **APT-NEAR-002**: When the nearest airport to a point within a radius is requested, the system shall consider airports on both sides of the 180° meridian.

## The Airport Popup

- [x] **APT-POP-001**: When the user clicks a visited-airport dot or a planner candidate on the map, the system shall open a popup with "IDENT · Name", the location, the Wikipedia lead image linked to its article when there is one, the runway display with up to five runways, the current METAR when the airport has a station, the Wikipedia extract, and links.
- [x] **APT-POP-002**: The airport popup shall fetch runways, METAR and Wikipedia data only while it is open.
- [x] **APT-POP-003**: When the airport popup opens for an airport known only by its runway summary, the system shall fetch the airport's full runway list.
- [x] **APT-POP-004**: The airport popup shall link, in a new tab, to Wikipedia when the airport has an article, the official site when known, SkyVector always, and aviationweather.gov's decoded METAR/TAF page when the airport has a METAR station.
- [ ] **APT-POP-005**: When a Wikipedia extract is longer than 260 characters, the airport popup shall cut it at the last sentence end within 260 characters, else at the last word boundary, and append "…".
- [x] **APT-POP-006**: While the airport popup is fetching a METAR it shall show "Fetching METAR…", and when the station has no current report it shall show "No current METAR for X."

## Runway Display

- [x] **APT-RWY-001**: The runway display shall show the airport's class label, its elevation when known, and "no runway data" when the airport has no open runways.
- [x] **APT-RWY-002**: When an airport's runway list is known, the runway display shall list up to the caller's limit of open runways, each with its surface-class color, `LE/HE` name, length or "length n/a", width when known, surface class word, the original surface text when the class is unknown, and "· lit" when lit, followed by "+N more" for open runways beyond the limit.
- [x] **APT-RWY-003**: When only an airport's runway summary is known, the runway display shall show one line of longest length, surface classes and runway count.

## METAR

- [x] **APT-WX-001**: When METARs are requested, the system shall fetch uncached stations from aviationweather.gov in batches of up to 150 and cache each station's result for 5 minutes, caching "no report" as null.
- [x] **APT-WX-002**: When aviationweather.gov returns several reports for one station, the system shall keep the most recently observed.
- [x] **APT-WX-003**: When `GET /api/metar/:icao` is called, the system shall reject a code that is not 4 letters or digits with HTTP 400 and return HTTP 404 "no current METAR for X" when the station reports nothing.
- [x] **APT-WX-004**: When `GET /api/metars?ids=` is called, the system shall drop ids that are not 4 letters or digits, reject the request with HTTP 400 when none remain or more than 500 do, and return null for each station that reports nothing.
- [x] **APT-WX-005**: The system shall take an airport's METAR station to be its ICAO code when that is 4 letters or digits, else its ident when that is 4 letters, else none.
- [x] **APT-WX-006**: The system shall treat a METAR as fresh only when it was observed less than 90 minutes ago, and use only a fresh METAR's flight category (VFR, MVFR, IFR, LIFR) for map graphics and planner flags.
- [x] **APT-WX-007**: When the airport popup shows a METAR, the system shall show the flight-category badge; then wind ("calm", "DIR° N kt", with "GN" for gusts, or "wind n/a"), visibility in SM, the ceiling as the first BKN/OVC/OVX layer ("COVER base ft") or "clear" when there are no cloud layers, temperature/dewpoint in °C, and the altimeter in inHg; then the raw report and "observed N min ago".
- [x] **APT-WX-008**: When a map tooltip summarises a METAR, the system shall show wind, visibility, ceiling (or "clear") and the report's age, separated by " · ".
- [x] **APT-WX-009**: The system shall color flight categories VFR green, MVFR blue, IFR red and LIFR magenta.

## Wikipedia

- [x] **APT-WIKI-001**: When an airport's Wikipedia summary is requested, the system shall return the title, extract, thumbnail and full image (with tracking parameters removed) and the article URL for the airport's Wikipedia link, or HTTP 404 when the airport has no link or the link is not a wikipedia.org article.
- [x] **APT-WIKI-002**: The system shall cache each airport's Wikipedia summary in the database and reuse it for 30 days.
- [x] **APT-WIKI-003**: If refreshing a Wikipedia summary returns an HTTP error and a cached summary exists, then the system shall return the cached summary.
- [ ] **APT-WIKI-004**: If refreshing a Wikipedia summary fails with a network error or timeout and a cached summary exists, then the system shall return the cached summary.
