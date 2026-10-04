/**
 * Weather hazard areas from aviationweather.gov: G-AIRMETs (CONUS: icing, turbulence, IFR,
 * mountain obscuration), US SIGMETs (convective) and international SIGMETs (thunderstorms,
 * icing, turbulence, volcanic ash, tropical cyclones). Normalised to one shape and cached.
 */

const USER_AGENT = "MSFSCareerMap/0.6 (personal flight-sim logbook; local use)";
const AWC = "https://aviationweather.gov/api/data";
const TTL_MS = 10 * 60 * 1000;

export type HazardKind = "ICE" | "TURB" | "IFR" | "MT_OBSC" | "CONVECTIVE" | "VA" | "TC";

export interface Hazard {
  id: string;
  source: "gairmet" | "sigmet" | "isigmet";
  kind: HazardKind;
  /** Original label, e.g. "TURB-LO", "TS", "MTN OBSCN" */
  label: string;
  severity: string | null;
  base_ft: number | null;
  top_ft: number | null;
  valid_from: string | null;
  valid_to: string | null;
  /** G-AIRMET snapshot hour (0, 3, 6); null for SIGMETs. */
  forecast_hour: number | null;
  /** Polygon as [lat, lon] pairs. */
  coords: [number, number][];
  fir: string | null;
  raw: string | null;
}

export interface HazardSet {
  hazards: Hazard[];
  fetched_at: string;
  /** Sources that failed on this refresh, if any. */
  errors: string[];
}

let cache: { at: number; value: HazardSet } | null = null;

async function getJson(path: string): Promise<unknown[]> {
  const res = await fetch(`${AWC}/${path}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const text = (await res.text()).trim();
  const j = text ? JSON.parse(text) : [];
  return Array.isArray(j) ? j : [];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** G-AIRMET altitudes are in hundreds of feet ("120" = 12,000 ft; "SFC" = surface). */
const hundreds = (v: unknown): number | null => {
  if (typeof v === "string" && /^SFC$/i.test(v)) return 0;
  const n = num(v);
  return n === null ? null : n * 100;
};

const coordsOf = (v: unknown): [number, number][] => {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const p of v as { lat?: unknown; lon?: unknown }[]) {
    const lat = num(p.lat);
    const lon = num(p.lon);
    if (lat !== null && lon !== null) out.push([lat, lon]);
  }
  return out;
};

const iso = (v: unknown): string | null => {
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

function kindOf(label: string): HazardKind | null {
  const u = label.toUpperCase();
  if (u.startsWith("ICE") || u === "ICING") return "ICE";
  if (u.startsWith("TURB") || u === "LLWS") return "TURB";
  if (u === "IFR") return "IFR";
  if (u.startsWith("MT") || u.includes("OBSC")) return "MT_OBSC";
  if (u === "CONVECTIVE" || u === "TS" || u.startsWith("TSGR") || u.includes("THUNDER")) return "CONVECTIVE";
  if (u === "VA") return "VA";
  if (u === "TC") return "TC";
  return null;
}

function fromGairmet(rows: unknown[]): Hazard[] {
  const out: Hazard[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (String(r.geometryType ?? r.geom ?? "") !== "AREA") continue;
    const label = String(r.hazard ?? "");
    const kind = kindOf(label);
    if (!kind) continue; // freezing-level lines, surface wind, etc.
    const coords = coordsOf(r.coords);
    if (coords.length < 3) continue;
    const hour = num(r.forecastHour) ?? num(r.forecast);
    out.push({
      id: `g-${r.tag ?? ""}-${label}-${hour ?? ""}-${r.validTime ?? ""}`,
      source: "gairmet",
      kind,
      label,
      severity: typeof r.severity === "string" ? r.severity : null,
      base_ft: hundreds(r.base),
      top_ft: hundreds(r.top),
      valid_from: iso(r.validTime),
      valid_to: iso(r.expireTime),
      forecast_hour: hour,
      coords,
      fir: null,
      raw: null,
    });
  }
  return out;
}

function fromSigmet(rows: unknown[]): Hazard[] {
  const out: Hazard[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const type = String(r.airSigmetType ?? "");
    if (type === "OUTLOOK") continue;
    const label = String(r.hazard ?? "");
    const kind = kindOf(label);
    if (!kind) continue;
    const coords = coordsOf(r.coords);
    if (coords.length < 3) continue;
    out.push({
      id: `s-${r.icaoId ?? ""}-${r.alphaChar ?? ""}-${r.seriesId ?? ""}-${r.validTimeFrom ?? ""}`,
      source: "sigmet",
      kind,
      label: `${type} ${label}`.trim(),
      severity: typeof r.severity === "string" ? r.severity : null,
      base_ft: num(r.altitudeLow1) ?? num(r.altitudeLow2),
      top_ft: num(r.altitudeHi1) ?? num(r.altitudeHi2),
      valid_from: iso(r.validTimeFrom),
      valid_to: iso(r.validTimeTo),
      forecast_hour: null,
      coords,
      fir: null,
      raw: typeof r.rawAirSigmet === "string" ? r.rawAirSigmet : null,
    });
  }
  return out;
}

function fromIsigmet(rows: unknown[]): Hazard[] {
  const out: Hazard[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const label = String(r.hazard ?? "");
    const kind = kindOf(label);
    if (!kind) continue;
    const coords = coordsOf(r.coords);
    if (coords.length < 3) continue;
    out.push({
      id: `i-${r.icaoId ?? ""}-${r.seriesId ?? ""}-${r.validTimeFrom ?? ""}`,
      source: "isigmet",
      kind,
      label: `SIGMET ${label}${r.qualifier ? ` ${r.qualifier}` : ""}`,
      severity: typeof r.qualifier === "string" ? r.qualifier : null,
      base_ft: num(r.base),
      top_ft: num(r.top),
      valid_from: iso(r.validTimeFrom),
      valid_to: iso(r.validTimeTo),
      forecast_hour: null,
      coords,
      fir: typeof r.firName === "string" ? r.firName : typeof r.firId === "string" ? r.firId : null,
      raw: typeof r.rawSigmet === "string" ? r.rawSigmet : null,
    });
  }
  return out;
}

/** Current hazard areas from all three sources, cached for ten minutes. */
export async function currentHazards(): Promise<HazardSet> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [g, s, i] = await Promise.allSettled([
    getJson("gairmet?format=json"),
    getJson("airsigmet?format=json"),
    getJson("isigmet?format=json"),
  ]);
  const errors: string[] = [];
  const hazards: Hazard[] = [];
  if (g.status === "fulfilled") hazards.push(...fromGairmet(g.value));
  else errors.push(`gairmet: ${g.reason}`);
  if (s.status === "fulfilled") hazards.push(...fromSigmet(s.value));
  else errors.push(`sigmet: ${s.reason}`);
  if (i.status === "fulfilled") hazards.push(...fromIsigmet(i.value));
  else errors.push(`isigmet: ${i.reason}`);
  if (errors.length === 3 && cache) return cache.value;
  const value: HazardSet = { hazards, fetched_at: new Date().toISOString(), errors };
  cache = { at: Date.now(), value };
  return value;
}
