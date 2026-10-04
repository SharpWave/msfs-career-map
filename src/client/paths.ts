import { distanceNm, greatCircle, type LatLng } from "./geo";
import type { Aircraft, Airport, AppState, Hop } from "./types";

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
  /** Unwrapped great-circle points, first = origin, last = destination. */
  pts: LatLng[];
  nm: number;
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
      const pts = greatCircle(A, B);
      const r: RenderHop = { hop: h, aircraft: a, from, to, pts, nm: distanceNm(A, B) };
      hops.push(r);

      const nf = node(from, pts[0]);
      nf.events.push({ aircraft: a, hop: h, kind: "departed", time: h.departed_at });
      nf.aircraftIds.add(a.id);
      const nt = node(to, pts[pts.length - 1]);
      nt.events.push({ aircraft: a, hop: h, kind: "arrived", time: h.arrived_at });
      nt.aircraftIds.add(a.id);

      prevEnd = pts[pts.length - 1];
      last = r;
    }

    if (last) {
      const pos = last.pts[last.pts.length - 1];
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

/** Every rendered coordinate, optionally limited to one aircraft or one hop. Used for zoom-to-fit. */
export function focusPoints(data: RenderData, filter?: { aircraftId?: number; hopId?: number }): LatLng[] {
  const pts: LatLng[] = [];
  for (const r of data.hops) {
    if (filter?.aircraftId != null && r.aircraft.id !== filter.aircraftId) continue;
    if (filter?.hopId != null && r.hop.id !== filter.hopId) continue;
    pts.push(r.pts[0], r.pts[r.pts.length - 1]);
  }
  return pts;
}
