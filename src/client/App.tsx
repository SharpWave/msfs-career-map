import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import type { LatLng } from "./geo";
import { buildRenderData, focusPoints, planBounds, planLonShift } from "./paths";
import { METAR_REUSE_MS, metarStation, type MetarMap } from "./metar";
import { assessCandidate, type Flag } from "./constraints";
import { useTracker } from "./tracker";
import { fmtDuration } from "./format";
import { clearInsets, columnReducer, initialColumn, type DrawerKey } from "./layout";
import { readPref, writePref } from "./prefs";
import type { AppState, Briefing, HazardKind, Hop, OfpFix, PlanCandidate, PlanResult, SimAircraft } from "./types";
import { MapView, type Basemap, type Focus } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { FlightPanel, type PanelSource } from "./components/FlightPanel";
import { Menu } from "./components/Menu";
import { MapToolbar, HAZARD_TOGGLES } from "./components/MapToolbar";
import { LeftColumn, type DrawerRequest } from "./components/Drawer";
import { Fleet, type FleetForm } from "./components/Fleet";
import { HopForm, type HopPreset } from "./components/HopForm";

/** Mountain obscuration rides with IFR; ash and cyclones with convective. */
const HAZARD_GROUPS: Record<string, HazardKind[]> = {
  ICE: ["ICE"],
  TURB: ["TURB"],
  IFR: ["IFR", "MT_OBSC"],
  CONVECTIVE: ["CONVECTIVE", "VA", "TC"],
};

const readBasemap = () => readPref<Basemap>("basemap", "dark", (v) => (v === "light" || v === "satellite" ? v : "dark"));
const windowSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The page: the map across the whole window, with the top bar, the left column (the sidebar or a
 * drawer) and the flight panel floating over it.
 */
// @spec APP-UI-001, APP-UI-002, APP-UI-017, APP-UI-020, APP-UI-022
export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [column, dispatchColumn] = useReducer(columnReducer, initialColumn);
  const [drawerRequest, setDrawerRequest] = useState<DrawerRequest | null>(null);
  const [fleetForm, setFleetForm] = useState<FleetForm>(null);
  const [openMenu, setOpenMenu] = useState<"app" | "layers" | null>(null);
  const [win, setWin] = useState(windowSize);
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
  const menuButton = useRef<HTMLButtonElement>(null);

  // A minute tick drives the day/night overlay and the "dark at ETA" checks.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onResize = () => setWin(windowSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  // Live tracker stream. A leg the server logs refreshes the map, drops stale planner results and
  // shows a toast for a few seconds.
  const [toast, setToast] = useState<string | null>(null);
  // The flight panel across the bottom of the map: a logged hop or the leg being flown.
  const [panel, setPanel] = useState<PanelSource | null>(null);
  const [panelBriefing, setPanelBriefing] = useState<Briefing | null>(null);
  const [briefingVersion, setBriefingVersion] = useState(0);
  const live = useTracker(
    useCallback(
      (hop: Hop) => {
        void reload();
        setPlan(null);
        setHopPreset(null);
        setToast(`Logged ${hop.origin} → ${hop.dest}${hop.duration_min != null ? ` · ${fmtDuration(hop.duration_min)}` : ""}`);
        // A live panel follows the leg into the logbook.
        setPanel((p) => (p?.kind === "live" ? { kind: "hop", hopId: hop.id } : p));
      },
      [reload],
    ),
  );

  const panelHop = panel?.kind === "hop" && state ? state.hops.find((h) => h.id === panel.hopId) : undefined;
  const panelBriefingId = panel?.kind === "hop" ? (panelHop?.briefing_id ?? null) : panel?.kind === "live" ? (live.status?.briefing?.id ?? null) : null;

  // Load the full briefing (OFP text, fixes) for whatever the panel shows.
  useEffect(() => {
    let cancelled = false;
    if (panelBriefingId == null) {
      setPanelBriefing(null);
      return;
    }
    api
      .briefing(panelBriefingId)
      .then((b) => !cancelled && setPanelBriefing(b))
      .catch(() => !cancelled && setPanelBriefing(null));
    return () => {
      cancelled = true;
    };
  }, [panelBriefingId, briefingVersion]);

  // Close the panel if its hop was deleted.
  useEffect(() => {
    if (panel?.kind === "hop" && state && !state.hops.some((h) => h.id === panel.hopId)) setPanel(null);
  }, [panel, state]);

  // SimBrief routes to draw: the plan for the flight being flown, plus the opened hop's plan.
  const routes = useMemo(() => {
    const out: { fixes: OfpFix[]; color: string }[] = [];
    const colorOf = (id: number | null | undefined) => state?.aircraft.find((a) => a.id === id)?.color ?? "#ffffff";
    const lb = live.status?.briefing;
    if (lb && lb.fixes.length > 1) out.push({ fixes: lb.fixes, color: colorOf(live.status?.aircraft_id) });
    if (panelBriefing && panelBriefing.id !== lb?.id && panelBriefing.fixes.length > 1) {
      out.push({ fixes: panelBriefing.fixes, color: colorOf(panelHop?.aircraft_id) });
    }
    return out;
  }, [live.status?.briefing, live.status?.aircraft_id, panelBriefing, panelHop?.aircraft_id, state?.aircraft]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Which panels cover the map, as of this render; a zoom that opens one says so itself.
  const covered = { columnShown: !column.hidden, panelOpen: panel != null && state != null };
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const clear = clearInsets(win, covered);

  /** Ask the map to zoom, into the part the panels leave clear once this update has applied. */
  const requestFocus = (points: LatLng[], opts: { zoom?: number; panelOpen?: boolean } = {}) => {
    if (!points.length) return;
    const open = { ...coveredRef.current, ...(opts.panelOpen != null ? { panelOpen: opts.panelOpen } : {}) };
    setFocus({ key: ++seq.current, points, zoom: opts.zoom, clear: clearInsets(windowSize(), open) });
  };

  const focusLive = () => {
    const p = live.status?.position;
    if (p) requestFocus([[p.lat, p.lon]], { zoom: 10 });
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
    writePref("basemap", b);
  };

  const select = (id: number | null) => {
    setSelectedId(id);
    if (id != null) requestFocus(focusPoints(data, { aircraftId: id }));
  };

  /** Zoom to a hop and open its profile in the flight panel. */
  const openHop = (hop: Hop) => {
    setPanel({ kind: "hop", hopId: hop.id });
    setSelectedId(hop.aircraft_id);
    requestFocus(focusPoints(data, { hopId: hop.id }), { panelOpen: true });
  };

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

  /**
   * Show a drawer, from the menu or a hand-off. The focus returns to whatever opened it when it
   * closes, or to the menu button when that was a menu entry.
   */
  const openDrawer = (drawer: DrawerKey, target?: string) => {
    const active = document.activeElement as HTMLElement | null;
    const opener = active && active !== document.body && !active.closest("[role=menu]") ? active : menuButton.current;
    dispatchColumn({ type: "open", drawer });
    setDrawerRequest({ key: ++seq.current, target, opener });
  };

  // Auto-run the planner from the URL, e.g. ?plan=1&minutes=90 (handy for bookmarks and testing).
  const autoPlanned = useRef(false);
  useEffect(() => {
    if (!state || autoPlanned.current) return;
    autoPlanned.current = true;
    const q = new URLSearchParams(window.location.search);
    if (q.get("wx")) setHazardToggles(new Set(q.get("wx") === "1" ? HAZARD_TOGGLES.map((t) => t.key) : (q.get("wx")!.split(",") as HazardKind[])));
    if (q.get("night")) setNightOn(q.get("night") === "1");
    const view = q.get("view")?.split(",").map(Number);
    if (view && view.length === 3 && view.every(Number.isFinite)) requestFocus([[view[0], view[1]]], { zoom: view[2] });
    const aircraftId = Number(q.get("plan"));
    const minutes = Number(q.get("minutes") ?? 90);
    if (!aircraftId || !minutes) return;
    api
      .plan({ aircraft_id: aircraftId, max_minutes: minutes, types: ["large_airport", "medium_airport", "small_airport"], paved: q.get("paved") === "1" })
      .then(onPlan)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // @spec LOG-FORM-004
  const pickCandidate = (c: PlanCandidate) => {
    if (!plan) return;
    setHopPreset({ key: ++seq.current, aircraftId: plan.aircraft_id, dest: c.ident });
    focusCandidate(c);
    openDrawer("log", ".hop-form");
  };

  // @spec FLEET-SIM-003
  const newFromSim = (sim: SimAircraft) => {
    setFleetForm({ mode: "new", prefill: { name: sim.title, livery: sim.atc_id || sim.livery, sim_title: sim.title, sim_livery: sim.livery } });
    openDrawer("fleet", "#aircraft-form-new");
  };

  // @spec PLAN-FORM-003
  const editAircraft = (id: number) => {
    setFleetForm({ mode: "edit", id });
    openDrawer("fleet", `#aircraft-${id}`);
  };

  const vars = {
    "--clear-top": `${clear.top}px`,
    "--clear-left": `${clear.left}px`,
    "--clear-bottom": `${clear.bottom}px`,
  } as CSSProperties;

  return (
    <div className={`app${column.hidden ? " column-hidden" : ""}${panel && state ? " panel-open" : ""}`} data-basemap={basemap} style={vars}>
      <header className="top-bar">
        <Menu
          ref={menuButton}
          counts={state ? { aircraft: state.aircraft.length, hops: state.hops.length, airports: state.airportCount, runways: state.runwayCount } : null}
          open={openMenu === "app"}
          onOpenChange={(o) => setOpenMenu((m) => (o ? "app" : m === "app" ? null : m))}
          onChoose={(d) => openDrawer(d)}
          columnHidden={column.hidden}
          onToggleColumn={() => dispatchColumn({ type: "toggle" })}
        />
        <MapToolbar
          basemap={basemap}
          onBasemap={setBasemap}
          nightOn={nightOn}
          onToggleNight={toggleNight}
          hazards={hazardToggles}
          onToggleHazard={toggleHazard}
          hazardStatus={hazardStatus}
          layersOpen={openMenu === "layers"}
          onLayersOpenChange={(o) => setOpenMenu((m) => (o ? "layers" : m === "layers" ? null : m))}
          onFitAll={() => requestFocus(focusPoints(data))}
          highlighted={selectedId != null}
          onClearHighlight={() => select(null)}
          planShown={plan != null}
          onClearPlan={() => setPlan(null)}
        />
      </header>

      {state && (
        <LeftColumn
          column={column}
          request={drawerRequest}
          onClose={() => dispatchColumn({ type: "close" })}
          fallbackFocus={menuButton.current}
          sidebar={
            <Sidebar
              state={state}
              selectedId={selectedId}
              onSelect={select}
              reload={reload}
              plan={plan}
              metars={metars}
              flags={flags}
              hideFlagged={hideFlagged}
              onHideFlagged={setHideFlagged}
              onPlan={onPlan}
              onPickCandidate={pickCandidate}
              onFocusCandidate={focusCandidate}
              onEditAircraft={editAircraft}
              live={live}
              onFocusLive={focusLive}
              onOpenLive={() => setPanel({ kind: "live" })}
              onNewFromSim={newFromSim}
            />
          }
          drawers={{
            log: {
              title: "Log a hop",
              body: (
                <HopForm
                  aircraft={state.aircraft}
                  hops={state.hops}
                  defaultAircraftId={selectedId}
                  preset={hopPreset}
                  onSaved={async () => {
                    await reload();
                    setPlan(null);
                    setHopPreset(null);
                  }}
                />
              ),
            },
            fleet: {
              title: "Fleet",
              actions: (
                <button
                  type="button"
                  className="small"
                  aria-pressed={fleetForm?.mode === "new"}
                  onClick={() => setFleetForm((f) => (f?.mode === "new" ? null : { mode: "new" }))}
                >
                  + Aircraft
                </button>
              ),
              body: (
                <Fleet state={state} selectedId={selectedId} onSelect={select} onFocusHop={openHop} reload={reload} form={fleetForm} onFormChange={setFleetForm} />
              ),
            },
          }}
        />
      )}

      {panel && state && (
        <FlightPanel
          source={panel}
          state={state}
          live={live}
          briefing={panelBriefing}
          onClose={() => setPanel(null)}
          onBriefingChanged={() => {
            void reload();
            setBriefingVersion((v) => v + 1);
          }}
        />
      )}

      <main className="map-layer">
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
            live={live}
            onOpenHop={openHop}
            routes={routes}
            clear={clear}
          />
        ) : (
          <div className="loading">{error ? "" : "Loading…"}</div>
        )}
      </main>

      {state && state.hops.length === 0 && (
        <div className="map-empty glass">
          <h2>Nothing on the map yet</h2>
          <p>Add an aircraft under Fleet in the menu, then log its first hop. Each plane’s path grows from wherever it last parked.</p>
        </div>
      )}

      {toast && (
        <div className="toast glass" role="status">
          {toast}
        </div>
      )}

      {error && (
        <div className="banner glass" role="alert">
          Server error: {error}{" "}
          <button type="button" className="small" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
