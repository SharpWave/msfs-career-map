import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { bearing, type LatLng } from "../geo";
import { aircraftLabel, airportTypeLabel, airportWhere, fmtDateTime, fmtDuration, fmtFt, fmtNm, hopDurationMin, runwaySummary } from "../format";
import { CATEGORY_COLORS, categoryFor, isFresh, metarBrief, metarStation, type FlightCategory, type MetarMap } from "../metar";
import { legFor, type PlanAirport } from "../simbrief";
import { isBlocked, type Flag } from "../constraints";
import { NightLayer } from "./NightLayer";
import { HazardLayer } from "./HazardLayer";
import { LiveLayer } from "./LiveLayer";
import { BriefingLayer, PlanAirportsLayer } from "./BriefingLayer";
import { ErrorBoundary } from "./ErrorBoundary";
import { LandingBadge } from "./LandingBadge";
import { hopTouchdown } from "../landing";
import type { LiveState } from "../tracker";
import type { Hop, OfpFix } from "../types";
import type { HazardKind } from "../types";
import { headMarkerHtml, hopStroke } from "../icons";
import { applyFocus, type FitMap } from "../fit";
import type { Insets } from "../layout";
import { prefersReducedMotion } from "../prefs";
import { copiesInView, copyShifts, lonSpan, planSpan, shiftLine, shiftPoint, type AirportNode, type Copies, type RenderData, type RenderHop } from "../paths";
import type { Aircraft, PlanCandidate, PlanResult } from "../types";
import { RunwayInfo } from "./RunwayInfo";
import { AirportPopup } from "./AirportPopup";
import { WorldCopies, useWorldCopies } from "./WorldCopies";

/** How strongly everything that is not the highlighted aircraft fades back. */
const DIM = { path: 0.45, casing: 0.25, head: 0.6, airport: 0.5 };

export type Basemap = "dark" | "light" | "satellite";

interface TileSpec {
  url: string;
  attribution: string;
  maxZoom: number;
  /** Optional label overlay drawn above the base tiles. */
  labels?: string;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const TILES: Record<Basemap, TileSpec> = {
  dark: {
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    maxZoom: 16,
  },
  light: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
};

/**
 * Dot fill by runway surface. Chosen to stay clear of the flight-category ring colors
 * (green/blue/red/magenta): paved is asphalt black, grass a yellowish lime, water cyan.
 */
export const SURFACE_COLORS: Record<string, string> = {
  paved: "#111827",
  grass: "#bef264",
  gravel: "#fbbf24",
  dirt: "#f59e0b",
  water: "#67e8f9",
  snow: "#f8fafc",
  unknown: "#94a3b8",
};

function candidateColor(c: PlanCandidate): string {
  const classes = (c.rwy_surfaces ?? "").split(",").filter(Boolean);
  if (classes.includes("paved")) return SURFACE_COLORS.paved;
  return SURFACE_COLORS[classes[0] ?? "unknown"] ?? SURFACE_COLORS.unknown;
}

/** Dot size and outline by airport class: big, bright-ringed dots for big airports, small dark-ringed ones for strips. */
function candidateStyle(type: string): { radius: number; color: string; weight: number } {
  switch (type) {
    case "large_airport":
      return { radius: 12, color: "#ffffff", weight: 2.5 };
    case "medium_airport":
      return { radius: 7.5, color: "#ffffff", weight: 1.5 };
    case "small_airport":
      return { radius: 4, color: "#cbd5e1", weight: 1 };
    default:
      return { radius: 3, color: "#cbd5e1", weight: 1 };
  }
}

export interface Focus {
  key: number;
  points: LatLng[];
  /** When set, centre on the first point at this zoom instead of fitting the points. */
  zoom?: number;
  /** The part of the map the page's panels left clear when the request was made. */
  clear?: Insets;
}

interface Props {
  data: RenderData;
  aircraft: Aircraft[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  focus: Focus | null;
  basemap: Basemap;
  plan: PlanResult | null;
  metars: MetarMap;
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  now: Date;
  nightOn: boolean;
  hazardKinds: Set<HazardKind>;
  onHazardStatus?: (s: { count: number; fetched_at: string | null; error: string | null }) => void;
  onPickCandidate: (c: PlanCandidate) => void;
  live?: LiveState;
  /** Clicking a hop's line opens it in the flight panel. */
  onOpenHop?: (hop: Hop) => void;
  /** SimBrief routes to draw under the paths. */
  routes?: { fixes: OfpFix[]; color: string }[];
  /** The current SimBrief plan's airports, circled under the routes. */
  planAirports?: { airports: PlanAirport[]; color: string };
  /** The part of the map the page's panels leave clear now; popups open inside it. */
  clear: Insets;
}

/** Div icons kept by their markup, so a re-render hands Leaflet the same icon and rebuilds nothing. */
const icons = new Map<string, L.DivIcon>();
function divIcon(className: string, html: string, size: number, anchor: [number, number]): L.DivIcon {
  const key = `${className}|${size}|${anchor[0]},${anchor[1]}|${html}`;
  let icon = icons.get(key);
  if (!icon) icons.set(key, (icon = L.divIcon({ className, html, iconSize: [size, size], iconAnchor: anchor })));
  return icon;
}

/** A candidate's longitude in −180..180 (180 counts as −180), so it has one copy per world. */
const ownLon = (lon: number) => (lon >= 180 ? lon - 360 : lon);

/** The shift of each world copy in view. */
const copyRange = ({ lo, hi }: Copies) => Array.from({ length: hi - lo + 1 }, (_, i) => 360 * (lo + i) + 0);

/**
 * The map: basemap, zoom requests, and every layer drawn on every world copy in view. Panning carries
 * on across the antimeridian onto any copy — there is no jump back to the first world.
 */
// @spec MAP-VIEW-004
export function MapView(props: Props) {
  const tiles = TILES[props.basemap];
  // Vector layers are rendered a quarter of the view beyond each edge, as far as the copies in view reach.
  const renderer = useMemo(() => L.svg({ padding: 0.25 }), []);
  return (
    <MapContainer center={[39, -96]} zoom={4} minZoom={2} renderer={renderer} className="map" zoomControl={false}>
      <TileLayer key={props.basemap} url={tiles.url} attribution={tiles.attribution} maxNativeZoom={tiles.maxZoom} maxZoom={19} />
      {tiles.labels && <TileLayer key={`${props.basemap}-labels`} url={tiles.labels} maxNativeZoom={tiles.maxZoom} maxZoom={19} zIndex={2} />}
      <PopupPadding clear={props.clear} />
      <Resizer />
      <WorldCopies>
        <FitController focus={props.focus} />
        <Layers {...props} />
      </WorldCopies>
    </MapContainer>
  );
}

/** Everything over the basemap, bottom to top, each shape on every world copy in view. */
// @spec MAP-GEO-013, MAP-GEO-014, MAP-GEO-019, MAP-PATH-005
function Layers({
  data,
  aircraft,
  selectedId,
  onSelect,
  plan,
  metars,
  flags,
  hideFlagged,
  now,
  nightOn,
  hazardKinds,
  onHazardStatus,
  onPickCandidate,
  live,
  onOpenHop,
  routes,
  planAirports,
}: Props) {
  const { hops, nodes, heads } = data;
  const { copies } = useWorldCopies();
  const byId = new Map(aircraft.map((a) => [a.id, a]));
  const planAircraft = plan ? byId.get(plan.aircraft_id) : undefined;
  const spans = useMemo(() => new Map(hops.map((r) => [r.hop.id, lonSpan(r.pts)])), [hops]);
  const ring = useMemo(() => (plan ? { centre: [plan.origin.lat, plan.origin.lon] as LatLng, span: planSpan(plan) } : null), [plan]);
  const at = (pos: LatLng) => copyShifts([pos[1], pos[1]], copies);

  // The candidate popup opens on the world copy whose dot was clicked.
  const [openCandidate, setOpenCandidate] = useState<{ c: PlanCandidate; shift: number } | null>(null);
  const pickCandidate = useCallback((c: PlanCandidate, shift: number) => setOpenCandidate({ c, shift }), []);
  // Stable reference: react-leaflet reopens a popup whenever its `position` array changes identity,
  // and the live tracker re-renders this component every second.
  const candidatePos = useMemo<LatLng | null>(
    () => (openCandidate ? [openCandidate.c.lat, ownLon(openCandidate.c.lon) + openCandidate.shift] : null),
    [openCandidate],
  );

  // A new plan (or none) closes any candidate popup, and so does its world copy leaving the view.
  useEffect(() => setOpenCandidate(null), [plan]);
  useEffect(() => {
    if (openCandidate && (openCandidate.shift < 360 * copies.lo || openCandidate.shift > 360 * copies.hi)) setOpenCandidate(null);
  }, [copies, openCandidate]);

  return (
    <>
      {/* weather hazard areas and day/night shading sit under everything */}
      {hazardKinds.size > 0 && <HazardLayer kinds={hazardKinds} now={now} onStatus={onHazardStatus} />}
      {nightOn && <NightLayer now={now} />}

      {/* 0. planner: range ring and reachable airports, under everything else */}
      {plan &&
        ring &&
        copyShifts(ring.span, copies).map((d) => (
          <Circle
            key={`ring@${d}`}
            center={shiftPoint(ring.centre, d)}
            radius={plan.range_nm * 1852}
            interactive={false}
            pathOptions={{ color: planAircraft?.color ?? "#ffffff", weight: 1.5, dashArray: "8 8", opacity: 0.8, fillColor: planAircraft?.color ?? "#ffffff", fillOpacity: 0.05 }}
          />
        ))}
      {plan &&
        ring &&
        plan.truncated &&
        copyShifts(ring.span, copies).map((d) => (
          <Circle
            key={`shown@${d}`}
            center={shiftPoint(ring.centre, d)}
            radius={plan.shown_nm * 1852}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 1, opacity: 0.6, fill: false }}
          />
        ))}
      {plan && <CandidateLayer plan={plan} metars={metars} flags={flags} hideFlagged={hideFlagged} onClick={pickCandidate} />}
      {plan && openCandidate && candidatePos && (
        <Popup
          position={candidatePos}
          className="apop-wrap"
          maxWidth={360}
          minWidth={280}
          offset={[0, -candidateStyle(openCandidate.c.type).radius]}
          eventHandlers={{ remove: () => setOpenCandidate(null) }}
        >
          <AirportPopup
            airport={openCandidate.c}
            extra={<div className="tip-route">{legLine(openCandidate.c)}</div>}
            onUse={() => onPickCandidate(openCandidate.c)}
            simbrief={legFor(plan.origin, openCandidate.c, planAircraft)}
            leg={{ from: plan.origin, aircraft: planAircraft }}
            flags={flags.get(openCandidate.c.ident)}
          />
        </Popup>
      )}

      {/* 0b. SimBrief planned routes, dashed, under the flown paths; the current plan's airports under them */}
      <ErrorBoundary label="Planned route" className="map-notice">
        {planAirports && <PlanAirportsLayer airports={planAirports.airports} color={planAirports.color} />}
        {routes?.map((r, i) => <BriefingLayer key={`route-${i}`} fixes={r.fixes} color={r.color} />)}
      </ErrorBoundary>

      {/* 1. dark casing under every path so colors pop on any basemap */}
      {hops.map((r) =>
        copyShifts(spans.get(r.hop.id)!, copies).map((d) => (
          <Polyline
            key={`case-${r.hop.id}@${d}`}
            positions={shiftLine(r.pts, d)}
            interactive={false}
            pathOptions={{ color: "#05080c", weight: 9, opacity: isDim(r.aircraft, selectedId) ? DIM.casing : 0.45, lineCap: "round", lineJoin: "round" }}
          />
        )),
      )}

      {/* 2. the colored paths */}
      {hops.map((r) =>
        copyShifts(spans.get(r.hop.id)!, copies).map((d) => (
          <Polyline
            key={`hop-${r.hop.id}@${d}`}
            positions={shiftLine(r.pts, d)}
            pathOptions={{ className: `hop-path hop-${r.hop.id}`, color: hopStroke(r.aircraft.color, r.hop.seq), weight: 5, opacity: isDim(r.aircraft, selectedId) ? DIM.path : 0.95, lineCap: "round", lineJoin: "round" }}
            eventHandlers={{ click: () => (onOpenHop ? onOpenHop(r.hop) : onSelect(r.aircraft.id)) }}
          >
            <Tooltip sticky className="tip" opacity={1}>
              <HopTip r={r} />
            </Tooltip>
          </Polyline>
        )),
      )}

      {/* 3. direction chevrons at each hop's midpoint */}
      {hops.map((r) => {
        if (r.nm < 8 || isDim(r.aircraft, selectedId)) return null;
        const mid = Math.floor(r.pts.length / 2);
        const brg = bearing(r.pts[Math.max(0, mid - 1)], r.pts[Math.min(r.pts.length - 1, mid + 1)]);
        const icon = divIcon(
          "chev-wrap",
          `<div class="chev" style="--c:${hopStroke(r.aircraft.color, r.hop.seq)};transform:rotate(${brg.toFixed(1)}deg)"></div>`,
          16,
          [8, 8],
        );
        return copyShifts(spans.get(r.hop.id)!, copies).map((d) => (
          <Marker key={`chev-${r.hop.id}@${d}`} position={shiftPoint(r.pts[mid], d)} interactive={false} icon={icon} />
        ));
      })}

      {/* 4. airports visited, with arrival/departure history on hover */}
      {nodes.map((n) => {
        const dim = selectedId != null && !n.aircraftIds.has(selectedId);
        const single = n.aircraftIds.size === 1 ? byId.get([...n.aircraftIds][0]) : undefined;
        return at(n.pos).map((d) => (
          <CircleMarker
            key={`ap-${n.key}@${d}`}
            center={shiftPoint(n.pos, d)}
            radius={6}
            pathOptions={{ className: `airport-dot ap-${n.airport.ident}`, color: "#05080c", weight: 2, fillColor: single?.color ?? "#ffffff", fillOpacity: dim ? DIM.airport : 1, opacity: dim ? DIM.airport : 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="tip" opacity={1}>
              <AirportTip node={n} />
            </Tooltip>
            <Popup className="apop-wrap" maxWidth={360} minWidth={280} offset={[0, -6]}>
              <AirportPopup airport={n.airport} />
            </Popup>
          </CircleMarker>
        ));
      })}

      {/* 5. where each aircraft currently sits */}
      {heads.map(({ aircraft: a, airport, pos, offset }) => {
        const icon = divIcon("head-wrap", headMarkerHtml(a, selectedId === a.id), 44, [22 - offset[0], 22 - offset[1]]);
        return at(pos).map((d) => (
          <Marker
            key={`head-${a.id}@${d}`}
            position={shiftPoint(pos, d)}
            zIndexOffset={selectedId === a.id ? 1000 : 0}
            opacity={isDim(a, selectedId) ? DIM.head : 1}
            icon={icon}
            eventHandlers={{ click: () => onSelect(selectedId === a.id ? null : a.id) }}
          >
            <Tooltip direction="top" offset={[offset[0], -24 + offset[1]]} className="tip" opacity={1}>
              <div className="tip-title" style={{ color: a.color }}>
                {aircraftLabel(a)}
              </div>
              <div className="tip-sub">
                parked at <b>{airport.ident}</b> · {airport.name}
              </div>
            </Tooltip>
          </Marker>
        ));
      })}

      {/* 6. the aircraft being flown right now, with its track so far */}
      {live && (
        <ErrorBoundary label="Live aircraft" className="map-notice">
          <LiveLayer live={live} aircraft={aircraft} />
        </ErrorBoundary>
      )}
    </>
  );
}

function isDim(a: Aircraft, selectedId: number | null) {
  return selectedId != null && a.id !== selectedId;
}

function legLine(c: PlanCandidate): string {
  return `${fmtNm(c.distance_nm)} · ~${fmtDuration(c.est_minutes)} · ${Math.round(c.bearing_deg).toString().padStart(3, "0")}°`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Hover tooltip for a candidate, as plain HTML so thousands of markers stay cheap. */
function candidateTooltipHtml(c: PlanCandidate, metars: MetarMap, flags: Flag[] | undefined): string {
  const where = airportWhere(c);
  const rwy = runwaySummary(c);
  const st = metarStation(c);
  const m = st ? metars.get(st)?.metar : undefined;
  let weather = "";
  if (isFresh(m)) {
    const cat = m.flight_category ?? "";
    weather = `<div class="tip-sub"><span class="fltcat fltcat-${esc(cat)}">${esc(cat || "METAR")}</span> ${esc(metarBrief(m))}</div>`;
  } else if (m) {
    weather = `<div class="tip-sub muted">METAR stale (${esc(metarBrief(m))})</div>`;
  }
  const flagHtml = (flags ?? []).map((f) => `<div class="tip-flag${f.blocking ? " blocking" : ""}">${esc(f.text)}</div>`).join("");
  return (
    `<div class="tip-title">${esc(c.ident)} · ${esc(c.name)}</div>` +
    (where ? `<div class="tip-sub">${esc(where)}</div>` : "") +
    `<div class="tip-route">${esc(legLine(c))}</div>` +
    `<div class="tip-sub">${esc(airportTypeLabel(c.type))}${c.elevation_ft != null ? ` · elev ${esc(fmtFt(c.elevation_ft))}` : ""}` +
    `${rwy ? ` · ${esc(rwy)}` : " · no runway data"}</div>` +
    weather +
    flagHtml +
    `<div class="tip-hint">Click for photo, weather, terrain, links, and to use as the next destination</div>`
  );
}

/** Ring color/weight for a candidate: flight category when a fresh METAR is known, else the class default. */
function ringStyle(c: PlanCandidate, cat: FlightCategory | null): { color: string; weight: number } {
  const base = candidateStyle(c.type);
  if (!cat) return { color: base.color, weight: base.weight };
  return { color: CATEGORY_COLORS[cat], weight: Math.max(base.weight, c.type === "large_airport" ? 3.5 : 3) };
}

/**
 * Planner candidates drawn straight with Leaflet on a canvas: one circle marker per airport per
 * world copy in view, with a lazily-built tooltip. This stays snappy with several thousand
 * airports, where one React component per marker would not. As METARs arrive, only the markers
 * whose category changed are restyled. A click says which copy it came from, so the popup opens
 * beside that dot.
 */
interface MarkerEntry {
  marker: L.CircleMarker;
  c: PlanCandidate;
  cat: FlightCategory | null;
  faded: boolean;
}

/** Opacity for a candidate: faded when its flags rule it out and the planner is hiding those. */
const fadeStyle = (faded: boolean) => (faded ? { opacity: 0.25, fillOpacity: 0.12 } : { opacity: 0.95, fillOpacity: 0.9 });

// @spec PLAN-DRAW-005
function CandidateLayer({
  plan,
  metars,
  flags,
  hideFlagged,
  onClick,
}: {
  plan: PlanResult;
  metars: MetarMap;
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  onClick: (c: PlanCandidate, shift: number) => void;
}) {
  const map = useMap();
  const { copies } = useWorldCopies();
  const drawn = useRef(new Map<number, { group: L.LayerGroup; entries: MarkerEntry[] }>());
  const renderer = useRef<L.Canvas | null>(null);
  const metarsRef = useRef(metars);
  metarsRef.current = metars;
  const flagsRef = useRef(flags);
  flagsRef.current = flags;

  // A new plan starts afresh: every copy of the old plan's markers goes, with their canvas.
  useEffect(() => {
    const canvas = L.canvas({ padding: 0.5 });
    renderer.current = canvas;
    return () => {
      for (const { group } of drawn.current.values()) group.remove();
      drawn.current = new Map();
      map.removeLayer(canvas);
      renderer.current = null;
    };
  }, [plan, map, onClick]);

  // One group of markers per world copy in view; a copy that stays in view keeps its markers.
  useEffect(() => {
    const canvas = renderer.current;
    if (!canvas) return;
    const want = new Set(copyRange(copies));
    for (const [shift, { group }] of drawn.current) {
      if (want.has(shift)) continue;
      group.remove();
      drawn.current.delete(shift);
    }
    for (const shift of want) {
      if (drawn.current.has(shift)) continue;
      const group = L.layerGroup();
      const entries: MarkerEntry[] = [];
      for (const c of plan.candidates) {
        const s = candidateStyle(c.type);
        const cat = categoryFor(c, metarsRef.current);
        const ring = ringStyle(c, cat);
        const faded = hideFlagged && isBlocked(flagsRef.current.get(c.ident));
        const m = L.circleMarker([c.lat, ownLon(c.lon) + shift], {
          renderer: canvas,
          radius: s.radius,
          color: ring.color,
          weight: ring.weight,
          fillColor: candidateColor(c),
          ...fadeStyle(faded),
        });
        m.bindTooltip(() => candidateTooltipHtml(c, metarsRef.current, flagsRef.current.get(c.ident)), {
          direction: "top",
          offset: [0, -s.radius],
          className: "tip",
          opacity: 1,
        });
        m.on("click", () => onClick(c, shift));
        group.addLayer(m);
        entries.push({ marker: m, c, cat, faded });
      }
      group.addTo(map);
      drawn.current.set(shift, { group, entries });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, copies, map, onClick]);

  // Recolor rings as METARs land, and fade/unfade as flags or the hide toggle change.
  useEffect(() => {
    for (const { entries } of drawn.current.values()) {
      for (const entry of entries) {
        const cat = categoryFor(entry.c, metars);
        const faded = hideFlagged && isBlocked(flags.get(entry.c.ident));
        if (cat === entry.cat && faded === entry.faded) continue;
        entry.cat = cat;
        entry.faded = faded;
        entry.marker.setStyle({ ...ringStyle(entry.c, cat), ...fadeStyle(faded) });
      }
    }
  }, [metars, flags, hideFlagged]);

  return null;
}

// @spec MAP-PATH-003
export function HopTip({ r }: { r: RenderHop }) {
  const dur = hopDurationMin(r.hop);
  const landing = hopTouchdown(r.hop);
  return (
    <>
      <div className="tip-title" style={{ color: r.aircraft.color }}>
        {aircraftLabel(r.aircraft)}
      </div>
      <div className="tip-route">
        <b>{r.hop.origin}</b> → <b>{r.hop.dest}</b>{" "}
        <span className="muted">
          · hop {r.hop.seq} · {Math.round(r.nm)} nm
          {r.flownNm != null && <> · {Math.round(r.flownNm)} nm flown (tracked)</>}
        </span>
      </div>
      {(r.hop.departed_at || r.hop.arrived_at || dur != null) && (
        <div className="tip-sub">
          {r.hop.departed_at && <>dep {fmtDateTime(r.hop.departed_at)} </>}
          {r.hop.arrived_at && <>· arr {fmtDateTime(r.hop.arrived_at)} </>}
          {dur != null && <>· {fmtDuration(dur)}</>}
        </div>
      )}
      {landing && (
        <div className="tip-sub">
          <LandingBadge landing={landing} />
          {landing.g != null && <span className="muted"> · {landing.g.toFixed(2)} G</span>}
        </div>
      )}
      {r.hop.notes && <div className="tip-notes">{r.hop.notes}</div>}
      {r.tracked && <div className="tip-hint">Click for the flight profile</div>}
    </>
  );
}

function AirportTip({ node }: { node: AirportNode }) {
  const ap = node.airport;
  const where = airportWhere(ap);
  return (
    <>
      <div className="tip-title">
        {ap.ident} · {ap.name}
      </div>
      {where && <div className="tip-sub">{where}</div>}
      <RunwayInfo airport={ap} max={3} />
      <ul className="tip-events">
        {node.events.map((ev, i) => (
          <li key={i}>
            <span className="dot" style={{ background: ev.aircraft.color }} />
            <b>{aircraftLabel(ev.aircraft)}</b>
            <span className="muted"> {ev.kind === "departed" ? "departed" : "arrived"} </span>
            {ev.time ? fmtDateTime(ev.time) : <span className="muted">(time not logged)</span>}
            <span className="muted"> · hop {ev.hop.seq}</span>
          </li>
        ))}
      </ul>
      {node.parked.length > 0 && <div className="tip-parked">Currently here: {node.parked.map((a) => aircraftLabel(a)).join(", ")}</div>}
      <div className="tip-hint">Click for photo, weather and links</div>
    </>
  );
}

/**
 * Zoom the map whenever a new focus request arrives, into the part the panels leave clear, first
 * adding the world copies around where it will land.
 */
function FitController({ focus }: { focus: Focus | null }) {
  const map = useMap();
  const { include } = useWorldCopies();
  useEffect(() => {
    if (!focus) return;
    applyFocus(map as unknown as FitMap, focus, prefersReducedMotion(), (points) => {
      const [west, east] = lonSpan(points);
      include(copiesInView(west, east));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);
  return null;
}

/**
 * Keep popups clear of the panels. Leaflet reads a popup's pan padding when it opens, and a popup
 * that sets none inherits it from the defaults, so keeping the defaults current covers every popup,
 * including those created before a panel opened.
 */
// @spec APP-UI-021
function PopupPadding({ clear }: { clear: Insets }) {
  useEffect(() => {
    const o = L.Popup.prototype.options as L.PopupOptions;
    o.autoPanPaddingTopLeft = L.point(clear.left + 12, clear.top + 12);
    o.autoPanPaddingBottomRight = L.point(clear.right + 12, clear.bottom + 12);
  }, [clear.left, clear.top, clear.right, clear.bottom]);
  return null;
}

/** Keep Leaflet's size in sync with the window. */
function Resizer() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}
