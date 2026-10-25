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

- **Reference data** — the OurAirports airport and runway lists: seeded into a data folder from the
  program folder or downloaded, imported into the local database when the server prepares its
  airport data at start, refreshed every month, with runway surfaces normalised into a few classes
  and a per-airport runway summary.
- **Finding airports** — resolving any code to the canonical ident, search-as-you-type, and the
  nearest airport to a point.
- **Airport details** — runways, current weather (METAR), a Wikipedia photo and blurb, and
  outbound links, shown in the airport popup.

It does not own which airports are reachable (planner), how airports appear on the map
(tour-map), or why the tracker asks for the nearest airport (live-tracking). The popup hosts extra
content those segments pass in — the planner's leg line, flags, terrain check and **Use** button,
and simbrief's dispatch link — but that content is specified by its owners. Nor does it own the
server's start order, its inputs or `/api/status` (app-shell), the seed lists shipped in the
installed program (desktop distribution), or where the desktop app's window sends outside links
(desktop shell). The desktop app relies on this segment for seeding a data folder from the program
folder, the lists' download times, an input that turns airport downloads off, and popup links the
window can send to the pilot's browser ([Desktop › Relies On](../desktop/desktop-design.md#relies-on)).

OurAirports is a free, worldwide, regularly updated dataset with codes, coordinates, elevations,
runways and Wikipedia links, which suits an open, keyless local tool. Every request this segment
makes to OurAirports, aviationweather.gov and Wikipedia carries the server's User-Agent, naming the
app, its version and the project's address as contact (app-shell, APP-API-005).

## Reference Data

### Where the lists live

The airport and runway lists come from OurAirports' CSV mirror
([airport-data.ts:15-17](../../../src/server/airport-data.ts#L15-L17)) as `airports.csv` and `runways.csv`,
kept in the data folder beside the database: `%LOCALAPPDATA%\MSFS Career Map` for the installed app,
`<folder>\data` in the desktop app's test mode, and the database's folder (`data/` by default) for a
copy run from source (app-shell).

**Download times.** Each list carries the time it was downloaded, in a file beside it named after it
with `.downloaded` added (`airports.csv.downloaded`, `runways.csv.downloaded`). The file holds one
ISO 8601 UTC date-time ending in `Z`, with seconds and optionally fractions of a second —
`2026-10-23T14:05:00Z` or `2026-10-23T14:05:00.000Z` — and whitespace around it is ignored. The seed
lists in the installed program carry theirs the same way, recorded by the desktop build scripts when
they download them (desktop distribution), so a list seeded into a data folder keeps the age of the
release's download rather than starting afresh at the first run. A list without that file — one put
there by hand, the test fixture lists, one downloaded before times were recorded — counts as
downloaded at its own last-modified time, and so does one whose file holds anything else or a time
later than now (written by a machine whose clock ran ahead), which would otherwise keep its refresh
from ever falling due.

**Downloads** write a list under a temporary name and put it in place, with its download time, only
once it is complete, so a download that fails leaves the list on disk and its time as they were. A
download fails when no data arrives for 60 s or when it has not finished within 10 minutes, and a
failed download names the HTTP status when there is one
([airport-data.ts:94-151](../../../src/server/airport-data.ts#L94-L151)).

### Preparing airport data at start

The server prepares its airport data once it is listening and its start-up work on the logbook is
done — the database opened, backed up and upgraded — and before it starts the sim link (app-shell's
start order). Preparation:

1. **Clears leftovers.** Temporary list files and staging tables left by a download or import that an
   earlier server did not finish — one ended by a crash or by Windows — are removed.
2. **Seeds** the data folder from the program folder, an input of the server's (app-shell) that for
   the installed app is its resources, holding the seed lists. Each list the data folder lacks and the
   program folder holds is copied in under a temporary name and put in place only once complete, with
   the download time the program folder's list carries written beside it, so a copy cut short never
   leaves a partial list that later starts would keep. A list already in the data folder stays as it
   is, whatever put it there — an earlier release, a monthly refresh, or a test that placed its
   fixture lists before the first start. So a new data folder (the first run, or one the pilot
   deleted) needs no connection, and a list deleted by hand comes back without one. A program folder
   without lists seeds nothing.
3. **Downloads** a list that an import below needs and the data folder still lacks after seeding,
   when airport downloads are on (below). A list missing when there is nothing to import is left to
   the monthly refresh, which counts a missing list as due; downloading it here would hold back the
   sim link, which starts only once preparation has ended.
4. **Imports** the airport list when the database holds no airports, and the runway list when it holds
   no runways or no runway with a heading (a database from before headings were stored)
   ([airport-data.ts:709-727](../../../src/server/airport-data.ts#L709-L727)). Each import takes the data
   folder's list: the one already there, else the one just seeded, else the one just downloaded.

A logbook brought in from another data folder, or restored from a backup, comes with the airport data
imported into its database. Preparation imports only into empty tables, so that data stays in use
until the next monthly refresh replaces it.

While it runs the server keeps answering, and `/api/status` reports the step under way — copying
lists from the program folder, downloading a list, importing airports or runways with the rows
imported so far out of the total — and, once preparation has ended, whether it succeeded or failed
and why. app-shell carries that report in the status, sets the status's `ready` flag once
preparation at start has ended, and shows the report on the page. Until a first run's import has
finished, airport lookups and searches find nothing.

A failure — a list an import needs that the data folder still lacks after seeding and that may not be
downloaded (airport downloads off) or whose download fails, or a failed import — ends preparation
without ending the server. The server keeps the airport data it had (none on a first run), the status
says what failed and why, and the next daily check after it prepares again, not the one run as it
ends (The monthly refresh › When), held while the pilot is in the sim as a refresh is. app-shell starts the sim link once preparation at start
has ended, succeeded or failed, so an import made at start never shares the server with the sim
link's samples, and the refresh's hold needs no exception for it.

**Preparing again.** A preparation that a daily check repeats after a failure runs steps 2 to 4 again —
seeding, downloading what an import needs, importing into empty tables — and reports in `/api/status`
the same way, its report replacing the earlier failure's. The `ready` flag, once set, stays set
(app-shell). Leftovers are cleared only at start, since within one server no other airport work runs
beside a preparation (one import at a time, below).

**Shutting down.** When the server shuts down while it is seeding, downloading or importing — at
start, in a refresh or on request — the step under way stops before app-shell's shutdown closes the
database, discarding that step's unfinished copy, download or staged rows. A list already put in place
keeps its download time, so each list, its time and the imported data are wholly as before that step
or wholly as after it. An import works in batches of at most about 100 ms (Importing), so it stops
within one, well inside the few seconds a shutdown is given.

Preparation, the daily checks and requested re-imports are run one at a time by `AirportWork`
([airport-data.ts:569-797](../../../src/server/airport-data.ts#L569-L797)), which app-shell's startup gives the database, the data and program
folders, the status report and the in-the-sim check.

### Airport downloads on or off

Whether the server may download airport lists by itself is an input of the server's (app-shell). On,
it downloads at start a list an import needs and the data folder lacks, and runs the monthly refresh.
Off, it does neither and prepares airport data only from the lists in the data folder and those it
seeds from the program folder. The input is on unless something turns it off: the installed app and a
copy run from source have downloads on, a source copy on the fake feed included, so a source copy's
own `data/` lists fill and stay current as the installed app's do. The desktop app's test mode turns
them off, so the lists a test folder was seeded with are never replaced, and so do the Vitest and
browser test harnesses. A requested re-import (below) downloads even with airport downloads off,
since someone asked for it, and tests of the download path answer it from fixtures.

### The monthly refresh

OurAirports keeps changing, so the server keeps its lists current by itself. In the installed app
this is the only refresh: it has no terminal command, and the page offers none.

- **When.** Checks run as preparation at start ends and every 24 hours after that.
  - When the last preparation — the one at start, or one a check repeated — failed, a check prepares
    again (Preparing again, above), except the check run as preparation at start ends: that one does
    nothing, so a failure waits a day rather than being retried at once.
  - Otherwise, with airport downloads on, a check starts a refresh when either list is missing from
    the data folder or its download time (Where the lists live) is more than 30 days ago.
  - Only one import runs at a time, so a check that falls due while preparation, a refresh or a
    requested re-import is waiting or under way does nothing. Every download being bounded, nothing
    under way can hold later checks for long.
- **What it does.** It downloads both lists under temporary names, imports them from there, and only
  once that import has succeeded puts them in place of the data folder's lists with their new download
  times. A refresh that fails or is cut short leaves the lists, their times and the imported data as
  they were, and the next daily check tries again. Like every re-import it keeps the airports that
  hops reference ([Airports that leave the dataset](#airports-that-leave-the-dataset)).
- **Held while the pilot is in the sim.** A refresh, or a preparation a check repeats, does not start
  while this server's sim link is connected — in the sim's menus, at the gate, flying in casual mode
  or not — or while the tracker reports a leg in progress, a leg restored at server start and still
  waiting for the sim included; it starts as soon as neither holds. One already under way when either
  comes to hold stops before it replaces any airport data, discarding what it downloaded, and starts
  again from the beginning once neither holds. Downloading and importing take the disk, processor and
  bandwidth MSFS uses to stream scenery, and a refresh is never urgent (the HLD's "Out of the pilot's
  way while flying"). On the fake feed (live-tracking's synthetic samples) no sim link is ever
  connected, so only a leg the feed drives holds a refresh.
- **What the server cannot see.** The server knows its own sim link and tracker, nothing wider.
  - Not the desktop shell's "the sim is in use" (an MSFS process running for this account), so a
    refresh can start while MSFS is still loading, before its SimConnect answers.
  - Not a flight another copy is tracking. A copy run from source beside the installed app links to
    the sim only when started for it (live-tracking's sim modes); off or on the fake feed it checks no
    sim-link claim, so its own refresh can run while the pilot flies with the installed app.

  Both are accepted: a refresh comes at most once a month, is a short download and an import that
  keeps the server answering, and in the first case stops as soon as the link connects; the second
  happens only while the developer has a source copy running.
- **Where the hold comes from.** Airports does not read the tracker. The server's startup (app-shell)
  hands the refresh a check that reports whether the pilot is in the sim — this server's sim link
  connected, or a leg in progress, both from live-tracking's status — and tells it whenever that
  changes, so airports keeps no dependency on live-tracking.

### Requested re-imports

- `npm run import-airports` re-imports both lists into a copy run from source's database, downloading
  any missing file first, or both with `--fresh`
  ([scripts/import-airports.ts](../../../scripts/import-airports.ts)). It is a development command,
  run in a process of its own and so outside the server's one-import-at-a-time rule; the installed
  app refreshes by itself.
- `POST /api/airports/reimport[?download=1]` re-imports from the files on disk, downloading both first
  with `download=1` ([routes.ts:108-117](../../../src/server/routes.ts#L108-L117)), and answers
  `409 "airport data is already being imported"` while another import is under way. The page has no
  control for it.

Both start straight away, whatever the sim is doing: someone asked for them.

### Importing

- **The server keeps answering.** An import reads the list and writes its rows in batches, each
  holding the server for no more than about 100 ms, yielding between them, so the server keeps
  answering requests and taking the sim link's samples while it runs. Samples are stamped as they
  arrive, once a second, so a batch that long delays none by more than a fraction of its interval.
  The new rows go into staging tables; the airport data the server had stays in use until the new
  lists have been read and checked, and they then replace it in one short transaction, so readers
  see either the old lists or the new ones, and a failure before that moment leaves the old ones
  unchanged ([airport-data.ts:395-467](../../../src/server/airport-data.ts#L395-L467), [airport-data.ts:469-524](../../../src/server/airport-data.ts#L469-L524)). The swap empties the airports table in one step
  and builds its indexes again in one pass each, which keeps it to a few hundred milliseconds for
  OurAirports' lists.
- **Airports** ([airport-data.ts:331-357](../../../src/server/airport-data.ts#L331-L357)): each import
  replaces every row but those kept below. Rows of type `closed` and rows without numeric coordinates
  are skipped; blank text fields become null; a blank elevation is null.
- **Runways** ([airport-data.ts:359-393](../../../src/server/airport-data.ts#L359-L393)): each import
  replaces every row but those of airports kept below. Rows without an airport ident are skipped. Length and
  width are rounded, and blank or non-positive values are null. `lighted`/`closed` are 1 only for
  `"1"`. Each end's heading is the CSV's true heading normalised to 0–360, else derived from a
  two-digit runway number (`16L` → 160°, `36` → 0°), else null; a missing high-end heading is the
  low end's + 180°.
- A missing required CSV column fails the import with the file and column named
  ([airport-data.ts:408-417](../../../src/server/airport-data.ts#L408-L417)). The CSV reader handles quoted
  fields, doubled quotes, embedded commas and newlines, and CRLF or LF line ends.

### Airports that leave the dataset

Hops store airport idents, so a hop row survives any re-import. What depends on the airport row
itself does not: the map cannot place a hop whose airport is missing, the planner cannot start
from it, and editing the hop fails because its codes no longer resolve. Airports most often leave
the dataset by being marked `closed`, which the import skips.

A re-import keeps the last-known record and runways of every airport that a hop references and that the new lists omit or mark closed. Such an
airport is flagged as no longer listed. It still resolves by code — so its hops draw, plan and edit
as before — but it is not offered as a planner candidate or chosen as a nearest airport, and its
popup says "No longer listed by OurAirports". The flag is the airports table's `unlisted` column,
set in the swap ([airport-data.ts:469-524](../../../src/server/airport-data.ts#L469-L524)); an airport
the lists bring back is listed again, and one no hop references any more is dropped at the next
re-import.

### Surface classes

OurAirports surfaces are free text ("ASPH-G", "TURF-F", "PIÇARRA"…). Each runway is also given one
of seven classes — paved, grass, gravel, dirt, water, snow, unknown — by testing the upper-cased
text against token lists in that order, first match winning; single letters G, S, C and D map to
grass, dirt, paved and dirt ([airport-data.ts:276-291](../../../src/server/airport-data.ts#L276-L291)).

### Runway summary

After every runway import the per-airport summary `airport_rwy` is rebuilt from **open** runways
only: longest length, widest width, count, the distinct surface classes, whether any is paved,
whether any is lit, and the distinct rounded headings
([airport-data.ts:506-512](../../../src/server/airport-data.ts#L506-L512)). Every airport query LEFT JOINs
it, so an airport without open runways reads as count 0 and not paved or lit
([airports.ts:82-86](../../../src/server/airports.ts#L82-L86)). The summary is what search
results, planner candidates and map dots carry; full runway lists are attached only where needed.

## Finding Airports

**By code.** A code is trimmed, upper-cased and matched against the ident, ICAO, GPS, IATA and local
codes, preferring an ident match, then ICAO, then GPS, then the rest
([airports.ts:88-96](../../../src/server/airports.ts#L88-L96)). This is the resolution the
logbook relies on to store canonical idents. `GET /api/airports/:code` returns the airport with
all its runways, open first and longest first, or `404 "airport not found: X"`
([routes.ts:73-77](../../../src/server/routes.ts#L73-L77), [airports.ts:125-127](../../../src/server/airports.ts#L125-L127)).

**Search.** A blank query returns nothing. Otherwise codes are prefix-matched and name and city
substring-matched; results rank exact code matches first, then code prefixes, then name matches,
then by class (large, medium, small, seaplane base, heliport, other), then by name
([airports.ts:98-118](../../../src/server/airports.ts#L98-L118)). `GET /api/airports/search`
caps results at 1–50, default 12 ([routes.ts:67-71](../../../src/server/routes.ts#L67-L71)).

**Airport input** — the code box used by the hop form, the pending-leg form and the planner's From
field ([AirportInput.tsx](../../../src/client/components/AirportInput.tsx)):

- Typing two or more characters searches 120 ms after the last keystroke (10 results), shown as a
  dropdown of ident, name and "city, country". Only results for the latest text are meant to show;
  today a slow earlier response can replace newer results ([AirportInput.tsx:64-73](../../../src/client/components/AirportInput.tsx#L64-L73)).
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
([airports.ts:381-419](../../../src/server/airports.ts#L381-L419)). The tracker uses it with a
5 nm radius. It is meant to work across the 180° meridian like the planner's search does; today
its search box does not wrap, so near the meridian airports on the far side are missed.

**Geodesy.** Great-circle distance (Earth radius 3440.065 nm) and initial bearing
([airports.ts:302-313](../../../src/server/airports.ts#L302-L313)) are shared by the planner and
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
- **Links**: Wikipedia, the official site when it has a usable address (below), SkyVector, and
  aviationweather.gov's decoded METAR/TAF page when the airport has a station.
- **Hosted content** from other segments when passed in: the planner's leg line, flags, terrain
  check and "Use as next destination"; simbrief's dispatch link.

**Where links open.** Every link the popup shows itself, the photo's included, asks for a new window
(`target="_blank"`); the links in hosted content are specified by their owners. A browser opens it in
a new tab; the desktop app's window, installed or in test mode, opens no window of its own and sends
the address to the pilot's default browser (desktop shell). The page does nothing of its own for
that, so it behaves the same in a browser tab and in the window.

**The official site.** OurAirports' `home_link` is free text, taken with surrounding whitespace
trimmed. An `http` or `https` address, its scheme in any case, is linked as it is. A value with no
scheme that begins with a host name — labels of letters, digits and hyphens joined by dots, at least
two of them, optionally followed by `/` and a path, with no spaces, such as `www.example.org/en` — is
linked with `https://` put in front. Anything else — another scheme such as `mailto:` or
`javascript:`, a bare word, a value with spaces — shows no official-site link. A link without a
scheme would resolve against the page's own address: a browser would open the app's own page in a new
tab, and the desktop app's window, installed or in test mode, refuses a new window on its own origin,
so the link would do nothing. (Intended; today the raw value is linked,
[AirportPopup.tsx:158-159](../../../src/client/components/AirportPopup.tsx#L158-L159).)

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
  ([airports.ts:221-295](../../../src/server/airports.ts#L221-L295)).
- **Cache size.** A server that runs for weeks in the tray would otherwise keep every station it was
  ever asked about. Each time fetched reports are stored, entries more than 5 minutes old are dropped,
  so the cache holds only the stations asked about in the last 5 minutes. (Intended; today an expired
  entry stays until its station is asked about again,
  [airports.ts:262-289](../../../src/server/airports.ts#L262-L289).)
- **API.** `GET /api/metar/:icao` (400 unless 4 letters/digits; 404 "no current METAR for X") and
  `GET /api/metars?ids=` (non-4-character ids dropped; 400 when none remain or more than 500)
  ([routes.ts:88-106](../../../src/server/routes.ts#L88-L106)).
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
([airports.ts:162-203](../../../src/server/airports.ts#L162-L203), [routes.ts:79-86](../../../src/server/routes.ts#L79-L86)).
Summaries are cached in `wiki_cache` for 30 days. An airport without a link, or whose link is not a
wikipedia.org article, has no summary (404). A failed refresh returns the stale cached summary
when one exists; today that fallback covers an HTTP error status but not a network error or
timeout, which fails the request. The page loads the photo straight from Wikimedia, as it loads map
tiles from their hosts.

## API

| Method | Path | Behaviour | Errors |
|---|---|---|---|
| GET | `/api/airports/search?q=&limit=` | Ranked search, 1–50 results (default 12), with runway summary | — |
| GET | `/api/airports/:code` | One airport by any code, with its runways | 404 |
| GET | `/api/airports/:code/wiki` | Cached Wikipedia summary | 404 no airport / no article; 500 fetch failed without cache |
| GET | `/api/metar/:icao` | Latest METAR | 400 bad code; 404 none; 500 upstream |
| GET | `/api/metars?ids=A,B` | Up to 500 stations; unreported ones null | 400; 500 upstream |
| POST | `/api/airports/reimport[?download=1]` | Re-import (optionally re-download) both lists → counts | 409 another import under way; 500 |

Airport preparation's progress and outcome are reported in `GET /api/status`, whose shape is
app-shell's.

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Airport data source | OurAirports CSVs, kept in the data folder and imported into the local database | The sim's own navdata; a commercial airport API | [inferred] Free, worldwide and keyless, with runways, codes and Wikipedia links in one dataset; works offline once imported. The sim's database is not readable from outside it. |
| When airport data is prepared | After the server listens and its logbook start-up work is done, before the sim link starts (app-shell's order), in steps that keep `/api/status` answering with progress | Before the server listens; beside the sim link, in no set order | The import writes to the logbook's database, so it follows the logbook's opening and upgrade. A server that cannot answer until a first run's import ends leaves the desktop shell's window on its start screen with nothing to say, and an offline first run that ends the server would only be restarted to fail again. One fixed order is simpler to reason about, and with the sim link started after it the import's batches never compete with the sim link's samples for the server's attention. |
| What preparation downloads | Only a list an import needs that the data folder still lacks after seeding; a list missing when there is nothing to import is left to the monthly refresh | Every list still missing after seeding | The sim link starts only once preparation has ended, so a download there could hold it back for up to 10 minutes a list; and offline or with downloads off, a copy whose airport data is complete would report a failed preparation. The refresh, held while the pilot is in the sim, brings the list back. |
| A failed preparation | Ends preparation without ending the server; the sim link starts anyway; the next daily check prepares again, not the check run as preparation ends | Ending the server; retrying at once in a loop | The pilot's flights matter more than airport data: a server that ends cannot track, and a supervised one would only be restarted into the same failure. A failure that lasts — offline, a damaged list — would make an immediate retry loop spin. |
| A new data folder's lists | Seeded from the lists shipped in the program folder | Downloaded at the first start | A first run needs no connection, and OurAirports being unreachable that day costs nothing. A release's lists are at most a few months old, and the monthly refresh counts from their own download time. |
| Which lists are seeded | Only those the data folder lacks, at every start, any list already there kept | Every list replaced by the program's at each update; only a data folder that is new; a data folder's list replaced when the program's is newer | A data folder's lists may be newer than the program's, after a refresh; a test puts its fixture lists in place before the first start and must keep them; and a list deleted by hand comes back without a download. Fixture lists carry no download time and count from their file dates, so comparing ages could replace them; the monthly refresh brings an older list up to date anyway. |
| Recording a list's download time | A `.downloaded` file beside each list holding an ISO 8601 UTC date-time ending in `Z`; the list's last-modified time when there is none, or when it is malformed or later than now | The file's last-modified time alone; a row in the database | The time travels with the list wherever it is copied — from the build into the program, from the program into a data folder — whereas a file's times can be reset by a copy or an installer, and a database row would not travel with the seed lists at all. Falling back on the file's time keeps lists from before times were recorded from all being downloaded again at once. A time later than now, written by a machine whose clock ran ahead, would keep the refresh from falling due. |
| Turning downloads off | An input of the server's, on by default, off in the desktop app's test mode and the test harnesses; requested re-imports unaffected | Leaving downloads to the fetch guard; inferring it from test mode or the fake feed | A test run never replaces the lists it was given, and a packaged smoke test, which has no fetch guard, never reaches OurAirports. An input fits the server's other explicit inputs (app-shell) and keeps airports from depending on how the server was started; a copy run from source on the fake feed keeps its lists current like any other source copy. A requested re-import is asked for, and its own tests answer it from fixtures. |
| Keeping the data current | An automatic refresh once a list is missing or its download over 30 days old, checked as preparation at start ends and every 24 hours after; the installed app's only refresh | Manual only; refresh on every start; a "Refresh airport data" control in the page or the tray | The dataset keeps changing and a month is fresh enough for airports. A control would ask the pilot to remember something the app can do by itself, and would be one more thing to keep out of the way while flying; the requested re-imports stay for development. |
| When a refresh waits | While this server's sim link is connected or a leg is in progress; one under way stops before it replaces anything | Only while a leg is in progress; also while casual mode is on with the link down; the desktop shell's wider "sim in use"; also while another copy holds the PC-wide sim-link claim | In the sim's menus, at the gate or flying in casual mode the pilot is still in the sim, and a download and import there take disk and bandwidth MSFS needs. Casual mode with the link down means MSFS has gone, so nothing is left to disturb. The server sees only its own link and tracker; a refresh started while MSFS is still loading is accepted, being short and stopping when the link connects. A copy run from source that is off or on the fake feed checks no claim, so waiting on the claim would cover only a source copy started for the sim; a source copy's monthly refresh during the installed app's flight is accepted instead. |
| Where the refresh learns the sim's state | A check and change notices handed to it by the server's startup (app-shell), drawn from live-tracking's status | Reading the tracker directly | live-tracking relies on airports (nearest airport); airports reading the tracker would make the two depend on each other. |
| Bounding downloads | Failed after 60 s with no data or 10 minutes in all | No limit; one overall limit | In a server that runs for weeks a stalled download would hold that refresh, and every later one, until the server restarts. The no-data bound ends a dead connection quickly; the overall bound ends one that trickles. |
| Writing lists and seeds | Under a temporary name, put in place only when complete; leftovers cleared at the next start | Writing in place | A list cut short by a failure, a shutdown or a crash would otherwise stay in the data folder, where seeding keeps any list already there and an import would read it as the whole dataset. |
| How an import keeps the server answering | Batches of reading and writing, each holding the server for at most about 100 ms, into staging tables, yielding between them, then one short transaction replacing the live data | One synchronous transaction (holding the server for seconds); a worker thread with a database connection of its own | `/api/status` must answer and report progress during a first run's import, and samples and requests keep arriving during a requested one; a bound on each batch also bounds how long a shutdown waits for an import to stop. A second connection's long write transaction would block the tracker's checkpoints for its whole length; staging keeps every write short, and readers see the old lists or the new ones, never a mix. |
| Closed airports and runways | Closed airports are not imported; closed runways are kept but left out of the summary | Import everything; drop closed runways | [inferred] A closed airport is never a destination; a closed runway is still worth listing in the popup but must not make a field look usable. |
| Airports that leave the dataset | Keep the last-known record of any airport a hop references, flagged as no longer listed | Drop it with the rest; delete or rewrite the hops | Logged hops must stay intact — drawable, plannable from and editable — whatever happens to the source data. |
| Surface text | Normalised into seven classes by ordered token match; raw text kept | Show raw text only | Planner filters (paved only), map colors and legends need a small fixed set; OurAirports surfaces are inconsistent free text. |
| Runway summary | A per-airport table rebuilt on each runway import, LEFT JOINed into every airport query | Aggregate runways on every query | [inferred] Search, planner and map queries touch thousands of airports; a precomputed summary keeps them cheap. |
| Runway headings | CSV true heading, else derived from the runway number | Leave unknown | [inferred] Crosswind checks need a heading for every runway that has a number. |
| Code resolution order | Ident, then ICAO, then GPS, then IATA/local | First match in any column | [inferred] An ident is unique; IATA and local codes can collide across countries. |
| Nearest-airport choice | Distance plus a class handicap (0 / 0.3 / 0.8 / 2 nm) | Pure distance | A main field should win over its own heliport or an adjacent strip when the aircraft is at the main field's runway. |
| Popup data | Fetched only while the popup is open | Prefetch with map data | [inferred] Map state stays small and fast; most airports are never opened. |
| Outside links | A new window (`target="_blank"`), which a browser opens as a tab and the desktop app's window, installed or in test mode, sends to the default browser | A bridge from the page asking the desktop shell to open links | The page stays a web page that works the same in a browser tab and is covered by the browser tests (HLD tenet). |
| The official-site link | Trimmed; `http`/`https` (any case) as given; `https://` added to a scheme-less value that starts with a host name; nothing otherwise | Linking the raw value; showing only `http`/`https` values | A raw scheme-less value resolves to the app's own address and does nothing in the desktop app's window; many OurAirports entries are written without a scheme, and `https://` reaches them. Other schemes are not an airport's site. |
| METAR caching | 5 minutes in server memory, null cached for unreported stations, expired entries dropped as new ones are stored; freshness 90 minutes on the client | No cache; persist in the database; a fixed-size cache | [inferred] Routine reports are hourly; a short cache keeps planner batches cheap without serving stale weather. Dropping expired entries bounds the cache by what was asked for in 5 minutes, however long the server runs. |
| Wikipedia caching | 30 days in the database, stale copy served when a refresh fails | Fetch every time | [inferred] Summaries rarely change; the cache keeps popups fast and works through outages. |

## Open Questions & Future Decisions

### Resolved

1. ✅ Airport data refreshes automatically once it is over 30 days old (see Decisions).
2. ✅ Airports a hop references are kept when the source data drops them (see Airports that leave
   the dataset).
3. ✅ The nearest-airport class head start (0 / 0.3 / 0.8 / 2 nm) stays as it is.
4. ✅ A new data folder is seeded from the lists shipped with the program, so the installed app's first
   run needs no connection (see Preparing airport data at start).

### Deferred

1. **Airports the sim has and OurAirports lacks** (or knows by another ident) cannot be named by
   the tracker or typed in a form. Not yet encountered; revisit if it happens, for example with
   user-defined airports.
2. **Search wildcards** — `%` and `_` typed by the user act as SQL wildcards
   ([airports.ts:117](../../../src/server/airports.ts#L117)).
3. **One-digit runway numbers** ("9/27") get no derived heading ([airport-data.ts:374](../../../src/server/airport-data.ts#L374)).
4. **Old databases keep empty link columns** — preparation at start re-imports runways missing
   headings but not airports missing `wikipedia_link`/`home_link` ([airport-data.ts:715](../../../src/server/airport-data.ts#L715));
   the monthly refresh fills them within a month.
5. **METAR formatting is written twice** — the popup and the tooltip line format wind and ceiling
   separately ([AirportPopup.tsx:220-230](../../../src/client/components/AirportPopup.tsx#L220-L230),
   [metar.ts:54-63](../../../src/client/metar.ts#L54-L63)).
6. **One failed METAR batch fails the whole request**, even when earlier batches succeeded
   ([airports.ts:274-288](../../../src/server/airports.ts#L274-L288)).

## References

- HLD: [docs/high-level-design.md](../../high-level-design.md) — Approach (free, public data), System
  Design (the data folder, the server's start), Segments → airports, Rules every segment follows
  (airport codes), Tenets (out of the pilot's way while flying; the page stays a web page)
- Code: [src/server/airport-data.ts](../../../src/server/airport-data.ts) (the lists, their download
  times, downloads, seeding, the staged import and swap, `AirportWork`),
  [src/server/airports.ts](../../../src/server/airports.ts) (all but `planCandidates`, which
  belongs to planner), [src/server/routes.ts](../../../src/server/routes.ts) (airports section 65-117),
  [scripts/import-airports.ts](../../../scripts/import-airports.ts),
  [src/client/metar.ts](../../../src/client/metar.ts),
  [src/client/components/AirportInput.tsx](../../../src/client/components/AirportInput.tsx),
  [src/client/components/AirportPopup.tsx](../../../src/client/components/AirportPopup.tsx) (minus
  the planner's terrain block), [src/client/components/RunwayInfo.tsx](../../../src/client/components/RunwayInfo.tsx),
  [src/client/format.ts](../../../src/client/format.ts) (`airportTypeLabel`, `surfaceLabel`,
  `runwaySummary`, `airportWhere`), [src/server/db.ts](../../../src/server/db.ts) (`airports`,
  `runways`, `airport_rwy`, `wiki_cache`)
- Related designs: [app-shell](../app-shell/app-shell-design.md) (the server's start order and
  inputs — data folder, program folder, airport downloads — `/api/status` and its `ready` flag, the
  User-Agent, the shutdown order), [live-tracking](../live-tracking/live-tracking-design.md) (the sim
  link's state and the leg in progress, which the refresh waits on, handed over by app-shell's
  startup), [desktop](../desktop/desktop-design.md) (Relies On: seeding, download times, downloads
  off), [desktop shell](../desktop/shell/shell-design.md) (The Window: outside links; Relies On: the
  official-site link), [desktop distribution](../desktop/distribution/distribution-design.md)
  (Packaging: the seed lists and their download times)
- External: OurAirports data (davidmegginson.github.io/ourairports-data), aviationweather.gov
  METAR API, Wikipedia REST page summaries
- Consumers: logbook (code resolution), planner (summary, METAR categories, geodesy), live-tracking
  (nearest airport), tour-map (summary, METAR line, runway display), the desktop shell and
  distribution (seed lists, download times, downloads off, the popup's links)
