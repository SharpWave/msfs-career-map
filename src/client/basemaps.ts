/** The basemaps the Layers menu offers: what each draws, credits and says about itself. */

export type Basemap = "dark" | "light" | "topo" | "satellite" | "hybrid" | "sectional";

/** One layer of tiles. */
export interface TileLayerSpec {
  url: string;
  /** The deepest level the service has tiles for; further in, those tiles are enlarged. */
  maxNativeZoom: number;
  /** The first level the layer is drawn at; a layer without one is drawn at every level. */
  minZoom?: number;
}

export interface BasemapSpec {
  label: string;
  /** Bottom to top. */
  layers: TileLayerSpec[];
  attribution: string;
  /** Pale tiles, over which the panels' glass thickens (APP-UI-023). */
  bright: boolean;
  /** Shown under the basemap choice while this one is chosen. */
  note?: string;
}

/** Every basemap zooms this far, enlarging tiles past their native maximum. */
export const MAX_ZOOM = 19;

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
/** The FAA's Aeronautical Information Services, on ArcGIS Online. */
const FAA = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const TILE = "/MapServer/tile/{z}/{y}/{x}";

const TOPO: TileLayerSpec = { url: `${ESRI}/World_Topo_Map${TILE}`, maxNativeZoom: 19 };
const IMAGERY: TileLayerSpec = { url: `${ESRI}/World_Imagery${TILE}`, maxNativeZoom: 19 };

const TOPO_CREDIT = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors, and the GIS User Community";
const IMAGERY_CREDIT = "Tiles &copy; Esri &mdash; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community";

// @spec MAP-VIEW-001, MAP-VIEW-008, MAP-VIEW-009
export const BASEMAPS: Record<Basemap, BasemapSpec> = {
  dark: {
    label: "Dark",
    layers: [
      { url: `${ESRI}/Canvas/World_Dark_Gray_Base${TILE}`, maxNativeZoom: 16 },
      { url: `${ESRI}/Canvas/World_Dark_Gray_Reference${TILE}`, maxNativeZoom: 16 },
    ],
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    bright: false,
  },
  light: {
    label: "Light",
    layers: [{ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19 }],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    bright: true,
  },
  topo: {
    label: "Topo",
    layers: [TOPO],
    attribution: TOPO_CREDIT,
    bright: true,
  },
  satellite: {
    label: "Satellite",
    layers: [IMAGERY],
    attribution: IMAGERY_CREDIT,
    bright: false,
  },
  hybrid: {
    label: "Hybrid",
    layers: [IMAGERY, { url: `${ESRI}/Reference/World_Boundaries_and_Places${TILE}`, maxNativeZoom: 19 }],
    attribution: IMAGERY_CREDIT,
    bright: false,
  },
  // The FAA has chart tiles for levels 8 to 12 over the US alone; Topo shows wherever it has none.
  sectional: {
    label: "Sectional",
    layers: [TOPO, { url: `${FAA}/VFR_Sectional${TILE}`, minZoom: 8, maxNativeZoom: 12 }],
    attribution: `Charts: FAA Aeronautical Information Services | ${TOPO_CREDIT}`,
    bright: true,
    note: "FAA VFR chart: US only, shows as you zoom in",
  },
};

/** The order the Layers menu lists them in. */
export const BASEMAP_ORDER: Basemap[] = ["dark", "light", "topo", "satellite", "hybrid", "sectional"];

/** A remembered basemap; one this version does not offer gives Dark. */
// @spec MAP-VIEW-002
export function parseBasemap(stored: string): Basemap {
  return (BASEMAP_ORDER as string[]).includes(stored) ? (stored as Basemap) : "dark";
}
