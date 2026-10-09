import { describe, expect, it } from "vitest";
import { greatCircle, type LatLng } from "../../src/client/geo.ts";
import { buildRenderData, focusPoints } from "../../src/client/paths.ts";
import type { Aircraft, Airport, AppState, Hop } from "../../src/client/types.ts";

const airport = (ident: string, lat: number, lon: number) => ({ ident, lat, lon, type: "large_airport", name: ident }) as Airport;
const PHNL = airport("PHNL", 21.3187, -157.9225);
const NFFN = airport("NFFN", -17.7554, 177.4431);
const NZAA = airport("NZAA", -37.0081, 174.792);
const plane = { id: 1, name: "Caravan", livery: "", visible: 1, color: "#ff6b35" } as Aircraft;
const hop = (id: number, seq: number, origin: string, dest: string) =>
  ({ id, aircraft_id: 1, seq, origin, dest, track: null, departed_at: null, arrived_at: null, duration_min: null }) as Hop;

/** Hand-logged PHNL → NFFN → NZAA: the chain crosses the antimeridian on its first hop. */
const state = {
  aircraft: [plane],
  hops: [hop(1, 1, "PHNL", "NFFN"), hop(2, 2, "NFFN", "NZAA")],
  airports: { PHNL, NFFN, NZAA },
  airportCount: 3,
  runwayCount: 0,
} as unknown as AppState;

const ends = (pts: LatLng[]) => [pts[0], pts[pts.length - 1]];

describe("great-circle hop paths", () => {
  // @spec MAP-GEO-002, MAP-GEO-005
  it("start and end exactly at the hop's shifted airport positions, after the chain has crossed the antimeridian", () => {
    const data = buildRenderData(state);
    const [first, second] = data.hops;
    expect(ends(first.pts)).toEqual([
      [PHNL.lat, PHNL.lon],
      [NFFN.lat, NFFN.lon - 360],
    ]);
    expect(ends(second.pts)).toEqual([
      [NFFN.lat, NFFN.lon - 360],
      [NZAA.lat, NZAA.lon - 360],
    ]);
    // The whole second hop is on the shifted world copy, with its dots, chevron and zoom points.
    for (const [, lon] of second.pts) expect(lon).toBeLessThan(-180);
    const dot = (ident: string) => data.nodes.filter((n) => n.airport.ident === ident).map((n) => n.pos);
    expect(dot("NFFN")).toEqual([[NFFN.lat, NFFN.lon - 360]]);
    expect(dot("NZAA")).toEqual([[NZAA.lat, NZAA.lon - 360]]);
    const middle = second.pts[Math.floor(second.pts.length / 2)];
    expect(middle[1]).toBeGreaterThan(NFFN.lon - 360 - 5);
    expect(middle[1]).toBeLessThan(NZAA.lon - 360 + 5);
    expect(focusPoints(data, { hopId: 2 })).toEqual(ends(second.pts));
    expect(data.heads[0].pos).toEqual([NZAA.lat, NZAA.lon - 360]);
  });

  // @spec MAP-GEO-005
  it("is drawn from the longitude it is given, on whichever world copy that is", () => {
    const a: LatLng = [NFFN.lat, NFFN.lon - 360];
    const b: LatLng = [NZAA.lat, NZAA.lon - 360];
    const pts = greatCircle(a, b);
    expect(ends(pts)).toEqual([a, b]);
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThan(180);

    const east = greatCircle([PHNL.lat, PHNL.lon + 360], [NFFN.lat, NFFN.lon]);
    expect(ends(east)).toEqual([
      [PHNL.lat, PHNL.lon + 360],
      [NFFN.lat, NFFN.lon],
    ]);
  });

  // @spec MAP-GEO-004
  it("has a point about every 25 nm, 2 to 96 segments, or is a straight pair under 1 nm", () => {
    expect(greatCircle([41.7246, -71.4282], [41.73, -71.43])).toHaveLength(2);
    // KPVD → KBOS, about 43 nm: 2 segments.
    expect(greatCircle([41.7246, -71.4282], [42.3656, -71.0096])).toHaveLength(3);
    // PHNL → NFFN, about 2,750 nm: capped at 96 segments.
    expect(greatCircle([PHNL.lat, PHNL.lon], [NFFN.lat, NFFN.lon - 360])).toHaveLength(97);
  });
});
