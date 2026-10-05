import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import type { LatLng } from "../geo";
import { unwrapTrack } from "../paths";
import type { OfpFix } from "../types";

interface Props {
  fixes: OfpFix[];
  color?: string;
  /** Longitude reference so the route lands on the same world copy as the flight it belongs to. */
  ref?: LatLng;
}

/** A SimBrief route: dashed line through the navlog fixes, each fix a small dot with its name on hover. */
export function BriefingLayer({ fixes, color = "#ffffff", ref }: Props) {
  if (fixes.length < 2) return null;
  const pts = unwrapTrack(
    fixes.map((f) => [f.lat, f.lon, 0, 0]),
    ref,
  );
  return (
    <>
      <Polyline positions={pts} interactive={false} pathOptions={{ color: "#05080c", weight: 5, opacity: 0.35 }} />
      <Polyline positions={pts} interactive={false} pathOptions={{ color, weight: 2, opacity: 0.9, dashArray: "6 6" }} />
      {fixes.map((f, i) => (
        <CircleMarker
          key={`${f.ident}-${i}`}
          center={pts[i]}
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
    </>
  );
}
