import type { LatLng } from "./geo";

/**
 * Low-precision solar position (good to a fraction of a degree), enough for a day/night
 * overlay and "is it dark there" checks.
 */

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Sub-solar point: the latitude/longitude where the sun is directly overhead. */
export function subsolarPoint(date: Date): LatLng {
  const n = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const L = norm360(280.46 + 0.9856474 * n);
  const g = toRad(norm360(357.528 + 0.9856003 * n));
  const lambda = toRad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = toRad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = norm360(280.46061837 + 360.98564736629 * n);
  return [toDeg(decl), norm180(toDeg(ra) - gmst)];
}

/** Sun elevation above the horizon at a place and time, degrees (negative after sunset). */
export function sunElevationDeg(lat: number, lon: number, date: Date): number {
  const [sLat, sLon] = subsolarPoint(date);
  const ha = toRad(lon - sLon);
  const s = Math.sin(toRad(lat)) * Math.sin(toRad(sLat)) + Math.cos(toRad(lat)) * Math.cos(toRad(sLat)) * Math.cos(ha);
  return toDeg(Math.asin(Math.max(-1, Math.min(1, s))));
}

/** Civil twilight has ended: effectively night for VFR purposes. */
export const NIGHT_ELEVATION_DEG = -6;

export function isDark(lat: number, lon: number, date: Date): boolean {
  return sunElevationDeg(lat, lon, date) < NIGHT_ELEVATION_DEG;
}

/** Point at a given angular distance and bearing from a start point (spherical). */
function destination(lat: number, lon: number, bearingDeg: number, distDeg: number): LatLng {
  const φ1 = toRad(lat), λ1 = toRad(lon), θ = toRad(bearingDeg), δ = toRad(distDeg);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(φ2), toDeg(λ2)];
}

/**
 * Polygon (unwrapped longitudes) covering everywhere the sun is below `elevationDeg`:
 * a spherical cap around the anti-solar point. When the cap covers a pole, the ring is
 * closed along that pole so Mercator maps fill it correctly.
 */
export function nightPolygon(date: Date, elevationDeg = 0, step = 3): LatLng[] {
  const [sLat, sLon] = subsolarPoint(date);
  const aLat = -sLat;
  const aLon = norm180(sLon + 180);
  const radius = 90 + elevationDeg; // elevation < e  <=>  distance from anti-solar point < 90 + e
  const pts: LatLng[] = [];
  for (let b = 0; b <= 360; b += step) pts.push(destination(aLat, aLon, b, radius));

  // Unwrap longitudes so consecutive points never jump across the antimeridian.
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
    while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
  }

  const span = pts[pts.length - 1][1] - pts[0][1];
  if (Math.abs(span) > 180) {
    // The cap wraps around a pole: close the ring along it.
    const pole = aLat >= 0 ? 90 : -90;
    pts.push([pole, pts[pts.length - 1][1]], [pole, pts[0][1]]);
  }
  return pts;
}
