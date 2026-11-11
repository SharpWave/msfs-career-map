import { hopDurationMin } from "./format";
import { distanceNm } from "./geo";
import { hopTouchdown, parseStats } from "./landing";
import type { Airport, Hop, Landing, LandingRating, PlanDigestEntry } from "./types";

/**
 * What a tour adds up to, worked out from an aircraft's hops for the aircraft panel: each hop's
 * figures, the tour block's totals, tour facts and landing summary, and a plan's figures beside a
 * hop's. Nothing here reads the map's drawn geometry, so a hidden aircraft's tour adds up the same.
 */

/** One hop as the aircraft panel reads it. */
export interface HopFigures {
  hop: Hop;
  /** The distance flown, else the direct distance; null when the map state lacks one of its airports. */
  distanceNm: number | null;
  distanceKind: "flown" | "direct" | null;
  /** Fuel burned, lb; null when the hop recorded none. */
  fuelLb: number | null;
  /** Flight time in minutes, stored or derived from its times. */
  durationMin: number | null;
  /** The touchdown that stands for the hop (flight-panel's rule). */
  touchdown: Landing | null;
  /** When it was flown: its departure, else its arrival. */
  when: string | null;
}

// @spec ACP-TOUR-003, ACP-TOUR-005, ACP-LIST-002, ACP-LIST-003
export function hopFigures(hop: Hop, airports: Record<string, Airport>): HopFigures {
  const stats = parseStats(hop.stats);
  const from = airports[hop.origin];
  const to = airports[hop.dest];
  let nm: number | null = null;
  let kind: HopFigures["distanceKind"] = null;
  if (typeof stats?.flown_nm === "number" && stats.flown_nm > 0) {
    nm = stats.flown_nm;
    kind = "flown";
  } else if (from && to) {
    nm = distanceNm([from.lat, from.lon], [to.lat, to.lon]);
    kind = "direct";
  }
  return {
    hop,
    distanceNm: nm,
    distanceKind: kind,
    fuelLb: typeof stats?.fuel_used_lb === "number" && stats.fuel_used_lb > 0 ? stats.fuel_used_lb : null,
    durationMin: hopDurationMin(hop),
    touchdown: hopTouchdown(hop),
    when: hop.departed_at ?? hop.arrived_at ?? null,
  };
}

/** An aircraft's hops, in the order given, each with its figures. */
export function tourRows(hops: Hop[], airports: Record<string, Airport>): HopFigures[] {
  return hops.map((h) => hopFigures(h, airports));
}

const RATING_ORDER: LandingRating[] = ["butter", "solid", "hard", "hospital", "graveyard"];

export interface TourSummary {
  hops: number;
  /** The sum of the hops' flight times, a hop without one counting 0. */
  loggedMin: number;
  /** The sum of the hops' distances, a hop without one counting 0. */
  distanceNm: number;
  /** The sum of fuel burned over the hops that have a fuel figure; null when none has. */
  fuelLb: number | null;
  /** How many hops have a fuel figure. */
  fuelHops: number;
  /** Different airports among origins and destinations. */
  airports: number;
  /** The earliest and latest hop time, ISO. */
  first: string | null;
  latest: string | null;
  /** The hop with the greatest distance, the later one in tour order on a tie. */
  longest: HopFigures | null;
  landings: { count: number; avgFpm: number | null; byRating: { rating: LandingRating; count: number }[] };
}

/** The tour block's figures, from the aircraft's hops in tour order. */
// @spec ACP-TOUR-002, ACP-TOUR-004, ACP-TOUR-006, ACP-TOUR-007, ACP-TOUR-008, ACP-TOUR-009, ACP-TOUR-010
export function tourSummary(rows: HopFigures[]): TourSummary {
  const idents = new Set<string>();
  let loggedMin = 0;
  let nm = 0;
  let fuel = 0;
  let fuelHops = 0;
  let first: string | null = null;
  let latest: string | null = null;
  let longest: HopFigures | null = null;
  let fpm = 0;
  const ratings = new Map<LandingRating, number>();
  let landings = 0;

  for (const r of rows) {
    idents.add(r.hop.origin);
    idents.add(r.hop.dest);
    loggedMin += r.durationMin ?? 0;
    if (r.distanceNm != null) {
      nm += r.distanceNm;
      if (!longest || r.distanceNm >= (longest.distanceNm ?? 0)) longest = r;
    }
    if (r.fuelLb != null) {
      fuel += r.fuelLb;
      fuelHops++;
    }
    if (r.when && Number.isFinite(Date.parse(r.when))) {
      if (first === null || Date.parse(r.when) < Date.parse(first)) first = r.when;
      if (latest === null || Date.parse(r.when) > Date.parse(latest)) latest = r.when;
    }
    if (r.touchdown) {
      landings++;
      fpm += r.touchdown.fpm;
      ratings.set(r.touchdown.rating, (ratings.get(r.touchdown.rating) ?? 0) + 1);
    }
  }

  return {
    hops: rows.length,
    loggedMin,
    distanceNm: nm,
    fuelLb: fuelHops > 0 ? fuel : null,
    fuelHops,
    airports: idents.size,
    first,
    latest,
    longest,
    landings: {
      count: landings,
      avgFpm: landings > 0 ? Math.round(fpm / landings) : null,
      byRating: RATING_ORDER.filter((k) => ratings.has(k)).map((k) => ({ rating: k, count: ratings.get(k)! })),
    },
  };
}

const LB_PER_KG = 2.20462;

/**
 * A plan's time en route and planned burn beside a hop's flown figures. The burn is in pounds, as
 * every flown fuel figure on the page is: SimBrief's `lbs` as given, `kgs` converted, and none for
 * a plan in any other unit.
 */
// @spec ACP-PLAN-005
export function plannedFigures(entry: PlanDigestEntry): { eteMin: number | null; burnLb: number | null } {
  const { units, burn } = entry.fuel;
  let burnLb: number | null = null;
  if (typeof burn === "number" && Number.isFinite(burn)) {
    if (units === "lbs") burnLb = Math.round(burn);
    else if (units === "kgs") burnLb = Math.round(burn * LB_PER_KG);
  }
  return { eteMin: entry.ete_min ?? null, burnLb };
}

/**
 * The digest entry for a hop, used only while the entry's plan is the one the hop links to: a hop
 * whose plan was replaced or removed since the digest was asked for has none.
 */
// @spec ACP-PLAN-003
export function digestEntry(hop: Hop, digest: PlanDigestEntry[] | null): PlanDigestEntry | null {
  if (!digest || hop.briefing_id == null) return null;
  return digest.find((e) => e.hop_id === hop.id && e.id === hop.briefing_id) ?? null;
}
