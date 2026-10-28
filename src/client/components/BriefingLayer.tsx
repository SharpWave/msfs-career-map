import { Fragment, useMemo } from "react";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import type { LatLng } from "../geo";
import { copyShifts, lonSpan, routeLine, shiftLine, shiftPoint } from "../paths";
import type { PlanAirport } from "../simbrief";
import type { OfpFix } from "../types";
import { useWorldCopies } from "./WorldCopies";

interface Props {
  fixes: OfpFix[];
  color?: string;
}

/**
 * A SimBrief route: dashed line through the navlog fixes, each fix a small dot with its name on
 * hover. Placed fix to fix and drawn on every world copy in view.
 */
// @spec SB-ROUTE-002, SB-ROUTE-003
export function BriefingLayer({ fixes, color = "#ffffff" }: Props) {
  const { copies } = useWorldCopies();
  const pts = useMemo(() => routeLine(fixes), [fixes]);
  if (fixes.length < 2) return null;
  return (
    <>
      {copyShifts(lonSpan(pts), copies).map((d) => {
        const line = shiftLine(pts, d);
        return (
          <Fragment key={d}>
            <Polyline positions={line} interactive={false} pathOptions={{ color: "#05080c", weight: 5, opacity: 0.35 }} />
            <Polyline positions={line} interactive={false} pathOptions={{ color, weight: 2, opacity: 0.9, dashArray: "6 6" }} />
            {fixes.map((f, i) => (
              <CircleMarker
                key={`${f.ident}-${i}`}
                center={shiftPoint(pts[i], d)}
                radius={f.type === "apt" ? 5 : 3}
                pathOptions={{ color: "#05080c", weight: 1, fillColor: color, fillOpacity: 0.95, opacity: 1 }}
              >
                <Tooltip direction="top" offset={[0, -4]} className="tip" opacity={1}>
                  <div className="tip-title">{f.ident}</div>
                  <div className="tip-sub">
                    {f.name && f.name !== f.ident ? `${f.name} · ` : ""}
                    {f.airway && f.airway !== "DCT" ? `via ${f.airway} · ` : ""}
                    {f.alt_ft != null ? `${f.alt_ft.toLocaleString()} ft` : f.type}
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

/** A circle's radius on screen, at every zoom. */
const PLAN_AIRPORT_RADIUS = 16;
/** Ten dashes round the circle, so the dash pattern meets itself where the outline closes. */
const PLAN_AIRPORT_DASH = ((2 * Math.PI * PLAN_AIRPORT_RADIUS) / 10).toFixed(3);
const PLAN_AIRPORT_DASHES = `${(Number(PLAN_AIRPORT_DASH) * 0.6).toFixed(3)} ${(Number(PLAN_AIRPORT_DASH) * 0.4).toFixed(3)}`;

/**
 * The current plan's departure and arrival: a dashed circle of fixed screen size at each, over a faint
 * fill, its dashes turning slowly (styles.css `.plan-airport`). Drawn on every world copy in view, and
 * taking no pointer events.
 */
// @spec SB-ROUTE-005, SB-ROUTE-006
export function PlanAirportsLayer({ airports, color = "#ffffff" }: { airports: PlanAirport[]; color?: string }) {
  const { copies } = useWorldCopies();
  return (
    <>
      {airports.map((a) => {
        const p: LatLng = [a.lat, a.lon];
        return copyShifts([a.lon, a.lon], copies).map((d) => (
          <CircleMarker
            key={`${a.icao ?? ""}-${a.lat},${a.lon}-${d}`}
            center={shiftPoint(p, d)}
            radius={PLAN_AIRPORT_RADIUS}
            interactive={false}
            className="plan-airport"
            pathOptions={{ color, weight: 2, opacity: 0.9, dashArray: PLAN_AIRPORT_DASHES, fillColor: color, fillOpacity: 0.12 }}
          />
        ));
      })}
    </>
  );
}
