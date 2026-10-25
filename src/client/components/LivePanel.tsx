import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { aircraftLabel, fmtDuration, fmtTimeShort } from "../format";
import { shownTouchdown } from "../landing";
import type { LiveState } from "../tracker";
import type { Aircraft, BriefingSummary, PendingLeg, Settings, SimAircraft, TrackerStatus } from "../types";
import { AirportInput } from "./AirportInput";
import { IconButton } from "./Icon";
import { LandingBadge } from "./LandingBadge";

interface Props {
  live: LiveState;
  aircraft: Aircraft[];
  reload: () => Promise<void>;
  onFocusLive: () => void;
  /** Open the live leg in the flight panel. */
  onOpenLive: () => void;
  /** Open a pending leg, by its id, in the flight panel. */
  onOpenPending: (id: string) => void;
  onSelect: (id: number) => void;
  /** Open the new-aircraft form prefilled from what the sim reports. */
  onNewFromSim: (sim: SimAircraft) => void;
  /** Open, or collapsed to the one-line status strip. */
  open: boolean;
  onToggle: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Preview = Omit<BriefingSummary, "id"> & { id: null };

/**
 * SimBrief alias setting, "import latest plan" with a confirmation step, and the attached plan.
 * In casual mode nothing can be imported, so only an attached plan shows.
 */
// @spec SB-CTRL-001, SB-CTRL-002, SB-CTRL-003, SB-CTRL-004
function SimbriefControls({ status, busy, run }: { status: TrackerStatus; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [userText, setUserText] = useState("");
  const [editingUser, setEditingUser] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const casual = status.casual != null;

  // A preview or alias edit left open when casual mode starts is dropped, not kept for later.
  useEffect(() => {
    if (!casual) return;
    setPreview(null);
    setEditingUser(false);
  }, [casual]);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setUserText(s.simbrief_username ?? "");
      })
      .catch(() => setSettings({ simbrief_username: null }));
  }, []);

  if (!settings) return null;
  const b = status.briefing;
  if (casual && !b) return null;
  const needUser = !casual && (!settings.simbrief_username || editingUser);

  const saveUser = () =>
    run(async () => {
      const s = await api.saveSettings({ simbrief_username: userText.trim() || null });
      setSettings(s);
      setEditingUser(false);
    });

  const loadPreview = () => run(async () => setPreview(await api.simbriefLatest()));
  const useIt = () =>
    run(async () => {
      await api.trackerBriefing();
      setPreview(null);
    });
  const drop = () => run(() => api.trackerDropBriefing());

  return (
    <div className="live-sb">
      {needUser && (
        <div className="row-line">
          <input
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder="SimBrief alias or pilot ID"
            spellCheck={false}
            onKeyDown={(e) => e.key === "Enter" && void saveUser()}
          />
          <button type="button" className="small" onClick={saveUser} disabled={busy || !userText.trim()}>
            Save
          </button>
          {editingUser && (
            <button type="button" className="small" onClick={() => setEditingUser(false)} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      )}

      {!casual && !needUser && !b && !preview && (
        <div className="row-line">
          <button type="button" className="small" onClick={loadPreview} disabled={busy} title="Fetch your most recent SimBrief OFP and attach it to this flight">
            Import SimBrief plan
          </button>
          <button type="button" className="linkish" onClick={() => setEditingUser(true)} title="Change the SimBrief user">
            {settings.simbrief_username}
          </button>
        </div>
      )}

      {!casual && preview && (
        <div className="pending">
          <div>
            <b>Latest SimBrief plan</b>
            {preview.callsign && <> · {preview.callsign}</>}
          </div>
          <div className="code">
            {preview.origin.icao ?? "?"}
            {preview.origin.rwy ? `/${preview.origin.rwy}` : ""} → {preview.dest.icao ?? "?"}
            {preview.dest.rwy ? `/${preview.dest.rwy}` : ""}
          </div>
          <div className="muted small">
            {[
              preview.aircraft.icao && `${preview.aircraft.icao}${preview.aircraft.reg ? ` ${preview.aircraft.reg}` : ""}`,
              preview.weights.pax != null && `${preview.weights.pax} pax`,
              preview.distance_nm != null && `${Math.round(preview.distance_nm)} nm`,
              preview.ete_min != null && fmtDuration(preview.ete_min),
              preview.generated_at && `generated ${fmtTimeShort(preview.generated_at)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={useIt} disabled={busy}>
              Use this plan
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {b && !needUser && (
        <div className="row-line">
          <span>
            Plan{" "}
            <b className="code">
              {b.origin.icao ?? "?"} → {b.dest.icao ?? "?"}
            </b>
            {b.callsign && <> · {b.callsign}</>}
            {b.weights.pax != null && <> · {b.weights.pax} pax</>}
          </span>
          <button type="button" className="small" onClick={drop} disabled={busy} title="Detach the plan from this flight">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

/** The Casual slider. A click only switches: it never reaches the strip, which would open the card. */
function CasualSwitch({ on, busy, onSwitch }: { on: boolean; busy: boolean; onSwitch: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`casual-switch${on ? " on" : ""}`}
      disabled={busy}
      title={on ? "Casual mode: the path is drawn and nothing is logged" : "Casual mode: draw the path flown without logging it"}
      onClick={(e) => {
        e.stopPropagation();
        onSwitch(!on);
      }}
    >
      <span className="slider" aria-hidden="true">
        <span className="knob" />
      </span>
      Casual
    </button>
  );
}

/**
 * Sidebar card for the live tracker: connection state, the sim aircraft and which fleet row it is
 * bound to, the leg in progress, and the finished legs waiting for details before they are logged,
 * one block each, oldest first. Collapsed, it is a one-line status strip; its body stays mounted,
 * so nothing typed is lost. The Casual switch sits in both, so casual mode is never on unseen.
 */
// @spec LIVE-CARD-001, LIVE-CARD-003, LIVE-CARD-005, LIVE-CARD-006, LIVE-CARD-008, LIVE-CARD-010, LIVE-CARD-011, LIVE-CARD-012, LIVE-CARD-013, LIVE-CARD-014
export function LivePanel({ live, aircraft, reload, onFocusLive, onOpenLive, onOpenPending, onSelect, onNewFromSim, open, onToggle }: Props) {
  const { status: s, online } = live;
  const [bindId, setBindId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bound = s?.aircraft_id != null ? aircraft.find((a) => a.id === s.aircraft_id) : undefined;
  const casual = s?.casual ?? null;
  const legTouchdown = shownTouchdown(s?.leg?.landings ?? []);

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

  /** Switch casual mode; when the server protects a fleet aircraft's leg, ask before dropping it. */
  const switchCasual = (on: boolean) =>
    run(async () => {
      try {
        await api.trackerCasual(on);
      } catch (e) {
        if (!(on && e instanceof ApiError && e.status === 409)) throw e;
        const leg = (e.body ?? {}) as { name?: string; origin?: string | null };
        const where = leg.origin ? `a leg from ${leg.origin}` : "a leg that started in the air";
        if (!window.confirm(`${leg.name ?? "A fleet aircraft"} is flying ${where}. Switch to casual mode? The leg will not be logged.`)) return;
        await api.trackerCasual(true, true);
      }
    });
  const casualSwitch = online && s ? <CasualSwitch on={casual != null} busy={busy} onSwitch={(on) => void switchCasual(on)} /> : null;

  let pill: { cls: string; text: string };
  if (!online) pill = { cls: "", text: "no connection to the app server" };
  else if (s?.sim_mode === "off") pill = { cls: "", text: "tracking off" };
  else if (s?.link_holder) pill = { cls: "warn", text: "linked to another copy" };
  else if (!s || !s.connected) pill = { cls: "", text: "sim not running" };
  else if (s.paused) pill = { cls: "warn", text: "paused" };
  else if (!s.sim_running) pill = { cls: "warn", text: "in menus" };
  else if (s.casual) pill = { cls: "casual", text: "casual" };
  else if (s.phase === "airborne") pill = { cls: "air", text: "airborne" };
  else if (s.phase === "landed") pill = { cls: "air", text: "landed" };
  else if (s.phase === "ground") pill = { cls: "on", text: "on the ground" };
  else pill = { cls: "on", text: "connected" };

  // Why no flight is being tracked: while casual mode is off, the first that applies. In casual
  // mode its note says what happens instead.
  let linkHint: ReactNode = null;
  if (s && !casual) {
    if (s.sim_mode === "off")
      linkHint = (
        <>
          This copy does not link to the sim. Start it with <code>npm run dev:sim</code> to track flights from MSFS.
        </>
      );
    else if (s.link_holder) linkHint = `${s.link_holder.text}. Flights are logged there; this copy links once it lets go.`;
    else if (!s.connected) linkHint = "Start MSFS and the tracker connects by itself. Takeoffs and landings are logged as hops with the flown track.";
  }

  const p = s?.position;
  // As in the open card, the position is shown only while the sim is connected.
  const readout =
    p && s?.connected ? `${(p.alt_ft ?? 0).toLocaleString()} ft · ${p.gs_kts ?? 0} kt · ${String(p.hdg_deg ?? 0).padStart(3, "0")}°` : null;

  return (
    <>
      {open ? (
        <div className="card-title live-head">
          <h2>Live from the sim</h2>
          <span className={`pill ${pill.cls}`}>{pill.text}</span>
          {casualSwitch}
          <IconButton icon="chevron-down" label="Collapse Live from the sim" aria-expanded onClick={onToggle} />
        </div>
      ) : (
        // The whole strip opens the card; its chevron is the keyboard's way in, and its click bubbles here.
        <div className="live-strip" onClick={onToggle}>
          <h2 className="sr-only">Live from the sim</h2>
          <span className={`pill ${pill.cls}`}>{pill.text}</span>
          {readout && <span className="readout code">{readout}</span>}
          {s && s.pending.length > 0 && <span className="caution">Leg waiting to be logged</span>}
          {casualSwitch}
          <IconButton icon="chevron-right" label="Expand Live from the sim" aria-expanded={false} />
        </div>
      )}

      <div className="card-body live-body" hidden={!open}>
        {casual && (
          <p className="muted small casual-note">
            Casual mode: the path you fly is drawn on the map and nothing is logged until you switch casual mode off, quit the app or close MSFS.
          </p>
        )}

        {s && ((s.connected && s.sim) || casual) && (
          <dl className="live-grid">
            {s.connected && s.sim && (
              <>
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
              </>
            )}

            {s.connected && s.sim && !casual && (
              <>
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
              </>
            )}

            {s.connected && s.sim && p && (
              <>
                <dt>Position</dt>
                <dd>
                  {(p.alt_ft ?? 0).toLocaleString()} ft · {p.gs_kts ?? 0} kt · {String(p.hdg_deg ?? 0).padStart(3, "0")}°{" "}
                  <button type="button" className="small" onClick={onFocusLive} title="Zoom the map to the aircraft">
                    Zoom
                  </button>
                </dd>
              </>
            )}

            {casual && (
              <>
                <dt>Path</dt>
                <dd>
                  {casual.points} points · since {fmtTimeShort(casual.since)}{" "}
                  <button type="button" className="small" disabled={busy} onClick={() => void run(() => api.trackerClearPath())} title="Start the drawn path afresh">
                    Clear
                  </button>
                </dd>
              </>
            )}

            {!casual && s.leg && (
              <>
                <dt>Leg</dt>
                <dd>
                  from <b className="code">{s.leg.origin ?? "?"}</b> · off {fmtTimeShort(s.leg.departed_at)} · {s.leg.points} points
                  {legTouchdown && (
                    <>
                      {" "}
                      <LandingBadge landing={legTouchdown} compact />
                    </>
                  )}{" "}
                  <button type="button" className="small" onClick={onOpenLive} title="Open the live profile in the flight panel">
                    Profile
                  </button>{" "}
                  {s.phase === "landed" && (
                    <>
                      <button
                        type="button"
                        className="small"
                        disabled={busy}
                        title="Log the leg where the aircraft is now, without waiting for it to sit still for 30 s"
                        onClick={() => void run(() => api.trackerCompleteLeg())}
                      >
                        Log now
                      </button>{" "}
                    </>
                  )}
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

        {s && s.connected && s.sim && <SimbriefControls status={s} busy={busy} run={run} />}

        {s && s.connected && !s.sim && <p className="muted small">Connected to {s.sim_name ?? "the sim"}; waiting for the aircraft to load.</p>}
        {linkHint && <p className="muted small">{linkHint}</p>}
        {s?.sim_host && (
          <p className="muted small">{`Linked to the sim on ${s.sim_host}: a copy of MSFS Career Map on that PC is not checked, so run only one.`}</p>
        )}
        {!s && online && <p className="muted small">Waiting for the tracker…</p>}

        {s?.message && (
          <div className="live-msg">
            {s.message}
            {s.message_at && <> · {fmtTimeShort(s.message_at)}</>}
          </div>
        )}
        {error && <div className="error">{error}</div>}

        {/* Keyed by the leg's id, so each block keeps what was typed into it as the list changes. */}
        {s?.pending.map((p) => <PendingForm key={p.id} p={p} aircraft={aircraft} reload={reload} onOpen={() => onOpenPending(p.id)} />)}
      </div>
    </>
  );
}

const DASH = "—";
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A time the leg carries, short, or — when it is not a string that reads as a date. */
const shortTime = (v: unknown): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? fmtTimeShort(v) : DASH);

/**
 * A finished leg the tracker could not log by itself: look at its profile, fill in what it lacked
 * and save, or drop it. Every action names the leg by its id. A field the leg lacks, or carries with
 * the wrong type, reads "—" (or leaves its input empty), so one odd leg never breaks the others.
 */
// @spec LIVE-BIND-003, LIVE-CARD-008
function PendingForm({ p, aircraft, reload, onOpen }: { p: PendingLeg; aircraft: Aircraft[]; reload: () => Promise<void>; onOpen: () => void }) {
  const sim = p.sim != null && typeof p.sim === "object" ? p.sim : null;
  const title = str(sim?.title) ?? DASH;
  const livery = str(sim?.livery);
  const legAircraftId = num(p.aircraft_id);
  const duration = num(p.duration_min);
  const points = num(p.points);

  const [aircraftId, setAircraftId] = useState(legAircraftId != null ? String(legAircraftId) : "");
  // Binding can set the leg's aircraft after the block is shown (LIVE-BIND-003): fill it in,
  // unless the pilot has already chosen one.
  useEffect(() => {
    if (legAircraftId != null) setAircraftId((cur) => cur || String(legAircraftId));
  }, [legAircraftId]);
  const [origin, setOrigin] = useState(str(p.origin) ?? "");
  const [dest, setDest] = useState(str(p.dest) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.trackerSavePending(p.id, { aircraft_id: aircraftId ? Number(aircraftId) : null, origin: origin || null, dest: dest || null });
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
      await api.trackerDiscardPending(p.id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pending">
      <div>
        <b>Leg waiting to be logged</b> · {title}
        {livery && <> · {livery}</>}
      </div>
      <div className="why">{str(p.reason) ?? DASH}</div>
      <div className="muted small">
        off {shortTime(p.departed_at)} · {p.ended_in_air === true ? "last seen" : "down"} {shortTime(p.arrived_at)} ·{" "}
        {duration != null ? fmtDuration(duration) : DASH} · {points ?? DASH} track points{" "}
        <button type="button" className="small" onClick={onOpen} title="Open this leg's profile in the flight panel">
          Profile
        </button>
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
