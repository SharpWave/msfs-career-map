import { describe, expect, it } from "vitest";
import { BASEMAPS, BASEMAP_ORDER, MAX_ZOOM, parseBasemap } from "../../src/client/basemaps.ts";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const FAA = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const TILE = "/MapServer/tile/{z}/{y}/{x}";

const urls = (key: keyof typeof BASEMAPS) => BASEMAPS[key].layers.map((l) => l.url);

describe("the basemaps", () => {
  // @spec MAP-VIEW-001
  it("are six, in the order the Layers menu lists them", () => {
    expect(BASEMAP_ORDER).toEqual(["dark", "light", "topo", "satellite", "hybrid", "sectional"]);
    expect(Object.keys(BASEMAPS).sort()).toEqual([...BASEMAP_ORDER].sort());
    expect(BASEMAP_ORDER.map((k) => BASEMAPS[k].label)).toEqual(["Dark", "Light", "Topo", "Satellite", "Hybrid", "Sectional"]);
  });

  // @spec MAP-VIEW-001
  it("draw each basemap's tiles from its keyless service, bottom layer first", () => {
    expect(urls("dark")).toEqual([`${ESRI}/Canvas/World_Dark_Gray_Base${TILE}`, `${ESRI}/Canvas/World_Dark_Gray_Reference${TILE}`]);
    expect(urls("light")).toEqual(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
    expect(urls("topo")).toEqual([`${ESRI}/World_Topo_Map${TILE}`]);
    expect(urls("satellite")).toEqual([`${ESRI}/World_Imagery${TILE}`]);
    expect(urls("hybrid")).toEqual([`${ESRI}/World_Imagery${TILE}`, `${ESRI}/Reference/World_Boundaries_and_Places${TILE}`]);
    expect(urls("sectional")).toEqual([`${ESRI}/World_Topo_Map${TILE}`, `${FAA}/VFR_Sectional${TILE}`]);
    for (const key of BASEMAP_ORDER) {
      for (const url of urls(key)) expect(url).not.toMatch(/[?&](key|token|apikey)=/i);
    }
  });

  // @spec MAP-VIEW-001
  it("zoom to level 19, no layer asking for tiles past its service's deepest level", () => {
    expect(MAX_ZOOM).toBe(19);
    const deepest = (key: keyof typeof BASEMAPS) => BASEMAPS[key].layers.map((l) => l.maxNativeZoom);
    expect(deepest("dark")).toEqual([16, 16]);
    expect(deepest("light")).toEqual([19]);
    expect(deepest("topo")).toEqual([19]);
    expect(deepest("satellite")).toEqual([19]);
    expect(deepest("hybrid")).toEqual([19, 19]);
    for (const key of BASEMAP_ORDER) {
      for (const l of BASEMAPS[key].layers) expect(l.maxNativeZoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  // @spec MAP-VIEW-009
  it("draw the sectional chart from level 8, its own tiles to 12, over Topo tiles drawn at every level", () => {
    const [under, chart] = BASEMAPS.sectional.layers;
    expect(under).toEqual(BASEMAPS.topo.layers[0]);
    expect(under.minZoom).toBeUndefined();
    expect(chart.minZoom).toBe(8);
    expect(chart.maxNativeZoom).toBe(12);
    // Only the chart starts part-way in.
    for (const key of BASEMAP_ORDER.filter((k) => k !== "sectional")) {
      for (const l of BASEMAPS[key].layers) expect(l.minZoom).toBeUndefined();
    }
  });

  // @spec MAP-VIEW-008
  it("credit Esri, OpenStreetMap and the FAA for the basemaps that show their tiles", () => {
    for (const key of ["dark", "topo", "satellite", "hybrid", "sectional"] as const) expect(BASEMAPS[key].attribution).toContain("Esri");
    expect(BASEMAPS.light.attribution).toBe('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
    expect(BASEMAPS.sectional.attribution).toContain("FAA Aeronautical Information Services");
    for (const key of BASEMAP_ORDER.filter((k) => k !== "sectional")) expect(BASEMAPS[key].attribution).not.toContain("FAA");
  });

  // @spec MAP-VIEW-010
  it("carry a note on coverage for Sectional alone", () => {
    expect(BASEMAPS.sectional.note).toMatch(/US only/);
    expect(BASEMAPS.sectional.note).toMatch(/zoom in/);
    for (const key of BASEMAP_ORDER.filter((k) => k !== "sectional")) expect(BASEMAPS[key].note).toBeUndefined();
  });

  // @spec APP-UI-023
  it("mark Light, Topo and Sectional as bright", () => {
    expect(BASEMAP_ORDER.filter((k) => BASEMAPS[k].bright)).toEqual(["light", "topo", "sectional"]);
  });

  // @spec MAP-VIEW-002
  it("read a remembered basemap, giving Dark for one that is not offered", () => {
    for (const key of BASEMAP_ORDER) expect(parseBasemap(key)).toBe(key);
    for (const other of ["", "terrain", "Dark", "SECTIONAL", "constructor", "toString", "__proto__"]) expect(parseBasemap(other)).toBe("dark");
  });
});
