/**
 * The block-time model flown through a wind (PLAN-TIME-007 to 013): groundspeed with the wind
 * correction angle, each phase in the wind at its own height and place, the branch between a full
 * and a short leg, cruise steps, and the range ring's 72 radii. Legs run along the equator or a
 * meridian, where the great-circle track is constant, so the expected times are worked by hand.
 */
import { describe, expect, it } from "vitest";
import {
  blockMinutes,
  groundspeedKts,
  legMinutes,
  maxRangeNm,
  ringRadiiNm,
  type PerfProfile,
  type WindSource,
} from "../../src/server/performance.ts";

const NM_PER_DEG = (3440.065 * Math.PI) / 180;
const east = (nm: number) => ({ lat: 0, lon: nm / NM_PER_DEG, elevation_ft: 0 });
const ORIGIN = { lat: 0, lon: 0, elevation_ft: 0 };

// Climb 10 min (5,000 ft at 500 fpm) covering 13.3 nm in still air; descent 10 min covering 20 nm.
const P: PerfProfile = { cruise_kts: 120, cruise_alt_ft: 5000, climb_fpm: 500, climb_kts: 80, descent_fpm: 500, overhead_min: 10 };

/** The same wind (east and north components, kt) everywhere. */
const uniform = (u: number, v: number, spacingDeg = 1): WindSource => ({ at: () => ({ u, v }), spacingDeg, maxKts: Math.hypot(u, v) });

/** A calm wind that records where and at what altitude it was asked for. */
function recorder(spacingDeg = 1) {
  const calls: { lat: number; lon: number; alt: number }[] = [];
  const src: WindSource = {
    at: (lat, lon, alt) => {
      calls.push({ lat, lon, alt });
      return { u: 0, v: 0 };
    },
    spacingDeg,
    maxKts: 0,
  };
  return { src, calls };
}

describe("groundspeed", () => {
  // @spec PLAN-TIME-008
  it("is the airspeed flown with the wind correction angle plus the tailwind", () => {
    expect(groundspeedKts(120, 90, { u: 20, v: 0 })).toBeCloseTo(140, 6);
    expect(groundspeedKts(120, 270, { u: 20, v: 0 })).toBeCloseTo(100, 6);
    // A 30 kt wind from the north across an eastbound track.
    expect(groundspeedKts(120, 90, { u: 0, v: -30 })).toBeCloseTo(Math.sqrt(120 ** 2 - 30 ** 2), 6);
    // From the north-west at 20 kt on a northbound track: 14.1 kt across and 14.1 kt against.
    const c = 20 * Math.SQRT1_2;
    expect(groundspeedKts(120, 0, { u: c, v: -c })).toBeCloseTo(Math.sqrt(120 ** 2 - c ** 2) - c, 6);
  });

  // @spec PLAN-TIME-009
  it("is out of reach when the crosswind reaches the airspeed or the groundspeed is not positive", () => {
    expect(groundspeedKts(120, 90, { u: 0, v: 130 })).toBeNull();
    expect(groundspeedKts(120, 90, { u: 0, v: -120 })).toBeNull();
    expect(groundspeedKts(120, 0, { u: 0, v: -130 })).toBeNull();
    expect(groundspeedKts(120, 0, { u: 0, v: -120 })).toBeNull();
  });
});

describe("a leg flown through the wind", () => {
  // @spec PLAN-TIME-008, PLAN-TIME-011
  it("covers each phase's ground at its groundspeed and keeps the climb and descent times", () => {
    // 20 kt tailwind: climb 100 kt for 10 min (16.7 nm), descent 140 kt for 10 min (23.3 nm), the
    // remaining 160 nm of cruise at 140 kt.
    expect(legMinutes(P, ORIGIN, east(200), uniform(20, 0))).toBeCloseTo(10 + 10 + (160 / 140) * 60 + 10, 4);
  });

  // @spec PLAN-TIME-010
  it("flies the climb and descent in the wind at their half-way altitudes", () => {
    // The wind from the west grows 1 kt per 100 ft: 25 kt at 2,500 ft, 50 kt at 5,000 ft.
    const src: WindSource = { at: (_lat, _lon, alt) => ({ u: alt / 100, v: 0 }), spacingDeg: 1, maxKts: 50 };
    const climb = (10 / 60) * 105;
    const descent = (10 / 60) * 145;
    expect(legMinutes(P, ORIGIN, east(200), src)).toBeCloseTo(10 + 10 + ((200 - climb - descent) / 170) * 60 + 10, 4);
  });

  // @spec PLAN-TIME-010, PLAN-TIME-011
  it("samples the climb and descent at their still-air half-way points and the cruise at each step's midpoint", () => {
    const { src, calls } = recorder(1);
    legMinutes(P, ORIGIN, east(200), src);
    const at = (alt: number) => calls.filter((c) => Math.abs(c.alt - alt) < 1).map((c) => c.lon * NM_PER_DEG);

    const phases = at(2500);
    expect(phases.some((nm) => Math.abs(nm - 13.3333 / 2) < 0.01)).toBe(true);
    expect(phases.some((nm) => Math.abs(nm - (200 - 20 / 2)) < 0.01)).toBe(true);

    // 166.7 nm of cruise in steps of at most 30 nm (1° spacing): six steps of 27.8 nm.
    const step = (200 - 13.3333 - 20) / 6;
    const cruise = at(5000).sort((a, b) => a - b);
    expect(cruise).toHaveLength(6);
    cruise.forEach((nm, i) => expect(nm).toBeCloseTo(13.3333 + step * (i + 0.5), 2));
  });

  // @spec PLAN-TIME-011
  it("decides whether the leg reaches cruise altitude on the distances flown in the wind", () => {
    // 36 nm: the still-air climb and descent (33.3 nm) fit, but with a 20 kt tailwind they cover
    // 40 nm, so the leg is short: h × (100 + 140) / (60 × 500) = 36 → 4,500 ft, 9 min up and 9 down.
    expect(legMinutes(P, ORIGIN, east(36), uniform(20, 0))).toBeCloseTo(10 + 9 + 9, 4);
  });

  // @spec PLAN-TIME-012
  it("times a short leg to the height its groundspeeds allow, with the winds taken at its ends", () => {
    expect(legMinutes(P, ORIGIN, east(20), uniform(20, 0))).toBeCloseTo(10 + 5 + 5, 4);
    const { src, calls } = recorder(1);
    legMinutes(P, ORIGIN, east(20), src);
    const phases = calls.filter((c) => Math.abs(c.alt - 2500) < 1).map((c) => c.lon * NM_PER_DEG);
    expect(phases.some((nm) => Math.abs(nm) < 0.01)).toBe(true);
    expect(phases.some((nm) => Math.abs(nm - 20) < 0.01)).toBe(true);
  });

  // @spec PLAN-TIME-009
  it("is out of reach where the wind is too strong for the aircraft", () => {
    expect(legMinutes(P, ORIGIN, east(200), uniform(0, 130))).toBe(Infinity);
    expect(legMinutes(P, ORIGIN, east(200), uniform(-130, 0))).toBe(Infinity);
  });

  // @spec PLAN-TIME-013
  it("is timed by the still-air formulas without winds", () => {
    for (const nm of [5, 20, 36, 200, 900]) {
      expect(legMinutes(P, ORIGIN, east(nm), null)).toBeCloseTo(blockMinutes(P, nm, 0, 0), 6);
    }
    const high = { ...east(150), elevation_ft: 4200 };
    expect(legMinutes(P, ORIGIN, high, null)).toBeCloseTo(blockMinutes(P, 150, 0, 4200), 6);
  });
});

describe("the range ring", () => {
  const MAX = 10 + 10 + (160 / 140) * 60 + 10; // 200 nm downwind in a 20 kt tailwind

  // @spec PLAN-TIME-007
  it("has a radius on each of 72 bearings, reaching farther downwind than upwind", () => {
    const ring = ringRadiiNm(P, MAX, ORIGIN, uniform(20, 0));
    expect(ring).toHaveLength(72);
    // Beyond the still-air bound (cruise speed × time = 197 nm): the bisection's bound counts the wind.
    expect(ring[18]).toBeCloseTo(200, 1);
    // Upwind: climb 10 nm at 60 kt, descent 16.7 nm at 100 kt, 68.6 min of cruise at 100 kt.
    expect(ring[54]).toBeCloseTo(10 + 100 / 6 + ((MAX - 30) / 60) * 100, 1);
    // Across the wind, northbound.
    const gs = (tas: number) => Math.sqrt(tas ** 2 - 400);
    expect(ring[0]).toBeCloseTo((10 / 60) * gs(80) + (10 / 60) * gs(120) + ((MAX - 30) / 60) * gs(120), 1);
  });

  // @spec PLAN-TIME-007, PLAN-TIME-009
  it("is zero on a bearing where even the shortest leg is out of reach, and on every bearing for a time within the overhead", () => {
    const ring = ringRadiiNm(P, 90, ORIGIN, uniform(0, -130));
    expect(ring[0]).toBe(0); // straight into it
    expect(ring[18]).toBe(0); // across it
    expect(ring[36]).toBeGreaterThan(0); // with it
    expect(ringRadiiNm(P, 10, ORIGIN, uniform(20, 0))).toEqual(new Array(72).fill(0));
  });

  // @spec PLAN-TIME-013
  it("is a circle of the still-air range without winds", () => {
    const ring = ringRadiiNm(P, 90, ORIGIN, null);
    expect(ring).toHaveLength(72);
    for (const r of ring) expect(r).toBeCloseTo(maxRangeNm(P, 90, 0), 6);
  });
});
