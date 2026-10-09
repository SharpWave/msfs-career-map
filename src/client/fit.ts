import type { LatLng } from "./geo";
import type { Insets } from "./layout";

/** Padding kept around fitted points, inside the clear part of the map. */
export const FIT_PADDING = 60;
/** Below this size the clear part is no use, and a zoom uses the whole window. */
const MIN_CLEAR = { width: 240, height: 160 };
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The few map calls a zoom needs; Leaflet's map has them all. */
export interface FitMap {
  getSize(): { x: number; y: number };
  getZoom(): number;
  project(latlng: LatLng, zoom: number): { x: number; y: number };
  unproject(point: { x: number; y: number }, zoom: number): { lat: number; lng: number };
  setView(center: LatLng, zoom: number, options?: { animate?: boolean }): unknown;
  flyTo(center: LatLng, zoom: number, options?: { duration?: number }): unknown;
  fitBounds(bounds: LatLng[], options: object): unknown;
  flyToBounds(bounds: LatLng[], options: object): unknown;
}

export interface FitRequest {
  points: LatLng[];
  /** When set, show the first point at this zoom instead of fitting the points. */
  zoom?: number;
  /** The part of the map the page's panels leave clear. */
  clear?: Insets;
}

/**
 * Carry out a zoom request inside the part of the map the panels leave clear: a single point or a
 * fixed-zoom request is centred in it, and bounds are fitted with their padding inside it.
 */
// @spec MAP-ZOOM-007, MAP-ZOOM-008, MAP-ZOOM-009, MAP-ZOOM-010
export function applyFocus(map: FitMap, req: FitRequest, reduceMotion: boolean): void {
  const [first] = req.points;
  if (!first) return;
  const size = map.getSize();
  const c = req.clear ?? NO_INSETS;
  const usable = size.x - c.left - c.right >= MIN_CLEAR.width && size.y - c.top - c.bottom >= MIN_CLEAR.height;
  const ins = usable ? c : NO_INSETS;

  // The clear part's centre lies this far from the window's; put the point there.
  const centreIn = (pt: LatLng, zoom: number): LatLng => {
    const p = map.project(pt, zoom);
    const ll = map.unproject({ x: p.x - (ins.left - ins.right) / 2, y: p.y - (ins.top - ins.bottom) / 2 }, zoom);
    return [ll.lat, ll.lng];
  };

  if (req.zoom != null) {
    map.setView(centreIn(first, req.zoom), req.zoom, reduceMotion ? { animate: false } : {});
    return;
  }
  if (req.points.every((p) => p[0] === first[0] && p[1] === first[1])) {
    const zoom = Math.max(map.getZoom(), 9);
    const centre = centreIn(first, zoom);
    if (reduceMotion) map.setView(centre, zoom, { animate: false });
    else map.flyTo(centre, zoom, { duration: 0.6 });
    return;
  }
  const opts = {
    paddingTopLeft: [ins.left + FIT_PADDING, ins.top + FIT_PADDING],
    paddingBottomRight: [ins.right + FIT_PADDING, ins.bottom + FIT_PADDING],
    maxZoom: 11,
  };
  if (reduceMotion) map.fitBounds(req.points, { ...opts, animate: false });
  else map.flyToBounds(req.points, { ...opts, duration: 0.6 });
}
