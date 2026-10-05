import { useEffect, useMemo, useRef, useState } from "react";
import { RATING_META } from "../landing";
import type { Landing, TrackPoint } from "../types";

/**
 * Flight profile: every recorded series against elapsed time, each indexed to its own range so
 * they share one plot without a second y-axis. The legend carries each series' real min–max in
 * place of axis ticks, and the crosshair readout shows the real values at the pointer.
 */

interface Series {
  key: string;
  label: string;
  unit: string;
  /** Index into a TrackPoint. */
  idx: number;
  color: string;
}

/** Fixed categorical order (validated for the dark surface); never re-assigned when a series is hidden. */
const SERIES: Series[] = [
  { key: "alt", label: "Altitude", unit: "ft", idx: 2, color: "#3987e5" },
  { key: "gs", label: "Ground speed", unit: "kt", idx: 4, color: "#d95926" },
  { key: "vs", label: "Vertical speed", unit: "fpm", idx: 5, color: "#199e70" },
  { key: "ias", label: "IAS", unit: "kt", idx: 6, color: "#c98500" },
  { key: "fuel", label: "Fuel", unit: "lb", idx: 7, color: "#d55181" },
];

const PAD = { top: 12, right: 12, bottom: 26, left: 12 };

interface Props {
  track: TrackPoint[];
  landings?: Landing[];
  /** Pixel height of the plot area; width follows the container. */
  height?: number;
}

function fmtElapsed(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${r.toString().padStart(2, "0")}` : `${h}h`;
}

function tickStepSec(totalSec: number): number {
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
  for (const s of steps) if (totalSec / s <= 7) return s;
  return 28800;
}

export function ProfileChart({ track, landings = [], height = 190 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    if (track.length < 2) return null;
    const t0 = track[0][3];
    const t1 = track[track.length - 1][3];
    const span = Math.max(1, t1 - t0);
    const series = SERIES.map((s) => {
      const vals = track.map((p) => (typeof p[s.idx] === "number" && Number.isFinite(p[s.idx]) ? (p[s.idx] as number) : null));
      const present = vals.filter((v): v is number => v !== null);
      if (present.length < 2) return null;
      const min = Math.min(...present);
      const max = Math.max(...present);
      // A flat series (e.g. fuel on a plane that reports none) is not worth a line.
      if (max - min === 0) return null;
      return { ...s, vals, min, max };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
    return { t0, t1, span, series };
  }, [track]);

  if (!model) return <div className="muted small">No profile: this hop was logged by hand or its track is too short.</div>;

  const { t0, span, series } = model;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (tSec: number) => PAD.left + ((tSec - t0) / span) * plotW;
  const yFor = (s: (typeof series)[number], v: number) => PAD.top + plotH - ((v - s.min) / (s.max - s.min)) * plotH;

  const paths = series
    .filter((s) => !hidden.has(s.key))
    .map((s) => {
      let d = "";
      let pen = false;
      track.forEach((p, i) => {
        const v = s.vals[i];
        if (v === null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(p[3]).toFixed(1)},${yFor(s, v).toFixed(1)}`;
        pen = true;
      });
      return { s, d };
    });

  const step = tickStepSec(span);
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const tSec = t0 + ((px - PAD.left) / plotW) * span;
    // Nearest sample by time (samples are evenly spaced, so a scan is fine at this size).
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < track.length; i++) {
      const d = Math.abs(track[i][3] - tSec);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  };

  const hp = hover !== null ? track[hover] : null;
  const tipLeft = hp ? Math.min(Math.max(x(hp[3]), 90), width - 90) : 0;
  const landingTicks = landings
    .map((l) => ({ l, t: Math.round(new Date(l.t).getTime() / 1000) }))
    .filter(({ t }) => t >= t0 && t <= t0 + span);

  return (
    <div className="profile" ref={wrap}>
      <div className="profile-legend">
        {series.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`legend-item${hidden.has(s.key) ? " off" : ""}`}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                if (n.has(s.key)) n.delete(s.key);
                else n.add(s.key);
                return n;
              })
            }
            title={hidden.has(s.key) ? "Show series" : "Hide series"}
          >
            <span className="key" style={{ background: s.color }} />
            <span className="name">{s.label}</span>
            <span className="range">
              {Math.round(s.min).toLocaleString()}–{Math.round(s.max).toLocaleString()} {s.unit}
            </span>
          </button>
        ))}
        <button type="button" className={`legend-item${table ? "" : " off"}`} onClick={() => setTable((t) => !t)} title="Show the samples as a table">
          <span className="name">Table</span>
        </button>
      </div>

      {!table && (
        <div className="profile-plot">
          <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Flight profile">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t0 + t)} x2={x(t0 + t)} y1={PAD.top} y2={PAD.top + plotH} className="grid" />
                <text x={x(t0 + t)} y={height - 8} textAnchor="middle" className="axis">
                  {fmtElapsed(t)}
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH} className="axis-line" />
            {landingTicks.map(({ l, t }, i) => (
              <g key={i}>
                <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={PAD.top + plotH} className="landing-tick" />
                <text x={x(t)} y={PAD.top + 10} textAnchor="middle" className="landing-label">
                  {RATING_META[l.rating].icon} {l.fpm}
                </text>
              </g>
            ))}
            {paths.map(({ s, d }) => (
              <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hp && (
              <>
                <line x1={x(hp[3])} x2={x(hp[3])} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />
                {series
                  .filter((s) => !hidden.has(s.key) && s.vals[hover!] !== null)
                  .map((s) => (
                    <circle key={s.key} cx={x(hp[3])} cy={yFor(s, s.vals[hover!]!)} r={4} fill={s.color} stroke="#192230" strokeWidth={2} />
                  ))}
              </>
            )}
          </svg>
          {hp && (
            <div className="profile-tip" style={{ left: tipLeft }}>
              <div className="when">
                +{fmtElapsed(hp[3] - t0)} · {new Date(hp[3] * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </div>
              {series
                .filter((s) => !hidden.has(s.key) && s.vals[hover!] !== null)
                .map((s) => (
                  <div key={s.key} className="row">
                    <span className="key" style={{ background: s.color }} />
                    <b>
                      {Math.round(s.vals[hover!]!).toLocaleString()} {s.unit}
                    </b>
                    <span className="muted">{s.label}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {table && (
        <div className="profile-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                {series.map((s) => (
                  <th key={s.key}>
                    {s.label} ({s.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {track.map((p, i) => (
                <tr key={i}>
                  <td>+{fmtElapsed(p[3] - t0)}</td>
                  {series.map((s) => (
                    <td key={s.key}>{s.vals[i] === null ? "" : Math.round(s.vals[i]!).toLocaleString()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
