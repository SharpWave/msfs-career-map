import { useState, type CSSProperties } from "react";
import { api } from "../api";
import { fmtDuration, fmtTimeShort, hopDurationMin } from "../format";
import { iconInnerHtml } from "../icons";
import { finalLanding } from "../landing";
import type { Aircraft, AppState, Hop } from "../types";
import { AircraftForm, type AircraftPrefill } from "./AircraftForm";
import { HopForm } from "./HopForm";
import { Icon, IconButton } from "./Icon";
import { LandingBadge } from "./LandingBadge";

/** Which aircraft form is open in the Fleet drawer: a new one (maybe prefilled from the sim) or one aircraft's. */
export type FleetForm = { mode: "new"; prefill?: AircraftPrefill } | { mode: "edit"; id: number } | null;

interface Props {
  state: AppState;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onFocusHop: (hop: Hop) => void;
  reload: () => Promise<void>;
  form: FleetForm;
  onFormChange: (form: FleetForm) => void;
}

/** The Fleet drawer's body: the new-aircraft form when open, then a card per aircraft. */
// @spec FLEET-FORM-005, FLEET-SIM-003
export function Fleet({ state, selectedId, onSelect, onFocusHop, reload, form, onFormChange }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const usedColors = state.aircraft.map((a) => a.color);
  const prefill = form?.mode === "new" ? form.prefill : undefined;

  const toggleExpanded = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="fleet">
      {form?.mode === "new" && (
        <div className="card-form" id="aircraft-form-new">
          <AircraftForm
            key={prefill ? `${prefill.sim_title}|${prefill.sim_livery}` : "blank"}
            prefill={prefill}
            usedColors={usedColors}
            onCancel={() => onFormChange(null)}
            onSaved={async () => {
              await reload();
              onFormChange(null);
            }}
          />
        </div>
      )}

      {state.aircraft.length === 0 && form?.mode !== "new" && (
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
          editing={form?.mode === "edit" && form.id === a.id}
          onEdit={() => onFormChange(form?.mode === "edit" && form.id === a.id ? null : { mode: "edit", id: a.id })}
          onEditDone={() => onFormChange(null)}
          onToggleExpanded={() => toggleExpanded(a.id)}
          onSelect={() => onSelect(selectedId === a.id ? null : a.id)}
          onFocusHop={onFocusHop}
          reload={reload}
          usedColors={usedColors}
        />
      ))}
    </div>
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

// @spec FLEET-CARD-001, FLEET-CARD-002, FLEET-LOOK-010, LOG-LIST-001, LOG-LIST-004, LOG-LIST-005
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

  const hopsLabel = `${p.expanded ? "Hide" : "Show"} ${hops.length} hop${hops.length === 1 ? "" : "s"}`;

  return (
    <div
      id={`aircraft-${a.id}`}
      className={`aircraft-card${p.selected ? " selected" : ""}${a.visible ? "" : " hidden"}`}
      style={{ "--c": a.color } as CSSProperties}
    >
      <div className="card-head">
        <button type="button" className="badge-btn" onClick={p.onSelect} title={`Highlight ${a.name} on map`} aria-label={`Highlight ${a.name} on map`}>
          <span className="plane-head small" dangerouslySetInnerHTML={{ __html: iconInnerHtml(a) }} />
        </button>
        <button type="button" className="title-btn" onClick={p.onSelect} title="Highlight on map">
          <span className="name">{a.name}</span>
          <span className="meta">
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
              <span className="sim-link" title={`Tracked from the sim as “${a.sim_title}”${a.sim_livery ? ` / ${a.sim_livery}` : ""}`}>
                <Icon name="link" /> sim
              </span>
            )}
          </span>
        </button>
        <div className="card-actions">
          <IconButton icon={a.visible ? "eye" : "eye-off"} label={a.visible ? "Hide from map" : "Show on map"} onClick={toggleVisible} />
          <IconButton icon="pencil" label="Edit aircraft" aria-pressed={p.editing} onClick={p.onEdit} />
          <button type="button" className="icon count" onClick={p.onToggleExpanded} aria-label={hopsLabel} title={hopsLabel} aria-expanded={p.expanded}>
            <Icon name={p.expanded ? "chevron-down" : "chevron-right"} />
            <span aria-hidden="true">{hops.length}</span>
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
                  <button type="button" className="hop-main" onClick={() => p.onFocusHop(h)} title="Zoom to this hop and open its profile">
                    <span className="seq">{h.seq}</span>
                    <span className="route">
                      <b className="code">{h.origin}</b> → <b className="code">{h.dest}</b>
                      {(() => {
                        const l = finalLanding(h);
                        return l ? (
                          <>
                            {" "}
                            <LandingBadge landing={l} compact />
                          </>
                        ) : null;
                      })()}
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
                    <IconButton icon="arrow-up" label="Move earlier" disabled={busy || h.seq === 1} onClick={() => move(h, -1)} />
                    <IconButton icon="arrow-down" label="Move later" disabled={busy || h.seq === hops.length} onClick={() => move(h, 1)} />
                    <IconButton icon="pencil" label="Edit hop" disabled={busy} onClick={() => setEditingHop(h.id)} />
                    <IconButton icon="trash" label="Delete hop" className="danger" disabled={busy} onClick={() => remove(h)} />
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
