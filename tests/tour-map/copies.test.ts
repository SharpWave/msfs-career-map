import { describe, expect, it } from "vitest";
import type { LatLng } from "../../src/client/geo.ts";
import { gatherPoints } from "../../src/client/fit.ts";
import {
  copiesInView,
  copyShifts,
  liveShapes,
  lonSpan,
  placeLine,
  planSpan,
  planZoomPoints,
  routeLine,
  shiftLine,
  shiftPoint,
} from "../../src/client/paths.ts";
import { nightPolygon } from "../../src/client/sun.ts";
import type { OfpFix } from "../../src/client/types.ts";

const PANC = { lat: 61.1744, lon: -149.996 };
const UHMA = { lat: 64.735, lon: 177.741 };

describe("placing lines and areas", () => {
  // @spec MAP-GEO-015
  it("keeps the first point's own longitude and puts every next one, the last included, within 180° of the one before", () => {
    expect(
      placeLine([
        [0, 170],
        [0, -175],
        [0, 178],
        [0, -170],
      ]),
    ).toEqual([
      [0, 170],
      [0, 185],
      [0, 178],
      [0, 190],
    ]);
    // A first point beyond ±180° is kept as it is.
    expect(placeLine([[5, 200], [5, -150]])).toEqual([[5, 200], [5, 210]]);
  });

  // @spec MAP-HAZ-010
  it("keeps a hazard area that straddles the antimeridian whole, on both sides of it", () => {
    const area = placeLine([
      [50, 175],
      [50, -175],
      [45, -175],
      [45, 175],
    ]);
    expect(area).toEqual([
      [50, 175],
      [50, 185],
      [45, 185],
      [45, 175],
    ]);
    // In the first world alone, it is drawn at its own place and again one turn west.
    expect(copyShifts(lonSpan(area), { lo: 0, hi: 0 })).toEqual([-360, 0]);
  });

  // @spec SB-ROUTE-003
  it("places a SimBrief route fix to fix, so a route across the antimeridian is continuous", () => {
    const fix = (ident: string, lat: number, lon: number) => ({ ident, name: ident, type: "wpt", lat, lon, alt_ft: null, airway: null, is_sid_star: false }) as OfpFix;
    expect(routeLine([fix("PHNL", 21.3, -157.9), fix("A", 10, -175), fix("B", 0, 179), fix("NFFN", -17.8, 177.4)])).toEqual([
      [21.3, -157.9],
      [10, -175],
      [0, 179 - 360],
      [-17.8, 177.4 - 360],
    ]);
  });

  // @spec LIVE-LAYER-002, MAP-GEO-016
  it("places the live track sample to sample and the live aircraft at its own position", () => {
    const { pos, track } = liveShapes({ lat: 64.7, lon: -179.5 }, [
      [64.7, 178, 3000, 1],
      [64.7, 179.5, 3000, 2],
      [64.7, -179.5, 3000, 3],
    ]);
    expect(track).toEqual([
      [64.7, 178],
      [64.7, 179.5],
      [64.7, 180.5],
    ]);
    expect(pos).toEqual([64.7, -179.5]);
    // With the first two worlds in view, the aircraft is drawn on the copy where its track ends too.
    expect(copyShifts(lonSpan([pos]), { lo: 0, hi: 1 }).map((s) => pos[1] + s)).toContain(180.5);
  });
});

describe("world copies in view", () => {
  // @spec MAP-GEO-017
  it("are the worlds the view touches once widened by a quarter of its width on each side", () => {
    expect(copiesInView(-10, 10)).toEqual({ lo: 0, hi: 0 });
    // 170° to 200° widens to 162.5° to 207.5°, into the next world east.
    expect(copiesInView(170, 200)).toEqual({ lo: 0, hi: 1 });
    expect(copiesInView(-200, -170)).toEqual({ lo: -1, hi: 0 });
    // A wide window at the minimum zoom.
    expect(copiesInView(-460, 460)).toEqual({ lo: -2, hi: 2 });
  });

  // @spec MAP-GEO-014
  it("get every shift of whole turns that brings part of a shape into them", () => {
    // PHNL → NFFN, placed from PHNL: −182.6° to −157.9°.
    expect(copyShifts([-182.6, -157.9], { lo: 0, hi: 0 })).toEqual([0, 360]);
    expect(copyShifts([-182.6, -157.9], { lo: -1, hi: 0 })).toEqual([-360, 0, 360]);
    // A single point appears once in each world in view.
    expect(copyShifts([-71, -71], { lo: -1, hi: 1 })).toEqual([-360, 0, 360]);
  });

  // @spec MAP-NIGHT-001, MAP-GEO-016
  it("cover every world in view with night shading, drawn as computed", () => {
    // At the June solstice the night side covers the South Pole: the shape is closed along it, a full turn wide.
    const night = nightPolygon(new Date("2026-06-21T12:00:00Z"));
    const [min, max] = lonSpan(night);
    expect(max - min).toBeCloseTo(360, 0);
    const copies = { lo: -2, hi: 2 };
    const shifts = copyShifts([min, max], copies);
    for (let lon = -180 + 360 * copies.lo; lon <= 180 + 360 * copies.hi; lon += 10) {
      expect(shifts.some((s) => lon >= min + s && lon <= max + s)).toBe(true);
    }
  });

  // @spec MAP-GEO-020
  it("keep each shape's shifted geometry, so the same shape on the same copy is the same array", () => {
    const line: LatLng[] = [
      [0, 10],
      [1, 20],
    ];
    expect(shiftLine(line, 0)).toBe(line);
    expect(shiftLine(line, 360)).toBe(shiftLine(line, 360));
    expect(shiftLine(line, 360)).toEqual([
      [0, 370],
      [1, 380],
    ]);
    expect(shiftLine(line, -360)).not.toBe(shiftLine(line, 360));
    const p: LatLng = [5, 5];
    expect(shiftPoint(p, 0)).toBe(p);
    expect(shiftPoint(p, 720)).toBe(shiftPoint(p, 720));
    expect(shiftPoint(p, 720)).toEqual([5, 725]);
  });
});

describe("planner results across the antimeridian", () => {
  // @spec MAP-GEO-013
  it("show a candidate across 180° from the origin beside the range ring, on each copy of the ring", () => {
    // Planning from Anchorage with Anadyr in range; the view centred on Anchorage at zoom 4 in a
    // 1600 px window spans about −220° to −80°.
    const plan = { range_nm: 1000, origin: { ident: "PANC", ...PANC } };
    const copies = copiesInView(-220, -80);
    const ring = planSpan(plan);
    const ringCopies = copyShifts(ring, copies).map((s) => [ring[0] + s, ring[1] + s]);
    const anadyr = copyShifts([UHMA.lon, UHMA.lon], copies).map((s) => UHMA.lon + s);
    // West of Anchorage, across the meridian — beside the ring in view...
    expect(anadyr).toContain(UHMA.lon - 360);
    expect(ringCopies.some(([w, e]) => UHMA.lon - 360 >= w && UHMA.lon - 360 <= e)).toBe(true);
    // ...and at its own longitude, beside the ring's copy one turn east.
    expect(anadyr).toContain(UHMA.lon);
    expect(ringCopies.some(([w, e]) => UHMA.lon >= w && UHMA.lon <= e)).toBe(true);
  });

  // @spec MAP-GEO-021
  it("zoom to the ring's box along its edges, so a box wider than 180° is gathered whole", () => {
    // 3,000 nm from 61°N: the box is about 208° of longitude wide.
    const plan = { range_nm: 3000, origin: PANC };
    const pts = planZoomPoints(plan);
    for (const [lat] of pts) expect(Math.abs(lat)).toBeLessThanOrEqual(85);
    const byLat = new Map<number, number[]>();
    for (const [lat, lon] of pts) byLat.set(lat, [...(byLat.get(lat) ?? []), lon]);
    for (const lons of byLat.values()) {
      lons.sort((a, b) => a - b);
      for (let i = 1; i < lons.length; i++) expect(lons[i] - lons[i - 1]).toBeLessThanOrEqual(30);
    }
    const [w, e] = lonSpan(gatherPoints(pts, PANC.lon));
    expect(e - w).toBeGreaterThan(200);
    expect((w + e) / 2).toBeCloseTo(PANC.lon, 0);

    // A ring that would reach round the globe is held to one full turn.
    const [w2, e2] = lonSpan(planZoomPoints({ range_nm: 20000, origin: PANC }));
    expect(e2 - w2).toBeLessThanOrEqual(360);
  });
});
