import type { Hop, HopStats, Landing, LandingRating } from "./types";

/**
 * How a landing reads to the passengers. The rating itself is decided on the server
 * (src/server/tracker.ts, rateLanding) from descent rate and peak G; this is just how to show it.
 * Colors are the status ramp and always travel with the icon and word, never alone.
 */
export const RATING_META: Record<LandingRating, { icon: string; label: string; caption: string; color: string }> = {
  butter: { icon: "🧈", label: "Butter", caption: "nobody looked up from their book", color: "#3bceac" },
  solid: { icon: "👍", label: "Solid", caption: "the coffee stayed in the cups", color: "#86b6ef" },
  hard: { icon: "💥", label: "Hard", caption: "a few gasps from the cabin", color: "#fbbf24" },
  hospital: { icon: "🏥", label: "Hospital", caption: "someone is calling a lawyer", color: "#f97316" },
  graveyard: { icon: "🪦", label: "Graveyard", caption: "nobody is walking away from that one", color: "#ef4444" },
};

/** The fpm bands the server uses, for the legend in the panel. */
export const RATING_BANDS: { rating: LandingRating; fpm: string }[] = [
  { rating: "butter", fpm: "≤ 100" },
  { rating: "solid", fpm: "101–250" },
  { rating: "hard", fpm: "251–500" },
  { rating: "hospital", fpm: "501–800" },
  { rating: "graveyard", fpm: "> 800" },
];

export function parseLandings(json: string | null | undefined): Landing[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as Landing[]).filter((l) => l && typeof l.fpm === "number") : [];
  } catch {
    return [];
  }
}

export function parseStats(json: string | null | undefined): HopStats | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as HopStats) : null;
  } catch {
    return null;
  }
}

/** The landing that ended the hop (the last touchdown), if it was tracked. */
export function finalLanding(hop: Hop): Landing | null {
  const ls = parseLandings(hop.landings);
  return ls.length ? ls[ls.length - 1] : null;
}
