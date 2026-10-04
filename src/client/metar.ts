import type { Airport, Metar } from "./types";

/** A METAR older than this is ignored for the map graphics (routine reports are hourly). */
export const METAR_FRESH_MINUTES = 90;

/** How long a fetched METAR is reused client-side before asking the server again. */
export const METAR_REUSE_MS = 5 * 60 * 1000;

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export const CATEGORY_COLORS: Record<FlightCategory, string> = {
  VFR: "#22c55e",
  MVFR: "#3b82f6",
  IFR: "#ef4444",
  LIFR: "#d946ef",
};

export interface MetarEntry {
  metar: Metar | null;
  /** When this entry was received, for client-side reuse. */
  at: number;
}

export type MetarMap = Map<string, MetarEntry>;

/** ICAO station id for METAR lookups, or null when the airport has none. */
export function metarStation(a: Airport): string | null {
  if (a.icao_code && /^[A-Z0-9]{4}$/.test(a.icao_code)) return a.icao_code;
  if (/^[A-Z]{4}$/.test(a.ident)) return a.ident;
  return null;
}

export function isFresh(m: Metar | null | undefined, now = Date.now()): m is Metar {
  if (!m?.observed_at) return false;
  return now - new Date(m.observed_at).getTime() < METAR_FRESH_MINUTES * 60 * 1000;
}

/** Flight category from a fresh METAR, or null when unknown or stale. */
export function freshCategory(m: Metar | null | undefined, now = Date.now()): FlightCategory | null {
  if (!isFresh(m, now)) return null;
  const c = m.flight_category;
  return c === "VFR" || c === "MVFR" || c === "IFR" || c === "LIFR" ? c : null;
}

/** Fresh flight category for an airport given the client cache, or null. */
export function categoryFor(a: Airport, metars: MetarMap, now = Date.now()): FlightCategory | null {
  const st = metarStation(a);
  if (!st) return null;
  return freshCategory(metars.get(st)?.metar, now);
}

/** Short wind/visibility/age line for tooltips. */
export function metarBrief(m: Metar): string {
  let wind = "";
  if (m.wind_kts === 0) wind = "calm";
  else if (m.wind_kts != null) {
    const dir = typeof m.wind_dir === "number" ? `${m.wind_dir.toString().padStart(3, "0")}°` : m.wind_dir ?? "VRB";
    wind = `${dir} ${m.wind_kts} kt${m.gust_kts ? ` G${m.gust_kts}` : ""}`;
  }
  const parts = [wind, m.visibility ? `${m.visibility} SM` : ""].filter(Boolean);
  const ceiling = m.clouds.find((c) => c.cover === "BKN" || c.cover === "OVC" || c.cover === "OVX");
  if (ceiling) parts.push(`${ceiling.cover} ${ceiling.base_ft ?? "?"} ft`);
  else if (m.clouds.length === 0) parts.push("clear");
  if (m.observed_at) parts.push(`${Math.round((Date.now() - new Date(m.observed_at).getTime()) / 60000)} min ago`);
  return parts.join(" · ");
}
