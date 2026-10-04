import { airportTypeLabel, fmtFt, surfaceLabel } from "../format";
import type { Airport, Runway } from "../types";

/** Airport class and runway list for tooltips: "Medium airport · elev 55 ft" then one line per runway. */
export function RunwayInfo({ airport, max = 4 }: { airport: Airport; max?: number }) {
  const rws = (airport.runways ?? []).filter((r) => !r.closed);
  const extra = rws.length - max;
  return (
    <div className="rwy-info">
      <div className="tip-sub">
        {airportTypeLabel(airport.type)}
        {airport.elevation_ft != null && <> · elev {fmtFt(airport.elevation_ft)}</>}
        {rws.length === 0 && airport.rwy_count === 0 && <> · no runway data</>}
      </div>
      {rws.length > 0 && (
        <ul className="rwy-list">
          {rws.slice(0, max).map((r, i) => (
            <li key={i}>
              <span className={`surf surf-${r.surface_class}`} />
              <b>{runwayName(r)}</b>{" "}
              {r.length_ft != null ? fmtFt(r.length_ft) : "length n/a"}
              {r.width_ft != null && <span className="muted"> × {r.width_ft} ft</span>}{" "}
              <span className="muted">
                {surfaceLabel(r.surface_class)}
                {r.surface && r.surface_class === "unknown" && ` (${r.surface})`}
                {r.lighted ? " · lit" : ""}
              </span>
            </li>
          ))}
          {extra > 0 && <li className="muted">+{extra} more</li>}
        </ul>
      )}
    </div>
  );
}

export function runwayName(r: Runway): string {
  if (r.le_ident && r.he_ident) return `${r.le_ident}/${r.he_ident}`;
  return r.le_ident ?? r.he_ident ?? "rwy";
}
