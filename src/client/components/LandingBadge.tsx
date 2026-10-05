import { RATING_META } from "../landing";
import type { Landing } from "../types";

/** Small pill: icon + word + fpm, colored by rating (the icon and word carry the meaning, not the color). */
export function LandingBadge({ landing, compact }: { landing: Landing; compact?: boolean }) {
  const m = RATING_META[landing.rating];
  return (
    <span
      className="landing-badge"
      style={{ "--rc": m.color } as React.CSSProperties}
      title={`${m.label}: ${m.caption} · ${landing.fpm} fpm${landing.g != null ? `, ${landing.g.toFixed(2)} G` : ""}`}
    >
      {m.icon} {compact ? "" : `${m.label} · `}
      {landing.fpm} fpm
    </span>
  );
}
