import { useState } from "react";
import { api } from "../api";
import { fmtDuration, fmtTimeShort, hopDurationMin } from "../format";
import { iconInnerHtml } from "../icons";
import type { Flag } from "../constraints";
import type { MetarMap } from "../metar";
import type { LiveState } from "../tracker";
import type { Aircraft, AppState, Hop, PlanCandidate, PlanResult } from "../types";
import { AircraftForm, type AircraftPrefill } from "./AircraftForm";
import { HopForm, type HopPreset } from "./HopForm";
import { LivePanel } from "./LivePanel";
import { Planner } from "./Planner";

interface Props {
  state: AppState;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onFocusHop: (hop: Hop) => void;
  reload: () => Promise<void>;
  plan: PlanResult | null;
  metars: MetarMap;
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  onHideFlagged: (v: boolean) => void;
  onPlan: (p: PlanResult | null) => void;
  onPickCandidate: (c: PlanCandidate) => void;
  onFocusCandidate: (c: PlanCandidate) => void;
  hopPreset: HopPreset | null;
  onHopLogged: () => void;
  live: LiveState;
  onFocusLive: () => void;
}

export function Sidebar(p: Props) {
  const { state, selectedId, onSelect, onFocusHop, reload } = p;
  const [aircraftForm, setAircraftForm] = useState<"new" | number | null>(null);
  const [prefill, setPrefill] = useState<AircraftPrefill | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [plannerOpen, setPlannerOpen] = useState(true);

  const closeNewForm = () => {
    setAircraftForm(null);
    setPrefill(null);
  };

  const toggleExpanded = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const usedColors = state.aircraft.map((a) => a.color);

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <h1>
          <span className="logo" dangerouslySetInnerHTML={{ __html: iconInnerHtml({ icon: "builtin:single-piston", name: "" }) }} />
          Career Map
        </h1>
        <div className="muted small">
          {state.aircraft.length} aircraft · {state.hops.length} hops · {state.airportCount.toLocaleString()} airports ·{" "}
          {state.runwayCount.toLocaleString()} runways
        </div>
      </header>

      <section className="card">
        <LivePanel
          live={p.live}
          aircraft={state.aircraft}
          reload={reload}
          onFocusLive={p.onFocusLive}
          onSelect={(id) => onSelect(id)}
          onNewFromSim={(sim) => {
            setPrefill({ name: sim.title, livery: sim.atc_id || sim.livery, sim_title: sim.title, sim_livery: sim.livery });
            setAircraftForm("new");
            document.getElementById("fleet")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </section>

      <section className="card">
        <h2>Log a hop</h2>
        <HopForm
          aircraft={state.aircraft}
          hops={state.hops}
          defaultAircraftId={selectedId}
          preset={p.hopPreset}
          onSaved={async () => {
            await reload();
            p.onHopLogged();
          }}
        />
      </section>

      <section className="card">
        <div className="row">
          <h2>Plan next hop</h2>
          <button type="button" className="icon" onClick={() => setPlannerOpen((o) => !o)} title={plannerOpen ? "Collapse" : "Expand"}>
            {plannerOpen ? "▾" : "▸"}
          </button>
        </div>
        {plannerOpen && (
          <Planner
            state={state}
            plan={p.plan}
            metars={p.metars}
            flags={p.flags}
            hideFlagged={p.hideFlagged}
            onHideFlagged={p.onHideFlagged}
            selectedId={selectedId}
            onPlan={p.onPlan}
            onPick={p.onPickCandidate}
            onFocus={p.onFocusCandidate}
            onEditAircraft={(id) => {
              setAircraftForm(id);
              document.getElementById(`aircraft-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}
      </section>

      <section className="fleet" id="fleet">
        <div className="row">
          <h2>Fleet</h2>
          <button type="button" className="small" onClick={() => (aircraftForm === "new" ? closeNewForm() : setAircraftForm("new"))}>
            + Aircraft
          </button>
        </div>

        {aircraftForm === "new" && (
          <div className="card">
            <AircraftForm
              key={prefill ? `${prefill.sim_title}|${prefill.sim_livery}` : "blank"}
              prefill={prefill ?? undefined}
              usedColors={usedColors}
              onCancel={closeNewForm}
              onSaved={async () => {
                await reload();
                closeNewForm();
              }}
            />
          </div>
        )}

        {state.aircraft.length === 0 && aircraftForm !== "new" && (
          <p className="muted">No aircraft yet. Add the plane and livery you fly, then log its first hop.</p>
        )}

        {state.aircraft.map((a) => (
          <AircraftCard
            key={a.id}
            aircraft={a}
            hops={state.hops.filter((h) => h.aircraft_id === a.id)}
            allHops={state.hops}
            allAircraft={state.aircraft}
            selected={selectedId === a.id}
            expanded={expanded.has(a.id)}
            editing={aircraftForm === a.id}
            onEdit={() => setAircraftForm(aircraftForm === a.id ? null : a.id)}
            onEditDone={() => setAircraftForm(null)}
            onToggleExpanded={() => toggleExpanded(a.id)}
            onSelect={() => onSelect(selectedId === a.id ? null : a.id)}
            onFocusHop={onFocusHop}
            reload={reload}
            usedColors={usedColors}
          />
        ))}
      </section>
    </aside>
  );
}

interface CardProps {
  aircraft: Aircraft;
  hops: Hop[];
  allHops: Hop[];
  allAircraft: Aircraft[];
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  usedColors: string[];
  onEdit: () => void;
  onEditDone: () => void;
  onToggleExpanded: () => void;
  onSelect: () => void;
  onFocusHop: (hop: Hop) => void;
  reload: () => Promise<void>;
}

function AircraftCard(p: CardProps) {
  const { aircraft: a, hops } = p;
  const [editingHop, setEditingHop] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const location = hops.length ? hops[hops.length - 1].dest : null;
  const totalMin = hops.reduce((s, h) => s + (hopDurationMin(h) ?? 0), 0);

  const toggleVisible = async () => {
    await api.updateAircraft(a.id, { visible: !a.visible });
    await p.reload();
  };

  const move = async (hop: Hop, dir: -1 | 1) => {
    const ids = hops.map((h) => h.id);
    const i = ids.indexOf(hop.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    try {
      await api.reorderHops(a.id, ids);
      await p.reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (hop: Hop) => {
    if (!window.confirm(`Delete hop ${hop.origin} → ${hop.dest}?`)) return;
    setBusy(true);
    try {
      await api.deleteHop(hop.id);
      await p.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id={`aircraft-${a.id}`}
      className={`aircraft-card${p.selected ? " selected" : ""}${a.visible ? "" : " hidden"}`}
      style={{ "--c": a.color } as React.CSSProperties}
    >
      <div className="card-head">
        <button type="button" className="badge-btn" onClick={p.onSelect} title="Highlight on map">
          <span className="plane-head small" dangerouslySetInnerHTML={{ __html: iconInnerHtml(a) }} />
        </button>
        <button type="button" className="title-btn" onClick={p.onSelect} title="Highlight on map">
          <div className="name">{a.name}</div>
          <div className="meta">
            {a.livery && <span className="code">{a.livery}</span>}
            {location ? (
              <span>
                parked at <b className="code">{location}</b>
              </span>
            ) : (
              <span className="muted">no hops yet</span>
            )}
            {a.cruise_kts && <span>{a.cruise_kts} kts</span>}
            {a.ceiling_ft && <span>ceil {Math.round(a.ceiling_ft / 1000)}k</span>}
            {!a.ifr_capable && <span>VFR only</span>}
            {a.sim_title && (
              <span title={`Tracked from the sim as “${a.sim_title}”${a.sim_livery ? ` / ${a.sim_livery}` : ""}`}>🔗 sim</span>
            )}
          </div>
        </button>
        <div className="card-actions">
          <button type="button" className="icon" onClick={toggleVisible} title={a.visible ? "Hide from map" : "Show on map"}>
            {a.visible ? "👁" : "🚫"}
          </button>
          <button type="button" className="icon" onClick={p.onEdit} title="Edit aircraft">
            ✎
          </button>
          <button type="button" className="icon" onClick={p.onToggleExpanded} title={p.expanded ? "Collapse hops" : "Show hops"}>
            {p.expanded ? "▾" : "▸"} {hops.length}
          </button>
        </div>
      </div>

      {p.editing && (
        <div className="card-body">
          <AircraftForm
            initial={a}
            usedColors={p.usedColors.filter((c) => c !== a.color)}
            onCancel={p.onEditDone}
            onSaved={async () => {
              await p.reload();
              p.onEditDone();
            }}
            onDeleted={async () => {
              await p.reload();
              p.onEditDone();
            }}
          />
        </div>
      )}

      {p.expanded && (
        <div className="card-body">
          {hops.length === 0 && <p className="muted small">No hops logged for this aircraft.</p>}
          {hops.length > 0 && (
            <div className="muted small summary">
              {hops.length} hop{hops.length === 1 ? "" : "s"}
              {totalMin > 0 && <> · {fmtDuration(totalMin)} logged</>}
            </div>
          )}
          <ol className="hop-list">
            {hops.map((h) =>
              editingHop === h.id ? (
                <li key={h.id} className="editing">
                  <HopForm
                    aircraft={p.allAircraft}
                    hops={p.allHops}
                    initial={h}
                    onCancel={() => setEditingHop(null)}
                    onSaved={async () => {
                      await p.reload();
                      setEditingHop(null);
                    }}
                  />
                </li>
              ) : (
                <li key={h.id}>
                  <button type="button" className="hop-main" onClick={() => p.onFocusHop(h)} title="Zoom to this hop">
                    <span className="seq">{h.seq}</span>
                    <span className="route">
                      <b className="code">{h.origin}</b> → <b className="code">{h.dest}</b>
                    </span>
                    <span className="times">
                      {h.departed_at && <span>dep {fmtTimeShort(h.departed_at)}</span>}
                      {h.arrived_at && <span>arr {fmtTimeShort(h.arrived_at)}</span>}
                      {hopDurationMin(h) != null && <span>{fmtDuration(hopDurationMin(h))}</span>}
                      {!h.departed_at && !h.arrived_at && hopDurationMin(h) == null && <span className="muted">no times</span>}
                    </span>
                    {h.notes && <span className="notes">{h.notes}</span>}
                  </button>
                  <span className="hop-actions">
                    <button type="button" className="icon" disabled={busy || h.seq === 1} onClick={() => move(h, -1)} title="Move earlier">
                      ↑
                    </button>
                    <button type="button" className="icon" disabled={busy || h.seq === hops.length} onClick={() => move(h, 1)} title="Move later">
                      ↓
                    </button>
                    <button type="button" className="icon" disabled={busy} onClick={() => setEditingHop(h.id)} title="Edit hop">
                      ✎
                    </button>
                    <button type="button" className="icon danger" disabled={busy} onClick={() => remove(h)} title="Delete hop">
                      ✕
                    </button>
                  </span>
                </li>
              ),
            )}
          </ol>
        </div>
      )}
    </div>
  );
}
