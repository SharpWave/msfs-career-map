/**
 * Terrain along a leg, sampled from Open-Meteo's elevation API (Copernicus DEM, 90 m).
 * Up to 100 points per request; results are cached per rounded coordinate.
 */

const OPEN_METEO = "https://api.open-meteo.com/v1/elevation";
const USER_AGENT = "MSFSCareerMap/0.6 (personal flight-sim logbook; local use)";
const FT_PER_M = 3.28084;

const cache = new Map<string, number>();
const key = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Evenly spaced points along the great circle from a to b, inclusive. */
export function greatCirclePoints(a: [number, number], b: [number, number], n: number): [number, number][] {
  const lat1 = toRad(a[0]), lon1 = toRad(a[1]), lat2 = toRad(b[0]), lon2 = toRad(b[1]);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (d < 1e-6) return [a, b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

/** Elevation in feet for each point (sea level for ocean), fetching only what is not cached. */
export async function elevationsFt(points: [number, number][]): Promise<number[]> {
  const missing = points.filter(([lat, lon]) => !cache.has(key(lat, lon)));
  const uniq = [...new Map(missing.map((p) => [key(p[0], p[1]), p])).values()];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const url = `${OPEN_METEO}?latitude=${chunk.map((p) => p[0].toFixed(4)).join(",")}&longitude=${chunk.map((p) => p[1].toFixed(4)).join(",")}`;
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`open-meteo: ${res.status}`);
    const j = (await res.json()) as { elevation?: number[] };
    const elev = j.elevation ?? [];
    chunk.forEach((p, idx) => {
      const m = elev[idx];
      cache.set(key(p[0], p[1]), typeof m === "number" && Number.isFinite(m) ? Math.max(0, m) * FT_PER_M : 0);
    });
  }
  return points.map(([lat, lon]) => cache.get(key(lat, lon)) ?? 0);
}

export interface TerrainProfile {
  samples: { lat: number; lon: number; ft: number }[];
  max_ft: number;
  max_at: { lat: number; lon: number };
}

/** Terrain profile along a leg with `n` segments (n+1 samples). */
export async function terrainAlong(a: [number, number], b: [number, number], n = 24): Promise<TerrainProfile> {
  const pts = greatCirclePoints(a, b, Math.max(2, Math.min(99, n)));
  const ft = await elevationsFt(pts);
  let max = -1;
  let maxAt = pts[0];
  const samples = pts.map((p, i) => {
    const v = Math.round(ft[i]);
    if (v > max) {
      max = v;
      maxAt = p;
    }
    return { lat: p[0], lon: p[1], ft: v };
  });
  return { samples, max_ft: max, max_at: { lat: maxAt[0], lon: maxAt[1] } };
}
