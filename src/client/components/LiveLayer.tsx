import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import type { LatLng } from "../geo";
import { headMarkerHtml } from "../icons";
import { unwrapTrack, type RenderData } from "../paths";
import type { LiveState } from "../tracker";
import type { Aircraft } from "../types";

interface Props {
  live: LiveState;
  aircraft: Aircraft[];
  data: RenderData;
}

/** The aircraft being flown right now and the track it has laid down since takeoff. */
export function LiveLayer({ live, aircraft, data }: Props) {
  const s = live.status;
  if (!s || !s.connected || !s.position) return null;

  const bound = s.aircraft_id != null ? aircraft.find((a) => a.id === s.aircraft_id) : undefined;
  const color = bound?.color ?? "#ffffff";
  // Keep the live line on the same world copy as the bound aircraft's path.
  const head = bound ? data.heads.find((h) => h.aircraft.id === bound.id) : undefined;
  const ref: LatLng | undefined = head ? head.pos : undefined;
  const pos = unwrapTrack([[s.position.lat, s.position.lon, 0, 0]], ref)[0];
  const pts = unwrapTrack(live.track, ref);

  const iconSource = bound ?? ({ icon: "builtin:single-piston", name: s.sim?.title ?? "aircraft", color } as Aircraft);
  const html =
    `<div class="live-marker" style="--c:${color}">${headMarkerHtml(iconSource, false)}` +
    `<div class="hdg" style="transform:rotate(${s.position.hdg_deg}deg)"></div></div>`;

  return (
    <>
      {pts.length >= 2 && (
        <>
          <Polyline positions={pts} interactive={false} pathOptions={{ color: "#05080c", weight: 8, opacity: 0.45, lineCap: "round", lineJoin: "round" }} />
          <Polyline positions={pts} interactive={false} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
        </>
      )}
      <Marker position={pos} zIndexOffset={2000} icon={L.divIcon({ className: "live-wrap", html, iconSize: [44, 44], iconAnchor: [22, 22] })}>
        <Tooltip direction="top" offset={[0, -26]} className="tip" opacity={1}>
          <div className="tip-title" style={{ color }}>
            LIVE · {bound ? bound.name : s.sim?.title ?? "aircraft"}
          </div>
          <div className="tip-sub">
            {s.position.alt_ft.toLocaleString()} ft · {s.position.gs_kts} kt · hdg {s.position.hdg_deg.toString().padStart(3, "0")}°
            {s.position.on_ground ? " · on ground" : ""}
          </div>
          {s.leg && (
            <div className="tip-sub">
              from <b>{s.leg.origin ?? "?"}</b> · {s.leg.points} points
            </div>
          )}
        </Tooltip>
      </Marker>
    </>
  );
}
