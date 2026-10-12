import { describe, expect, it } from "vitest";
import { applyFocus, gatherPoints, type FitMap } from "../../src/client/fit.ts";
import type { LatLng } from "../../src/client/geo.ts";
import type { Insets } from "../../src/client/layout.ts";

type Call = { fn: string; args: unknown[] };

/**
 * A map 1600 × 1000 px centred on the equator at `centreLon`, with a flat projection (1 px per
 * degree × 2^zoom), recording what it is asked.
 */
function fakeMap(zoom = 5, centreLon = 0): FitMap & { calls: Call[] } {
  const calls: Call[] = [];
  const k = (z: number) => 2 ** z;
  const rec = (fn: string) => (...args: unknown[]) => void calls.push({ fn, args });
  return {
    calls,
    getSize: () => ({ x: 1600, y: 1000 }),
    getZoom: () => zoom,
    getCenter: () => ({ lat: 0, lng: centreLon }),
    project: ([lat, lon], z) => ({ x: lon * k(z), y: -lat * k(z) }),
    unproject: ({ x, y }, z) => ({ lat: -y / k(z), lng: x / k(z) }),
    setView: rec("setView"),
    flyTo: rec("flyTo"),
    fitBounds: rec("fitBounds"),
    flyToBounds: rec("flyToBounds"),
  };
}

const CLEAR: Insets = { top: 52, right: 0, bottom: 412, left: 412 };
const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Where a point lands relative to the map's centre, in px, when the view is centred on `centre`. */
function offsetOf(map: FitMap, point: [number, number], centre: [number, number], zoom: number) {
  const p = map.project(point, zoom);
  const c = map.project(centre, zoom);
  return { x: p.x - c.x, y: p.y - c.y };
}

describe("zooming under floating panels", () => {
  // @spec MAP-ZOOM-007, APP-UI-020
  it("flies to a single point at zoom 9 or closer, centred in the clear part", () => {
    const map = fakeMap(5);
    applyFocus(map, { points: [[41.7, -71.4]], clear: CLEAR }, false);
    expect(map.calls).toHaveLength(1);
    const [{ fn, args }] = map.calls;
    expect(fn).toBe("flyTo");
    const [centre, zoom, opts] = args as [[number, number], number, { duration: number }];
    expect(zoom).toBe(9);
    expect(opts.duration).toBe(0.6);
    // The clear part's centre sits (412 − 0) / 2 px right of and (52 − 412) / 2 px above the window's.
    const off = offsetOf(map, [41.7, -71.4], centre, 9);
    expect(off.x).toBeCloseTo(206, 6);
    expect(off.y).toBeCloseTo(-180, 6);
  });

  // @spec MAP-ZOOM-007
  it("keeps the current zoom for a single point when it is already closer than 9", () => {
    const map = fakeMap(12);
    applyFocus(map, { points: [[41.7, -71.4], [41.7, -71.4]], clear: NONE }, false);
    expect(map.calls[0].fn).toBe("flyTo");
    expect(map.calls[0].args[1]).toBe(12);
  });

  // @spec MAP-ZOOM-007, APP-UI-020
  it("flies to bounds with 60 px padding inside the clear part, no closer than zoom 11, over 0.6 s", () => {
    const map = fakeMap();
    const points: [number, number][] = [[42.36, -71.0], [41.72, -71.43]];
    applyFocus(map, { points, clear: CLEAR }, false);
    expect(map.calls).toEqual([
      {
        fn: "flyToBounds",
        args: [points, { paddingTopLeft: [472, 112], paddingBottomRight: [60, 472], maxZoom: 11, duration: 0.6 }],
      },
    ]);
  });

  // @spec MAP-ZOOM-007
  it("uses the whole window when the clear part is smaller than 240 × 160 px", () => {
    const narrow = fakeMap();
    const points: [number, number][] = [[42.36, -71.0], [41.72, -71.43]];
    applyFocus(narrow, { points, clear: { top: 52, right: 0, bottom: 412, left: 1400 } }, false);
    expect(narrow.calls[0].args[1]).toMatchObject({ paddingTopLeft: [60, 60], paddingBottomRight: [60, 60] });

    const short = fakeMap();
    applyFocus(short, { points: [[41.7, -71.4]], clear: { top: 52, right: 0, bottom: 800, left: 412 } }, false);
    const off = offsetOf(short, [41.7, -71.4], short.calls[0].args[0] as [number, number], 9);
    expect(off.x).toBeCloseTo(0, 6);
    expect(off.y).toBeCloseTo(0, 6);
  });

  // @spec MAP-ZOOM-009, APP-UI-020
  it("shows a request with its own zoom at that zoom, centred in the clear part", () => {
    const map = fakeMap();
    applyFocus(map, { points: [[41.7, -71.4]], zoom: 10, clear: CLEAR }, false);
    expect(map.calls).toHaveLength(1);
    expect(map.calls[0].fn).toBe("setView");
    const [centre, zoom] = map.calls[0].args as [[number, number], number];
    expect(zoom).toBe(10);
    const off = offsetOf(map, [41.7, -71.4], centre, 10);
    expect(off.x).toBeCloseTo(206, 6);
    expect(off.y).toBeCloseTo(-180, 6);
  });

  // @spec MAP-ZOOM-010
  it("jumps instead of flying while reduced motion is asked for", () => {
    const point = fakeMap();
    applyFocus(point, { points: [[41.7, -71.4]], clear: CLEAR }, true);
    expect(point.calls.map((c) => c.fn)).toEqual(["setView"]);
    expect(point.calls[0].args[2]).toEqual({ animate: false });

    const bounds = fakeMap();
    applyFocus(bounds, { points: [[42.36, -71.0], [41.72, -71.43]], clear: CLEAR }, true);
    expect(bounds.calls.map((c) => c.fn)).toEqual(["fitBounds"]);
    expect(bounds.calls[0].args[1]).toMatchObject({ animate: false, maxZoom: 11 });

    const fixed = fakeMap();
    applyFocus(fixed, { points: [[41.7, -71.4]], zoom: 10, clear: CLEAR }, true);
    expect(fixed.calls[0].args[2]).toEqual({ animate: false });
  });

  // @spec MAP-ZOOM-008
  it("ignores a request with no points", () => {
    const map = fakeMap();
    applyFocus(map, { points: [], clear: CLEAR }, false);
    expect(map.calls).toEqual([]);
  });
});

const lons = (pts: LatLng[]) => pts.map((p) => p[1]);

describe("zooming across world copies", () => {
  // @spec MAP-ZOOM-011
  it("gathers the points onto their narrowest band of longitude, across 180° when that is narrower", () => {
    expect(lons(gatherPoints([[0, 170], [0, -170]], 100))).toEqual([170, 190]);
    expect(lons(gatherPoints([[0, 170], [0, -170]], -150))).toEqual([-190, -170]);
    // Spread the other way round, the band stays clear of the meridian.
    expect(lons(gatherPoints([[0, -60], [0, 60]], 0))).toEqual([-60, 60]);
    // Points placed worlds away come back to the copy nearest the centre.
    expect(lons(gatherPoints([[0, 650], [0, 640]], 0))).toEqual([-70, -80]);
  });

  // @spec MAP-ZOOM-011
  it("puts the band's middle within 180° of the centre, an exact tie going east", () => {
    expect(gatherPoints([[0, 180]], 0)).toEqual([[0, 180]]);
    expect(gatherPoints([[0, -180]], 0)).toEqual([[0, 180]]);
    expect(lons(gatherPoints([[0, -170]], 100))).toEqual([190]);
  });

  // @spec MAP-ZOOM-011, APP-UI-020
  it("measures from the centre of the clear part of the map", () => {
    // At zoom 0 a pixel is a degree: the clear part's centre lies 206° east of the window's.
    const covered = fakeMap(0, 0);
    applyFocus(covered, { points: [[0, -160]], clear: CLEAR }, false);
    expect(offsetOf(covered, [0, 200], covered.calls[0].args[0] as LatLng, 9).x).toBeCloseTo(206, 6);

    const open = fakeMap(0, 0);
    applyFocus(open, { points: [[0, -160]], clear: NONE }, false);
    expect(offsetOf(open, [0, -160], open.calls[0].args[0] as LatLng, 9).x).toBeCloseTo(0, 6);
  });

  // @spec MAP-ZOOM-007, MAP-ZOOM-011
  it("judges whether the points lie at one place once they are gathered", () => {
    const map = fakeMap(5, 0);
    applyFocus(map, { points: [[10, 180], [10, -180]], clear: NONE }, false);
    expect(map.calls.map((c) => c.fn)).toEqual(["flyTo"]);
  });

  // @spec MAP-GEO-018
  it("says where the zoom will land before the map moves", () => {
    const map = fakeMap(5, 0);
    applyFocus(map, { points: [[0, 170], [0, -170]], clear: NONE }, false, (pts) => map.calls.push({ fn: "target", args: [pts] }));
    expect(map.calls.map((c) => c.fn)).toEqual(["target", "flyToBounds"]);
    expect(map.calls[0].args[0]).toEqual([
      [0, 170],
      [0, 190],
    ]);
  });
});
