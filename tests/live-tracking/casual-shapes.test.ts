import { describe, expect, it } from "vitest";
import { casualShapes } from "../../src/client/paths.ts";

const pt = (lat: number, lon: number) => [lat, lon, 1500, 0, 100, 0, 100, 300];

describe("placing the casual path", () => {
  // @spec LIVE-LAYER-004, MAP-GEO-015
  it("places each segment sample to sample and runs the last one on to the aircraft", () => {
    const path = [
      [pt(52, 179.5), pt(52, -179.8)],
      [pt(60, 10), pt(60.1, 10.1)],
    ];
    expect(casualShapes(path, { lat: 60.2, lon: 10.2 })).toEqual([
      [
        [52, 179.5],
        [52, 180.2],
      ],
      [
        [60, 10],
        [60.1, 10.1],
        [60.2, 10.2],
      ],
    ]);
  });

  // @spec LIVE-LAYER-004, MAP-GEO-015
  it("places the aircraft within 180° of the last point it runs on from", () => {
    expect(casualShapes([[pt(52, 179.5), pt(52, -179.8)]], { lat: 52, lon: -179.6 })).toEqual([
      [
        [52, 179.5],
        [52, 180.2],
        [52, 180.4],
      ],
    ]);
  });

  // @spec LIVE-LAYER-004
  it("draws the path alone when no position is known, and nothing for an empty path", () => {
    expect(casualShapes([[pt(41, -71), pt(41.1, -71)]], null)).toEqual([
      [
        [41, -71],
        [41.1, -71],
      ],
    ]);
    expect(casualShapes([], { lat: 41, lon: -71 })).toEqual([]);
  });

  // @spec LIVE-LAYER-004
  it("makes a line of a one-point segment by running it on to the aircraft", () => {
    expect(casualShapes([[pt(41, -71)]], { lat: 41.01, lon: -71 })).toEqual([
      [
        [41, -71],
        [41.01, -71],
      ],
    ]);
  });
});
