import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { aircraftLabel, airportTypeLabel, airportWhere, fmtDuration, fmtFt, fmtNm, runwaySummary } from "../format";
import type { AppState, PlanCandidate, PlanResult } from "../types";
import { AirportInput } from "./AirportInput";

interface Props {
  state: AppState;
  plan: PlanResult | null;
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

export function Planner({ state, plan, selectedId, onPlan, onPick, onFocus, onEditAircraft }: Props) {
  const eligible = state.aircraft.filter((a) => a.cruise_kts);
  const [aircraftId, setAircraftId] = useState<number>(() =>
    selectedId && state.aircraft.some((a) => a.id === selectedId) ? selectedId : eligible[0]?.id ?? state.aircraft[0]?.id ?? 0,
  );
  const [minutes, setMinutes] = useState("90");
  const [types, setTypes] = useState<Set<string>>(() => new Set(["large_airport", "medium_airport", "small_airport"]));
  const [paved, setPaved] = useState(false);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Follow the aircraft highlighted in the fleet / on the map.
  useEffect(() => {
    if (selectedId && state.aircraft.some((a) => a.id === selectedId)) setAircraftId(selectedId);
  }, [selectedId, state.aircraft]);

  // Keep the form in step with a plan that was started elsewhere (URL auto-run).
  useEffect(() => {
    if (!plan) return;
    setMinutes(String(plan.max_minutes));
    setPaved(plan.paved_only);
    setTypes(new Set(plan.types));
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
    setBusy(true);
    try {
      const r = await api.plan({
        aircraft_id: aircraft.id,
        max_minutes: m,
        types: [...types],
        paved,
        from: from.trim() || undefined,
      });
      onPlan(r);
      setFilter("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    if (!plan) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return plan.candidates;
    return plan.candidates.filter(
      (c) =>
        c.ident.toLowerCase().includes(f) ||
        c.name.toLowerCase().includes(f) ||
        (c.municipality ?? "").toLowerCase().includes(f) ||
        (c.iata_code ?? "").toLowerCase() === f,
    );
  }, [plan, filter]);

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
            {plan.truncated && <div className="muted small">Showing the nearest {plan.candidates.length.toLocaleString()}. Tighten the filters to see the rest.</div>}
          </div>

          <div className="legend">
            <span><i className="surf surf-paved" /> paved</span>
            <span><i className="surf surf-grass" /> grass</span>
            <span><i className="surf surf-gravel" /> gravel/dirt</span>
            <span><i className="surf surf-water" /> water</span>
            <span className="muted">· bigger dot = bigger airport</span>
          </div>

          {plan.candidates.length > 8 && (
            <input type="search" placeholder="Filter by code, name or city" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}

          <ol className="cand-list">
            {filtered.slice(0, LIST_MAX).map((c) => (
              <li key={c.ident}>
                <button type="button" className="cand-main" onClick={() => onFocus(c)} title="Show on map">
                  <span className="line1">
                    <b className="code">{c.ident}</b> <span className="name">{c.name}</span>
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
                <button type="button" className="small use" onClick={() => onPick(c)} title="Use as the next hop's destination">
                  Use
                </button>
              </li>
            ))}
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
