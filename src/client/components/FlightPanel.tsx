import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { aircraftLabel, fmtDateTime, fmtDuration, fmtTimeShort, hopDurationMin } from "../format";
import { RATING_BANDS, RATING_META, parseLandings, parseStats, shownTouchdown } from "../landing";
import { cleanOfpHtml, outsideLink } from "../ofp-html";
import { parseTrack, type LiveState } from "../tracker";
import type { Aircraft, Airport, AppState, Briefing, Hop, HopStats, Landing, PendingLeg, PendingLegDetail, TrackPoint } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";
import { IconButton } from "./Icon";
import { ProfileChart } from "./ProfileChart";

/** What the panel is showing: a logged hop, the leg being flown right now, or a leg waiting to be logged. */
export type PanelSource = { kind: "hop"; hopId: number } | { kind: "live" } | { kind: "pending"; id: string };

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

/** A pending leg in full, track included, fetched when the panel opens it (LIVE-API-007). */
function usePendingDetail(id: string | null): PendingLegDetail | null {
  const [detail, setDetail] = useState<PendingLegDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    if (id == null) return;
    let cancelled = false;
    api
      .trackerPending(id)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);
  return detail;
}

/** Both airports of a pending leg, once both are known, for its direct distance. */
function useAirportPair(origin: string | null | undefined, dest: string | null | undefined, known: AppState["airports"]): [Airport, Airport] | null {
  const [pair, setPair] = useState<[Airport, Airport] | null>(null);
  useEffect(() => {
    setPair(null);
    if (!origin || !dest) return;
    let cancelled = false;
    const get = (code: string) => (known[code] ? Promise.resolve(known[code]) : api.getAirport(code));
    Promise.all([get(origin), get(dest)])
      .then(([a, b]) => !cancelled && setPair([a, b]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dest]);
  return pair;
}

// @spec PANEL-OPEN-003, APP-UI-005, PANEL-OPEN-002, PANEL-HEAD-005, PANEL-STAT-003
export function FlightPanel({ source, state, live, briefing, onClose, onBriefingChanged }: Props) {
  const hop: Hop | undefined = source.kind === "hop" ? state.hops.find((h) => h.id === source.hopId) : undefined;
  const listed: PendingLeg | undefined = source.kind === "pending" ? live.status?.pending.find((p) => p.id === source.id) : undefined;
  const detail = usePendingDetail(source.kind === "pending" ? source.id : null);
  const pending = detail ?? listed;
  const pair = useAirportPair(pending?.origin, pending?.dest, state.airports);
  const aircraftId = source.kind === "hop" ? hop?.aircraft_id : source.kind === "pending" ? pending?.aircraft_id : live.status?.aircraft_id;
  const aircraft: Aircraft | undefined = state.aircraft.find((a) => a.id === aircraftId);
  let simTitle = live.status?.sim?.title;
  let directNmShown: number | null = hop ? directNm(hop, state) : null;

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
  } else if (source.kind === "pending") {
    if (!pending) return null;
    title = `${pending.origin ?? "?"} → ${pending.dest ?? "?"}`;
    sub = [
      "waiting to be logged",
      `off ${fmtTimeShort(pending.departed_at)}`,
      `${pending.ended_in_air ? "last seen" : "down"} ${fmtTimeShort(pending.arrived_at)}`,
      fmtDuration(pending.duration_min),
    ]
      .filter(Boolean)
      .join(" · ");
    track = detail?.track ?? [];
    landings = pending.landings ?? [];
    stats = pending.stats ?? null;
    simTitle = pending.sim?.title;
    directNmShown = pair ? greatCircleNm(pair[0], pair[1]) : null;
  } else {
    const s = live.status;
    const leg = s?.leg;
    title = leg ? `${leg.origin ?? "?"} → …` : "Live";
    sub = leg ? `airborne since ${fmtDateTime(leg.departed_at)} · ${leg.points} points` : "nothing being flown";
    track = live.track;
    landings = leg?.landings ?? [];
    stats = null;
    if (leg) {
      stats = {
        fuel_start_lb: null,
        fuel_end_lb: s?.position?.fuel_lb ?? null,
        fuel_used_lb: leg.fuel_used_lb ?? null,
        weight_start_lb: null,
        weight_end_lb: null,
        max_alt_ft: leg.max_alt_ft ?? null,
        max_gs_kts: null,
        flown_nm: null,
      };
    }
  }

  const landing = shownTouchdown(landings);

  return (
    <section className="flight-panel glass">
      <header className="fp-head">
        {aircraft && <span className="dot" style={{ background: aircraft.color }} />}
        <b>{aircraft ? aircraftLabel(aircraft) : simTitle ?? "aircraft"}</b>
        <span className="route code">{title}</span>
        <span className="muted small">{sub}</span>
        {source.kind === "live" && <span className="pill air">live</span>}
        <IconButton icon="close" label="Close the flight panel" className="close" onClick={onClose} />
      </header>
      {/* A malformed record fails here, inside the panel, which keeps its place and close button. */}
      <ErrorBoundary label="Flight panel">
        <div className="fp-body">
          <div className="fp-chart">
            <ProfileChart track={track} landings={landings} />
          </div>
          <aside className="fp-side">
            <LandingCard landing={landing} all={landings} />
            <StatsCard stats={stats} points={track.length} directNm={directNmShown} />
            <BriefingCard hop={hop} briefing={briefing} onChanged={onBriefingChanged} />
          </aside>
        </div>
      </ErrorBoundary>
    </section>
  );
}

function directNm(hop: Hop, state: AppState): number | null {
  const a = state.airports[hop.origin];
  const b = state.airports[hop.dest];
  if (!a || !b) return null;
  return greatCircleNm(a, b);
}

function greatCircleNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

// @spec PANEL-LAND-001, PANEL-LAND-002
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

/** A plan's OFP text, cleaned each time it is shown, in its light box. @spec SB-CARD-006, SB-CARD-011 */
function OfpText({ html }: { html: string }) {
  const clean = useMemo(() => cleanOfpHtml(html), [html]);
  return <div className="ofp-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}

// @spec SB-CARD-005, SB-CARD-007
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
  const pdf = outsideLink(b.pdf_url);
  return (
    <div className="fp-card">
      <h3>SimBrief</h3>
      <dl className="kv">
        <dt>Flight</dt>
        <dd>
          <b>{b.callsign || [b.airline, b.flight_number].filter(Boolean).join("") || "—"}</b>
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
        {pdf && (
          <a className="button small" href={pdf} target="_blank" rel="noopener noreferrer">
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
      {showPlan && b.plan_html && <OfpText html={b.plan_html} />}
    </div>
  );
}
