import { freshCategory, metarStation, type MetarMap } from "./metar";
import { isDark } from "./sun";
import type { Aircraft, Airport, Metar, PlanCandidate } from "./types";

/**
 * Checks that depend on live weather or the clock, applied client-side to planner candidates.
 * (Field elevation vs. ceiling/oxygen is a hard filter on the server.)
 */

export type FlagKind = "ifr" | "xwind" | "dark" | "night";

export interface Flag {
  kind: FlagKind;
  text: string;
  /** Blocking flags hide the airport by default; advisory ones just tag it. */
  blocking: boolean;
}

export function runwayHeadings(a: Airport): number[] {
  if (a.runways?.length) {
    return a.runways.filter((r) => !r.closed && r.le_heading != null).map((r) => r.le_heading as number);
  }
  return (a.rwy_headings ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

/** Smallest crosswind component across the airport's runways, or null when unknown. */
export function crosswind(m: Metar, headings: number[]): { kts: number; heading: number } | null {
  if (typeof m.wind_dir !== "number" || m.wind_kts == null || headings.length === 0) return null;
  const speed = m.gust_kts && m.gust_kts > m.wind_kts ? m.gust_kts : m.wind_kts;
  if (speed === 0) return { kts: 0, heading: headings[0] };
  let best: { kts: number; heading: number } | null = null;
  for (const h of headings) {
    const delta = ((m.wind_dir - h) * Math.PI) / 180;
    const kts = Math.abs(speed * Math.sin(delta));
    if (!best || kts < best.kts) best = { kts, heading: h };
  }
  return best;
}

export function assessCandidate(c: PlanCandidate, aircraft: Aircraft | undefined, metars: MetarMap, now: Date): Flag[] {
  const flags: Flag[] = [];
  const station = metarStation(c);
  const metar = station ? metars.get(station)?.metar : undefined;
  const cat = freshCategory(metar, now.getTime());

  if (aircraft && !aircraft.ifr_capable && (cat === "IFR" || cat === "LIFR")) {
    flags.push({ kind: "ifr", text: `${cat} conditions, VFR-only aircraft`, blocking: true });
  }

  if (aircraft?.max_xwind_kts && metar && cat) {
    const xw = crosswind(metar, runwayHeadings(c));
    if (xw && xw.kts > aircraft.max_xwind_kts) {
      flags.push({
        kind: "xwind",
        text: `Crosswind ${Math.round(xw.kts)} kt on best runway, limit ${aircraft.max_xwind_kts} kt`,
        blocking: true,
      });
    }
  }

  const eta = new Date(now.getTime() + c.est_minutes * 60000);
  if (isDark(c.lat, c.lon, eta)) {
    if (c.rwy_lighted) flags.push({ kind: "night", text: "Night arrival (runway lit)", blocking: false });
    else flags.push({ kind: "dark", text: "Dark at ETA and no runway lighting", blocking: true });
  }

  return flags;
}

export function isBlocked(flags: Flag[] | undefined): boolean {
  return !!flags?.some((f) => f.blocking);
}
