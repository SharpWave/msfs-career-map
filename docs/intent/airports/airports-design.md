---
parent: high-level-design
prefix: APT
---

# Airports

## Context and Design Philosophy

Every other part of the app talks about airports: hops are stored by airport ident, the planner
searches for reachable fields, the tracker names where a flight took off and stopped, and the map
draws airport dots. This segment owns the airport reference data and everything the app can tell
you about one airport.

- **Reference data** — the OurAirports airport and runway lists, imported into the local database
  on first run, with runway surfaces normalised into a few classes and a per-airport runway
  summary.
- **Finding airports** — resolving any code to the canonical ident, search-as-you-type, and the
  nearest airport to a point.
- **Airport details** — runways, current weather (METAR), a Wikipedia photo and blurb, and
  outbound links, shown in the airport popup.

It does not own which airports are reachable (planner), how airports appear on the map
(tour-map), or why the tracker asks for the nearest airport (live-tracking). The popup hosts extra
content those segments pass in — the planner's leg line, flags, terrain check and **Use** button,
and simbrief's dispatch link — but that content is specified by its owners.

OurAirports is a free, worldwide, regularly updated dataset with codes, coordinates, elevations,
runways and Wikipedia links, which suits an open, keyless local tool.

## Reference Data

### Import

The airport and runway lists come from OurAirports' CSV mirror
([airports.ts:4-6](../../../src/server/airports.ts#L4-L6)) and are stored as `data/airports.csv`
and `data/runways.csv`.

- **Startup.** When the airports table is empty, the server downloads `airports.csv` if it is
  missing and imports it. When the runways table is empty, or no runway has a heading (a database
  from before headings were stored), it downloads `runways.csv` if missing and imports it
  ([airports.ts:197-209](../../../src/server/airports.ts#L197-L209)). This happens before the
  server starts listening, so the first run takes a few seconds longer.
- **Monthly refresh** (intended; today the lists are only downloaded on first run). At startup and
  once a day, when more than 30 days have passed since the lists were last downloaded, the server
  downloads both again and re-imports them in the background, after it is already serving. The
  import holds the server for a few seconds, so an automatic refresh waits while the live tracker
  has a leg in progress — a stall during a landing would distort the touchdown measurement. A
  failed download or import leaves the current data in place and is retried at the next check.
- **Manual refresh.** `npm run import-airports` re-imports both lists, downloading any missing file
  first, or both with `--fresh` ([scripts/import-airports.ts](../../../scripts/import-airports.ts));
  `POST /api/airports/reimport[?download=1]` re-imports from the files on disk, downloading both
  first with `download=1` ([routes.ts:106-114](../../../src/server/routes.ts#L106-L114)).
- **Airports** ([airports.ts:78-116](../../../src/server/airports.ts#L78-L116)): each import
  replaces every row in one transaction. Rows of type `closed` and rows without numeric coordinates
  are skipped; blank text fields become null; a blank elevation is null.
- **Runways** ([airports.ts:140-194](../../../src/server/airports.ts#L140-L194)): each import
  replaces every row in one transaction. Rows without an airport ident are skipped. Length and
  width are rounded, and blank or non-positive values are null. `lighted`/`closed` are 1 only for
  `"1"`. Each end's heading is the CSV's true heading normalised to 0–360, else derived from a
  two-digit runway number (`16L` → 160°, `36` → 0°), else null; a missing high-end heading is the
  low end's + 180°.
- A missing required CSV column fails the import with the file and column named; a failed
  download names the HTTP status ([airports.ts:53-70](../../../src/server/airports.ts#L53-L70)).
  The CSV reader handles quoted fields, doubled quotes, embedded commas and newlines, and CRLF or
  LF line ends.

### Airports that leave the dataset

Hops store airport idents, so a hop row survives any re-import. What depends on the airport row
itself does not: the map cannot place a hop whose airport is missing, the planner cannot start
from it, and editing the hop fails because its codes no longer resolve. Airports most often leave
the dataset by being marked `closed`, which the import skips.

The intended rule (today every re-import drops them): a re-import keeps the last-known record and
runways of every airport that a hop references and that the new lists omit or mark closed. Such an
airport is flagged as no longer listed. It still resolves by code — so its hops draw, plan and edit
as before — but it is not offered as a planner candidate or chosen as a nearest airport, and its
popup says "No longer listed by OurAirports".

### Surface classes

OurAirports surfaces are free text ("ASPH-G", "TURF-F", "PIÇARRA"…). Each runway is also given one
of seven classes — paved, grass, gravel, dirt, water, snow, unknown — by testing the upper-cased
text against token lists in that order, first match winning; single letters G, S, C and D map to
grass, dirt, paved and dirt ([airports.ts:120-137](../../../src/server/airports.ts#L120-L137)).

### Runway summary

After every runway import the per-airport summary `airport_rwy` is rebuilt from **open** runways
only: longest length, widest width, count, the distinct surface classes, whether any is paved,
whether any is lit, and the distinct rounded headings
([airports.ts:180-187](../../../src/server/airports.ts#L180-L187)). Every airport query LEFT JOINs
it, so an airport without open runways reads as count 0 and not paved or lit
([airports.ts:257-261](../../../src/server/airports.ts#L257-L261)). The summary is what search
results, planner candidates and map dots carry; full runway lists are attached only where needed.

## Finding Airports

**By code.** A code is trimmed, upper-cased and matched against the ident, ICAO, GPS, IATA and local
codes, preferring an ident match, then ICAO, then GPS, then the rest
([airports.ts:263-271](../../../src/server/airports.ts#L263-L271)). This is the resolution the
logbook relies on to store canonical idents. `GET /api/airports/:code` returns the airport with
all its runways, open first and longest first, or `404 "airport not found: X"`
([routes.ts:71-75](../../../src/server/routes.ts#L71-L75), [airports.ts:295-302](../../../src/server/airports.ts#L295-L302)).

**Search.** A blank query returns nothing. Otherwise codes are prefix-matched and name and city
substring-matched; results rank exact code matches first, then code prefixes, then name matches,
then by class (large, medium, small, seaplane base, heliport, other), then by name
([airports.ts:277-293](../../../src/server/airports.ts#L277-L293)). `GET /api/airports/search`
caps results at 1–50, default 12 ([routes.ts:65-69](../../../src/server/routes.ts#L65-L69)).

**Airport input** — the code box used by the hop form, the pending-leg form and the planner's From
field ([AirportInput.tsx](../../../src/client/components/AirportInput.tsx)):

- Typing two or more characters searches 120 ms after the last keystroke (10 results), shown as a
  dropdown of ident, name and "city, country". Only results for the latest text are meant to show;
  today a slow earlier response can replace newer results ([AirportInput.tsx:62-71](../../../src/client/components/AirportInput.tsx#L62-L71)).
- ↑/↓ move through the results with wrap-around, Enter picks, Escape closes; a mouse pick works
  before the box loses focus.
- Leaving the box or pressing Enter with no dropdown commits the text trimmed and upper-cased.
- The line under the box names the committed airport — "name · city · runway summary" — or says
  "Unknown airport code" when the lookup fails.
- A value set from outside (form reset, defaults, planner hand-off) replaces the text unless the
  user is typing.

**Nearest airport.** Given a point and a radius, returns the airport that minimises distance plus
a class handicap — large 0, medium 0.3 nm, small 0.8 nm, any other type 2 nm — so a main field
wins over its own heliport or a strip next door; nothing beyond the radius is considered
([airports.ts:555-581](../../../src/server/airports.ts#L555-L581)). The tracker uses it with a
5 nm radius. It is meant to work across the 180° meridian like the planner's search does; today
its search box does not wrap, so near the meridian airports on the far side are missed.

**Geodesy.** Great-circle distance (Earth radius 3440.065 nm) and initial bearing
([airports.ts:478-489](../../../src/server/airports.ts#L478-L489)) are shared by the planner and
the tracker.

## Airport Details

### The airport popup

Clicking an airport dot — a visited airport or a planner candidate — opens a popup
([AirportPopup.tsx](../../../src/client/components/AirportPopup.tsx)). It fetches only while open:

- **Header**: "IDENT · Name" and "city, region, country"; for an airport kept after leaving the
  dataset, "No longer listed by OurAirports".
- **Photo**: the Wikipedia lead image, linked to the article, when there is one.
- **Runways**: the airport class and elevation, then up to five open runways (below). A planner
  candidate arrives with only its runway summary, so the popup fetches the full airport.
- **Weather**: the station's current METAR (below), "Fetching METAR…" meanwhile, or "No current
  METAR for X."
- **Blurb**: the Wikipedia extract, cut to 260 characters with "…".
- **Links**: Wikipedia, the official site when known, SkyVector, and aviationweather.gov's decoded
  METAR/TAF page when the airport has a station, all in a new tab.
- **Hosted content** from other segments when passed in: the planner's leg line, flags, terrain
  check and "Use as next destination"; simbrief's dispatch link.

The text cut is meant to end at the last sentence within 260 characters when there is one, else at
the last word; today it always cuts at the last space
([AirportPopup.tsx:212-216](../../../src/client/components/AirportPopup.tsx#L212-L216)).

### Runway display

[RunwayInfo.tsx](../../../src/client/components/RunwayInfo.tsx) shows the class label ("Medium
airport"), "elev N ft" when known, and "no runway data" when the airport has no open runways. Then
up to N open runways (callers choose: 5 in the popup, 3 in map tooltips), each with a surface-class
color square, `LE/HE` name, length or "length n/a", "× width ft" when known, the surface class
word, the raw surface text when the class is unknown, and "· lit"; extra runways show as "+N more".
With only the summary known it shows one line: "longest ft · surfaces · n rwys"
([format.ts:95-103](../../../src/client/format.ts#L95-L103)).

### Weather (METAR)

- **Source.** aviationweather.gov's METAR API, fetched in batches of 150 stations, 12 s timeout,
  each station cached in server memory for 5 minutes. A station that reports nothing is cached as
  null for the same time; when a station returns several reports the newest wins
  ([airports.ts:397-471](../../../src/server/airports.ts#L397-L471)).
- **API.** `GET /api/metar/:icao` (400 unless 4 letters/digits; 404 "no current METAR for X") and
  `GET /api/metars?ids=` (non-4-character ids dropped; 400 when none remain or more than 500)
  ([routes.ts:86-104](../../../src/server/routes.ts#L86-L104)).
- **Station rule.** An airport's METAR station is its ICAO code when that is 4 letters/digits, else
  its ident when that is 4 letters, else none ([metar.ts:27-31](../../../src/client/metar.ts#L27-L31)).
- **Freshness.** A METAR is fresh when observed under 90 minutes ago; only a fresh report's flight
  category (VFR, MVFR, IFR, LIFR) counts for map graphics and planner flags
  ([metar.ts:33-50](../../../src/client/metar.ts#L33-L50)). Category colors: VFR green, MVFR blue,
  IFR red, LIFR magenta.
- **Popup line**: flight-category badge, then wind ("calm", "DIR° N kt [GN]", or "wind n/a"),
  visibility in SM, ceiling (first BKN/OVC/OVX layer as "COVER base ft", or "clear" with no cloud
  layers), temperature/dewpoint °C, altimeter in inHg; then the raw report and "observed N min
  ago" ([AirportPopup.tsx:218-241](../../../src/client/components/AirportPopup.tsx#L218-L241)).
  Map tooltips use a shorter wind · visibility · ceiling · age line ([metar.ts:53-66](../../../src/client/metar.ts#L53-L66)).

### Wikipedia

`GET /api/airports/:code/wiki` returns the page summary for an airport's `wikipedia_link`: title,
extract, thumbnail and full image (tracking parameters stripped), and the article URL
([airports.ts:338-379](../../../src/server/airports.ts#L338-L379), [routes.ts:78-84](../../../src/server/routes.ts#L78-L84)).
Summaries are cached in `wiki_cache` for 30 days. An airport without a link, or whose link is not a
wikipedia.org article, has no summary (404). A failed refresh returns the stale cached summary
when one exists; today that fallback covers an HTTP error status but not a network error or
timeout, which fails the request.

## API

| Method | Path | Behaviour | Errors |
|---|---|---|---|
| GET | `/api/airports/search?q=&limit=` | Ranked search, 1–50 results (default 12), with runway summary | — |
| GET | `/api/airports/:code` | One airport by any code, with its runways | 404 |
| GET | `/api/airports/:code/wiki` | Cached Wikipedia summary | 404 no airport / no article; 500 fetch failed without cache |
| GET | `/api/metar/:icao` | Latest METAR | 400 bad code; 404 none; 500 upstream |
| GET | `/api/metars?ids=A,B` | Up to 500 stations; unreported ones null | 400; 500 upstream |
| POST | `/api/airports/reimport[?download=1]` | Re-import (optionally re-download) both lists → counts | 500 |

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Airport data source | OurAirports CSVs, downloaded on first run into the local database | The sim's own navdata; a commercial airport API | [inferred] Free, worldwide and keyless, with runways, codes and Wikipedia links in one dataset; works offline once imported. The sim's database is not readable from outside it. |
| Keeping the data current | Automatic refresh when the last download is over 30 days old, checked at startup and daily, deferred while a leg is flown | Manual only; refresh on every start | The dataset keeps changing, a month is fresh enough for airports, and a refresh must never disturb a flight being tracked. |
| Airports that leave the dataset | Keep the last-known record of any airport a hop references, flagged as no longer listed | Drop it with the rest; delete or rewrite the hops | Logged hops must stay intact — drawable, plannable from and editable — whatever happens to the source data. |
| Closed airports and runways | Closed airports are not imported; closed runways are kept but left out of the summary | Import everything; drop closed runways | [inferred] A closed airport is never a destination; a closed runway is still worth listing in the popup but must not make a field look usable. |
| Surface text | Normalised into seven classes by ordered token match; raw text kept | Show raw text only | Planner filters (paved only), map colors and legends need a small fixed set; OurAirports surfaces are inconsistent free text. |
| Runway summary | A per-airport table rebuilt on each runway import, LEFT JOINed into every airport query | Aggregate runways on every query | [inferred] Search, planner and map queries touch thousands of airports; a precomputed summary keeps them cheap. |
| Runway headings | CSV true heading, else derived from the runway number | Leave unknown | [inferred] Crosswind checks need a heading for every runway that has a number. |
| Code resolution order | Ident, then ICAO, then GPS, then IATA/local | First match in any column | [inferred] An ident is unique; IATA and local codes can collide across countries. |
| Nearest-airport choice | Distance plus a class handicap (0 / 0.3 / 0.8 / 2 nm) | Pure distance | A main field should win over its own heliport or an adjacent strip when the aircraft is at the main field's runway. |
| Popup data | Fetched only while the popup is open | Prefetch with map data | [inferred] Map state stays small and fast; most airports are never opened. |
| METAR caching | 5 minutes in server memory, null cached for unreported stations; freshness 90 minutes on the client | No cache; persist in the database | [inferred] Routine reports are hourly; a short cache keeps planner batches cheap without serving stale weather. |
| Wikipedia caching | 30 days in the database, stale copy served when a refresh fails | Fetch every time | [inferred] Summaries rarely change; the cache keeps popups fast and works through outages. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Airport data refreshes automatically once it is over 30 days old (see Decisions).
2. ✅ Airports a hop references are kept when the source data drops them (see Airports that leave
   the dataset).
3. ✅ The nearest-airport class head start (0 / 0.3 / 0.8 / 2 nm) stays as it is.

### Deferred

1. **Airports the sim has and OurAirports lacks** (or knows by another ident) cannot be named by
   the tracker or typed in a form. Not yet encountered; revisit if it happens, for example with
   user-defined airports.
2. **Search wildcards** — `%` and `_` typed by the user act as SQL wildcards
   ([airports.ts:292](../../../src/server/airports.ts#L292)).
3. **One-digit runway numbers** ("9/27") get no derived heading ([airports.ts:159](../../../src/server/airports.ts#L159)).
4. **Import blocks the server** — the synchronous import holds the server for its duration, at
   startup, for `POST /airports/reimport`, and for the monthly refresh (which is why that waits for
   the tracker to be idle); downloads have no timeout.
5. **Old databases keep empty link columns** — startup re-imports runways missing headings but not
   airports missing `wikipedia_link`/`home_link` ([airports.ts:198](../../../src/server/airports.ts#L198));
   the monthly refresh fills them within a month.
6. **METAR formatting is written twice** — the popup and the tooltip line format wind and ceiling
   separately ([AirportPopup.tsx:220-230](../../../src/client/components/AirportPopup.tsx#L220-L230),
   [metar.ts:54-63](../../../src/client/metar.ts#L54-L63)).
7. **One failed METAR batch fails the whole request**, even when earlier batches succeeded
   ([airports.ts:450-463](../../../src/server/airports.ts#L450-L463)).

## References

- Code: [src/server/airports.ts](../../../src/server/airports.ts) (all but `planCandidates`, which
  belongs to planner), [src/server/routes.ts](../../../src/server/routes.ts) (airports section 63-114),
  [scripts/import-airports.ts](../../../scripts/import-airports.ts),
  [src/client/metar.ts](../../../src/client/metar.ts),
  [src/client/components/AirportInput.tsx](../../../src/client/components/AirportInput.tsx),
  [src/client/components/AirportPopup.tsx](../../../src/client/components/AirportPopup.tsx) (minus
  the planner's terrain block), [src/client/components/RunwayInfo.tsx](../../../src/client/components/RunwayInfo.tsx),
  [src/client/format.ts](../../../src/client/format.ts) (`airportTypeLabel`, `surfaceLabel`,
  `runwaySummary`, `airportWhere`), [src/server/db.ts](../../../src/server/db.ts) (`airports`,
  `runways`, `airport_rwy`, `wiki_cache`)
- External: OurAirports data (davidmegginson.github.io/ourairports-data), aviationweather.gov
  METAR API, Wikipedia REST page summaries
- Consumers: logbook (code resolution), planner (summary, METAR categories, geodesy), live-tracking
  (nearest airport), tour-map (summary, METAR line, runway display)
