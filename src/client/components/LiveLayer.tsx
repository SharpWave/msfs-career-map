import { useMemo } from "react";
import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { headMarkerHtml } from "../icons";
import { copyShifts, liveShapes, lonSpan, shiftLine, shiftPoint } from "../paths";
import type { LiveState } from "../tracker";
import type { Aircraft } from "../types";
import { useWorldCopies } from "./WorldCopies";

interface Props {
  live: LiveState;
  aircraft: Aircraft[];
}

/**
 * The aircraft being flown right now and the track it has laid down since takeoff, on every world
 * copy in view: the aircraft at its own position, the track placed sample to sample.
 */
// @spec LIVE-LAYER-001, LIVE-LAYER-002, LIVE-LAYER-003
export function LiveLayer({ live, aircraft }: Props) {
  const { copies } = useWorldCopies();
  const s = live.status;
  const position = s?.connected ? s.position : null;
  const lat = position?.lat;
  const lon = position?.lon;
  const shapes = useMemo(() => (lat == null || lon == null ? null : liveShapes({ lat, lon }, live.track)), [lat, lon, live.track]);
  if (!s || !position || !shapes) return null;

  const bound = s.aircraft_id != null ? aircraft.find((a) => a.id === s.aircraft_id) : undefined;
  const color = bound?.color ?? "#ffffff";
  const iconSource = bound ?? ({ icon: "builtin:single-piston", name: s.sim?.title ?? "aircraft", color } as Aircraft);
  const html =
    `<div class="live-marker" style="--c:${color}">${headMarkerHtml(iconSource, false)}` +
    `<div class="hdg" style="transform:rotate(${position.hdg_deg ?? 0}deg)"></div></div>`;
  const icon = L.divIcon({ className: "live-wrap", html, iconSize: [44, 44], iconAnchor: [22, 22] });
  const { pos, track } = shapes;

  return (
    <>
      {track.length >= 2 &&
        copyShifts(lonSpan(track), copies).map((d) => (
          <Polyline key={`case@${d}`} positions={shiftLine(track, d)} interactive={false} pathOptions={{ color: "#05080c", weight: 8, opacity: 0.45, lineCap: "round", lineJoin: "round" }} />
        ))}
      {track.length >= 2 &&
        copyShifts(lonSpan(track), copies).map((d) => (
          <Polyline key={`track@${d}`} positions={shiftLine(track, d)} interactive={false} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
        ))}
      {copyShifts([pos[1], pos[1]], copies).map((d) => (
        <Marker key={`live@${d}`} position={shiftPoint(pos, d)} zIndexOffset={2000} icon={icon}>
          <Tooltip direction="top" offset={[0, -26]} className="tip" opacity={1}>
            <div className="tip-title" style={{ color }}>
              LIVE · {bound ? bound.name : s.sim?.title ?? "aircraft"}
            </div>
            <div className="tip-sub">
              {(position.alt_ft ?? 0).toLocaleString()} ft · {position.gs_kts ?? 0} kt · hdg {String(position.hdg_deg ?? 0).padStart(3, "0")}°
              {position.on_ground ? " · on ground" : ""}
            </div>
            {s.leg && (
              <div className="tip-sub">
                from <b>{s.leg.origin ?? "?"}</b> · {s.leg.points} points
              </div>
            )}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
