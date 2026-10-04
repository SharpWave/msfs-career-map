import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { LatLng } from "./geo";
import { buildRenderData, focusPoints, planBounds, planLonShift } from "./paths";
import type { AppState, Hop, PlanCandidate, PlanResult } from "./types";
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

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [basemap, setBasemapState] = useState<Basemap>(readBasemap);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [hopPreset, setHopPreset] = useState<HopPreset | null>(null);
  const seq = useRef(0);
  const didInitialFit = useRef(false);

  const data = useMemo(() => buildRenderData(state), [state]);

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
