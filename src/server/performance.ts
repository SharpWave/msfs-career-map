/**
 * Simple block-time model: fixed taxi/departure/approach overhead, a climb at reduced speed,
 * cruise, and a descent. The same shape SimBrief uses, with a handful of numbers per aircraft
 * instead of full performance tables, flown along the direct leg through the forecast wind when
 * one is given, each phase in the wind at its own height.
 */

export interface PerfProfile {
  cruise_kts: number;
  cruise_alt_ft: number;
  climb_fpm: number;
  climb_kts: number;
  descent_fpm: number;
  /** Taxi, takeoff, departure, approach and landing, minutes. */
  overhead_min: number;
}

export interface PerfInputs {
  cruise_kts: number;
  cruise_alt_ft?: number | null;
  climb_fpm?: number | null;
  climb_kts?: number | null;
  descent_fpm?: number | null;
  overhead_min?: number | null;
}

/** Light-piston defaults for anything not filled in. */
export const DEFAULTS = { cruise_alt_ft: 6500, climb_fpm: 700, climb_frac: 0.65, descent_fpm: 500, overhead_min: 12 };

export function profileFor(a: PerfInputs, cruiseAltOverride?: number | null): PerfProfile {
  return {
    cruise_kts: a.cruise_kts,
    cruise_alt_ft: cruiseAltOverride ?? a.cruise_alt_ft ?? DEFAULTS.cruise_alt_ft,
    climb_fpm: a.climb_fpm ?? DEFAULTS.climb_fpm,
    climb_kts: a.climb_kts ?? Math.round(a.cruise_kts * DEFAULTS.climb_frac),
    descent_fpm: a.descent_fpm ?? DEFAULTS.descent_fpm,
    overhead_min: a.overhead_min ?? DEFAULTS.overhead_min,
  };
}

/** Minimum cruise altitude: 1,000 ft above the higher of the two fields. */
function effectiveCruiseAlt(p: PerfProfile, originElevFt: number, destElevFt: number): number {
  return Math.max(p.cruise_alt_ft, Math.max(originElevFt, destElevFt) + 1000);
}

/** Estimated block time in minutes for a leg of `distNm`. */
export function blockMinutes(p: PerfProfile, distNm: number, originElevFt: number, destElevFt: number): number {
  const alt = effectiveCruiseAlt(p, originElevFt, destElevFt);
  const climbFt = Math.max(0, alt - originElevFt);
  const descFt = Math.max(0, alt - destElevFt);
  const tc = climbFt / p.climb_fpm; // minutes
  const td = descFt / p.descent_fpm;
  const dc = (tc / 60) * p.climb_kts; // nm covered while climbing
  const dd = (td / 60) * p.cruise_kts; // descent at roughly cruise speed
  if (distNm >= dc + dd) {
    return p.overhead_min + tc + ((distNm - dc - dd) / p.cruise_kts) * 60 + td;
  }
  // Too short to reach cruise altitude: climb to whatever height fits, then descend.
  const nmPerFtClimb = p.climb_kts / 60 / p.climb_fpm;
  const nmPerFtDesc = p.cruise_kts / 60 / p.descent_fpm;
  const h = distNm / (nmPerFtClimb + nmPerFtDesc);
  return p.overhead_min + h / p.climb_fpm + h / p.descent_fpm;
}

/**
 * Farthest leg (nm) that fits in `maxMinutes`, for a destination at the origin's elevation, by 40
 * halvings below `hiNm` (default: the naive cruise speed × time).
 */
export function maxRangeNm(p: PerfProfile, maxMinutes: number, originElevFt: number, hiNm?: number): number {
  if (maxMinutes <= p.overhead_min) return 0;
  return bisect(hiNm ?? (p.cruise_kts * maxMinutes) / 60, (nm) => blockMinutes(p, nm, originElevFt, originElevFt) <= maxMinutes);
}

function bisect(hiNm: number, fits: (nm: number) => boolean): number {
  let lo = 0;
  let hi = hiNm;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------- wind ----------

/** A wind field: east (`u`) and north (`v`) components in knots at a point and pressure altitude. */
export interface WindSource {
  at(lat: number, lon: number, altFt: number): { u: number; v: number };
  /** The grid's spacing in degrees, which sets the cruise step. */
  spacingDeg: number;
  /** The strongest wind in the field, for the ring's upper bound. */
  maxKts: number;
}

export interface Place {
  lat: number;
  lon: number;
  elevation_ft?: number | null;
}

/** Half the way round the Earth: no ring radius goes beyond it. */
export const MAX_RING_NM = 10800;
const EARTH_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function centralAngle(a: Place, b: Place): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function initialBearing(a: Place, b: Place): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `nm` along the great circle from `a` on `bearingDeg`. */
export function destinationPoint(a: Place, bearingDeg: number, nm: number): { lat: number; lon: number } {
  const d = nm / EARTH_NM, t = rad(bearingDeg), lat1 = rad(a.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lon2 = rad(a.lon) + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** The direct leg from `a` to `b`: the point and great-circle track `nm` along it. */
function legGeometry(a: Place, b: Place) {
  const d = centralAngle(a, b);
  const distNm = d * EARTH_NM;
  const finalTrack = (initialBearing(b, a) + 180) % 360;
  const pointAt = (nm: number): { lat: number; lon: number; track: number } => {
    const along = Math.max(0, Math.min(distNm, nm));
    if (d < 1e-12) return { lat: a.lat, lon: a.lon, track: 0 };
    if (distNm - along < 1e-9) return { lat: b.lat, lon: b.lon, track: finalTrack };
    const f = along / distNm;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
    const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
    const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
    const p = { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
    return { ...p, track: initialBearing(p, b) };
  };
  return { distNm, pointAt };
}

/**
 * Groundspeed holding `trackDeg` at `tasKts` in wind `w`: √(TAS² − crosswind²) + tailwind, or null
 * when the crosswind reaches the airspeed or the groundspeed is not positive (out of reach).
 */
// @spec PLAN-TIME-008, PLAN-TIME-009
export function groundspeedKts(tasKts: number, trackDeg: number, w: { u: number; v: number }): number | null {
  const t = rad(trackDeg);
  const along = w.u * Math.sin(t) + w.v * Math.cos(t);
  const across = w.u * Math.cos(t) - w.v * Math.sin(t);
  if (Math.abs(across) >= tasKts) return null;
  const gs = Math.sqrt(tasKts ** 2 - across ** 2) + along;
  return gs > 0 ? gs : null;
}

/**
 * Block time in minutes for the direct leg from `from` to `to`, flown through `wind` (still air
 * when null), or Infinity when the wind puts the leg out of reach.
 */
// @spec PLAN-TIME-008, PLAN-TIME-009, PLAN-TIME-010, PLAN-TIME-011, PLAN-TIME-012, PLAN-TIME-013
export function legMinutes(p: PerfProfile, from: Place, to: Place, wind: WindSource | null): number {
  const originElev = from.elevation_ft ?? 0;
  const destElev = to.elevation_ft ?? 0;
  const leg = legGeometry(from, to);
  const dist = leg.distNm;
  if (!wind) return blockMinutes(p, dist, originElev, destElev);

  const alt = effectiveCruiseAlt(p, originElev, destElev);
  const tc = Math.max(0, alt - originElev) / p.climb_fpm; // minutes
  const td = Math.max(0, alt - destElev) / p.descent_fpm;
  const climbAlt = (originElev + alt) / 2;
  const descentAlt = (alt + destElev) / 2;
  const gsAt = (tas: number, nm: number, altFt: number) => {
    const pt = leg.pointAt(nm);
    return groundspeedKts(tas, pt.track, wind.at(pt.lat, pt.lon, altFt));
  };

  // Each phase at one groundspeed, sampled half-way through its still-air ground distance.
  const gsClimb = gsAt(p.climb_kts, ((tc / 60) * p.climb_kts) / 2, climbAlt);
  const gsDescent = gsAt(p.cruise_kts, dist - ((td / 60) * p.cruise_kts) / 2, descentAlt);
  if (gsClimb === null || gsDescent === null) return Infinity;
  const dc = (tc / 60) * gsClimb;
  const dd = (td / 60) * gsDescent;

  if (dc + dd <= dist) {
    const cruiseNm = dist - dc - dd;
    const steps = cruiseNm > 0 ? Math.ceil(cruiseNm / (wind.spacingDeg * 30)) : 0;
    const step = steps ? cruiseNm / steps : 0;
    let cruiseMin = 0;
    for (let i = 0; i < steps; i++) {
      const gs = gsAt(p.cruise_kts, dc + step * (i + 0.5), alt);
      if (gs === null) return Infinity;
      cruiseMin += (step / gs) * 60;
    }
    return p.overhead_min + tc + cruiseMin + td;
  }

  // Too short to reach cruise altitude: the climb's wind at the origin, the descent's at the destination.
  const gsUp = gsAt(p.climb_kts, 0, climbAlt);
  const gsDown = gsAt(p.cruise_kts, dist, descentAlt);
  if (gsUp === null || gsDown === null) return Infinity;
  const h = dist / (gsUp / 60 / p.climb_fpm + gsDown / 60 / p.descent_fpm);
  return p.overhead_min + h / p.climb_fpm + h / p.descent_fpm;
}

/**
 * The range ring: on each of 72 bearings, every 5° from true north, the longest leg that fits in
 * `maxMinutes` for a destination at the origin's elevation, by 40 halvings below the distance
 * covered at cruise speed plus the strongest wind (at most half the way round the Earth).
 */
// @spec PLAN-TIME-007, PLAN-TIME-013
export function ringRadiiNm(p: PerfProfile, maxMinutes: number, origin: Place, wind: WindSource | null): number[] {
  if (maxMinutes <= p.overhead_min) return new Array(72).fill(0);
  const elev = origin.elevation_ft ?? 0;
  const hi = Math.min(MAX_RING_NM, ((p.cruise_kts + (wind?.maxKts ?? 0)) * maxMinutes) / 60);
  if (!wind) return new Array(72).fill(maxRangeNm(p, maxMinutes, elev, hi));
  return Array.from({ length: 72 }, (_, i) =>
    bisect(hi, (nm) => legMinutes(p, origin, { ...destinationPoint(origin, i * 5, nm), elevation_ft: elev }, wind) <= maxMinutes),
  );
}
