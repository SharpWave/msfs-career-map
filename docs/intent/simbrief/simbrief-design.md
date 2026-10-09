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

The link to SimBrief is the user's alias or pilot ID, the only setting the app has. SimBrief's
fetcher needs no API key or login, so nothing else is configured.

This segment owns:

- the dispatch link for a leg ([client simbrief.ts](../../../src/client/simbrief.ts));
- SimBrief's aircraft type list ([server simbrief.ts](../../../src/server/simbrief.ts));
- the alias setting, fetching and parsing the latest OFP ([ofp.ts](../../../src/server/ofp.ts));
- briefings: archiving a plan whole, the current plan for the flight being flown, attaching and
  removing plans on logged hops, and when an archived plan is deleted
  ([routes.ts:562-692](../../../src/server/routes.ts#L562-L692));
- the SimBrief controls in the live card, the SimBrief card in the flight panel, and the route on
  the map ([LivePanel.tsx](../../../src/client/components/LivePanel.tsx) `SimbriefControls`,
  [FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx) `BriefingCard`,
  [BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx)).

It relies on: fleet for the aircraft's SimBrief type and livery, and the type field in the aircraft
form (FLEET-SIM-004); live-tracking for carrying the current plan into the hop or pending leg the
flight becomes (LIVE-HOP-001/002); the planner for where the dispatch link is offered
(PLAN-LIST-008, PLAN-DRAW-005); the flight panel, which hosts the SimBrief card; and tour-map for
world-copy placement and layer order (MAP-PATH-005).

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
whose hover text names the leg and type, or suggests setting a type on the aircraft).

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
([routes.ts:562-586](../../../src/server/routes.ts#L562-L586)).

**Fetching** ([ofp.ts:65-84](../../../src/server/ofp.ts#L65-L84)). The latest OFP comes from
`xml.fetcher.php?userid=` (all digits) or `?username=`, with `json=v2`, and a 20 s timeout.
SimBrief's own error ("Unknown UserID…") is passed on as `502 "SimBrief: …"`; with no alias set the
request is `400 "set your SimBrief alias or pilot ID first"`.

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
([LivePanel.tsx:58-62](../../../src/client/components/LivePanel.tsx#L58-L62), [routes.ts:647-653](../../../src/server/routes.ts#L647-L653)),
and the flight panel attaches the latest plan with no preview at all.

**For the flight being flown** (live card). A confirmed plan becomes the tracker's current plan
(`POST /api/tracker/briefing`); **Remove** clears it (`DELETE /api/tracker/briefing`). The current
plan goes with the next leg the tracker logs or keeps as pending (LIVE-HOP-001/002). Replacing or
removing a current plan that no hop uses deletes it.

**For a logged hop** (flight panel). **Attach my latest SimBrief plan** previews, and a confirmed
plan is linked to the hop (`POST /api/hops/:id/briefing`); **Remove** deletes it after "Remove the
SimBrief plan from this hop?" (`DELETE /api/hops/:id/briefing`).

Attaching to a hop that already has a plan is meant to replace it. Today the old plan stays in the
table still pointing at the hop, and `GET /api/hops/:id/briefing`, which falls back to any plan
pointing at the hop, returns it again once the new one is removed
([routes.ts:666-687](../../../src/server/routes.ts#L666-L687)).

**A pending leg** carries its plan until it is logged, or deletes it when discarded and no hop uses
it (LIVE-HOP-005).

**Deleting hops and aircraft.** A plan is deleted with its hop, whether the hop is deleted alone or
with its aircraft's tour; a plan on no hop (the tracker's current plan, a pending leg's) stays,
with its aircraft link cleared when the aircraft goes (FLEET-REC-016). Nothing in the app can show
a plan no hop points to, and each holds a whole OFP. Today a deleted hop's plan stays in the table
with its hop link cleared.

| Endpoint | Does | Errors |
|---|---|---|
| `GET /api/simbrief/latest[?username=]` | Latest plan's summary, not stored, with whether it has OFP text | 400 no alias; 502 SimBrief's error |
| `POST /api/tracker/briefing` | `{ofp_id}`: store the previewed plan as the current plan → tracker status | as above; 409 latest plan changed |
| `DELETE /api/tracker/briefing` | Clear the current plan | |
| `GET /api/briefings/:id` | A stored plan: summary, OFP text, hop and aircraft | 404 |
| `GET /api/hops/:id/briefing` | The plan the hop links to | 404 no hop or no plan |
| `POST /api/hops/:id/briefing` | `{ofp_id}`: attach the previewed plan to the hop, replacing its old one → 201 + plan | 404 hop; 400 / 502 as above; 409 latest plan changed |
| `DELETE /api/hops/:id/briefing` | Delete the hop's plan → 204 | 404 hop |

The `ofp_id` checks and the `409` are intended; today both `POST`s store whatever plan is latest.

## SimBrief Controls in the Live Card

([LivePanel.tsx:29-148](../../../src/client/components/LivePanel.tsx#L29-L148)), shown while the sim is
connected with an aircraft:

- **No alias** (or changing it): a "SimBrief alias or pilot ID" field with **Save** (Enter saves)
  and **Cancel** when changing.
- **Ready**: **Import SimBrief plan** and the alias, which can be clicked to change it.
- **Preview**: "Latest SimBrief plan · callsign", "ORIG/RWY → DEST/RWY", then aircraft type and
  registration, passengers, distance, time en route and when it was generated; **Use this plan**
  and **Cancel**.
- **Current plan**: "Plan ORIG → DEST · callsign · N pax" with **Remove**.

## SimBrief Card in the Flight Panel

([FlightPanel.tsx:229-343](../../../src/client/components/FlightPanel.tsx#L229-L343)) The app loads
the full plan for whatever the panel shows — a hop's plan, or the current plan for the live leg —
and reloads it after a change ([App.tsx:179-196](../../../src/client/App.tsx#L179-L196)). For a
pending leg it is meant to show that leg's plan too (PANEL-OPEN-002).

- **No plan**: "No plan attached to this flight.", and for a hop **Attach my latest SimBrief plan**,
  which shows the same preview as the live card with **Use this plan** and **Cancel**.
- **Plan**: Flight (callsign, else airline and flight number, else "—"; aircraft type and
  registration); Plan ("ORIG/RWY → DEST/RWY", "alt ALTN"); Route; "Cruise / dist / ETE"; Payload
  (passengers, cargo, TOW in the plan's units); Fuel (burn, ramp, landing); Generated.
- **Show OFP / Hide OFP** opens SimBrief's OFP text in a light, scrolling box; **PDF** opens the PDF
  in a new tab, styled like the buttons beside it; for a hop, **Remove**.

The OFP text is SimBrief's HTML and is meant to be shown with scripts, event handlers and anything
else active stripped. Today it is inserted as it comes
([FlightPanel.tsx:340](../../../src/client/components/FlightPanel.tsx#L340)). Today the PDF link is
unstyled, and with neither callsign nor airline the Flight line is blank rather than "—".

## Route on the Map

([BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx), [App.tsx:203-213](../../../src/client/App.tsx#L203-L213))

- Which routes: the current plan of the flight being flown, in the bound aircraft's color (white
  when unbound), and the plan of the flight open in the panel when it is a different plan, in that
  hop's aircraft color.
- How: a thin dashed line in the color over a soft dark casing, under the flown paths
  (MAP-PATH-005); a dot at every navlog fix (larger for airports), whose tooltip gives the ident,
  the name when different, "via AIRWAY" unless direct, and the planned altitude or else the fix
  type.
- Where: on the world copy of the flight it belongs to. Today the route is unwrapped only against
  itself — the reference meant to place it is passed as a `ref` prop, which React never delivers
  — so across the antimeridian it can sit a world copy away from its flight
  ([BriefingLayer.tsx:9-19](../../../src/client/components/BriefingLayer.tsx#L9-L19)).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Integration | Dispatch links out, latest-OFP import back, both keyless | SimBrief's API with a developer key; no integration | Nothing to sign up for; the user plans in SimBrief as usual. |
| Identity | One alias or pilot ID setting | Per-aircraft accounts | One pilot flies the career. |
| Cruise level in links | Left to SimBrief | Pass the planner's cruise altitude | SimBrief's own choice uses winds and the route; the planner's altitude is only a timing assumption. |
| Archive | The whole OFP (summary, HTML, raw JSON) | Summary only | Nothing the plan said is lost, and new fields can be read later from the raw OFP. |
| Two OFP shapes | Parse `v2` and the older all-strings form | `v2` only | SimBrief has changed its output before. |
| Confirming the plan | Preview, then store exactly the previewed plan, in the live card and the flight panel alike | Attach the latest blindly; re-fetch on confirm | The latest plan in SimBrief may be for a different flight, or change between preview and confirm. |
| Plans of deleted hops | Deleted with the hop, including with an aircraft's tour | Keep as an archive | No screen shows a plan without a hop, and each holds a whole OFP. |
| One current plan | The tracker holds one and the next leg takes it | Match plans to legs by airports | Simple, and a plan whose airports differ from what was flown is still the plan that was briefed. |
| Unused plans | Deleted when replaced, removed or discarded before any hop uses them | Keep every import | Plans no hop points to cannot be seen anywhere in the app. |
| Type list | SimBrief's own list, cached a day, with a built-in fallback | A hand-kept list | Covers every type SimBrief knows; still works offline. |

## Open Questions & Future Decisions

### Resolved

*(none yet)*

### Deferred

1. **Registration test too loose** — any short word is sent as `reg` ([simbrief.ts:15-18](../../../src/client/simbrief.ts#L15-L18)).
2. **Use this plan fetches again** ([LivePanel.tsx:58-62](../../../src/client/components/LivePanel.tsx#L58-L62), [routes.ts:647-653](../../../src/server/routes.ts#L647-L653)).
3. **Re-attaching keeps the old plan** pointing at the hop, where `GET /api/hops/:id/briefing` can
   find it again ([routes.ts:666-687](../../../src/server/routes.ts#L666-L687)).
4. **Plans of deleted hops** stay in the table with nothing pointing to them.
5. **Attaching to a logged hop has no preview** — it takes whatever plan is latest
   ([FlightPanel.tsx:234-246](../../../src/client/components/FlightPanel.tsx#L234-L246)).
6. **OFP HTML is not sanitised** ([FlightPanel.tsx:340](../../../src/client/components/FlightPanel.tsx#L340)).
7. **Route world copy** — the `ref` prop never arrives ([BriefingLayer.tsx:9-19](../../../src/client/components/BriefingLayer.tsx#L9-L19)).
8. **Pending legs' plans** cannot be seen until the leg is logged.
9. **Two fallback type lists** — the server's built-in 35 and the form's own
   ([simbrief.ts:22-33](../../../src/server/simbrief.ts#L22-L33), [client simbrief.ts:44-96](../../../src/client/simbrief.ts#L44-L96)).
10. **PDF link unstyled; blank Flight line** with neither callsign nor airline
    ([FlightPanel.tsx:284](../../../src/client/components/FlightPanel.tsx#L284), [328-332](../../../src/client/components/FlightPanel.tsx#L328-L332)).
11. **The archived OFP is never read back** — `ofp` is stored but no endpoint returns it.

## References

- Code: [src/client/simbrief.ts](../../../src/client/simbrief.ts), [src/server/simbrief.ts](../../../src/server/simbrief.ts),
  [src/server/ofp.ts](../../../src/server/ofp.ts), [src/server/routes.ts](../../../src/server/routes.ts)
  (settings and briefings 562-692), [src/server/db.ts](../../../src/server/db.ts) (`briefings`,
  `settings`, `kv_cache`), [src/client/components/LivePanel.tsx](../../../src/client/components/LivePanel.tsx)
  (`SimbriefControls`), [src/client/components/FlightPanel.tsx](../../../src/client/components/FlightPanel.tsx)
  (`BriefingCard`), [src/client/components/BriefingLayer.tsx](../../../src/client/components/BriefingLayer.tsx),
  [src/client/App.tsx](../../../src/client/App.tsx) (panel plan loading, routes to draw)
- External: SimBrief `xml.fetcher.php`, `inputs.list.json`, dispatch page
- Consumers: planner (dispatch link), live-tracking (current plan), flight-panel (hosts the card),
  fleet (type list in the aircraft form)
