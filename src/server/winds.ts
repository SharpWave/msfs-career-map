import type { WindSource } from "./performance.ts";
import { USER_AGENT } from "./version.ts";
/**
 * Winds aloft for the planner, from Open-Meteo's forecast API (its default model blend): wind speed
 * and direction at the standard pressure levels, fetched at the nodes of a fixed lattice over the
 * area a search covers, for the UTC hour under way, and interpolated between nodes and levels.
 * Kept in memory per node, level and hour, at most 50,000 winds.
 */

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const EARTH_NM = 3440.065;
const NM_PER_DEG = (EARTH_NM * Math.PI) / 180;
const SPACINGS = [0.5, 1, 2, 3, 5, 10];
const MAX_NODES = 300;
const MAX_LAT = 85;
const PER_REQUEST = 100;
const TIMEOUT_MS = 15_000;
const PAUSE_MS = 5 * 60_000;
const CACHE_MAX = 50_000;

export const PRESSURE_LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** Longitude in −180° to under 180°. */
const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** A pressure level's altitude in the standard atmosphere, ft. */
export function pressureAltitudeFt(hpa: number): number {
  return 145366.45 * (1 - Math.pow(hpa / 1013.25, 0.190284));
}

const LEVEL_ALT = PRESSURE_LEVELS_HPA.map(pressureAltitudeFt);

/**
 * The levels a search needs: from the one at or below the lower of the climb's half-way altitude
 * and half the cruise altitude, to the one at or above the cruise altitude.
 */
// @spec PLAN-WIND-002
export function levelsFor(originElevFt: number, cruiseAltFt: number): number[] {
  const low = Math.min((originElevFt + cruiseAltFt) / 2, cruiseAltFt / 2);
  let bottom = 0;
  LEVEL_ALT.forEach((a, i) => {
    if (a <= low) bottom = i;
  });
  let top = LEVEL_ALT.findIndex((a) => a >= cruiseAltFt);
  if (top < 0) top = LEVEL_ALT.length - 1;
  return PRESSURE_LEVELS_HPA.slice(bottom, Math.max(bottom, top) + 1);
}

/** Half the circle's width in longitude at `lat`, degrees (180 when it reaches all the way round). */
function halfWidth(origin: { lat: number }, r: number, lat: number): number {
  const c = (Math.cos(r) - Math.sin(rad(origin.lat)) * Math.sin(rad(lat))) / (Math.cos(rad(origin.lat)) * Math.cos(rad(lat)));
  if (c <= -1) return 180;
  if (c >= 1) return 0;
  return deg(Math.acos(c));
}

/**
 * The corners of every cell of a `spacingDeg` lattice that a circle of `radiusNm` around `origin`
 * touches, latitudes within ±85°, longitudes in −180° to under 180°.
 */
// @spec PLAN-WIND-003
export function gridNodes(origin: { lat: number; lon: number }, radiusNm: number, spacingDeg: number): [number, number][] {
  const s = spacingDeg;
  const r = Math.min(Math.PI, radiusNm / EARTH_NM);
  const rDeg = deg(r);
  const south = Math.max(-MAX_LAT, origin.lat - rDeg);
  const north = Math.min(MAX_LAT, origin.lat + rDeg);
  const cols = Math.round(360 / s);
  const maxRow = Math.floor(MAX_LAT / s);
  const seen = new Set<string>();
  const nodes: [number, number][] = [];
  const add = (row: number, col: number) => {
    if (Math.abs(row) > maxRow) return;
    const c = ((col % cols) + cols) % cols;
    const key = `${row},${c}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push([row * s, normLon(c * s)]);
  };
  // Where the circle is widest, when that latitude lies inside it.
  const widest = Math.abs(Math.sin(rad(origin.lat)) / Math.cos(r)) <= 1 ? deg(Math.asin(Math.sin(rad(origin.lat)) / Math.cos(r))) : null;
  for (let row = Math.floor(south / s); row * s < north; row++) {
    const lo = Math.max(south, row * s), hi = Math.min(north, (row + 1) * s);
    const lats = [lo, hi];
    if (widest !== null && widest > lo && widest < hi) lats.push(widest);
    const span = Math.max(...lats.map((lat) => halfWidth(origin, r, lat)));
    const firstCol = span >= 180 ? 0 : Math.floor((origin.lon - span) / s);
    const lastCol = span >= 180 ? cols - 1 : Math.ceil((origin.lon + span) / s) - 1;
    for (let col = firstCol; col <= lastCol; col++) {
      add(row, col);
      add(row + 1, col);
      add(row, col + 1);
      add(row + 1, col + 1);
    }
  }
  return nodes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The finest lattice that needs at most 300 nodes for the area, or null when even 10° needs more. */
// @spec PLAN-WIND-003, PLAN-WIND-004
export function chooseGrid(origin: { lat: number; lon: number }, radiusNm: number): { spacingDeg: number; nodes: [number, number][] } | null {
  for (const spacingDeg of SPACINGS) {
    const nodes = gridNodes(origin, radiusNm, spacingDeg);
    if (nodes.length <= MAX_NODES) return { spacingDeg, nodes };
  }
  return null;
}

/** One node's winds as fetched, one entry per level: knots, and the direction they blow from. */
export interface GridNode {
  lat: number;
  lon: number;
  speed: (number | null)[];
  direction: (number | null)[];
}

export interface WindField extends WindSource {
  levels: number[];
}

/**
 * The wind at any point and altitude from the fetched nodes: east and north components bilinear in
 * the cell around the point (wrapping across 180°), linear in altitude between levels; the nearest
 * fetched node outside the fetched cells. Null when a node has no wind at any level.
 */
// @spec PLAN-WIND-005, PLAN-WIND-006
export function buildField(grid: { spacingDeg: number; levels: number[]; nodes: GridNode[] }): WindField | null {
  const s = grid.spacingDeg;
  const cols = Math.round(360 / s);
  const alts = grid.levels.map(pressureAltitudeFt);
  const byKey = new Map<string, { u: number[]; v: number[] }>();
  const all: { lat: number; lon: number; u: number[]; v: number[] }[] = [];
  let maxKts = 0;
  for (const n of grid.nodes) {
    const u: number[] = [], v: number[] = [];
    for (let i = 0; i < grid.levels.length; i++) {
      // A level without a wind takes the node's nearest level above that has one, else below.
      let j = i;
      while (j < grid.levels.length && (n.speed[j] == null || n.direction[j] == null)) j++;
      if (j === grid.levels.length) {
        j = i;
        while (j >= 0 && (n.speed[j] == null || n.direction[j] == null)) j--;
      }
      if (j < 0) return null;
      const sp = n.speed[j]!, dir = rad(n.direction[j]!);
      maxKts = Math.max(maxKts, sp);
      u.push(-sp * Math.sin(dir));
      v.push(-sp * Math.cos(dir));
    }
    const row = Math.round(n.lat / s);
    const col = ((Math.round(normLon(n.lon) / s) % cols) + cols) % cols;
    byKey.set(`${row},${col}`, { u, v });
    all.push({ lat: n.lat, lon: normLon(n.lon), u, v });
  }

  /** Index and weight of the levels either side of `altFt` (levels run up in altitude). */
  const levelMix = (altFt: number): [number, number, number] => {
    if (alts.length === 1 || altFt <= alts[0]) return [0, 0, 0];
    const last = alts.length - 1;
    if (altFt >= alts[last]) return [last, last, 0];
    let i = 0;
    while (alts[i + 1] < altFt) i++;
    return [i, i + 1, (altFt - alts[i]) / (alts[i + 1] - alts[i])];
  };

  const at = (lat: number, lonIn: number, altFt: number) => {
    const lon = normLon(lonIn);
    const [lo, hi, w] = levelMix(altFt);
    const comp = (n: { u: number[]; v: number[] }) => ({ u: n.u[lo] + (n.u[hi] - n.u[lo]) * w, v: n.v[lo] + (n.v[hi] - n.v[lo]) * w });
    const row = Math.floor(lat / s);
    const col = Math.floor(lon / s);
    const key = (r: number, c: number) => `${r},${((c % cols) + cols) % cols}`;
    const sw = byKey.get(key(row, col)), nw = byKey.get(key(row + 1, col));
    const se = byKey.get(key(row, col + 1)), ne = byKey.get(key(row + 1, col + 1));
    if (sw && nw && se && ne) {
      const fy = (lat - row * s) / s, fx = (lon - col * s) / s;
      const [a, b, c, d] = [comp(sw), comp(se), comp(nw), comp(ne)];
      const mix = (k: "u" | "v") => a[k] * (1 - fx) * (1 - fy) + b[k] * fx * (1 - fy) + c[k] * (1 - fx) * fy + d[k] * fx * fy;
      return { u: mix("u"), v: mix("v") };
    }
    let best = all[0], bestD = Infinity;
    for (const n of all) {
      let dLon = Math.abs(n.lon - lon);
      if (dLon > 180) dLon = 360 - dLon;
      const dd = (n.lat - lat) ** 2 + (dLon * Math.cos(rad(lat))) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = n;
      }
    }
    return comp(best);
  };

  return { at, spacingDeg: s, maxKts, levels: grid.levels };
}

// ---------- lookup and cache ----------

export type WindLookup =
  | { status: "forecast"; field: WindField; hour: string; levels: number[]; spacingDeg: number }
  | { status: "unavailable"; reason: "failed" | "recent_failure" | "too_wide" };

interface Cached {
  speed: number | null;
  direction: number | null;
}

/** Winds by `hour|level|lat,lon`, oldest use first. */
const cache = new Map<string, Cached>();
/** Keys a lookup under way uses, with how many lookups use each. */
const inUse = new Map<string, number>();
/** Hours a lookup under way uses, with how many. */
const hoursInUse = new Map<string, number>();
let lastFailure: number | null = null;

const cacheKey = (hour: string, level: number, lat: number, lon: number) => `${hour}|${level}|${lat},${lon}`;

const bump = <K>(m: Map<K, number>, k: K, by: number) => {
  const n = (m.get(k) ?? 0) + by;
  if (n > 0) m.set(k, n);
  else m.delete(k);
};

function store(key: string, value: Cached) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= CACHE_MAX) return;
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_MAX) break;
    if (!inUse.has(k)) cache.delete(k);
  }
}

/** Forget every wind held and any failure (tests). */
export function forgetWinds(): void {
  cache.clear();
  lastFailure = null;
}

/** How many winds the cache holds (one node at one level for one hour each). */
export function windCacheSize(): number {
  return cache.size;
}

/** Ask Open-Meteo for `nodes` at `levels` for `hour`; each location's winds in order. */
async function fetchNodes(nodes: [number, number][], levels: number[], hour: string, signal: AbortSignal): Promise<Cached[][]> {
  const hourly = levels.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]).join(",");
  const url =
    `${OPEN_METEO}?latitude=${nodes.map((n) => n[0]).join(",")}&longitude=${nodes.map((n) => n[1]).join(",")}` +
    `&hourly=${hourly}&wind_speed_unit=kn&start_hour=${hour}&end_hour=${hour}`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal });
  if (!res.ok) throw new Error(`open-meteo: ${res.status}`);
  const j = (await res.json()) as unknown;
  const locations = (Array.isArray(j) ? j : [j]) as { hourly?: Record<string, unknown[]> }[];
  if (locations.length !== nodes.length) throw new Error("open-meteo: wrong number of locations");
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return locations.map((loc) =>
    levels.map((l) => ({ speed: num(loc.hourly?.[`wind_speed_${l}hPa`]?.[0]), direction: num(loc.hourly?.[`wind_direction_${l}hPa`]?.[0]) })),
  );
}

/**
 * The winds over a circle of `areaRadiusNm` around `origin` at `levels`, for the UTC hour under way
 * at `now`: from the cache where held, from Open-Meteo otherwise, in requests of up to 100 nodes
 * sent together and given up after 15 s. Unavailable when a request fails or a node has no wind,
 * for 5 minutes after such a failure, and for an area needing more than 300 nodes.
 */
// @spec PLAN-WIND-001, PLAN-WIND-004, PLAN-WIND-007, PLAN-WIND-008, PLAN-WIND-009, PLAN-WIND-010, PLAN-WIND-011
export async function lookupWinds(opts: { origin: { lat: number; lon: number }; areaRadiusNm: number; levels: number[]; now?: Date }): Promise<WindLookup> {
  const now = opts.now ?? new Date();
  if (lastFailure !== null && now.getTime() - lastFailure < PAUSE_MS) return { status: "unavailable", reason: "recent_failure" };
  const grid = chooseGrid(opts.origin, opts.areaRadiusNm);
  if (!grid) return { status: "unavailable", reason: "too_wide" };
  const hour = now.toISOString().slice(0, 13) + ":00";
  const levels = opts.levels;

  // Drop the hours no lookup under way uses.
  bump(hoursInUse, hour, 1);
  for (const k of [...cache.keys()]) {
    if (!hoursInUse.has(k.slice(0, k.indexOf("|"))) && !inUse.has(k)) cache.delete(k);
  }
  const keys = grid.nodes.flatMap(([lat, lon]) => levels.map((l) => cacheKey(hour, l, lat, lon)));
  for (const k of keys) bump(inUse, k, 1);
  try {
    const missing = grid.nodes.filter(([lat, lon]) => levels.some((l) => !cache.has(cacheKey(hour, l, lat, lon))));
    if (missing.length) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const chunks: [number, number][][] = [];
      for (let i = 0; i < missing.length; i += PER_REQUEST) chunks.push(missing.slice(i, i + PER_REQUEST));
      const results = await Promise.allSettled(chunks.map((c) => fetchNodes(c, levels, hour, ctl.signal)));
      clearTimeout(timer);
      results.forEach((r, ci) => {
        if (r.status !== "fulfilled") return;
        chunks[ci].forEach(([lat, lon], ni) => levels.forEach((l, li) => store(cacheKey(hour, l, lat, lon), r.value[ni][li])));
      });
      if (results.some((r) => r.status === "rejected")) {
        lastFailure = now.getTime();
        return { status: "unavailable", reason: "failed" };
      }
    }
    const nodes: GridNode[] = grid.nodes.map(([lat, lon]) => {
      const winds = levels.map((l) => {
        const k = cacheKey(hour, l, lat, lon);
        const w = cache.get(k)!;
        // A use: move it to the newest end.
        cache.delete(k);
        cache.set(k, w);
        return w;
      });
      return { lat, lon, speed: winds.map((w) => w.speed), direction: winds.map((w) => w.direction) };
    });
    const field = buildField({ spacingDeg: grid.spacingDeg, levels, nodes });
    if (!field) {
      lastFailure = now.getTime();
      return { status: "unavailable", reason: "failed" };
    }
    return { status: "forecast", field, hour: hour + "Z", levels, spacingDeg: grid.spacingDeg };
  } finally {
    for (const k of keys) bump(inUse, k, -1);
    bump(hoursInUse, hour, -1);
  }
}
