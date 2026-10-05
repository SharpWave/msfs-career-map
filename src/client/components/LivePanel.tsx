import { useState } from "react";
import { api } from "../api";
import { aircraftLabel, fmtDuration, fmtTimeShort } from "../format";
import type { LiveState } from "../tracker";
import type { Aircraft, PendingLeg, SimAircraft } from "../types";
import { AirportInput } from "./AirportInput";

interface Props {
  live: LiveState;
  aircraft: Aircraft[];
  reload: () => Promise<void>;
  onFocusLive: () => void;
  onSelect: (id: number) => void;
  /** Open the new-aircraft form prefilled from what the sim reports. */
  onNewFromSim: (sim: SimAircraft) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Sidebar card for the live tracker: connection state, the sim aircraft and which fleet row it is
 * bound to, the leg in progress, and any finished leg waiting for details before it is logged.
 */
export function LivePanel({ live, aircraft, reload, onFocusLive, onSelect, onNewFromSim }: Props) {
  const { status: s, online } = live;
  const [open, setOpen] = useState(true);
  const [bindId, setBindId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bound = s?.aircraft_id != null ? aircraft.find((a) => a.id === s.aircraft_id) : undefined;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  let pill: { cls: string; text: string };
  if (!online) pill = { cls: "", text: "no connection to the app server" };
  else if (!s || !s.connected) pill = { cls: "", text: "sim not running" };
  else if (s.paused) pill = { cls: "warn", text: "paused" };
  else if (!s.sim_running) pill = { cls: "warn", text: "in menus" };
  else if (s.phase === "airborne") pill = { cls: "air", text: "airborne" };
  else if (s.phase === "landed") pill = { cls: "air", text: "landed" };
  else if (s.phase === "ground") pill = { cls: "on", text: "on the ground" };
  else pill = { cls: "on", text: "connected" };

  const p = s?.position;

  return (
    <>
      <div className="live-head">
        <h2>Live from the sim</h2>
        <span className={`pill ${pill.cls}`}>{pill.text}</span>
        <button type="button" className="icon" onClick={() => setOpen((o) => !o)} title={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <>
          {s && s.connected && s.sim && (
            <dl className="live-grid">
              <dt>Sim aircraft</dt>
              <dd>
                {s.sim.title || <span className="muted">(no title yet)</span>}
                {s.sim.livery && (
                  <>
                    {" "}
                    · <span className="code">{s.sim.livery}</span>
                  </>
                )}
                {s.sim.atc_id && (
                  <>
                    {" "}
                    · <span className="code">{s.sim.atc_id}</span>
                  </>
                )}
              </dd>

              <dt>Fleet</dt>
              <dd>
                {bound ? (
                  <button type="button" className="small" onClick={() => onSelect(bound.id)} title="Highlight on the map">
                    {aircraftLabel(bound)}
                  </button>
                ) : (
                  <div className="live-bind">
                    <select value={bindId} onChange={(e) => setBindId(e.target.value)} disabled={busy}>
                      <option value="">Bind to…</option>
                      {aircraft.map((a) => (
                        <option key={a.id} value={a.id}>
                          {aircraftLabel(a)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="small"
                      disabled={!bindId || busy}
                      onClick={() => run(() => api.trackerBind(Number(bindId)).then(reload))}
                      title="Remember this sim aircraft + livery as that fleet aircraft"
                    >
                      Bind
                    </button>
                    <button type="button" className="small" onClick={() => onNewFromSim(s.sim!)} title="Add a fleet aircraft from what the sim reports">
                      + New
                    </button>
                  </div>
                )}
              </dd>

              {p && (
                <>
                  <dt>Position</dt>
                  <dd>
                    {p.alt_ft.toLocaleString()} ft · {p.gs_kts} kt · {p.hdg_deg.toString().padStart(3, "0")}°{" "}
                    <button type="button" className="small" onClick={onFocusLive} title="Zoom the map to the aircraft">
                      Zoom
                    </button>
                  </dd>
                </>
              )}

              {s.leg && (
                <>
                  <dt>Leg</dt>
                  <dd>
                    from <b className="code">{s.leg.origin ?? "?"}</b> · off {fmtTimeShort(s.leg.departed_at)} · {s.leg.points} points{" "}
                    <button
                      type="button"
                      className="small"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Discard the leg being flown? It will not be logged.")) void run(() => api.trackerDiscardLeg());
                      }}
                    >
                      Discard
                    </button>
                  </dd>
                </>
              )}
            </dl>
          )}

          {s && s.connected && !s.sim && <p className="muted small">Connected to {s.sim_name ?? "the sim"}; waiting for the aircraft to load.</p>}
          {s && !s.connected && (
            <p className="muted small">
              Start MSFS and the tracker connects by itself. Takeoffs and landings are logged as hops with the flown track.
            </p>
          )}
          {!s && online && <p className="muted small">Waiting for the tracker…</p>}

          {s?.message && (
            <div className="live-msg">
              {s.message}
              {s.message_at && <> · {fmtTimeShort(s.message_at)}</>}
            </div>
          )}
          {error && <div className="error">{error}</div>}

          {s?.pending && <PendingForm key={s.pending.departed_at} p={s.pending} aircraft={aircraft} reload={reload} />}
        </>
      )}
    </>
  );
}

/** A finished leg the tracker could not log by itself: fill in what it lacked and save, or drop it. */
function PendingForm({ p, aircraft, reload }: { p: PendingLeg; aircraft: Aircraft[]; reload: () => Promise<void> }) {
  const [aircraftId, setAircraftId] = useState(p.aircraft_id ? String(p.aircraft_id) : "");
  const [origin, setOrigin] = useState(p.origin ?? "");
  const [dest, setDest] = useState(p.dest ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.trackerSavePending({ aircraft_id: aircraftId ? Number(aircraftId) : null, origin: origin || null, dest: dest || null });
      await reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!window.confirm("Discard this leg? Its recorded track will be lost.")) return;
    setBusy(true);
    try {
      await api.trackerDiscardPending();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pending">
      <div>
        <b>Leg waiting to be logged</b> · {p.sim.title}
        {p.sim.livery && <> · {p.sim.livery}</>}
      </div>
      <div className="why">{p.reason}</div>
      <div className="muted small">
        off {fmtTimeShort(p.departed_at)} · down {fmtTimeShort(p.arrived_at)} · {fmtDuration(p.duration_min)} · {p.points} track points
      </div>
      <label>
        <span>Aircraft</span>
        <select value={aircraftId} onChange={(e) => setAircraftId(e.target.value)} disabled={busy}>
          <option value="">Choose…</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {aircraftLabel(a)}
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          <span>From</span>
          <AirportInput value={origin} onChange={setOrigin} placeholder="KBOS" />
        </label>
        <label>
          <span>To</span>
          <AirportInput value={dest} onChange={setDest} placeholder="KPVD" />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          Log hop
        </button>
        <button type="button" onClick={discard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}
