import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { LatLng } from "./geo";
import { buildRenderData, focusPoints, planBounds, planLonShift } from "./paths";
import { METAR_REUSE_MS, metarStation, type MetarMap } from "./metar";
import { assessCandidate, type Flag } from "./constraints";
import { HAZARD_STYLE } from "./components/HazardLayer";
import type { AppState, HazardKind, Hop, PlanCandidate, PlanResult } from "./types";
import { MapView, type Basemap, type Focus } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import type { HopPreset } from "./components/HopForm";

const BASEMAPS: { key: Basemap; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "satellite", label: "Satellite" },
];

function readBasemap(): Basemap {
  try {
    const v = localStorage.getItem("basemap");
    if (v === "dark" || v === "light" || v === "satellite") return v;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

const HAZARD_TOGGLES: HazardKind[] = ["ICE", "TURB", "IFR", "CONVECTIVE"];
/** Mountain obscuration rides with IFR; ash and cyclones with convective. */
const HAZARD_GROUPS: Record<string, HazardKind[]> = {
  ICE: ["ICE"],
  TURB: ["TURB"],
  IFR: ["IFR", "MT_OBSC"],
  CONVECTIVE: ["CONVECTIVE", "VA", "TC"],
};

function readPref<T>(key: string, fallback: T, parse: (s: string) => T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : parse(v);
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [basemap, setBasemapState] = useState<Basemap>(readBasemap);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [hopPreset, setHopPreset] = useState<HopPreset | null>(null);
  const [metars, setMetars] = useState<MetarMap>(() => new Map());
  const [now, setNow] = useState(() => new Date());
  const [nightOn, setNightOn] = useState(() => readPref("nightOn", true, (s) => s === "1"));
  const [hazardToggles, setHazardToggles] = useState<Set<HazardKind>>(() =>
    readPref("hazards", new Set<HazardKind>(), (s) => new Set(s.split(",").filter(Boolean) as HazardKind[])),
  );
  const [hazardStatus, setHazardStatus] = useState<{ count: number; fetched_at: string | null; error: string | null } | null>(null);
  const [hideFlagged, setHideFlagged] = useState(true);
  const seq = useRef(0);
  const didInitialFit = useRef(false);

  // A minute tick drives the day/night overlay and the "dark at ETA" checks.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const hazardKinds = useMemo(() => new Set<HazardKind>([...hazardToggles].flatMap((k) => HAZARD_GROUPS[k] ?? [k])), [hazardToggles]);

  const toggleHazard = (k: HazardKind) =>
    setHazardToggles((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      writePref("hazards", [...next].join(","));
      return next;
    });

  const toggleNight = () =>
    setNightOn((v) => {
      writePref("nightOn", v ? "0" : "1");
      return !v;
    });

  // After each search, fetch METARs for the large and medium candidates in batches, merging each
  // batch into the cache as it lands so the map colors in progressively. Entries younger than
  // METAR_REUSE_MS are reused rather than re-requested.
  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    const now = Date.now();
    const wanted = new Set<string>();
    for (const c of plan.candidates) {
      if (c.type !== "large_airport" && c.type !== "medium_airport") continue;
      const st = metarStation(c);
      if (!st) continue;
      const hit = metars.get(st);
      if (!hit || now - hit.at > METAR_REUSE_MS) wanted.add(st);
    }
    const ids = [...wanted];
    (async () => {
      for (let i = 0; i < ids.length && !cancelled; i += 150) {
        const chunk = ids.slice(i, i + 150);
        try {
          const r = await api.metars(chunk);
          if (cancelled) return;
          setMetars((prev) => {
            const next = new Map(prev);
            const at = Date.now();
            for (const id of chunk) next.set(id, { metar: r.metars[id] ?? null, at });
            return next;
          });
        } catch {
          /* leave those stations unknown; the next search retries them */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const data = useMemo(() => buildRenderData(state), [state]);

  // Live-weather and clock checks for every planner candidate.
  const flags = useMemo(() => {
    const out = new Map<string, Flag[]>();
    if (!plan || !state) return out;
    const aircraft = state.aircraft.find((a) => a.id === plan.aircraft_id);
    for (const c of plan.candidates) {
      const f = assessCandidate(c, aircraft, metars, now);
      if (f.length) out.set(c.ident, f);
    }
    return out;
  }, [plan, state, metars, now]);

  const reload = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestFocus = (points: LatLng[]) => {
    if (points.length) setFocus({ key: ++seq.current, points });
  };

  useEffect(() => {
    if (state && !didInitialFit.current) {
      didInitialFit.current = true;
      requestFocus(focusPoints(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Drop the selection if that aircraft was deleted.
  useEffect(() => {
    if (state && selectedId != null && !state.aircraft.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [state, selectedId]);

  const setBasemap = (b: Basemap) => {
    setBasemapState(b);
    try {
      localStorage.setItem("basemap", b);
    } catch {
      /* ignore */
    }
  };

  const select = (id: number | null) => {
    setSelectedId(id);
    if (id != null) requestFocus(focusPoints(data, { aircraftId: id }));
  };

  const focusHop = (hop: Hop) => requestFocus(focusPoints(data, { hopId: hop.id }));

  const onPlan = (p: PlanResult | null) => {
    setPlan(p);
    if (p) {
      setSelectedId(p.aircraft_id);
      requestFocus(planBounds(data, p));
    }
  };

  const focusCandidate = (c: PlanCandidate) => {
    if (!plan) return;
    requestFocus([[c.lat, c.lon + planLonShift(data, plan)]]);
  };

  // Auto-run the planner from the URL, e.g. ?plan=1&minutes=90 (handy for bookmarks and testing).
  const autoPlanned = useRef(false);
  useEffect(() => {
    if (!state || autoPlanned.current) return;
    autoPlanned.current = true;
    const q = new URLSearchParams(window.location.search);
    if (q.get("wx")) setHazardToggles(new Set(q.get("wx") === "1" ? HAZARD_TOGGLES : (q.get("wx")!.split(",") as HazardKind[])));
    if (q.get("night")) setNightOn(q.get("night") === "1");
    const view = q.get("view")?.split(",").map(Number);
    if (view && view.length === 3 && view.every(Number.isFinite)) {
      setFocus({ key: ++seq.current, points: [[view[0], view[1]]], zoom: view[2] });
    }
    const aircraftId = Number(q.get("plan"));
    const minutes = Number(q.get("minutes") ?? 90);
    if (!aircraftId || !minutes) return;
    api
      .plan({ aircraft_id: aircraftId, max_minutes: minutes, types: ["large_airport", "medium_airport", "small_airport"], paved: q.get("paved") === "1" })
      .then(onPlan)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pickCandidate = (c: PlanCandidate) => {
    if (!plan) return;
    setHopPreset({ key: ++seq.current, aircraftId: plan.aircraft_id, dest: c.ident });
    focusCandidate(c);
  };

  return (
    <div className={`app${sidebarOpen ? "" : " collapsed"}`}>
      {state && sidebarOpen && (
        <Sidebar
          state={state}
          selectedId={selectedId}
          onSelect={select}
          onFocusHop={focusHop}
          reload={reload}
          plan={plan}
          metars={metars}
          flags={flags}
          hideFlagged={hideFlagged}
          onHideFlagged={setHideFlagged}
          onPlan={onPlan}
          onPickCandidate={pickCandidate}
          onFocusCandidate={focusCandidate}
          hopPreset={hopPreset}
          onHopLogged={() => {
            setPlan(null);
            setHopPreset(null);
          }}
        />
      )}
      <div className="map-wrap">
        {state ? (
          <MapView
            data={data}
            aircraft={state.aircraft}
            selectedId={selectedId}
            onSelect={select}
            focus={focus}
            basemap={basemap}
            plan={plan}
            metars={metars}
            flags={flags}
            hideFlagged={hideFlagged}
            now={now}
            nightOn={nightOn}
            hazardKinds={hazardKinds}
            onHazardStatus={setHazardStatus}
            onPickCandidate={pickCandidate}
          />
        ) : (
          <div className="loading">{error ? "" : "Loading…"}</div>
        )}

        <div className="map-toolbar">
          <button type="button" onClick={() => setSidebarOpen((o) => !o)} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
            {sidebarOpen ? "◀" : "▶"}
          </button>
          <div className="seg">
            {BASEMAPS.map((b) => (
              <button type="button" key={b.key} className={basemap === b.key ? "on" : ""} onClick={() => setBasemap(b.key)}>
                {b.label}
              </button>
            ))}
          </div>
          <button type="button" className={nightOn ? "on" : ""} onClick={toggleNight} title="Day/night shading (civil twilight)">
            Night
          </button>
          <div className="seg" title="Weather hazard areas from aviationweather.gov (G-AIRMET / SIGMET)">
            {HAZARD_TOGGLES.map((k) => (
              <button
                type="button"
                key={k}
                className={hazardToggles.has(k) ? "on hz" : "hz"}
                style={hazardToggles.has(k) ? ({ "--hz": HAZARD_STYLE[k].color } as React.CSSProperties) : undefined}
                onClick={() => toggleHazard(k)}
                title={`${HAZARD_STYLE[k].label}${k === "IFR" ? " + mountain obscuration" : k === "CONVECTIVE" ? " + volcanic ash, cyclones" : ""}`}
              >
                {k === "ICE" ? "Ice" : k === "TURB" ? "Turb" : k === "IFR" ? "IFR" : "Storms"}
              </button>
            ))}
          </div>
          {hazardKinds.size > 0 && hazardStatus && (
            <span className="toolbar-note" title={hazardStatus.fetched_at ? `fetched ${new Date(hazardStatus.fetched_at).toLocaleTimeString()}` : ""}>
              {hazardStatus.error ? "hazards unavailable" : `${hazardStatus.count} areas`}
            </span>
          )}
          <button type="button" onClick={() => requestFocus(focusPoints(data))} title="Zoom to every path">
            Fit all
          </button>
          {selectedId != null && (
            <button type="button" onClick={() => select(null)} title="Show all aircraft at full strength">
              Clear highlight
            </button>
          )}
          {plan && (
            <button type="button" onClick={() => setPlan(null)} title="Remove the planner results from the map">
              Clear plan
            </button>
          )}
        </div>

        {state && state.hops.length === 0 && (
          <div className="map-empty">
            <h2>Nothing on the map yet</h2>
            <p>Add an aircraft in the sidebar, then log its first hop. Each plane’s path grows from wherever it last parked.</p>
          </div>
        )}

        {error && (
          <div className="banner">
            Server error: {error}{" "}
            <button type="button" className="small" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
