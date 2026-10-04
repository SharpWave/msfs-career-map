import { useEffect, useMemo, useState } from "react";
import { Polygon, Tooltip } from "react-leaflet";
import { api } from "../api";
import { fmtDateTime, fmtFt } from "../format";
import type { Hazard, HazardKind, HazardSet } from "../types";

export const HAZARD_STYLE: Record<HazardKind, { color: string; label: string }> = {
  ICE: { color: "#38bdf8", label: "Icing" },
  TURB: { color: "#f97316", label: "Turbulence" },
  IFR: { color: "#a78bfa", label: "IFR" },
  MT_OBSC: { color: "#a16207", label: "Mountain obscuration" },
  CONVECTIVE: { color: "#ef4444", label: "Convective" },
  VA: { color: "#6b7280", label: "Volcanic ash" },
  TC: { color: "#dc2626", label: "Tropical cyclone" },
};

const REFRESH_MS = 10 * 60 * 1000;

/** Keep the G-AIRMET snapshot whose valid time is nearest to now; SIGMETs are always current. */
function selectCurrent(all: Hazard[], now: Date): Hazard[] {
  const g = all.filter((h) => h.source === "gairmet");
  const hours = [...new Set(g.map((h) => h.forecast_hour ?? 0))];
  let bestHour: number | null = null;
  let bestDiff = Infinity;
  for (const hr of hours) {
    const sample = g.find((h) => (h.forecast_hour ?? 0) === hr && h.valid_from);
    if (!sample?.valid_from) continue;
    const diff = Math.abs(new Date(sample.valid_from).getTime() - now.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestHour = hr;
    }
  }
  return all.filter((h) => h.source !== "gairmet" || bestHour === null || (h.forecast_hour ?? 0) === bestHour);
}

interface Props {
  kinds: Set<HazardKind>;
  now: Date;
  onStatus?: (s: { count: number; fetched_at: string | null; error: string | null }) => void;
}

/** Shaded G-AIRMET / SIGMET areas for the enabled hazard kinds, refreshed every ten minutes. */
export function HazardLayer({ kinds, now, onStatus }: Props) {
  const [set, setSet] = useState<HazardSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .hazards()
        .then((s) => {
          if (cancelled) return;
          setSet(s);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const shown = useMemo(() => (set ? selectCurrent(set.hazards, now).filter((h) => kinds.has(h.kind)) : []), [set, kinds, now]);

  useEffect(() => {
    onStatus?.({ count: shown.length, fetched_at: set?.fetched_at ?? null, error });
  }, [shown.length, set?.fetched_at, error, onStatus]);

  return (
    <>
      {shown.map((h) => {
        const st = HAZARD_STYLE[h.kind];
        return (
          <Polygon
            key={h.id}
            positions={h.coords}
            pathOptions={{ color: st.color, weight: 1.5, opacity: 0.8, fillColor: st.color, fillOpacity: 0.18, dashArray: h.source === "gairmet" ? undefined : "6 4" }}
          >
            <Tooltip sticky className="tip" opacity={1}>
              <div className="tip-title" style={{ color: st.color }}>
                {st.label}
                {h.severity && <span className="muted"> · {h.severity}</span>}
              </div>
              <div className="tip-sub">{h.label}{h.fir ? ` · ${h.fir}` : ""}</div>
              <div className="tip-route">
                {h.base_ft != null || h.top_ft != null
                  ? `${h.base_ft != null ? fmtFt(h.base_ft) : "SFC"} – ${h.top_ft != null ? fmtFt(h.top_ft) : "above"}`
                  : "altitudes not given"}
              </div>
              {(h.valid_from || h.valid_to) && (
                <div className="tip-sub">
                  valid {h.valid_from ? fmtDateTime(h.valid_from) : "…"} → {h.valid_to ? fmtDateTime(h.valid_to) : "…"}
                  {h.forecast_hour != null && ` · G-AIRMET +${h.forecast_hour}h`}
                </div>
              )}
              {h.raw && <div className="tip-notes">{h.raw.slice(0, 220)}{h.raw.length > 220 ? "…" : ""}</div>}
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}
