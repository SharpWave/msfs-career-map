import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { bearing, type LatLng } from "../geo";
import { aircraftLabel, airportTypeLabel, airportWhere, fmtDateTime, fmtDuration, fmtFt, fmtNm, hopDurationMin, runwaySummary } from "../format";
import { CATEGORY_COLORS, categoryFor, isFresh, metarBrief, metarStation, type FlightCategory, type MetarMap } from "../metar";
import { legFor } from "../simbrief";
import { isBlocked, type Flag } from "../constraints";
import { NightLayer } from "./NightLayer";
import { HazardLayer } from "./HazardLayer";
import { LiveLayer } from "./LiveLayer";
import { BriefingLayer } from "./BriefingLayer";
import { LandingBadge } from "./LandingBadge";
import { finalLanding } from "../landing";
import type { LiveState } from "../tracker";
import type { Hop, OfpFix } from "../types";
import type { HazardKind } from "../types";
import { headMarkerHtml } from "../icons";
import { planLonShift, type AirportNode, type RenderData, type RenderHop } from "../paths";
import type { Aircraft, PlanCandidate, PlanResult } from "../types";
import { RunwayInfo } from "./RunwayInfo";
import { AirportPopup } from "./AirportPopup";

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
}

export function MapView({
  data,
  aircraft,
  selectedId,
  onSelect,
  focus,
  basemap,
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
}: Props) {
  const { hops, nodes, heads } = data;
  const tiles = TILES[basemap];
  const byId = new Map(aircraft.map((a) => [a.id, a]));
  const planShift = plan ? planLonShift(data, plan) : 0;
  const planAircraft = plan ? byId.get(plan.aircraft_id) : undefined;
  const [openCandidate, setOpenCandidate] = useState<PlanCandidate | null>(null);

  // A new plan (or none) closes any candidate popup.
  useEffect(() => setOpenCandidate(null), [plan]);

  return (
    <MapContainer center={[39, -96]} zoom={4} minZoom={2} worldCopyJump className="map" zoomControl={false}>
      <TileLayer key={basemap} url={tiles.url} attribution={tiles.attribution} maxNativeZoom={tiles.maxZoom} maxZoom={19} />
      {tiles.labels && <TileLayer key={`${basemap}-labels`} url={tiles.labels} maxNativeZoom={tiles.maxZoom} maxZoom={19} zIndex={2} />}
      <FitController focus={focus} />
      <Resizer />

      {/* weather hazard areas and day/night shading sit under everything */}
      {hazardKinds.size > 0 && <HazardLayer kinds={hazardKinds} now={now} onStatus={onHazardStatus} />}
      {nightOn && <NightLayer now={now} />}

      {/* 0. planner: range ring and reachable airports, under everything else */}
      {plan && (
        <Circle
          center={[plan.origin.lat, plan.origin.lon + planShift]}
          radius={plan.range_nm * 1852}
          interactive={false}
          pathOptions={{ color: planAircraft?.color ?? "#ffffff", weight: 1.5, dashArray: "8 8", opacity: 0.8, fillColor: planAircraft?.color ?? "#ffffff", fillOpacity: 0.05 }}
        />
      )}
      {plan && plan.truncated && (
        <Circle
          center={[plan.origin.lat, plan.origin.lon + planShift]}
          radius={plan.shown_nm * 1852}
          interactive={false}
          pathOptions={{ color: "#ffffff", weight: 1, opacity: 0.6, fill: false }}
        />
      )}
      {plan && <CandidateLayer plan={plan} shift={planShift} metars={metars} flags={flags} hideFlagged={hideFlagged} onClick={setOpenCandidate} />}
      {plan && openCandidate && (
        <Popup
          position={[openCandidate.lat, openCandidate.lon + planShift]}
          className="apop-wrap"
          maxWidth={360}
          minWidth={280}
          offset={[0, -candidateStyle(openCandidate.type).radius]}
          eventHandlers={{ remove: () => setOpenCandidate(null) }}
        >
          <AirportPopup
            airport={openCandidate}
            extra={<div className="tip-route">{legLine(openCandidate)}</div>}
            onUse={() => onPickCandidate(openCandidate)}
            simbrief={legFor(plan.origin, openCandidate, planAircraft, plan.profile.cruise_alt_ft)}
            leg={{ from: plan.origin, aircraft: planAircraft }}
            flags={flags.get(openCandidate.ident)}
          />
        </Popup>
      )}

      {/* 0b. SimBrief planned routes, dashed, under the flown paths */}
      {routes?.map((r, i) => <BriefingLayer key={`route-${i}`} fixes={r.fixes} color={r.color} />)}

      {/* 1. dark casing under every path so colors pop on any basemap */}
      {hops.map((r) => (
        <Polyline
          key={`case-${r.hop.id}`}
          positions={r.pts}
          interactive={false}
          pathOptions={{ color: "#05080c", weight: 9, opacity: isDim(r.aircraft, selectedId) ? DIM.casing : 0.45, lineCap: "round", lineJoin: "round" }}
        />
      ))}

      {/* 2. the colored paths */}
      {hops.map((r) => (
        <Polyline
          key={`hop-${r.hop.id}`}
          positions={r.pts}
          pathOptions={{ color: r.aircraft.color, weight: 5, opacity: isDim(r.aircraft, selectedId) ? DIM.path : 0.95, lineCap: "round", lineJoin: "round" }}
          eventHandlers={{ click: () => (onOpenHop ? onOpenHop(r.hop) : onSelect(r.aircraft.id)) }}
        >
          <Tooltip sticky className="tip" opacity={1}>
            <HopTip r={r} />
          </Tooltip>
        </Polyline>
      ))}

      {/* 3. direction chevrons at each hop's midpoint */}
      {hops.map((r) => {
        if (r.nm < 8 || isDim(r.aircraft, selectedId)) return null;
        const mid = Math.floor(r.pts.length / 2);
        const brg = bearing(r.pts[Math.max(0, mid - 1)], r.pts[Math.min(r.pts.length - 1, mid + 1)]);
        return (
          <Marker
            key={`chev-${r.hop.id}`}
            position={r.pts[mid]}
            interactive={false}
            icon={L.divIcon({
              className: "chev-wrap",
              html: `<div class="chev" style="--c:${r.aircraft.color};transform:rotate(${brg.toFixed(1)}deg)"></div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            })}
          />
        );
      })}

      {/* 4. airports visited, with arrival/departure history on hover */}
      {nodes.map((n) => {
        const dim = selectedId != null && !n.aircraftIds.has(selectedId);
        const single = n.aircraftIds.size === 1 ? byId.get([...n.aircraftIds][0]) : undefined;
        return (
          <CircleMarker
            key={`ap-${n.key}`}
            center={n.pos}
            radius={6}
            pathOptions={{ color: "#05080c", weight: 2, fillColor: single?.color ?? "#ffffff", fillOpacity: dim ? DIM.airport : 1, opacity: dim ? DIM.airport : 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="tip" opacity={1}>
              <AirportTip node={n} />
            </Tooltip>
            <Popup className="apop-wrap" maxWidth={360} minWidth={280} offset={[0, -6]}>
              <AirportPopup airport={n.airport} />
            </Popup>
          </CircleMarker>
        );
      })}

      {/* 5. where each aircraft currently sits */}
      {heads.map(({ aircraft: a, airport, pos, offset }) => (
        <Marker
          key={`head-${a.id}`}
          position={pos}
          zIndexOffset={selectedId === a.id ? 1000 : 0}
          opacity={isDim(a, selectedId) ? DIM.head : 1}
          icon={L.divIcon({
            className: "head-wrap",
            html: headMarkerHtml(a, selectedId === a.id),
            iconSize: [44, 44],
            iconAnchor: [22 - offset[0], 22 - offset[1]],
          })}
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
      ))}

      {/* 6. the aircraft being flown right now, with its track so far */}
      {live && <LiveLayer live={live} aircraft={aircraft} data={data} />}
    </MapContainer>
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
 * Planner candidates drawn straight with Leaflet on a canvas: one circle marker per airport with
 * a lazily-built tooltip. This stays snappy with several thousand airports, where one React
 * component per marker would not. As METARs arrive, only the markers whose category changed
 * are restyled.
 */
interface MarkerEntry {
  marker: L.CircleMarker;
  c: PlanCandidate;
  cat: FlightCategory | null;
  faded: boolean;
}

/** Opacity for a candidate: faded when its flags rule it out and the planner is hiding those. */
const fadeStyle = (faded: boolean) => (faded ? { opacity: 0.25, fillOpacity: 0.12 } : { opacity: 0.95, fillOpacity: 0.9 });

function CandidateLayer({
  plan,
  shift,
  metars,
  flags,
  hideFlagged,
  onClick,
}: {
  plan: PlanResult;
  shift: number;
  metars: MetarMap;
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  onClick: (c: PlanCandidate) => void;
}) {
  const map = useMap();
  const markers = useRef(new Map<string, MarkerEntry>());
  const metarsRef = useRef(metars);
  metarsRef.current = metars;
  const flagsRef = useRef(flags);
  flagsRef.current = flags;

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();
    const reg = new Map<string, MarkerEntry>();
    for (const c of plan.candidates) {
      const s = candidateStyle(c.type);
      const cat = categoryFor(c, metarsRef.current);
      const ring = ringStyle(c, cat);
      const faded = hideFlagged && isBlocked(flagsRef.current.get(c.ident));
      const m = L.circleMarker([c.lat, c.lon + shift], {
        renderer,
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
      m.on("click", () => onClick(c));
      group.addLayer(m);
      reg.set(c.ident, { marker: m, c, cat, faded });
    }
    markers.current = reg;
    group.addTo(map);
    return () => {
      group.remove();
      markers.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, shift, map, onClick]);

  // Recolor rings as METARs land, and fade/unfade as flags or the hide toggle change.
  useEffect(() => {
    for (const entry of markers.current.values()) {
      const cat = categoryFor(entry.c, metars);
      const faded = hideFlagged && isBlocked(flags.get(entry.c.ident));
      if (cat === entry.cat && faded === entry.faded) continue;
      entry.cat = cat;
      entry.faded = faded;
      entry.marker.setStyle({ ...ringStyle(entry.c, cat), ...fadeStyle(faded) });
    }
  }, [metars, flags, hideFlagged]);

  return null;
}

function HopTip({ r }: { r: RenderHop }) {
  const dur = hopDurationMin(r.hop);
  const landing = finalLanding(r.hop);
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

/** Zoom the map whenever a new focus request arrives. */
function FitController({ focus }: { focus: Focus | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus || focus.points.length === 0) return;
    if (focus.zoom != null) {
      map.setView(focus.points[0], focus.zoom);
      return;
    }
    const bounds = L.latLngBounds(focus.points);
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.flyTo(focus.points[0], Math.max(map.getZoom(), 9), { duration: 0.6 });
    } else {
      map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 11, duration: 0.6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);
  return null;
}

/** Keep Leaflet's size in sync when the sidebar opens/closes. */
function Resizer() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}
