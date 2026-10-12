import { Fragment, useMemo } from "react";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import { copyShifts, lonSpan, routeLine, shiftLine, shiftPoint } from "../paths";
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
