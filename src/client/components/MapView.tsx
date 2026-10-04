import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { bearing, type LatLng } from "../geo";
import { aircraftLabel, airportWhere, fmtDateTime, fmtDuration, fmtNm, hopDurationMin } from "../format";
import { headMarkerHtml } from "../icons";
import { planLonShift, type AirportNode, type RenderData, type RenderHop } from "../paths";
import type { Aircraft, PlanCandidate, PlanResult } from "../types";
import { RunwayInfo } from "./RunwayInfo";

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

export const SURFACE_COLORS: Record<string, string> = {
  paved: "#7dd3fc",
  grass: "#86efac",
  gravel: "#fbbf24",
  dirt: "#f59e0b",
  water: "#60a5fa",
  snow: "#e0f2fe",
  unknown: "#94a3b8",
};

function candidateColor(c: PlanCandidate): string {
  const classes = (c.rwy_surfaces ?? "").split(",").filter(Boolean);
  if (classes.includes("paved")) return SURFACE_COLORS.paved;
  return SURFACE_COLORS[classes[0] ?? "unknown"] ?? SURFACE_COLORS.unknown;
}

function candidateRadius(type: string): number {
  switch (type) {
    case "large_airport":
      return 8;
    case "medium_airport":
      return 6;
    case "small_airport":
      return 4.5;
    default:
      return 3.5;
  }
}

export interface Focus {
  key: number;
  points: LatLng[];
}

interface Props {
  data: RenderData;
  aircraft: Aircraft[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  focus: Focus | null;
  basemap: Basemap;
  plan: PlanResult | null;
  onPickCandidate: (c: PlanCandidate) => void;
}

export function MapView({ data, aircraft, selectedId, onSelect, focus, basemap, plan, onPickCandidate }: Props) {
  const { hops, nodes, heads } = data;
  const tiles = TILES[basemap];
  const byId = new Map(aircraft.map((a) => [a.id, a]));
  const canvas = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const planShift = plan ? planLonShift(data, plan) : 0;
  const planAircraft = plan ? byId.get(plan.aircraft_id) : undefined;

  return (
    <MapContainer center={[39, -96]} zoom={4} minZoom={2} worldCopyJump className="map" zoomControl={false}>
      <TileLayer key={basemap} url={tiles.url} attribution={tiles.attribution} maxNativeZoom={tiles.maxZoom} maxZoom={19} />
      {tiles.labels && <TileLayer key={`${basemap}-labels`} url={tiles.labels} maxNativeZoom={tiles.maxZoom} maxZoom={19} zIndex={2} />}
      <FitController focus={focus} />
      <Resizer />

      {/* 0. planner: range ring and reachable airports, under everything else */}
      {plan && (
        <Circle
          center={[plan.origin.lat, plan.origin.lon + planShift]}
          radius={plan.range_nm * 1852}
          interactive={false}
          pathOptions={{ color: planAircraft?.color ?? "#ffffff", weight: 1.5, dashArray: "8 8", opacity: 0.8, fillColor: planAircraft?.color ?? "#ffffff", fillOpacity: 0.05 }}
        />
      )}
      {plan?.candidates.map((c) => (
        <CircleMarker
          key={`cand-${c.ident}`}
          center={[c.lat, c.lon + planShift]}
          radius={candidateRadius(c.type)}
          pathOptions={{ renderer: canvas, color: "#05080c", weight: 1, fillColor: candidateColor(c), fillOpacity: 0.9, opacity: 0.9 }}
          eventHandlers={{ click: () => onPickCandidate(c) }}
        >
          <Tooltip direction="top" offset={[0, -6]} className="tip" opacity={1}>
            <div className="tip-title">
              {c.ident} · {c.name}
            </div>
            {airportWhere(c) && <div className="tip-sub">{airportWhere(c)}</div>}
            <div className="tip-route">
              {fmtNm(c.distance_nm)} · ~{fmtDuration(c.est_minutes)} · {Math.round(c.bearing_deg).toString().padStart(3, "0")}°
            </div>
            <RunwayInfo airport={c} />
            <div className="tip-hint">Click to use as the next destination</div>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* 1. dark casing under every path so colors pop on any basemap */}
      {hops.map((r) => (
        <Polyline
          key={`case-${r.hop.id}`}
          positions={r.pts}
          interactive={false}
          pathOptions={{ color: "#05080c", weight: 9, opacity: isDim(r.aircraft, selectedId) ? 0.1 : 0.45, lineCap: "round", lineJoin: "round" }}
        />
      ))}

      {/* 2. the colored paths */}
      {hops.map((r) => (
        <Polyline
          key={`hop-${r.hop.id}`}
          positions={r.pts}
          pathOptions={{ color: r.aircraft.color, weight: 5, opacity: isDim(r.aircraft, selectedId) ? 0.18 : 0.95, lineCap: "round", lineJoin: "round" }}
          eventHandlers={{ click: () => onSelect(r.aircraft.id) }}
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
            pathOptions={{ color: "#05080c", weight: 2, fillColor: single?.color ?? "#ffffff", fillOpacity: dim ? 0.25 : 1, opacity: dim ? 0.25 : 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="tip" opacity={1}>
              <AirportTip node={n} />
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* 5. where each aircraft currently sits */}
      {heads.map(({ aircraft: a, airport, pos, offset }) => (
        <Marker
          key={`head-${a.id}`}
          position={pos}
          zIndexOffset={selectedId === a.id ? 1000 : 0}
          opacity={isDim(a, selectedId) ? 0.35 : 1}
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
    </MapContainer>
  );
}

function isDim(a: Aircraft, selectedId: number | null) {
  return selectedId != null && a.id !== selectedId;
}

function HopTip({ r }: { r: RenderHop }) {
  const dur = hopDurationMin(r.hop);
  return (
    <>
      <div className="tip-title" style={{ color: r.aircraft.color }}>
        {aircraftLabel(r.aircraft)}
      </div>
      <div className="tip-route">
        <b>{r.hop.origin}</b> → <b>{r.hop.dest}</b>{" "}
        <span className="muted">
          · hop {r.hop.seq} · {Math.round(r.nm)} nm
        </span>
      </div>
      {(r.hop.departed_at || r.hop.arrived_at || dur != null) && (
        <div className="tip-sub">
          {r.hop.departed_at && <>dep {fmtDateTime(r.hop.departed_at)} </>}
          {r.hop.arrived_at && <>· arr {fmtDateTime(r.hop.arrived_at)} </>}
          {dur != null && <>· {fmtDuration(dur)}</>}
        </div>
      )}
      {r.hop.notes && <div className="tip-notes">{r.hop.notes}</div>}
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
    </>
  );
}

/** Zoom the map whenever a new focus request arrives. */
function FitController({ focus }: { focus: Focus | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus || focus.points.length === 0) return;
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
