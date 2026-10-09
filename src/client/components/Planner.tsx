import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { aircraftLabel, airportTypeLabel, airportWhere, fmtDuration, fmtFt, fmtNm, runwaySummary } from "../format";
import { isBlocked, type Flag } from "../constraints";
import { categoryFor, type MetarMap } from "../metar";
import { legFor, simbriefUrl } from "../simbrief";
import type { AppState, PlanCandidate, PlanResult } from "../types";
import { AirportInput } from "./AirportInput";

const FLAG_ICON: Record<Flag["kind"], string> = { ifr: "IFR", xwind: "X-wind", dark: "Dark", night: "Night" };

interface Props {
  state: AppState;
  plan: PlanResult | null;
  metars: MetarMap;
  /** Live-weather / clock checks per candidate ident. */
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  onHideFlagged: (v: boolean) => void;
  selectedId: number | null;
  onPlan: (p: PlanResult | null) => void;
  /** Use this candidate as the next hop's destination. */
  onPick: (c: PlanCandidate) => void;
  /** Zoom the map to this candidate. */
  onFocus: (c: PlanCandidate) => void;
  onEditAircraft: (id: number) => void;
}

const TYPE_OPTIONS: [string, string][] = [
  ["large_airport", "Large"],
  ["medium_airport", "Medium"],
  ["small_airport", "Small"],
  ["seaplane_base", "Seaplane"],
  ["heliport", "Heliport"],
];

const QUICK_MINUTES = [30, 60, 90, 120, 180, 240];
const LIST_MAX = 80;

export function Planner({ state, plan, metars, flags, hideFlagged, onHideFlagged, selectedId, onPlan, onPick, onFocus, onEditAircraft }: Props) {
  const eligible = state.aircraft.filter((a) => a.cruise_kts);
  const [aircraftId, setAircraftId] = useState<number>(() =>
    selectedId && state.aircraft.some((a) => a.id === selectedId) ? selectedId : eligible[0]?.id ?? state.aircraft[0]?.id ?? 0,
  );
  const [minutes, setMinutes] = useState("90");
  const [types, setTypes] = useState<Set<string>>(() => new Set(["large_airport", "medium_airport", "small_airport"]));
  const [paved, setPaved] = useState(false);
  const [from, setFrom] = useState("");
  const [cruiseAlt, setCruiseAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Follow the aircraft highlighted in the fleet / on the map.
  useEffect(() => {
    if (selectedId && state.aircraft.some((a) => a.id === selectedId)) setAircraftId(selectedId);
  }, [selectedId, state.aircraft]);

  // Switching aircraft resets the cruise-altitude override to that aircraft's typical altitude.
  useEffect(() => {
    const a = state.aircraft.find((x) => x.id === aircraftId);
    setCruiseAlt(a?.cruise_alt_ft ? String(a.cruise_alt_ft) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftId]);

  // Keep the form in step with a plan that was started elsewhere (URL auto-run).
  useEffect(() => {
    if (!plan) return;
    setMinutes(String(plan.max_minutes));
    setPaved(plan.paved_only);
    setTypes(new Set(plan.types));
    setCruiseAlt(String(plan.profile.cruise_alt_ft));
    if (state.aircraft.some((a) => a.id === plan.aircraft_id)) setAircraftId(plan.aircraft_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // Fall back if the chosen aircraft was deleted.
  useEffect(() => {
    if (state.aircraft.length && !state.aircraft.some((a) => a.id === aircraftId)) {
      setAircraftId(eligible[0]?.id ?? state.aircraft[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aircraft]);

  const aircraft = state.aircraft.find((a) => a.id === aircraftId);
  const parked = useMemo(() => {
    const hs = state.hops.filter((h) => h.aircraft_id === aircraftId);
    return hs.length ? hs[hs.length - 1].dest : null;
  }, [state.hops, aircraftId]);

  const toggleType = (t: string) =>
    setTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!aircraft) return setError("Choose an aircraft.");
    if (!aircraft.cruise_kts) return setError("This aircraft has no cruise speed yet.");
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) return setError("Enter a maximum flight time in minutes.");
    if (types.size === 0) return setError("Pick at least one airport type.");
    if (!parked && !from.trim()) return setError("This aircraft has no hops yet; enter a starting airport.");
    const alt = cruiseAlt.trim() === "" ? undefined : Number(cruiseAlt);
    if (alt !== undefined && (!Number.isFinite(alt) || alt < 500)) return setError("Cruise altitude must be at least 500 ft.");
    setBusy(true);
    try {
      const r = await api.plan({
        aircraft_id: aircraft.id,
        max_minutes: m,
        types: [...types],
        paved,
        from: from.trim() || undefined,
        cruise_alt_ft: alt,
      });
      onPlan(r);
      setFilter("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const blockedCount = useMemo(() => (plan ? plan.candidates.filter((c) => isBlocked(flags.get(c.ident))).length : 0), [plan, flags]);

  const filtered = useMemo(() => {
    if (!plan) return [];
    const f = filter.trim().toLowerCase();
    return plan.candidates.filter((c) => {
      if (hideFlagged && isBlocked(flags.get(c.ident))) return false;
      if (!f) return true;
      return (
        c.ident.toLowerCase().includes(f) ||
        c.name.toLowerCase().includes(f) ||
        (c.municipality ?? "").toLowerCase().includes(f) ||
        (c.iata_code ?? "").toLowerCase() === f
      );
    });
  }, [plan, filter, flags, hideFlagged]);

  if (state.aircraft.length === 0) {
    return <p className="muted">Add an aircraft with a cruise speed to plan its next hop.</p>;
  }

  return (
    <div className="planner">
      <form onSubmit={run}>
        <label>
          <span>Aircraft</span>
          <select value={aircraftId} onChange={(e) => setAircraftId(Number(e.target.value))}>
            {state.aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {aircraftLabel(a)}
                {a.cruise_kts ? ` — ${a.cruise_kts} kts` : " — no cruise speed"}
              </option>
            ))}
          </select>
        </label>

        {aircraft && !aircraft.cruise_kts && (
          <div className="notice">
            Set a cruise speed on this aircraft to unlock the planner.{" "}
            <button type="button" className="link" onClick={() => onEditAircraft(aircraft.id)}>
              Edit aircraft
            </button>
          </div>
        )}

        <div className="two">
          <label>
            <span>Max flight time, min</span>
            <input type="number" min={1} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <div className="quick">
              {QUICK_MINUTES.map((m) => (
                <button type="button" key={m} className={`chip${Number(minutes) === m ? " on" : ""}`} onClick={() => setMinutes(String(m))}>
                  {fmtDuration(m)}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>
              From <em>(default: where it's parked)</em>
            </span>
            <AirportInput value={from} onChange={setFrom} placeholder={parked ?? "ICAO"} />
          </label>
        </div>

        <label>
          <span>
            Cruise altitude, ft <em>(for climb/descent time; also sent to SimBrief)</em>
          </span>
          <input type="number" min={500} step={500} value={cruiseAlt} onChange={(e) => setCruiseAlt(e.target.value)} placeholder="aircraft default (6,500)" />
          {aircraft && !aircraft.oxygen && Number(cruiseAlt) > 12000 && (
            <div className="hint bad">Above 12,000 ft without oxygen or pressurisation.</div>
          )}
        </label>

        <div className="type-row">
          {TYPE_OPTIONS.map(([t, label]) => (
            <label key={t} className="check">
              <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
              <span>{label}</span>
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={paved} onChange={(e) => setPaved(e.target.checked)} />
            <span>Paved only</span>
          </label>
        </div>

        <div className="muted small">
          {aircraft?.min_runway_ft
            ? `Only airports with a runway of at least ${fmtFt(aircraft.min_runway_ft)} (aircraft setting; airports without runway data are left out).`
            : "No minimum runway length set for this aircraft, so every airport in range is included."}
          {aircraft && (
            <>
              {" "}
              {aircraft.ceiling_ft
                ? `Fields above ${fmtFt(aircraft.ceiling_ft - 2000)} are out (ceiling ${fmtFt(aircraft.ceiling_ft)} minus a 2,000 ft pattern).`
                : ""}
              {!aircraft.oxygen ? " No oxygen/pressurisation, so fields above 10,000 ft are out." : ""}
            </>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !aircraft?.cruise_kts}>
            {busy ? "Searching…" : "Find airports in range"}
          </button>
          {plan && (
            <button type="button" onClick={() => onPlan(null)} disabled={busy}>
              Clear
            </button>
          )}
        </div>
      </form>

      {plan && (
        <div className="plan-results">
          <div className="plan-summary">
            <b>{plan.total.toLocaleString()}</b> airport{plan.total === 1 ? "" : "s"} within <b>{fmtNm(plan.range_nm)}</b> of{" "}
            <b className="code">{plan.origin.ident}</b>
            <span className="muted">
              {" "}
              ({fmtDuration(plan.max_minutes)} at {plan.cruise_kts} kts)
            </span>
            <div className="muted small" title="Block time = taxi/approach overhead + climb at climb speed + cruise + descent">
              Block-time model: {plan.profile.overhead_min} min on the ground and in the pattern, climb {plan.profile.climb_fpm} fpm at{" "}
              {plan.profile.climb_kts} kts to {plan.profile.cruise_alt_ft.toLocaleString()} ft, descend {plan.profile.descent_fpm} fpm. Naive{" "}
              speed × time would be {fmtNm(plan.naive_range_nm)}.
            </div>
            {plan.truncated && (
              <div className="notice small">
                Too many to show them all: the nearest {plan.candidates.length.toLocaleString()} are drawn, reaching only{" "}
                <b>{fmtNm(plan.shown_nm)}</b> out (inner ring). Untick small airports, set paved only, or shorten the time to see the full range.
              </div>
            )}
          </div>

          <div className="legend">
            <span><i className="surf surf-paved" /> paved</span>
            <span><i className="surf surf-grass" /> grass</span>
            <span><i className="surf surf-gravel" /> gravel/dirt</span>
            <span><i className="surf surf-water" /> water</span>
            <span className="muted">· bigger dot = bigger airport</span>
          </div>
          <div className="legend">
            <span className="muted">ring = current weather:</span>
            <span><i className="ring ring-VFR" /> VFR</span>
            <span><i className="ring ring-MVFR" /> MVFR</span>
            <span><i className="ring ring-IFR" /> IFR</span>
            <span><i className="ring ring-LIFR" /> LIFR</span>
            <span className="muted">(large &amp; medium, METAR under 90 min old)</span>
          </div>

          <label className="check">
            <input type="checkbox" checked={hideFlagged} onChange={(e) => onHideFlagged(e.target.checked)} />
            <span>
              Hide airports ruled out by live weather or darkness
              {blockedCount > 0 && <span className="muted"> ({blockedCount})</span>}
            </span>
          </label>

          {plan.candidates.length > 8 && (
            <input type="search" placeholder="Filter by code, name or city" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}

          <ol className="cand-list">
            {filtered.slice(0, LIST_MAX).map((c) => {
              const cat = categoryFor(c, metars);
              const cf = flags.get(c.ident) ?? [];
              return (
              <li key={c.ident} className={isBlocked(cf) ? "blocked" : ""}>
                <button type="button" className="cand-main" onClick={() => onFocus(c)} title={cf.map((f) => f.text).join("\n") || "Show on map"}>
                  <span className="line1">
                    <b className="code">{c.ident}</b> <span className="name">{c.name}</span>
                    {cat && <span className={`fltcat fltcat-${cat}`}>{cat}</span>}
                    {cf.map((f) => (
                      <span key={f.kind} className={`flag flag-${f.kind}`} title={f.text}>
                        {FLAG_ICON[f.kind]}
                      </span>
                    ))}
                  </span>
                  <span className="line2 muted">
                    {fmtNm(c.distance_nm)} · ~{fmtDuration(c.est_minutes)} · {Math.round(c.bearing_deg).toString().padStart(3, "0")}° ·{" "}
                    {airportTypeLabel(c.type)}
                  </span>
                  <span className="line3 muted">
                    {runwaySummary(c) || "no runway data"}
                    {airportWhere(c) && <> · {airportWhere(c)}</>}
                  </span>
                </button>
                <a
                  className="small sb-btn"
                  href={simbriefUrl(legFor(plan.origin, c, state.aircraft.find((a) => a.id === plan.aircraft_id)))}
                  target="_blank"
                  rel="noreferrer"
                  title="Start a SimBrief plan for this leg"
                >
                  SB
                </a>
                <button type="button" className="small use" onClick={() => onPick(c)} title="Use as the next hop's destination">
                  Use
                </button>
              </li>
              );
            })}
          </ol>
          {filtered.length > LIST_MAX && (
            <div className="muted small">
              {filtered.length - LIST_MAX} more not listed. All {plan.candidates.length} are on the map; filter above to narrow the list.
            </div>
          )}
          {filtered.length === 0 && <div className="muted small">Nothing matches that filter.</div>}
        </div>
      )}
    </div>
  );
}
