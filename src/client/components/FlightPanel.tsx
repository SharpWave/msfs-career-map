import { useState } from "react";
import { api } from "../api";
import { aircraftLabel, fmtDateTime, fmtDuration, hopDurationMin } from "../format";
import { RATING_BANDS, RATING_META, finalLanding, parseLandings, parseStats } from "../landing";
import { parseTrack, type LiveState } from "../tracker";
import type { Aircraft, AppState, Briefing, Hop, HopStats, Landing, TrackPoint } from "../types";
import { ProfileChart } from "./ProfileChart";

/** What the panel is showing: a logged hop, or the leg being flown right now. */
export type PanelSource = { kind: "hop"; hopId: number } | { kind: "live" };

interface Props {
  source: PanelSource;
  state: AppState;
  live: LiveState;
  /** Full briefing for the shown flight, loaded by the app (null while loading or when there is none). */
  briefing: Briefing | null;
  onClose: () => void;
  onBriefingChanged: () => void;
}

const num = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${Math.round(v).toLocaleString()}${unit}`);

export function FlightPanel({ source, state, live, briefing, onClose, onBriefingChanged }: Props) {
  const hop: Hop | undefined = source.kind === "hop" ? state.hops.find((h) => h.id === source.hopId) : undefined;
  const aircraft: Aircraft | undefined =
    source.kind === "hop" ? state.aircraft.find((a) => a.id === hop?.aircraft_id) : state.aircraft.find((a) => a.id === live.status?.aircraft_id);

  let title: string;
  let sub: string;
  let track: TrackPoint[];
  let landings: Landing[];
  let stats: HopStats | null;

  if (source.kind === "hop") {
    if (!hop) return null;
    const dur = hopDurationMin(hop);
    title = `${hop.origin} → ${hop.dest}`;
    sub = [`hop ${hop.seq}`, hop.departed_at ? fmtDateTime(hop.departed_at) : null, dur != null ? fmtDuration(dur) : null].filter(Boolean).join(" · ");
    track = parseTrack(hop.track);
    landings = parseLandings(hop.landings);
    stats = parseStats(hop.stats);
  } else {
    const s = live.status;
    const leg = s?.leg;
    title = leg ? `${leg.origin ?? "?"} → …` : "Live";
    sub = leg ? `airborne since ${fmtDateTime(leg.departed_at)} · ${leg.points} points` : "nothing being flown";
    track = live.track;
    landings = leg?.landings ?? [];
    stats = leg
      ? {
          fuel_start_lb: null,
          fuel_end_lb: s?.position?.fuel_lb ?? null,
          fuel_used_lb: leg.fuel_used_lb,
          weight_start_lb: null,
          weight_end_lb: null,
          max_alt_ft: leg.max_alt_ft,
          max_gs_kts: null,
          flown_nm: null,
        }
      : null;
  }

  const landing = hop ? finalLanding(hop) : landings.length ? landings[landings.length - 1] : null;

  return (
    <section className="flight-panel">
      <header className="fp-head">
        {aircraft && <span className="dot" style={{ background: aircraft.color }} />}
        <b>{aircraft ? aircraftLabel(aircraft) : live.status?.sim?.title ?? "aircraft"}</b>
        <span className="route code">{title}</span>
        <span className="muted small">{sub}</span>
        {source.kind === "live" && <span className="pill air">live</span>}
        <button type="button" className="icon close" onClick={onClose} title="Close the flight panel">
          ✕
        </button>
      </header>
      <div className="fp-body">
        <div className="fp-chart">
          <ProfileChart track={track} landings={landings} />
        </div>
        <aside className="fp-side">
          <LandingCard landing={landing} all={landings} />
          <StatsCard stats={stats} points={track.length} directNm={hop ? directNm(hop, state) : null} />
          <BriefingCard hop={hop} briefing={briefing} onChanged={onBriefingChanged} />
        </aside>
      </div>
    </section>
  );
}

function directNm(hop: Hop, state: AppState): number | null {
  const a = state.airports[hop.origin];
  const b = state.airports[hop.dest];
  if (!a || !b) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

function LandingCard({ landing, all }: { landing: Landing | null; all: Landing[] }) {
  const [bands, setBands] = useState(false);
  if (!landing) {
    return (
      <div className="fp-card">
        <h3>Landing</h3>
        <p className="muted small">No touchdown recorded.</p>
      </div>
    );
  }
  const m = RATING_META[landing.rating];
  return (
    <div className="fp-card">
      <h3>Landing</h3>
      <div className="rating" style={{ "--rc": m.color } as React.CSSProperties}>
        <span className="icon">{m.icon}</span>
        <div>
          <div className="word">{m.label}</div>
          <div className="caption">{m.caption}</div>
        </div>
      </div>
      <dl className="kv">
        <dt>Descent rate</dt>
        <dd>
          <b>{landing.fpm} fpm</b>
          {landing.sim_fpm != null && <span className="muted"> · sim says {landing.sim_fpm}</span>}
        </dd>
        <dt>Peak G</dt>
        <dd>{landing.g != null ? <b>{landing.g.toFixed(2)} G</b> : <span className="muted">not measured</span>}</dd>
        {landing.ias_kts != null && (
          <>
            <dt>Touchdown IAS</dt>
            <dd>{landing.ias_kts} kt</dd>
          </>
        )}
        {(landing.pitch_deg != null || landing.bank_deg != null) && (
          <>
            <dt>Attitude</dt>
            <dd>
              {landing.pitch_deg != null && `${landing.pitch_deg.toFixed(1)}° pitch`}
              {landing.pitch_deg != null && landing.bank_deg != null && " · "}
              {landing.bank_deg != null && `${Math.abs(landing.bank_deg).toFixed(1)}° ${landing.bank_deg < 0 ? "left" : "right"} bank`}
            </dd>
          </>
        )}
        {all.length > 1 && (
          <>
            <dt>Touchdowns</dt>
            <dd>
              {all.map((l, i) => (
                <span key={i} className="td-chip" title={`${l.fpm} fpm${l.g != null ? `, ${l.g.toFixed(2)} G` : ""}`}>
                  {RATING_META[l.rating].icon} {l.fpm}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <div className="muted small">
        {landing.source === "frames" ? "Measured every frame at touchdown." : "From once-a-second samples; the per-frame watcher was not available."}{" "}
        <button type="button" className="linkish" onClick={() => setBands((b) => !b)}>
          {bands ? "hide scale" : "scale"}
        </button>
      </div>
      {bands && (
        <ul className="bands">
          {RATING_BANDS.map((b) => (
            <li key={b.rating}>
              <span className="swatch" style={{ background: RATING_META[b.rating].color }} />
              {RATING_META[b.rating].icon} {RATING_META[b.rating].label} <span className="muted">{b.fpm} fpm</span>
            </li>
          ))}
          <li className="muted">A peak G above 1.6 / 2.0 / 2.6 / 3.5 bumps the class up regardless of fpm.</li>
        </ul>
      )}
    </div>
  );
}

function StatsCard({ stats, points, directNm }: { stats: HopStats | null; points: number; directNm: number | null }) {
  return (
    <div className="fp-card">
      <h3>Flight</h3>
      <dl className="kv">
        <dt>Distance</dt>
        <dd>
          {stats?.flown_nm != null ? (
            <>
              <b>{num(stats.flown_nm, " nm")}</b> flown{directNm != null && <span className="muted"> · {num(directNm, " nm")} direct</span>}
            </>
          ) : directNm != null ? (
            `${num(directNm, " nm")} direct`
          ) : (
            "—"
          )}
        </dd>
        <dt>Max altitude</dt>
        <dd>{num(stats?.max_alt_ft, " ft")}</dd>
        <dt>Max ground speed</dt>
        <dd>{num(stats?.max_gs_kts, " kt")}</dd>
        <dt>Fuel used</dt>
        <dd>
          {stats?.fuel_used_lb != null ? <b>{num(stats.fuel_used_lb, " lb")}</b> : "—"}
          {stats?.fuel_start_lb != null && stats?.fuel_end_lb != null && (
            <span className="muted">
              {" "}
              · {num(stats.fuel_start_lb)} → {num(stats.fuel_end_lb)} lb
            </span>
          )}
        </dd>
        <dt>Weight</dt>
        <dd>
          {stats?.weight_start_lb != null ? `${num(stats.weight_start_lb, " lb")} at takeoff` : "—"}
          {stats?.weight_end_lb != null && <span className="muted"> · {num(stats.weight_end_lb, " lb")} at landing</span>}
        </dd>
        <dt>Samples</dt>
        <dd>{points.toLocaleString()}</dd>
      </dl>
    </div>
  );
}

function BriefingCard({ hop, briefing, onChanged }: { hop: Hop | undefined; briefing: Briefing | null; onChanged: () => void }) {
  const [showPlan, setShowPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = async () => {
    if (!hop) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachHopBriefing(hop.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!hop || !window.confirm("Remove the SimBrief plan from this hop?")) return;
    setBusy(true);
    try {
      await api.dropHopBriefing(hop.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!briefing) {
    return (
      <div className="fp-card">
        <h3>SimBrief</h3>
        <p className="muted small">No plan attached to this flight.</p>
        {hop && (
          <button type="button" className="small" onClick={attach} disabled={busy}>
            Attach my latest SimBrief plan
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  const b = briefing;
  const fuelU = b.fuel.units;
  return (
    <div className="fp-card">
      <h3>SimBrief</h3>
      <dl className="kv">
        <dt>Flight</dt>
        <dd>
          <b>{b.callsign ?? [b.airline, b.flight_number].filter(Boolean).join("") ?? "—"}</b>
          {b.aircraft.icao && <span className="muted"> · {b.aircraft.icao}</span>}
          {b.aircraft.reg && <span className="muted"> {b.aircraft.reg}</span>}
        </dd>
        <dt>Plan</dt>
        <dd>
          <b className="code">
            {b.origin.icao ?? "?"}
            {b.origin.rwy ? `/${b.origin.rwy}` : ""} → {b.dest.icao ?? "?"}
            {b.dest.rwy ? `/${b.dest.rwy}` : ""}
          </b>
          {b.alternate?.icao && <span className="muted"> · alt {b.alternate.icao}</span>}
        </dd>
        {b.route && (
          <>
            <dt>Route</dt>
            <dd className="code small route-text">{b.route}</dd>
          </>
        )}
        <dt>Cruise / dist / ETE</dt>
        <dd>
          {num(b.cruise_alt_ft, " ft")} · {num(b.distance_nm, " nm")} · {b.ete_min != null ? fmtDuration(b.ete_min) : "—"}
        </dd>
        <dt>Payload</dt>
        <dd>
          {b.weights.pax != null ? `${b.weights.pax} pax` : "—"}
          {b.weights.cargo != null && ` · ${num(b.weights.cargo)} ${fuelU} cargo`}
          {b.weights.tow != null && <span className="muted"> · TOW {num(b.weights.tow)} {fuelU}</span>}
        </dd>
        <dt>Fuel</dt>
        <dd>
          {b.fuel.burn != null ? `${num(b.fuel.burn)} ${fuelU} burn` : "—"}
          {b.fuel.ramp != null && <span className="muted"> · ramp {num(b.fuel.ramp)}</span>}
          {b.fuel.landing != null && <span className="muted"> · landing {num(b.fuel.landing)}</span>}
        </dd>
        <dt>Generated</dt>
        <dd>{b.generated_at ? fmtDateTime(b.generated_at) : "—"}</dd>
      </dl>
      <div className="actions wrap">
        {b.plan_html && (
          <button type="button" className="small" onClick={() => setShowPlan((s) => !s)}>
            {showPlan ? "Hide OFP" : "Show OFP"}
          </button>
        )}
        {b.pdf_url && (
          <a className="button small" href={b.pdf_url} target="_blank" rel="noreferrer">
            PDF
          </a>
        )}
        {hop && (
          <button type="button" className="small danger" onClick={drop} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {showPlan && b.plan_html && <div className="ofp-html" dangerouslySetInnerHTML={{ __html: b.plan_html }} />}
    </div>
  );
}
