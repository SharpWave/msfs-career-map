import { useMemo } from "react";
import L from "leaflet";
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { headMarkerHtml } from "../icons";
import { casualShapes, copyShifts, liveShapes, lonSpan, shiftLine, shiftPoint } from "../paths";
import type { LiveState } from "../tracker";
import type { Aircraft } from "../types";
import { useWorldCopies } from "./WorldCopies";

interface Props {
  live: LiveState;
  aircraft: Aircraft[];
}

const CASING = { color: "#05080c", weight: 8, opacity: 0.45, lineCap: "round", lineJoin: "round" } as const;

/**
 * The aircraft being flown right now and the track it has laid down since takeoff — or, in casual
 * mode, the dashed casual path — on every world copy in view: the aircraft at its own position,
 * lines placed sample to sample. The casual path stays drawn while the sim is away; the aircraft
 * needs the link.
 */
// @spec LIVE-LAYER-001, LIVE-LAYER-002, LIVE-LAYER-003, LIVE-LAYER-004
export function LiveLayer({ live, aircraft }: Props) {
  const { copies } = useWorldCopies();
  const s = live.status;
  const position = s?.connected ? s.position : null;
  const lat = position?.lat;
  const lon = position?.lon;
  const casual = s?.casual ?? null;
  const casualOn = casual != null;
  const shapes = useMemo(() => (lat == null || lon == null ? null : liveShapes({ lat, lon }, live.track)), [lat, lon, live.track]);
  const casualLines = useMemo(
    () => (casualOn ? casualShapes(live.path, lat == null || lon == null ? null : { lat, lon }) : []),
    [casualOn, live.path, lat, lon],
  );
  if (!s) return null;

  const bound = s.aircraft_id != null ? aircraft.find((a) => a.id === s.aircraft_id) : undefined;
  const color = bound?.color ?? "#ffffff";
  const name = bound ? bound.name : s.sim?.title ?? "aircraft";

  // Every casing goes under every dashed line, so segments that cross do not cut each other.
  const placed = casualLines.flatMap((line, i) => (line.length >= 2 ? copyShifts(lonSpan(line), copies).map((d) => ({ key: `${i}@${d}`, line: shiftLine(line, d) })) : []));
  const casualLayer = (
    <>
      {placed.map(({ key, line }) => (
        <Polyline key={`casual-case${key}`} positions={line} interactive={false} pathOptions={{ ...CASING, className: "casual-casing" }} />
      ))}
      {placed.map(({ key, line }) => (
        <Polyline
          key={`casual${key}`}
          positions={line}
          interactive={false}
          pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round", dashArray: "10 9", className: "casual-path" }}
        />
      ))}
    </>
  );
  if (!position || !shapes) return casualLayer;

  const iconSource = bound ?? ({ icon: "builtin:single-piston", name: s.sim?.title ?? "aircraft", color } as Aircraft);
  const html =
    `<div class="live-marker" style="--c:${color}">${headMarkerHtml(iconSource, false)}` +
    `<div class="hdg" style="transform:rotate(${position.hdg_deg ?? 0}deg)"></div></div>`;
  const icon = L.divIcon({ className: "live-wrap", html, iconSize: [44, 44], iconAnchor: [22, 22] });
  const { pos, track } = shapes;

  return (
    <>
      {casualLayer}
      {track.length >= 2 &&
        copyShifts(lonSpan(track), copies).map((d) => (
          <Polyline key={`case@${d}`} positions={shiftLine(track, d)} interactive={false} pathOptions={CASING} />
        ))}
      {track.length >= 2 &&
        copyShifts(lonSpan(track), copies).map((d) => (
          <Polyline key={`track@${d}`} positions={shiftLine(track, d)} interactive={false} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
        ))}
      {copyShifts([pos[1], pos[1]], copies).map((d) => (
        <Marker key={`live@${d}`} position={shiftPoint(pos, d)} zIndexOffset={2000} icon={icon}>
          <Tooltip direction="top" offset={[0, -26]} className="tip" opacity={1}>
            <div className="tip-title" style={{ color }}>
              {casual ? "CASUAL" : "LIVE"} · {name}
            </div>
            <div className="tip-sub">
              {(position.alt_ft ?? 0).toLocaleString()} ft · {position.gs_kts ?? 0} kt · hdg {String(position.hdg_deg ?? 0).padStart(3, "0")}°
              {position.on_ground ? " · on ground" : ""}
            </div>
            {casual ? (
              <div className="tip-sub">path · {casual.points} points</div>
            ) : (
              s.leg && (
                <div className="tip-sub">
                  from <b>{s.leg.origin ?? "?"}</b> · {s.leg.points} points
                </div>
              )
            )}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
