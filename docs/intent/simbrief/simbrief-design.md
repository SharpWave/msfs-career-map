---
parent: high-level-design
prefix: SB
---

# SimBrief

## Context and Design Philosophy

SimBrief is where the user plans the flight they are about to fly; the app does not replace it.
The app does three things with it: it opens SimBrief's dispatch page already filled in for a leg,
it imports the plan the user generated there and keeps it with the flight it belongs to, and it
draws that plan's route on the map.

The link to SimBrief is the user's alias or pilot ID, the app's only SimBrief setting, kept in the
server's `settings` table. SimBrief's fetcher needs no API key or login, so nothing else is
configured.

The page runs on the app's own origin — in the installed app's window, in a browser tab (on a copy
run from source or on the installed app's own address) and under the browser tests — and two things
follow for SimBrief. Its links out — the dispatch page, a plan's PDF, a link inside a plan — open
outside the app as a new window: a new tab in a browser, and from the installed app's window the
pilot's default browser, where their SimBrief and Navigraph sign-in lives (the desktop shell's
routing, DESK-SHELL-WIN-007). And a plan's OFP text, SimBrief's own HTML, is shown on that origin,
so the card shows it as text and layout only ([The OFP Text](#the-ofp-text)); the desktop app's
first release waits for that (DESK-DIST-REL-012).

This segment owns:

- the dispatch link for a leg ([client simbrief.ts](../../../src/client/simbrief.ts));
- SimBrief's aircraft type list ([server simbrief.ts](../../../src/server/simbrief.ts));
- the alias setting, fetching and parsing the latest OFP ([ofp.ts](../../../src/server/ofp.ts));
- briefings: archiving a plan whole, the current plan for the flight being flown, attaching and
  removing plans on logged hops, and when an archived plan is deleted
  ([routes.ts:589-721](../../../src/server/routes.ts#L589-L721));
- the SimBrief controls in the live card, the SimBrief card in the flight panel, and the route on
  the map ([LivePanel.tsx](../../../src/client/components/LivePanel.tsx) `SimbriefControls`,
  [FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx) `BriefingCard`,
  [BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx)).

It relies on: fleet for the aircraft's SimBrief type and livery, and the type field in the aircraft
form (FLEET-SIM-004); live-tracking for carrying the current plan into the hop or pending leg the
flight becomes (LIVE-HOP-001/002), and plans into a brought-in logbook (LIVE-SAVE-008,
LIVE-SAVE-010, LIVE-SAVE-011); and tour-map for world-copy placement and layer order
(MAP-PATH-005). The planner, which relies on this segment, offers the dispatch link (PLAN-LIST-008,
PLAN-DRAW-005), and the SimBrief card sits in the flight panel.

## Dispatch Link

A link to `https://dispatch.simbrief.com/options/custom` with the leg pre-filled
([simbrief.ts:7-42](../../../src/client/simbrief.ts#L7-L42)):

- `orig` and `dest`: each airport's ICAO code when it has one, else its OurAirports ident;
- `type`: the aircraft's SimBrief type, when set;
- `reg`: the aircraft's livery when it looks like a registration;
- no cruise level, so SimBrief chooses one itself.

"Looks like a registration" is meant to need a digit or a hyphen (N6017Y, G-ABCD, D-EABC). Today
any word of three to seven letters or digits passes, so liveries such as "Asobo" or "Default" are sent as
registrations ([simbrief.ts:15-18](../../../src/client/simbrief.ts#L15-L18)).

The planner offers the link on each candidate (**SB**) and in a candidate's popup ("SimBrief",
whose hover text names the leg and type, or suggests setting a type on the aircraft). It opens
outside the app, as the planner's specs say (PLAN-LIST-008).

## Aircraft Type List

`GET /api/simbrief/aircraft` serves SimBrief's published list of aircraft types (ICAO designator and
name) for the aircraft form's suggestions ([simbrief.ts](../../../src/server/simbrief.ts)):

- fetched from `inputs.list.json` with a 10 s timeout, keeping designators of 2–6 letters or
  digits, sorted, and refusing a list of fewer than 20 as broken;
- cached in the database for a day;
- when SimBrief cannot be reached, the last cached list however old, else a built-in list of 35
  common types; the response says which (`simbrief`, `cache`, `fallback`).

The aircraft form also carries its own shorter list for when the server cannot be reached
([simbrief.ts:44-96](../../../src/client/simbrief.ts#L44-L96)).

## Alias and Fetching the Plan

**Alias.** `simbrief_username` in the `settings` table — a Navigraph alias or a numeric pilot ID.
`GET /api/settings` reads it; `PUT /api/settings` sets it, a blank value clearing it
([routes.ts:589-613](../../../src/server/routes.ts#L589-L613)).

**Fetching** ([ofp.ts:65-84](../../../src/server/ofp.ts#L65-L84)). The latest OFP comes from
`xml.fetcher.php?userid=` (all digits) or `?username=`, with `json=v2`, and a 20 s timeout.
SimBrief's own error ("Unknown UserID…") is passed on as `502 "SimBrief: …"`; with no alias set the
request is `400 "set your SimBrief alias or pilot ID first"`. This request and the type list's carry
the server's User-Agent (APP-API-005, app-shell). Today the plan fetch sends none and the type list
an old one with no contact ([ofp.ts:72](../../../src/server/ofp.ts#L72),
[server simbrief.ts:5](../../../src/server/simbrief.ts#L5)).

**Parsing** ([ofp.ts:86-160](../../../src/server/ofp.ts#L86-L160)) reduces the OFP to a summary:
OFP and static ids, generation time, airline, flight number, callsign; aircraft type, name and
registration; origin and destination with planned runways; the first alternate; the route string;
route distance (or great-circle distance); initial cruise altitude; time en route in minutes; fuel
(units, ramp, takeoff, landing, burn); weights (passengers, cargo, payload, ZFW, TOW, LDW); the PDF
link; and the navlog fixes with position, altitude, airway and SID/STAR flag. It accepts both the
`v2` shape and the older all-strings one, since SimBrief has changed it before; missing or
non-numeric values become unknown.

## Briefings

A **briefing** is an imported plan archived whole: the summary, the OFP's HTML text and the raw OFP,
with the hop and aircraft it belongs to ([db.ts:142-155](../../../src/server/db.ts#L142-L155)).

**Preview, then confirm.** A plan is never stored without the user seeing it first: the latest
plan in SimBrief may be for a different flight. Both places that import a plan — the live card and
the flight panel — preview the latest plan without storing it (`GET /api/simbrief/latest`), then
**Use this plan** stores exactly the plan that was previewed, identified by its OFP id. If SimBrief's
latest plan has changed in between, the request is refused (`409`) and the newer plan is previewed
for confirmation instead. **Cancel** stores nothing.

Today **Use this plan** in the live card fetches the latest again and stores whatever it gets
([LivePanel.tsx:72-76](../../../src/client/components/LivePanel.tsx#L72-L76), [routes.ts:675-682](../../../src/server/routes.ts#L675-L682)),
and the flight panel attaches the latest plan with no preview at all.

**For the flight being flown** (live card). A confirmed plan becomes the tracker's current plan
(`POST /api/tracker/briefing`); **Remove** clears it (`DELETE /api/tracker/briefing`). The current
plan goes with the next leg the tracker logs or keeps as pending (LIVE-HOP-001/002). Replacing or
removing a current plan that no hop uses deletes it. While the tracker is in casual mode
(live-tracking) no plan can be made current: the card offers no import, and
`POST /api/tracker/briefing` is refused with 409. A plan made current before casual mode was
switched on stays, with **Remove**, and goes with the next leg logged after it.

**For a logged hop** (flight panel). **Attach my latest SimBrief plan** previews, and a confirmed
plan is linked to the hop (`POST /api/hops/:id/briefing`); **Remove** deletes it after "Remove the
SimBrief plan from this hop?" (`DELETE /api/hops/:id/briefing`).

Attaching to a hop that already has a plan is meant to replace it. Today the old plan stays in the
table still pointing at the hop, and `GET /api/hops/:id/briefing`, which falls back to any plan
pointing at the hop, returns it again once the new one is removed
([routes.ts:695-716](../../../src/server/routes.ts#L695-L716)).

**A pending leg** carries its plan until it is logged, or deletes it when discarded and no hop uses
it (LIVE-HOP-005).

**A brought-in logbook.** The tracker's current plan and pending legs' plans are rows of the logbook
they were made in. When a logbook is brought in from another data folder or a backup (app-shell),
live-tracking's merged checkpoint carries them into it, and no plan is ever kept as an id from the
logbook being replaced:

- the plans of the flying on this PC — its current plan and its pending legs' plans — are copied
  whole into the brought-in logbook, and the current plan and those legs name the copies
  (LIVE-SAVE-008);
- the brought-in logbook's own pending legs keep their plans, already rows of that logbook
  (LIVE-SAVE-010);
- its leg in progress, kept as a pending leg, takes its current plan with it; that plan is otherwise
  dropped unless a hop uses it (LIVE-SAVE-011).

A carried plan is then like any other: replacing or removing the current plan deletes it when no hop
uses it (SB-CUR-001, SB-CUR-002), and a pending leg's plan goes with the leg when it is logged or is
deleted when it is discarded (LIVE-HOP-005).

**Deleting hops and aircraft.** A plan is deleted with its hop, whether the hop is deleted alone or
with its aircraft's tour; a plan on no hop (the tracker's current plan, a pending leg's) stays,
with its aircraft link cleared when the aircraft goes (FLEET-REC-016). Nothing in the app can show
a plan no hop points to, and each holds a whole OFP. Today a deleted hop's plan stays in the table
with its hop link cleared.

| Endpoint | Does | Errors |
|---|---|---|
| `GET /api/simbrief/latest[?username=]` | Latest plan's summary, not stored, with whether it has OFP text | 400 no alias; 502 SimBrief's error |
| `POST /api/tracker/briefing` | `{ofp_id}`: store the previewed plan as the current plan → tracker status | as above; 409 latest plan changed; 409 casual mode is on |
| `DELETE /api/tracker/briefing` | Clear the current plan | |
| `GET /api/briefings/:id` | A stored plan: summary, OFP text, hop and aircraft | 404 |
| `GET /api/hops/:id/briefing` | The plan the hop links to | 404 no hop or no plan |
| `POST /api/hops/:id/briefing` | `{ofp_id}`: attach the previewed plan to the hop, replacing its old one → 201 + plan | 404 hop; 400 / 502 as above; 409 latest plan changed |
| `DELETE /api/hops/:id/briefing` | Delete the hop's plan → 204 | 404 hop |

The `ofp_id` checks and the `409` are intended; today both `POST`s store whatever plan is latest.

## SimBrief Controls in the Live Card

([LivePanel.tsx:29-162](../../../src/client/components/LivePanel.tsx#L29-L162)), shown while the sim is
connected with an aircraft. The first three states are for importing a plan, and appear only while
casual mode is off; in casual mode the controls show only a current plan, if there is one.

- **No alias** (or changing it): a "SimBrief alias or pilot ID" field with **Save** (Enter saves)
  and **Cancel** when changing.
- **Ready**: **Import SimBrief plan** and the alias, which can be clicked to change it.
- **Preview**: "Latest SimBrief plan · callsign", "ORIG/RWY → DEST/RWY", then aircraft type and
  registration, passengers, distance, time en route and when it was generated; **Use this plan**
  and **Cancel**.
- **Current plan**: "Plan ORIG → DEST · callsign · N pax" with **Remove**.

## SimBrief Card in the Flight Panel

([FlightPanel.tsx:230-343](../../../src/client/components/FlightPanel.tsx#L230-L343)) The app loads
the full plan for whatever the panel shows — a hop's plan, or the current plan for the live leg —
and reloads it after a change ([App.tsx:179-196](../../../src/client/App.tsx#L179-L196)). For a
pending leg it is meant to show that leg's plan too (PANEL-OPEN-002).

- **No plan**: "No plan attached to this flight.", and for a hop **Attach my latest SimBrief plan**,
  which shows the same preview as the live card with **Use this plan** and **Cancel**.
- **Plan**: Flight (callsign, else airline and flight number, else "—"; aircraft type and
  registration); Plan ("ORIG/RWY → DEST/RWY", "alt ALTN"); Route; "Cruise / dist / ETE"; Payload
  (passengers, cargo, TOW in the plan's units); Fuel (burn, ramp, landing); Generated.
- **Show OFP / Hide OFP** opens the plan's OFP text ([below](#the-ofp-text)) in a light, scrolling
  box; **PDF**, styled like the buttons beside it, opens the plan's PDF outside the app, in a new
  window — a new tab in a browser, the pilot's default browser from the installed app's window — and is
  offered only for an address a link inside the plan could keep ([Links](#the-ofp-text)); for a hop,
  **Remove**.

Today, with neither callsign nor airline the Flight line is blank rather than "—"
([FlightPanel.tsx:285](../../../src/client/components/FlightPanel.tsx#L285)), and **PDF** is offered
whatever its address ([FlightPanel.tsx:329-333](../../../src/client/components/FlightPanel.tsx#L329-L333)).

### The OFP Text

The OFP text is SimBrief's HTML, and the page shows it on its own origin, in a browser tab or the
installed app's window. There, anything in it would act as the page: the server accepts changes to
the logbook from its own origin (app-shell), the page reads its address's fragment to open a hop or
pending leg (app-shell's hand-off; PANEL-OPEN-009 and PANEL-OPEN-010 in flight-panel), and the
page's styles and names are shared with whatever is inserted into it. So the card shows a plan as
text and layout only: nothing in it runs, loads, navigates the page or is drawn outside its box.
What follows holds as one — the cleaning (SB-CARD-006), the links it keeps (SB-CARD-009), nothing
loading (SB-CARD-010) and the box (SB-CARD-011) — since each closes a way the others leave open,
and the desktop app's first release waits for all of it (DESK-DIST-REL-012).

- **Cleaned as shown.** DOMPurify, configured as an allowlist, cleans the HTML each time the card
  shows it, so every stored plan is shown under the same rules whenever it was imported; the archive
  keeps SimBrief's HTML as it came ([Briefings](#briefings)).
- **Kept:** the text; `div`, `span`, `p`, `br`, `hr`, `pre`, `h1`–`h6`, `b`, `strong`, `i`, `em`,
  `u`, `s`, `small`, `big`, `sub`, `sup`, `code`, `tt`, `font` and `center`; lists (`ul`, `ol`,
  `li`, `dl`, `dt`, `dd`); tables (`table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`,
  `col`, `colgroup`); and links (below). Attributes: `style` (below), `title`, and the table layout
  attributes (`align`, `valign`, `width`, `height`, `colspan`, `rowspan`, `border`, `cellpadding`,
  `cellspacing`). `font` and `center` keep no attributes of their own: the box sets the type and
  colours, so a `font`'s `color`, `size` or `face` would have no effect.
- **Removed:** everything else — scripts and every event-handler attribute; `<style>` and `<link>`,
  whose rules would apply to the whole page; `<base>`, which would re-point every relative address
  the page uses, `/api/` included; `<meta>`, whose refresh would navigate the page; forms and their
  controls, which could send to the server as the page; frames, `object` and `embed`; SVG and
  MathML; every `id`, `name` and `class`, which could shadow the page's own names or take on its
  styles; and every `data-*`, `aria-*` and `role` attribute, which the page's own scripts and styles
  select on (`[role=menu]`, `[data-handoff-focus]`) and which DOMPurify keeps unless told not to.
  The text inside a removed layout element stays; the contents of a script, style sheet, frame,
  object, SVG or MathML go with it.
- **Links.** A link inside the plan is judged as the page would follow it: its address is resolved
  against the page's own address, and it stays a link only when the result is an http or https
  address with a host, on another origin than the page's own. The link then carries that resolved
  address, re-serialised, so the address followed is the one judged — an address read on its own can
  name another host where the page would resolve it to its own origin (`http:/api/hops`), or be
  read differently once the browser trims its spaces, drops its tabs and lowers its scheme's case
  (` HTTPS://…`, a `javascript:` with a tab inside). It opens in a new window (`target="_blank"`, `rel="noopener noreferrer"`): a new
  tab in a browser, the pilot's default browser from the installed app's window (the desktop shell's
  routing, DESK-SHELL-WIN-007). Any other link is shown as its text alone: a relative one would load
  the page's own origin in the page's place, losing anything half typed; a fragment-only one would
  change the page's own fragment; one on the page's own origin would open a second copy of the page,
  which the installed app's window refuses; and no other scheme (`javascript:`, `data:`, `file:`,
  `mailto:`) is an address a plan needs. **PDF** follows the same rule.
- **Nothing loads.** Images and media are removed, and so is every other attribute that names an
  address, such as a table cell's `background`, a link's own `href` aside. An inline style that
  names an address — `url(…)`, `image-set(…)` or `-webkit-image-set(…)`, in any case — or holds a
  CSS escape (`\`), which could spell one, is removed whole rather than having the address cut out of
  it. Showing a plan makes no request.
- **Kept in its box.** Every kept inline style has `!important` taken off its declarations, by the
  browser's own style parsing, so no style in the plan overrides the box's: the box sets its own
  monospaced type and colours over the plan's with rules marked important, which an important inline
  declaration would beat. The box clips the plan to its area, positioned content included (CSS paint
  containment), so no inline style can draw over the rest of the page.

Today the OFP text is inserted as it comes
([FlightPanel.tsx:341](../../../src/client/components/FlightPanel.tsx#L341)), in a box that already
sets its own type and colours over the plan's, except where an inline style is marked important, and
clips only what flows inside it ([styles.css](../../../src/client/styles.css) `.ofp-html`).

## Route on the Map

([BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx), [App.tsx:203-213](../../../src/client/App.tsx#L203-L213))

- Which routes: the current plan of the flight being flown, in the bound aircraft's color (white
  when unbound), and the plan of the flight open in the panel when it is a different plan, in that
  hop's aircraft color.
- How: a thin dashed line in the color over a soft dark casing, under the flown paths
  (MAP-PATH-005); a dot at every navlog fix (larger for airports), whose tooltip gives the ident,
  the name when different, "via AIRWAY" unless direct, and the planned altitude or else the fix
  type.
- Where: on every world copy in view (MAP-GEO-014), placed fix to fix (MAP-GEO-015), so it lies
  along its flight on every copy and a route across the antimeridian is continuous on both sides
  ([BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx)).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Integration | Dispatch links out, latest-OFP import back, both keyless | SimBrief's API with a developer key; no integration | Nothing to sign up for, and the user plans in SimBrief as usual — the HLD's **Hand off to the specialists** and **Keyless and local**. |
| Identity | One alias or pilot ID setting | Per-aircraft accounts | One pilot flies the career. |
| Cruise level in links | Left to SimBrief | Pass the planner's cruise altitude | SimBrief's own choice uses winds and the route; the planner's altitude is only a timing assumption. |
| Archive | The whole OFP (summary, HTML, raw JSON) | Summary only | Nothing the plan said is lost, and new fields can be read later from the raw OFP. |
| Two OFP shapes | Parse `v2` and the older all-strings form | `v2` only | SimBrief has changed its output before. |
| Confirming the plan | Preview, then store exactly the previewed plan, in the live card and the flight panel alike | Attach the latest blindly; re-fetch on confirm | The latest plan in SimBrief may be for a different flight, or change between preview and confirm. |
| Plans of deleted hops | Deleted with the hop, including with an aircraft's tour | Keep as an archive | No screen shows a plan without a hop, and each holds a whole OFP. |
| One current plan | The tracker holds one and the next leg takes it | Match plans to legs by airports | Simple, and a plan whose airports differ from what was flown is still the plan that was briefed. |
| Unused plans | Deleted when replaced, removed or discarded before any hop uses them | Keep every import | Plans no hop points to cannot be seen anywhere in the app. |
| Type list | SimBrief's own list, cached a day, with a built-in fallback | A hand-kept list | Covers every type SimBrief knows; still works offline. |
| Showing the OFP text | SimBrief's HTML through an allowlist (DOMPurify), each time the card shows it | Inserting it as it comes; removing only scripts and event handlers; a cleaner of the card's own; a sandboxed frame; the browsers' own Sanitizer API; cleaning once at import and storing the result | The plan is shown on the page's own origin, where anything active acts as the page. An allowlist holds when SimBrief's markup changes, where a list of what to remove misses what it did not foresee (`<base>`, a `<meta>` refresh, a form). DOMPurify is maintained, widely used and made for this job, and behaves alike in a browser tab and in the installed app's window; a cleaner of the card's own would have to keep up with every way HTML can act. A sandboxed frame needs a document, styles and sizing of its own, and its links need popups let out of the sandbox; the Sanitizer API is not in every browser yet. Cleaning as shown applies the same rules to every stored plan, and the archive keeps the plan whole. |
| Links inside a plan | Links resolved against the page's own address and kept, in that resolved form, only when they reach an http or https address on another origin, opening in a new window; any other shown as text | Keeping links as they are, leaving the installed app's window to send them out; judging each address on its own and keeping it as written; removing every link | A relative link replaces the page with whatever its own origin answers, and a fragment-only one changes the fragment the page reads to open a hop or pending leg. The installed app's window sends only addresses off the page's origin to the default browser and loads its own origin in place, so it stops neither, and a browser tab has no such guard. An address judged on its own can name another host where the page resolves it to its own origin, so it is judged as the page resolves it and written back in that form. Links out are SimBrief's own and worth following, and a new window takes them out of the app. |
| Style sheets and loads in a plan | `<style>` and `<link>` removed; images, media and attributes naming an address removed; an inline style naming an address or holding a CSS escape removed whole; other inline styles kept without `!important`, inside a box that clips them | Scoping the plan's style sheets to its box; keeping https images; cutting only the offending declaration out of an inline style; removing colour, background and font declarations from inline styles | A style sheet applies to the whole page, and scoping one needs a CSS parser the card would own; so does cutting one declaration out of a style, where escapes and comments make the text hard to judge. SimBrief's OFP layouts are preformatted text with plain inline styles, and its PDF carries the charts. With nothing loaded, opening a plan contacts no one. Taking `!important` off every kept declaration lets the box's own rules win over any style without a list of properties to keep up with. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Open

*(none)*

### Deferred

1. **Registration test too loose** — any short word is sent as `reg` ([simbrief.ts:15-18](../../../src/client/simbrief.ts#L15-L18)).
2. **Use this plan fetches again** ([LivePanel.tsx:72-76](../../../src/client/components/LivePanel.tsx#L72-L76), [routes.ts:675-682](../../../src/server/routes.ts#L675-L682)).
3. **Re-attaching keeps the old plan** pointing at the hop, where `GET /api/hops/:id/briefing` can
   find it again ([routes.ts:695-716](../../../src/server/routes.ts#L695-L716)).
4. **Plans of deleted hops** stay in the table with nothing pointing to them.
5. **Attaching to a logged hop has no preview** — it takes whatever plan is latest
   ([FlightPanel.tsx:235-247](../../../src/client/components/FlightPanel.tsx#L235-L247)).
6. **OFP text shown as it comes**, on the page's own origin
   ([FlightPanel.tsx:341](../../../src/client/components/FlightPanel.tsx#L341)); the desktop app's
   first release waits for it shown as text and layout only (SB-CARD-006, SB-CARD-009 to 011;
   DESK-DIST-REL-012).
7. **Pending legs' plans** cannot be seen until the leg is logged.
8. **Two fallback type lists** — the server's built-in 35 and the form's own
   ([simbrief.ts:22-33](../../../src/server/simbrief.ts#L22-L33), [client simbrief.ts:44-96](../../../src/client/simbrief.ts#L44-L96)).
9. **PDF offered whatever its address; blank Flight line** with neither callsign nor airline
    ([FlightPanel.tsx:285](../../../src/client/components/FlightPanel.tsx#L285), [329-333](../../../src/client/components/FlightPanel.tsx#L329-L333)).
10. **The archived OFP is never read back** — `ofp` is stored but no endpoint returns it.

## References

- Code: [src/client/simbrief.ts](../../../src/client/simbrief.ts), [src/server/simbrief.ts](../../../src/server/simbrief.ts),
  [src/server/ofp.ts](../../../src/server/ofp.ts), [src/server/routes.ts](../../../src/server/routes.ts)
  (settings and briefings 589-721), [src/server/db.ts](../../../src/server/db.ts) (`briefings`,
  `settings`, `kv_cache`), [src/client/components/LivePanel.tsx](../../../src/client/components/LivePanel.tsx)
  (`SimbriefControls`), [src/client/components/FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx)
  (`BriefingCard`), [src/client/components/BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (panel plan loading, routes to draw),
  [src/client/styles.css](../../../src/client/styles.css) (`.ofp-html`, the OFP box)
- External: SimBrief `xml.fetcher.php`, `inputs.list.json`, dispatch page
- Consumers: planner (dispatch link), live-tracking (current plan), flight-panel (hosts the card),
  fleet (type list in the aircraft form), the [desktop design](../desktop/desktop-design.md) (a plan
  safe to show on the page's origin), the [desktop shell](../desktop/shell/shell-design.md) (The
  Window: a plan never asks for a new window on the page's own origin, SB-CARD-009; the window sends
  the card's new windows to the default browser) and
  [distribution](../desktop/distribution/distribution-design.md) (the OFP text shown as text and
  layout only gates the first release)
- Related: [app-shell](../app-shell/app-shell-design.md) (the server's User-Agent; changes refused
  from other sites' pages; bringing in a logbook, [Briefings](#briefings)), live-tracking (plans
  carried into a brought-in logbook, LIVE-SAVE-008, LIVE-SAVE-010, LIVE-SAVE-011)
- Library (planned): DOMPurify, for the OFP text
