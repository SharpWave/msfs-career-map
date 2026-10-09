import { useCallback, useRef, type CSSProperties } from "react";
import type { HazardKind } from "../types";
import { HAZARD_STYLE } from "./HazardLayer";
import { Icon } from "./Icon";
import type { Basemap } from "./MapView";
import { useDismiss } from "./useDismiss";

const BASEMAPS: { key: Basemap; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "satellite", label: "Satellite" },
];

/** The four hazard toggles; IFR also draws mountain obscuration, Storms also ash and cyclones. */
export const HAZARD_TOGGLES: { key: HazardKind; label: string; covers: string }[] = [
  { key: "ICE", label: "Ice", covers: "Icing" },
  { key: "TURB", label: "Turb", covers: "Turbulence" },
  { key: "IFR", label: "IFR", covers: "IFR and mountain obscuration" },
  { key: "CONVECTIVE", label: "Storms", covers: "Convective, volcanic ash, tropical cyclones" },
];

export interface MapToolbarProps {
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  nightOn: boolean;
  onToggleNight: () => void;
  /** Which of the four hazard toggles are on. */
  hazards: Set<HazardKind>;
  onToggleHazard: (k: HazardKind) => void;
  hazardStatus: { count: number; fetched_at: string | null; error: string | null } | null;
  layersOpen: boolean;
  onLayersOpenChange: (open: boolean) => void;
  onFitAll: () => void;
  highlighted: boolean;
  onClearHighlight: () => void;
  planShown: boolean;
  onClearPlan: () => void;
}

/** The top bar's right end: Clear chips while they apply, the hazard count, Layers and Fit all. */
// @spec MAP-VIEW-006, MAP-VIEW-007, MAP-HAZ-005, MAP-HAZ-008, MAP-HL-002, PLAN-RUN-002
export function MapToolbar(p: MapToolbarProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => p.onLayersOpenChange(false), [p.onLayersOpenChange]);
  useDismiss(wrap, p.layersOpen, close);
  const onToggles = HAZARD_TOGGLES.filter((t) => p.hazards.has(t.key));

  return (
    <div className="map-toolbar">
      {p.highlighted && (
        <button type="button" className="chip-button glass" onClick={p.onClearHighlight} title="Show all aircraft at full strength">
          Clear highlight
        </button>
      )}
      {p.planShown && (
        <button type="button" className="chip-button glass" onClick={p.onClearPlan} title="Remove the planner results from the map">
          Clear plan
        </button>
      )}
      {onToggles.length > 0 && p.hazardStatus && (
        <span className="toolbar-note glass" title={p.hazardStatus.fetched_at ? `fetched ${new Date(p.hazardStatus.fetched_at).toLocaleTimeString()}` : ""}>
          {p.hazardStatus.error ? "hazards unavailable" : `${p.hazardStatus.count} areas`}
        </span>
      )}
      <div className="layers-wrap" ref={wrap}>
        <button
          type="button"
          className="bar-button layers-button glass"
          aria-label="Layers"
          title="Basemap, night shading and weather hazards"
          aria-haspopup="dialog"
          aria-expanded={p.layersOpen}
          onClick={() => p.onLayersOpenChange(!p.layersOpen)}
        >
          <Icon name="layers" />
          <span className="layers-word" aria-hidden="true">
            Layers
          </span>
          {(p.nightOn || onToggles.length > 0) && (
            <span className="layer-marks" aria-hidden="true">
              {p.nightOn && <Icon name="moon" className="mark-moon" />}
              {onToggles.map((t) => (
                <i key={t.key} className="hz-dot" data-hazard={t.key} style={{ background: HAZARD_STYLE[t.key].color }} />
              ))}
            </span>
          )}
        </button>
        {p.layersOpen && (
          <div className="layers-menu glass" role="dialog" aria-label="Layers">
            <div className="layers-group">
              <div className="layers-title">Basemap</div>
              <div className="seg">
                {BASEMAPS.map((b) => (
                  <button type="button" key={b.key} aria-pressed={p.basemap === b.key} className={p.basemap === b.key ? "on" : ""} onClick={() => p.onBasemap(b.key)}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="layers-group layer-row">
              <button type="button" className={`layer-toggle${p.nightOn ? " on" : ""}`} aria-pressed={p.nightOn} onClick={p.onToggleNight}>
                Night shading
              </button>
              <span className="layer-covers">Where the sun is down, darker after civil twilight</span>
            </div>
            <div className="layers-group">
              <div className="layers-title">Weather hazards</div>
              {HAZARD_TOGGLES.map((t) => {
                const on = p.hazards.has(t.key);
                return (
                  <div className="layer-row" key={t.key}>
                    <button
                      type="button"
                      className={`layer-toggle hz${on ? " on" : ""}`}
                      aria-pressed={on}
                      style={{ "--hz": HAZARD_STYLE[t.key].color } as CSSProperties}
                      onClick={() => p.onToggleHazard(t.key)}
                    >
                      {t.label}
                    </button>
                    <span className="layer-covers">{t.covers}</span>
                  </div>
                );
              })}
              <div className="layers-source">G-AIRMETs and SIGMETs from aviationweather.gov</div>
            </div>
          </div>
        )}
      </div>
      <button type="button" className="bar-button glass" onClick={p.onFitAll} title="Zoom to every path">
        <Icon name="fit" />
        <span>Fit all</span>
      </button>
    </div>
  );
}
