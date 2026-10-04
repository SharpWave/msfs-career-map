import { useMemo } from "react";
import { Polygon } from "react-leaflet";
import type { LatLng } from "../geo";
import { NIGHT_ELEVATION_DEG, nightPolygon } from "../sun";

/**
 * Day/night shading: one polygon where the sun is below the horizon, a second (overlapping)
 * where civil twilight has ended, drawn on three world copies so panning stays seamless.
 */
export function NightLayer({ now }: { now: Date }) {
  const rings = useMemo(() => {
    const dusk = nightPolygon(now, 0);
    const night = nightPolygon(now, NIGHT_ELEVATION_DEG);
    const shift = (ring: LatLng[], d: number): LatLng[] => ring.map(([lat, lon]) => [lat, lon + d]);
    return [-360, 0, 360].flatMap((d) => [
      { key: `dusk${d}`, ring: shift(dusk, d), opacity: 0.22 },
      { key: `night${d}`, ring: shift(night, d), opacity: 0.22 },
    ]);
  }, [now]);

  return (
    <>
      {rings.map((r) => (
        <Polygon key={r.key} positions={r.ring} interactive={false} pathOptions={{ stroke: false, fillColor: "#020617", fillOpacity: r.opacity }} />
      ))}
    </>
  );
}
