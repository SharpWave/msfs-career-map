/**
 * A plan's range ring shaped by the wind (MAP-GEO-021, MAP-GEO-022): its outline placed from the
 * origin a point every 1° of bearing, across the antimeridian, and the zoom box fitted to the
 * outline rather than to a circle of the longest radius.
 */
import { describe, expect, it } from "vitest";
import { bearing, distanceNm } from "../../src/client/geo.ts";
import { lonSpan, planSpan, planZoomPoints, ringOutline } from "../../src/client/paths.ts";

const NM_PER_DEG = (3440.065 * Math.PI) / 180;
const circle = (nm: number) => new Array(72).fill(nm);
/** 72 radii from `east` nm at 090° to `west` nm at 270°. */
const skewed = (east: number, west: number) =>
  Array.from({ length: 72 }, (_, i) => (east + west) / 2 + ((east - west) / 2) * Math.sin((i * 5 * Math.PI) / 180));

describe("the range ring's outline", () => {
  // @spec MAP-GEO-022
  it("is a point every 1° of bearing at the ring's radius on that bearing", () => {
    const origin = { lat: 41.7, lon: -71.4 };
    const pts = ringOutline({ origin, ring_nm: circle(120), range_nm: 120 });
    expect(pts).toHaveLength(360);
    pts.forEach((p, k) => {
      expect(distanceNm([origin.lat, origin.lon], p)).toBeCloseTo(120, 1);
      const b = bearing([origin.lat, origin.lon], p);
      expect(Math.min(Math.abs(b - k), 360 - Math.abs(b - k))).toBeLessThan(0.01);
    });
  });

  // @spec MAP-GEO-022
  it("interpolates the radius linearly between the planner's bearings", () => {
    const ring = circle(100);
    ring[1] = 200; // 005°
    const origin = { lat: 0, lon: 0 };
    const pts = ringOutline({ origin, ring_nm: ring, range_nm: 200 });
    expect(distanceNm([0, 0], pts[2])).toBeCloseTo(140, 1);
    expect(distanceNm([0, 0], pts[5])).toBeCloseTo(200, 1);
    expect(distanceNm([0, 0], pts[8])).toBeCloseTo(140, 1);
  });

  // @spec MAP-GEO-022, MAP-GEO-014
  it("runs on past 180° rather than jumping across the map", () => {
    const origin = { lat: 52, lon: 179.5 };
    const pts = ringOutline({ origin, ring_nm: circle(300), range_nm: 300 });
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThan(180);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(180);
    const [west, east] = planSpan({ origin, ring_nm: circle(300), range_nm: 300 });
    expect(west).toBeLessThan(179.5);
    expect(east).toBeGreaterThan(180);
  });
});

describe("zooming to a plan", () => {
  // @spec MAP-GEO-021
  it("fits the box of the ring's outline, so a ring stretched by the wind is fitted as drawn", () => {
    const origin = { lat: 0, lon: 0 };
    const ring = skewed(300, 100);
    const plan = { origin, ring_nm: ring, range_nm: 300 };
    const [west, east] = lonSpan(planZoomPoints(plan));
    expect(west).toBeCloseTo(-100 / NM_PER_DEG, 1);
    expect(east).toBeCloseTo(300 / NM_PER_DEG, 1);
    expect(planSpan(plan)[0]).toBeCloseTo(-100 / NM_PER_DEG, 1);
    const lats = planZoomPoints(plan).map((p) => p[0]);
    expect(Math.max(...lats)).toBeLessThan(250 / NM_PER_DEG);
  });

  // @spec MAP-GEO-021
  it("keeps latitudes within ±85°", () => {
    const pts = planZoomPoints({ origin: { lat: 80, lon: 10 }, ring_nm: circle(900), range_nm: 900 });
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(85);
  });
});
