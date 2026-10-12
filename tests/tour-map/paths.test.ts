import { describe, expect, it } from "vitest";
import { greatCircle, type LatLng } from "../../src/client/geo.ts";
import { buildRenderData, focusPoints } from "../../src/client/paths.ts";
import type { Aircraft, Airport, AppState, Hop, TrackPoint } from "../../src/client/types.ts";

const airport = (ident: string, lat: number, lon: number) => ({ ident, lat, lon, type: "large_airport", name: ident }) as Airport;
const PHNL = airport("PHNL", 21.3187, -157.9225);
const NFFN = airport("NFFN", -17.7554, 177.4431);
const NZAA = airport("NZAA", -37.0081, 174.792);
const plane = (id: number) => ({ id, name: `Plane ${id}`, livery: "", visible: 1, color: "#ff6b35" }) as Aircraft;
const hop = (id: number, aircraft_id: number, seq: number, origin: string, dest: string, track: TrackPoint[] | null = null) =>
  ({ id, aircraft_id, seq, origin, dest, track: track ? JSON.stringify(track) : null, departed_at: null, arrived_at: null, duration_min: null }) as Hop;

const stateOf = (aircraft: Aircraft[], hops: Hop[]) =>
  ({ aircraft, hops, airports: { PHNL, NFFN, NZAA }, airportCount: 3, runwayCount: 0 }) as unknown as AppState;

/** Hand-logged PHNL → NFFN → NZAA: the first hop crosses the antimeridian. */
const state = stateOf([plane(1)], [hop(1, 1, 1, "PHNL", "NFFN"), hop(2, 1, 2, "NFFN", "NZAA")]);

const ends = (pts: LatLng[]) => [pts[0], pts[pts.length - 1]];
const stepsWithin180 = (pts: LatLng[]) => pts.every((p, i) => i === 0 || Math.abs(p[1] - pts[i - 1][1]) <= 180);

describe("hop paths", () => {
  // @spec MAP-GEO-002, MAP-GEO-005, MAP-GEO-011
  it("are placed hop by hop from the origin's own longitude, ending at the destination on the copy each reaches", () => {
    const data = buildRenderData(state);
    const [first, second] = data.hops;
    // The crossing runs on past −180° rather than jumping across the map...
    expect(ends(first.pts)).toEqual([
      [PHNL.lat, PHNL.lon],
      [NFFN.lat, NFFN.lon - 360],
    ]);
    // ...and the next hop starts afresh at NFFN's own longitude, not on the copy the first one reached.
    expect(ends(second.pts)).toEqual([
      [NFFN.lat, NFFN.lon],
      [NZAA.lat, NZAA.lon],
    ]);
    for (const r of data.hops) expect(stepsWithin180(r.pts)).toBe(true);
    expect(focusPoints(data, { hopId: 2 })).toEqual(ends(second.pts));
  });

  // @spec MAP-GEO-003, MAP-GEO-015
  it("follow a recorded track across the antimeridian, tied to the airports at both ends", () => {
    const track: TrackPoint[] = [
      [21.4, -158.2, 3000, 1],
      [10, -170, 9000, 2],
      [0, 179, 9000, 3],
      [-10, 178.5, 9000, 4],
      [-17.6, 177.5, 500, 5],
    ];
    const data = buildRenderData(stateOf([plane(1)], [hop(1, 1, 1, "PHNL", "NFFN", track)]));
    const [r] = data.hops;
    expect(r.tracked).toBe(true);
    expect(r.pts).toEqual([
      [PHNL.lat, PHNL.lon],
      [21.4, -158.2],
      [10, -170],
      [0, 179 - 360],
      [-10, 178.5 - 360],
      [-17.6, 177.5 - 360],
      [NFFN.lat, NFFN.lon - 360],
    ]);
  });

  // @spec MAP-GEO-005
  it("as great circles, start at the origin as given and end at the destination on the copy reached", () => {
    const a: LatLng = [NFFN.lat, NFFN.lon - 360];
    const pts = greatCircle(a, [NZAA.lat, NZAA.lon]);
    expect(ends(pts)).toEqual([a, [NZAA.lat, NZAA.lon - 360]]);
    expect(stepsWithin180(pts)).toBe(true);

    const east = greatCircle([PHNL.lat, PHNL.lon], [NFFN.lat, NFFN.lon]);
    expect(ends(east)).toEqual([
      [PHNL.lat, PHNL.lon],
      [NFFN.lat, NFFN.lon - 360],
    ]);
    expect(stepsWithin180(east)).toBe(true);
  });

  // @spec MAP-GEO-004
  it("as great circles, have a point about every 25 nm, 2 to 96 segments, or are a straight pair under 1 nm", () => {
    expect(greatCircle([41.7246, -71.4282], [41.73, -71.43])).toHaveLength(2);
    // KPVD → KBOS, about 43 nm: 2 segments.
    expect(greatCircle([41.7246, -71.4282], [42.3656, -71.0096])).toHaveLength(3);
    // PHNL → NFFN, about 2,750 nm: capped at 96 segments.
    expect(greatCircle([PHNL.lat, PHNL.lon], [NFFN.lat, NFFN.lon])).toHaveLength(97);
  });

  // @spec MAP-GEO-006
  it("skip a hop whose airport the map does not know, and park the aircraft at its last drawn hop", () => {
    const data = buildRenderData(stateOf([plane(1)], [hop(1, 1, 1, "PHNL", "NFFN"), hop(2, 1, 2, "NFFN", "XXXX")]));
    expect(data.hops.map((r) => r.hop.id)).toEqual([1]);
    expect(data.heads[0].airport.ident).toBe("NFFN");
  });
});

describe("airport dots and parked aircraft", () => {
  // @spec MAP-GEO-007, MAP-GEO-016
  it("give each visited airport one dot at its own position, holding every hop there", () => {
    // Plane 1 reaches NFFN across the antimeridian; plane 2 reaches it from the west.
    const data = buildRenderData(
      stateOf([plane(1), plane(2)], [hop(1, 1, 1, "PHNL", "NFFN"), hop(2, 1, 2, "NFFN", "NZAA"), hop(3, 2, 1, "NZAA", "NFFN")]),
    );
    const nffn = data.nodes.filter((n) => n.airport.ident === "NFFN");
    expect(nffn).toHaveLength(1);
    expect(nffn[0].pos).toEqual([NFFN.lat, NFFN.lon]);
    expect(nffn[0].events.map((e) => [e.aircraft.id, e.hop.id, e.kind])).toEqual([
      [1, 1, "arrived"],
      [1, 2, "departed"],
      [2, 3, "arrived"],
    ]);
    expect([...nffn[0].aircraftIds]).toEqual([1, 2]);
    expect(data.nodes.find((n) => n.airport.ident === "PHNL")!.pos).toEqual([PHNL.lat, PHNL.lon]);
  });

  // @spec MAP-GEO-008, MAP-GEO-009, MAP-GEO-016
  it("park each aircraft at its last hop's destination, at the airport's own position, fanning out those parked together", () => {
    // Plane 1 reaches NZAA by way of the antimeridian crossing, plane 2 from NFFN directly.
    const data = buildRenderData(
      stateOf([plane(1), plane(2)], [hop(1, 1, 1, "PHNL", "NFFN"), hop(2, 1, 2, "NFFN", "NZAA"), hop(3, 2, 1, "NFFN", "NZAA")]),
    );
    expect(data.heads.map((h) => [h.aircraft.id, h.pos, h.offset])).toEqual([
      [1, [NZAA.lat, NZAA.lon], [0, 0]],
      [2, [NZAA.lat, NZAA.lon], [26, -15]],
    ]);
    const nzaa = data.nodes.filter((n) => n.airport.ident === "NZAA");
    expect(nzaa).toHaveLength(1);
    expect(nzaa[0].parked.map((a) => a.id)).toEqual([1, 2]);
  });
});
