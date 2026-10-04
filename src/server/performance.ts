/**
 * Simple block-time model: fixed taxi/departure/approach overhead, a climb at reduced speed,
 * cruise, and a descent. The same shape SimBrief uses, with a handful of numbers per aircraft
 * instead of full performance tables. Wind is deliberately ignored.
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

/** Farthest leg (nm) that fits in `maxMinutes`, for a destination at the origin's elevation. */
export function maxRangeNm(p: PerfProfile, maxMinutes: number, originElevFt: number): number {
  if (maxMinutes <= p.overhead_min) return 0;
  let lo = 0;
  let hi = (p.cruise_kts * maxMinutes) / 60; // naive upper bound
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (blockMinutes(p, mid, originElevFt, originElevFt) <= maxMinutes) lo = mid;
    else hi = mid;
  }
  return lo;
}
