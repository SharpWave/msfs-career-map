import { distanceNm, greatCircle, type LatLng } from "./geo";
import { parseTrack } from "./tracker";
import type { Aircraft, Airport, AppState, Hop, OfpFix, TrackPoint } from "./types";

/**
 * Turns the raw state into map-ready geometry, and says which world copies each shape is drawn on.
 *
 * The map wraps: every shape is placed once, around its own longitude, and drawn again shifted by
 * whole turns of 360° on every world copy in view, so two copies of a region always show the same
 * things. A line is placed point by point — each point within 180° of the one before — so a Pacific
 * crossing is one short line that runs on past ±180°, and its copy one turn over completes it on
 * the other side.
 */

export interface RenderHop {
  hop: Hop;
  aircraft: Aircraft;
  from: Airport;
  to: Airport;
  /** Placed points, first = origin at its own longitude, last = destination: the recorded track when the hop has one, else a great circle. */
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
  /** The airport's ident: one dot per airport, drawn on every world copy in view. */
  key: string;
  airport: Airport;
  /** The airport's own position. */
  pos: LatLng;
  events: AirportEvent[];
  aircraftIds: Set<number>;
  parked: Aircraft[];
}

export interface Head {
  aircraft: Aircraft;
  airport: Airport;
  /** The parked airport's own position (the same array as its dot's). */
  pos: LatLng;
  /** Pixel offset so several aircraft parked at one airport fan out instead of stacking. */
  offset: [number, number];
}

export interface RenderData {
  hops: RenderHop[];
  nodes: AirportNode[];
  heads: Head[];
}

/** World copies in view, as a range of k: copy k spans −180° + 360°k to 180° + 360°k. */
export interface Copies {
  lo: number;
  hi: number;
}

const EMPTY: RenderData = { hops: [], nodes: [], heads: [] };

/** Shift lon by whole turns so it lands within 180° of `ref`. */
function nearLon(lon: number, ref: number): number {
  while (lon - ref > 180) lon -= 360;
  while (lon - ref < -180) lon += 360;
  return lon;
}

/** A line or area as map points: the first keeps its own longitude, each next one sits within 180° of the one before. */
// @spec MAP-GEO-015
export function placeLine(pts: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const [lat, lon] of pts) out.push([lat, out.length ? nearLon(lon, out[out.length - 1][1]) : lon]);
  return out;
}

/** Westmost and eastmost longitude of a set of points. */
export function lonSpan(pts: LatLng[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [, lon] of pts) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  return [min, max];
}

/** The world copies a view from `west` to `east` touches, once widened by a quarter of its width on each side. */
// @spec MAP-GEO-017
export function copiesInView(west: number, east: number): Copies {
  const margin = (east - west) / 4;
  return { lo: Math.floor((west - margin + 180) / 360), hi: Math.floor((east + margin + 180) / 360) };
}

/** Every shift of whole turns that brings part of a shape spanning `span` into the copies in view. */
// @spec MAP-GEO-014
export function copyShifts([min, max]: readonly [number, number], { lo, hi }: Copies): number[] {
  const west = -180 + 360 * lo;
  const east = 180 + 360 * hi;
  const out: number[] = [];
  // `+ 0` turns a shift of −0 into 0.
  for (let k = Math.ceil((west - max) / 360); min + 360 * k <= east; k++) out.push(360 * k + 0);
  return out;
}

const shiftedLines = new WeakMap<LatLng[], Map<number, LatLng[]>>();
const shiftedPoints = new WeakMap<LatLng, Map<number, LatLng>>();

/**
 * A line moved by `shift` degrees of longitude, kept per line and shift: the same line on the same
 * copy is the same array, so re-rendering the map hands Leaflet nothing new to redraw.
 */
// @spec MAP-GEO-020
export function shiftLine(pts: LatLng[], shift: number): LatLng[] {
  if (shift === 0) return pts;
  let byShift = shiftedLines.get(pts);
  if (!byShift) shiftedLines.set(pts, (byShift = new Map()));
  let out = byShift.get(shift);
  if (!out) byShift.set(shift, (out = pts.map(([lat, lon]): LatLng => [lat, lon + shift])));
  return out;
}

/** A point moved by `shift` degrees of longitude, kept per point and shift like `shiftLine`. */
export function shiftPoint(p: LatLng, shift: number): LatLng {
  if (shift === 0) return p;
  let byShift = shiftedPoints.get(p);
  if (!byShift) shiftedPoints.set(p, (byShift = new Map()));
  let out = byShift.get(shift);
  if (!out) byShift.set(shift, (out = [p[0], p[1] + shift]));
  return out;
}

/** Length of a polyline in nautical miles. */
export function pathNm(pts: LatLng[]): number {
  let nm = 0;
  for (let i = 1; i < pts.length; i++) nm += distanceNm(pts[i - 1], pts[i]);
  return nm;
}

// @spec MAP-GEO-001, MAP-GEO-002, MAP-GEO-003, MAP-GEO-006, MAP-GEO-007, MAP-GEO-008, MAP-GEO-009, MAP-GEO-016
export function buildRenderData(state: AppState | null): RenderData {
  if (!state) return EMPTY;
  const nodeMap = new Map<string, AirportNode>();
  const node = (ap: Airport): AirportNode => {
    let n = nodeMap.get(ap.ident);
    if (!n) {
      n = { key: ap.ident, airport: ap, pos: [ap.lat, ap.lon], events: [], aircraftIds: new Set(), parked: [] };
      nodeMap.set(ap.ident, n);
    }
    return n;
  };

  const hops: RenderHop[] = [];
  const heads: Head[] = [];
  const headsAt = new Map<string, number>();

  for (const a of state.aircraft) {
    if (!a.visible) continue;
    const mine = state.hops.filter((h) => h.aircraft_id === a.id);
    let last: RenderHop | null = null;

    for (const h of mine) {
      const from = state.airports[h.origin];
      const to = state.airports[h.dest];
      if (!from || !to) continue;
      // Each hop is placed on its own, from its origin's own longitude.
      const A: LatLng = [from.lat, from.lon];
      const track = parseTrack(h.track);
      const tracked = track.length >= 2;
      // A recorded track is tied to the airport dots at both ends so the line never floats free.
      const pts = tracked ? placeLine([A, ...track.map((p): LatLng => [p[0], p[1]]), [to.lat, to.lon]]) : greatCircle(A, [to.lat, to.lon]);
      const r: RenderHop = { hop: h, aircraft: a, from, to, pts, nm: distanceNm(A, pts[pts.length - 1]), tracked, flownNm: tracked ? pathNm(pts) : null };
      hops.push(r);

      const nf = node(from);
      nf.events.push({ aircraft: a, hop: h, kind: "departed", time: h.departed_at });
      nf.aircraftIds.add(a.id);
      const nt = node(to);
      nt.events.push({ aircraft: a, hop: h, kind: "arrived", time: h.arrived_at });
      nt.aircraftIds.add(a.id);

      last = r;
    }

    if (last) {
      const n = node(last.to);
      n.parked.push(a);
      const k = headsAt.get(n.key) ?? 0;
      headsAt.set(n.key, k + 1);
      const angle = -Math.PI / 2 + k * (Math.PI / 3);
      const offset: [number, number] = k === 0 ? [0, 0] : [Math.round(Math.cos(angle) * 30), Math.round(Math.sin(angle) * 30)];
      heads.push({ aircraft: a, airport: last.to, pos: n.pos, offset });
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

interface PlanGeometry {
  range_nm: number;
  origin: { lat: number; lon: number };
}

/** The range ring's bounding box: latitudes clamped to ±85°, at most a full turn of longitude wide. */
function planBox(plan: PlanGeometry) {
  const dLat = plan.range_nm / 60;
  const dLon = Math.min(180, plan.range_nm / (60 * Math.max(0.05, Math.cos((plan.origin.lat * Math.PI) / 180))));
  return {
    south: Math.max(-85, plan.origin.lat - dLat),
    north: Math.min(85, plan.origin.lat + dLat),
    west: plan.origin.lon - dLon,
    east: plan.origin.lon + dLon,
  };
}

/** How far east and west the range ring reaches, for choosing the copies it is drawn on. */
export function planSpan(plan: PlanGeometry): [number, number] {
  const b = planBox(plan);
  return [b.west, b.east];
}

/**
 * Zoom points for a plan: the ring's bounding box, as points along its top and bottom edges no more
 * than 30° of longitude apart, so a box wider than 180° is gathered whole rather than the other way
 * round the globe.
 */
// @spec MAP-GEO-021
export function planZoomPoints(plan: PlanGeometry): LatLng[] {
  const b = planBox(plan);
  const steps = Math.max(1, Math.ceil((b.east - b.west) / 30));
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const lon = b.west + ((b.east - b.west) * i) / steps;
    pts.push([b.south, lon], [b.north, lon]);
  }
  return pts;
}

/** The live aircraft at its own position, and its track placed sample to sample. */
// @spec LIVE-LAYER-002
export function liveShapes(position: { lat: number; lon: number }, track: TrackPoint[]): { pos: LatLng; track: LatLng[] } {
  return { pos: [position.lat, position.lon], track: placeLine(track.map((p): LatLng => [p[0], p[1]])) };
}

/** A SimBrief route's fixes placed fix to fix. */
// @spec SB-ROUTE-003
export function routeLine(fixes: OfpFix[]): LatLng[] {
  return placeLine(fixes.map((f): LatLng => [f.lat, f.lon]));
}

/** Every rendered coordinate, optionally limited to one aircraft or one hop. Used for zoom-to-fit. */
// @spec MAP-GEO-011
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
