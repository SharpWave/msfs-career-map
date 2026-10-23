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

/** A touchdown less than this after the previous one is a bounce within the same landing. */
const BOUNCE_MS = 30_000;

/**
 * The touchdown that stands for a flight wherever one is shown: the first touchdown of its final
 * landing, so a bounced arrival is judged by its first contact while touch-and-go circuits still
 * give way to the landing that ended the flight. The tracker's "Logged" message applies the same rule.
 */
// @spec PANEL-LOOK-004
export function shownTouchdown(landings: Landing[]): Landing | null {
  let i = landings.length - 1;
  if (i < 0) return null;
  while (i > 0 && Date.parse(landings[i].t) - Date.parse(landings[i - 1].t) < BOUNCE_MS) i--;
  return landings[i];
}

/** The touchdown that stands for a hop, if it was tracked. */
export function hopTouchdown(hop: Hop): Landing | null {
  return shownTouchdown(parseLandings(hop.landings));
}
