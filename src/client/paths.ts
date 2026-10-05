import { distanceNm, greatCircle, type LatLng } from "./geo";
import { parseTrack } from "./tracker";
import type { Aircraft, Airport, AppState, Hop, TrackPoint } from "./types";

/**
 * Turns the raw state into map-ready geometry.
 *
 * Longitudes are "unwrapped" per aircraft: each hop is shifted by a multiple of 360°
 * so it starts next to where the previous hop ended. That keeps a Pacific crossing
 * drawn as one short line instead of a jump across the whole map, and everything
 * attached to that chain (airport dots, the parked-aircraft icon, zoom-to-fit) uses
 * the same shifted coordinates so it all lines up.
 */

export interface RenderHop {
  hop: Hop;
  aircraft: Aircraft;
  from: Airport;
  to: Airport;
  /** Unwrapped points, first = origin, last = destination: the recorded track when the hop has one, else a great circle. */
  pts: LatLng[];
  /** Direct distance between the two airports. */
  nm: number;
  /** True when `pts` is a track recorded from the sim. */
  tracked: boolean;
  /** Length of the recorded track, when there is one. */
  flownNm: number | null;
}

export interface AirportEvent {
  aircraft: Aircraft;
  hop: Hop;
  kind: "departed" | "arrived";
  time: string | null;
}

export interface AirportNode {
  /** `${ident}@${worldCopy}` — the same airport can appear on two world copies. */
  key: string;
  airport: Airport;
  pos: LatLng;
  events: AirportEvent[];
  aircraftIds: Set<number>;
  parked: Aircraft[];
}

export interface Head {
  aircraft: Aircraft;
  airport: Airport;
  pos: LatLng;
  /** Pixel offset so several aircraft parked at one airport fan out instead of stacking. */
  offset: [number, number];
}

export interface RenderData {
  hops: RenderHop[];
  nodes: AirportNode[];
  heads: Head[];
}

const EMPTY: RenderData = { hops: [], nodes: [], heads: [] };

/** Shift lon by whole turns so it lands within 180° of `ref`. */
function nearLon(lon: number, ref: number): number {
  while (lon - ref > 180) lon -= 360;
  while (lon - ref < -180) lon += 360;
  return lon;
}

/** Track samples as map points, each longitude unwrapped to sit next to the previous one (starting from `ref`). */
export function unwrapTrack(track: TrackPoint[], ref?: LatLng): LatLng[] {
  const out: LatLng[] = [];
  let refLon = ref ? ref[1] : track[0]?.[1] ?? 0;
  for (const p of track) {
    const lon = nearLon(p[1], refLon);
    out.push([p[0], lon]);
    refLon = lon;
  }
  return out;
}

/** Length of a polyline in nautical miles. */
export function pathNm(pts: LatLng[]): number {
  let nm = 0;
  for (let i = 1; i < pts.length; i++) nm += distanceNm(pts[i - 1], pts[i]);
  return nm;
}

export function buildRenderData(state: AppState | null): RenderData {
  if (!state) return EMPTY;
  const nodeMap = new Map<string, AirportNode>();
  const node = (ap: Airport, pos: LatLng): AirportNode => {
    const copy = Math.round((pos[1] - ap.lon) / 360);
    const key = `${ap.ident}@${copy}`;
    let n = nodeMap.get(key);
    if (!n) {
      n = { key, airport: ap, pos, events: [], aircraftIds: new Set(), parked: [] };
      nodeMap.set(key, n);
    }
    return n;
  };

  const hops: RenderHop[] = [];
  const heads: Head[] = [];
  const headsAt = new Map<string, number>();

  for (const a of state.aircraft) {
    if (!a.visible) continue;
    const mine = state.hops.filter((h) => h.aircraft_id === a.id);
    let prevEnd: LatLng | null = null;
    let last: RenderHop | null = null;

    for (const h of mine) {
      const from = state.airports[h.origin];
      const to = state.airports[h.dest];
      if (!from || !to) continue;
      const A: LatLng = [from.lat, prevEnd ? nearLon(from.lon, prevEnd[1]) : from.lon];
      const B: LatLng = [to.lat, nearLon(to.lon, A[1])];
      const track = parseTrack(h.track);
      const tracked = track.length >= 2;
      // A recorded track is tied to the airport dots at both ends so the line never floats free.
      const pts = tracked ? [A, ...unwrapTrack(track, A), B] : greatCircle(A, B);
      const r: RenderHop = { hop: h, aircraft: a, from, to, pts, nm: distanceNm(A, B), tracked, flownNm: tracked ? pathNm(pts) : null };
      hops.push(r);

      const nf = node(from, A);
      nf.events.push({ aircraft: a, hop: h, kind: "departed", time: h.departed_at });
      nf.aircraftIds.add(a.id);
      const nt = node(to, B);
      nt.events.push({ aircraft: a, hop: h, kind: "arrived", time: h.arrived_at });
      nt.aircraftIds.add(a.id);

      prevEnd = B;
      last = r;
    }

    if (last && prevEnd) {
      const pos = prevEnd;
      const n = node(last.to, pos);
      n.parked.push(a);
      const k = headsAt.get(n.key) ?? 0;
      headsAt.set(n.key, k + 1);
      const angle = -Math.PI / 2 + k * (Math.PI / 3);
      const offset: [number, number] = k === 0 ? [0, 0] : [Math.round(Math.cos(angle) * 30), Math.round(Math.sin(angle) * 30)];
      heads.push({ aircraft: a, airport: last.to, pos, offset });
    }
  }

  const nodes = [...nodeMap.values()];
  for (const n of nodes) {
    n.events.sort((x, y) => {
      const tx = x.time ? new Date(x.time).getTime() : Number.POSITIVE_INFINITY;
      const ty = y.time ? new Date(y.time).getTime() : Number.POSITIVE_INFINITY;
      if (tx !== ty) return tx - ty;
      if (x.aircraft.id !== y.aircraft.id) return x.aircraft.id - y.aircraft.id;
      return x.hop.seq - y.hop.seq || (x.kind === "arrived" ? -1 : 1);
    });
  }

  return { hops, nodes, heads };
}

/**
 * Longitude shift (a multiple of 360) that puts planner results on the same world copy as the
 * planning aircraft's path. Zero unless the plan starts where that aircraft is parked and its
 * chain was unwrapped across the antimeridian.
 */
export function planLonShift(data: RenderData, plan: { aircraft_id: number; origin: { ident: string; lon: number } }): number {
  const head = data.heads.find((h) => h.aircraft.id === plan.aircraft_id);
  if (!head || head.airport.ident !== plan.origin.ident) return 0;
  return Math.round((head.pos[1] - plan.origin.lon) / 360) * 360;
}

/** Bounding box (SW, NE) of a plan's range ring, on the right world copy. Used for zoom-to-fit. */
export function planBounds(data: RenderData, plan: { aircraft_id: number; range_nm: number; origin: { ident: string; lat: number; lon: number } }): LatLng[] {
  const shift = planLonShift(data, plan);
  const dLat = plan.range_nm / 60;
  const dLon = plan.range_nm / (60 * Math.max(0.05, Math.cos((plan.origin.lat * Math.PI) / 180)));
  const lon = plan.origin.lon + shift;
  return [
    [Math.max(-85, plan.origin.lat - dLat), lon - dLon],
    [Math.min(85, plan.origin.lat + dLat), lon + dLon],
  ];
}

/** Every rendered coordinate, optionally limited to one aircraft or one hop. Used for zoom-to-fit. */
export function focusPoints(data: RenderData, filter?: { aircraftId?: number; hopId?: number }): LatLng[] {
  const pts: LatLng[] = [];
  for (const r of data.hops) {
    if (filter?.aircraftId != null && r.aircraft.id !== filter.aircraftId) continue;
    if (filter?.hopId != null && r.hop.id !== filter.hopId) continue;
    pts.push(r.pts[0], r.pts[r.pts.length - 1]);
    // A recorded track can wander well off the direct line; sample it so the fit includes the detour.
    if (r.tracked) for (let i = 0; i < r.pts.length; i += 10) pts.push(r.pts[i]);
  }
  return pts;
}
