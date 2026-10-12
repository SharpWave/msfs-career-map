import { useMemo } from "react";
import { Polygon } from "react-leaflet";
import { copyShifts, lonSpan, shiftLine } from "../paths";
import { NIGHT_ELEVATION_DEG, nightPolygon } from "../sun";
import { useWorldCopies } from "./WorldCopies";

/**
 * Day/night shading: one polygon where the sun is below the horizon, a second (overlapping)
 * where civil twilight has ended, each drawn as computed on every world copy in view.
 */
// @spec MAP-NIGHT-001
export function NightLayer({ now }: { now: Date }) {
  const { copies } = useWorldCopies();
  const shapes = useMemo(
    () =>
      [
        { key: "dusk", ring: nightPolygon(now, 0) },
        { key: "night", ring: nightPolygon(now, NIGHT_ELEVATION_DEG) },
      ].map((s) => ({ ...s, span: lonSpan(s.ring) })),
    [now],
  );

  return (
    <>
      {shapes.flatMap((s) =>
        copyShifts(s.span, copies).map((d) => (
          <Polygon
            key={`${s.key}@${d}`}
            positions={shiftLine(s.ring, d)}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: "#020617", fillOpacity: 0.22 }}
          />
        )),
      )}
    </>
  );
}
