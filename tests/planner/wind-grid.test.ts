/**
 * The wind grid (PLAN-WIND-002 to 006): which pressure levels a search asks for, the lattice of
 * nodes and its budget of 200 Open-Meteo calls, and how a wind is read between nodes and levels.
 */
import { describe, expect, it } from "vitest";
import {
  PRESSURE_LEVELS_HPA,
  buildField,
  callsPerNode,
  chooseGrid,
  gridNodes,
  levelsFor,
  pressureAltitudeFt,
  type GridNode,
} from "../../src/server/winds.ts";

const NM_PER_DEG = (3440.065 * Math.PI) / 180;

/** A node with the same wind at every level asked: `speed` kt from `direction`. */
const node = (lat: number, lon: number, levels: number, speed: number | null, direction: number | null): GridNode => ({
  lat,
  lon,
  speed: new Array(levels).fill(speed),
  direction: new Array(levels).fill(direction),
});

describe("pressure levels", () => {
  // @spec PLAN-WIND-002
  it("are the 19 standard levels, each at its standard-atmosphere pressure altitude", () => {
    expect(PRESSURE_LEVELS_HPA).toEqual([1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30]);
    expect(pressureAltitudeFt(1013.25)).toBeCloseTo(0, 6);
    expect(pressureAltitudeFt(850)).toBeCloseTo(4779, -1);
    expect(pressureAltitudeFt(500)).toBeCloseTo(18281, -1);
    expect(pressureAltitudeFt(250)).toBeCloseTo(33986, -1);
  });

  // @spec PLAN-WIND-002
  it("span the climb's half-way altitude, or half the cruise altitude when lower, up to the cruise altitude", () => {
    // Half of 6,500 ft is 3,250 ft: 900 hPa (3,242 ft) is the level at or below it, 700 hPa
    // (9,878 ft) the first at or above 6,500 ft.
    expect(levelsFor(0, 6500)).toEqual([900, 850, 800, 700]);
    // FL370 from sea level: 500 hPa (18,281 ft) to 200 hPa (38,615 ft).
    expect(levelsFor(0, 37000)).toEqual([500, 400, 300, 250, 200]);
    // From a 5,000 ft field the climb's half-way altitude (5,750 ft) is above half the cruise (3,250 ft).
    expect(levelsFor(5000, 6500)).toEqual([900, 850, 800, 700]);
    // From a 1,009 ft field to 3,000 ft: 975 hPa (1,061 ft) is at or below 1,500 ft.
    expect(levelsFor(1009, 3000)).toEqual([975, 950, 925, 900]);
  });

  // @spec PLAN-WIND-002
  it("start at 1000 hPa and stop at 30 hPa when the altitudes lie beyond them", () => {
    expect(levelsFor(0, 500)[0]).toBe(1000);
    expect(levelsFor(0, 90000).at(-1)).toBe(30);
  });
});

describe("the lattice", () => {
  const ORH = { lat: 42.2673, lon: -71.8757 };

  // @spec PLAN-WIND-003
  it("puts nodes on whole multiples of the finest spacing that costs at most 200 calls, with every point of the area inside a fetched cell", () => {
    const g = chooseGrid(ORH, 150, 4)!;
    expect(g.spacingDeg).toBe(0.5);
    expect(g.nodes.length).toBeLessThanOrEqual(200);
    const have = new Set(g.nodes.map(([lat, lon]) => `${lat},${lon}`));
    for (const [lat, lon] of g.nodes) {
      expect(Number.isInteger(lat / 0.5) && Number.isInteger(lon / 0.5)).toBe(true);
    }
    // Points spread over the circle (placed on a flat approximation, so kept inside its edge) each
    // have the four corners of their cell.
    for (let b = 0; b < 360; b += 15) {
      for (const f of [0, 0.5, 0.95]) {
        const d = (150 * f) / NM_PER_DEG;
        const lat = ORH.lat + d * Math.cos((b * Math.PI) / 180);
        const lon = ORH.lon + (d * Math.sin((b * Math.PI) / 180)) / Math.cos((ORH.lat * Math.PI) / 180);
        const s = Math.floor(lat / 0.5) * 0.5, w = Math.floor(lon / 0.5) * 0.5;
        for (const c of [`${s},${w}`, `${s + 0.5},${w}`, `${s},${w + 0.5}`, `${s + 0.5},${w + 0.5}`]) expect(have.has(c), c).toBe(true);
      }
    }
  });

  // @spec PLAN-WIND-003
  it("moves to a coarser spacing only when the finer one costs more than 200 calls", () => {
    const origin = { lat: 0, lon: 0 };
    const g = chooseGrid(origin, 600, 4)!;
    const finer = [0.5, 1, 2, 3, 5, 10].filter((s) => s < g.spacingDeg);
    expect(finer.length).toBeGreaterThan(0);
    for (const s of finer) expect(gridNodes(origin, 600, s).length).toBeGreaterThan(200);
    expect(g.nodes.length).toBeLessThanOrEqual(200);
    expect(g.nodes).toEqual(gridNodes(origin, 600, g.spacingDeg));
  });

  // @spec PLAN-WIND-003
  it("counts a node at more than 5 levels as one call per 10 variables", () => {
    expect(callsPerNode(4)).toBe(1);
    expect(callsPerNode(5)).toBe(1);
    expect(callsPerNode(6)).toBeCloseTo(1.2, 9);
    expect(callsPerNode(19)).toBeCloseTo(3.8, 9);
    // 171 nodes at 0.5°: 171 calls at 4 levels, 205 at 6.
    expect(gridNodes(ORH, 160, 0.5)).toHaveLength(171);
    expect(chooseGrid(ORH, 160, 4)!.spacingDeg).toBe(0.5);
    expect(chooseGrid(ORH, 160, 6)!.spacingDeg).toBe(1);
  });

  // @spec PLAN-WIND-003
  it("keeps longitudes from −180° to under 180° across the antimeridian, and latitudes within ±85°", () => {
    const g = chooseGrid({ lat: 52, lon: 179.5 }, 300, 4)!;
    const lons = g.nodes.map(([, lon]) => lon);
    expect(Math.min(...lons)).toBeGreaterThanOrEqual(-180);
    expect(Math.max(...lons)).toBeLessThan(180);
    expect(lons).toContain(-180);
    expect(lons.some((l) => l > 170) && lons.some((l) => l < -170)).toBe(true);
    const polar = chooseGrid({ lat: 82, lon: 15 }, 400, 4)!;
    expect(Math.max(...polar.nodes.map(([lat]) => Math.abs(lat)))).toBeLessThanOrEqual(85);
  });

  // @spec PLAN-WIND-004
  it("cannot be had for an area costing more than 200 calls even at 10°", () => {
    expect(chooseGrid({ lat: 0, lon: 0 }, 5400, 4)).toBeNull();
    // A 2,000 nm still-air ring from 45°N at 6 levels: 3,000 nm of area.
    expect(chooseGrid({ lat: 45, lon: 0 }, 3000, 6)).toBeNull();
    expect(chooseGrid({ lat: 45, lon: 0 }, 2800, 6)).not.toBeNull();
  });
});

describe("reading a wind", () => {
  // @spec PLAN-WIND-005
  it("interpolates the east and north components bilinearly inside a cell", () => {
    // Wind from the west whose speed is 10 × lon + 20 × lat: bilinear interpolation is exact.
    const nodes = [0, 1].flatMap((lat) => [0, 1].map((lon) => node(lat, lon, 1, 10 * lon + 20 * lat, 270)));
    const f = buildField({ spacingDeg: 1, levels: [850], nodes })!;
    expect(f.at(0.5, 0.5, 4779).u).toBeCloseTo(15, 6);
    expect(f.at(0.25, 0.75, 4779).u).toBeCloseTo(12.5, 6);
    expect(f.at(0.25, 0.75, 4779).v).toBeCloseTo(0, 6);
  });

  // @spec PLAN-WIND-005
  it("never averages directions across north", () => {
    const nodes = [node(0, 0, 1, 20, 350), node(0, 1, 1, 20, 10), node(1, 0, 1, 20, 350), node(1, 1, 1, 20, 10)];
    const w = buildField({ spacingDeg: 1, levels: [850], nodes })!.at(0.5, 0.5, 4779);
    // From the north: blowing south, so v is negative and u is zero.
    expect(w.u).toBeCloseTo(0, 6);
    expect(w.v).toBeCloseTo(-20 * Math.cos((10 * Math.PI) / 180), 6);
  });

  // @spec PLAN-WIND-005
  it("wraps across 180°", () => {
    const nodes = [node(50, 179, 1, 10, 270), node(51, 179, 1, 10, 270), node(50, -180, 1, 30, 270), node(51, -180, 1, 30, 270)];
    const f = buildField({ spacingDeg: 1, levels: [850], nodes })!;
    expect(f.at(50.5, 179.5, 4779).u).toBeCloseTo(20, 6);
    expect(f.at(50.5, -179.75, 4779).u).toBeCloseTo(30, 6);
  });

  // @spec PLAN-WIND-005
  it("interpolates linearly in altitude between levels and takes the nearest level beyond them", () => {
    const nodes = [0, 1].flatMap((lat) =>
      [0, 1].map((lon): GridNode => ({ lat, lon, speed: [10, 30], direction: [270, 270] })),
    );
    const f = buildField({ spacingDeg: 1, levels: [850, 700], nodes })!;
    const mid = (pressureAltitudeFt(850) + pressureAltitudeFt(700)) / 2;
    expect(f.at(0.5, 0.5, mid).u).toBeCloseTo(20, 6);
    expect(f.at(0.5, 0.5, 1000).u).toBeCloseTo(10, 6);
    expect(f.at(0.5, 0.5, 30000).u).toBeCloseTo(30, 6);
    expect(f.maxKts).toBe(30);
  });

  // @spec PLAN-WIND-005
  it("takes the nearest fetched node's wind outside the fetched cells", () => {
    const nodes = [node(0, 0, 1, 10, 270), node(0, 1, 1, 10, 270), node(1, 0, 1, 10, 270), node(1, 1, 1, 40, 270)];
    const f = buildField({ spacingDeg: 1, levels: [850], nodes })!;
    expect(f.at(5, 5, 4779).u).toBeCloseTo(40, 6);
    expect(f.at(-3, -2, 4779).u).toBeCloseTo(10, 6);
  });

  // @spec PLAN-WIND-006
  it("fills a node's missing level from its own nearest level above, and has no field when a node has no wind at all", () => {
    const filled = [0, 1].flatMap((lat) =>
      [0, 1].map((lon): GridNode => ({ lat, lon, speed: [null, 25], direction: [null, 270] })),
    );
    expect(buildField({ spacingDeg: 1, levels: [850, 700], nodes: filled })!.at(0.5, 0.5, 1000).u).toBeCloseTo(25, 6);
    const missing = [node(0, 0, 2, 10, 270), node(0, 1, 2, 10, 270), node(1, 0, 2, 10, 270), node(1, 1, 2, null, null)];
    expect(buildField({ spacingDeg: 1, levels: [850, 700], nodes: missing })).toBeNull();
  });
});
