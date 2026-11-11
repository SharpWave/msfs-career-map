import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api";
import { aircraftLabel, fmtDate, fmtDateTime, fmtDuration, fmtLb, fmtNm } from "../format";
import { iconInnerHtml } from "../icons";
import { RATING_META } from "../landing";
import { outsideLink } from "../ofp-html";
import { digestEntry, plannedFigures, tourRows, tourSummary, type HopFigures, type TourSummary } from "../tour";
import type { Aircraft, AppState, Hop, PlanDigestEntry } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";
import { IconButton } from "./Icon";
import { LandingBadge } from "./LandingBadge";

export interface AircraftPanelProps {
  /** The highlighted aircraft, which the panel shows. */
  aircraft: Aircraft;
  state: AppState;
  /** The hop the flight panel shows, if any: its row is the current one. */
  currentHopId: number | null;
  /** A hop opened from outside the hop list: its row is brought into view, once per key. */
  reveal: { key: number; hopId: number } | null;
  /** Whether the hop list scrolls by itself, or everything under the header as one (layout.ts). */
  listAlone: boolean;
  reload: () => Promise<void>;
  onClose: () => void;
  onOpenHop: (hop: Hop, from: "row" | "longest") => void;
  /** The hop to mark on the map while its row is pointed at, or none. */
  onMarkHop: (hopId: number | null) => void;
  onPlanNext: () => void;
  onLogHop: () => void;
  onZoomTour: () => void;
  onEditAircraft: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One aircraft beside the map: who it is, hiding it or the others, what its tour adds up to, and
 * its hops, latest first. The frame and its close button stay when what it holds fails to render.
 */
// @spec ACP-OPEN-009, ACP-LAY-002
export function AircraftPanel(p: AircraftPanelProps) {
  const a = p.aircraft;
  return (
    <aside
      className={`aircraft-panel glass ${p.listAlone ? "list-alone" : "scroll-all"}`}
      aria-label={`Aircraft ${aircraftLabel(a)}`}
      style={{ "--c": a.color } as CSSProperties}
    >
      <IconButton icon="close" label="Close the aircraft panel" className="close acp-close" onClick={p.onClose} />
      {/* Keyed by the aircraft: another aircraft starts afresh — its list at the top, no message or failure carried over. */}
      <ErrorBoundary key={a.id} label="Aircraft panel">
        <Body key={a.id} {...p} />
      </ErrorBoundary>
    </aside>
  );
}

function Body(p: AircraftPanelProps) {
  const { aircraft: a, state } = p;
  const hops = useMemo(() => state.hops.filter((h) => h.aircraft_id === a.id), [state.hops, a.id]);
  // @spec ACP-TOUR-001
  const rows = useMemo(() => tourRows(hops, state.airports), [hops, state.airports]);
  const summary = useMemo(() => tourSummary(rows), [rows]);
  // @spec ACP-LIST-001
  const latestFirst = useMemo(() => [...rows].reverse(), [rows]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---- the marked hop: the one last pointed at or focused, until the pointer or focus leaves it
  const onMarkHop = useRef(p.onMarkHop);
  onMarkHop.current = p.onMarkHop;
  const marked = useRef<number | null>(null);
  // @spec ACP-LIST-007
  const marking = (hopId: number) => {
    const set = () => {
      marked.current = hopId;
      onMarkHop.current(hopId);
    };
    const clear = () => {
      if (marked.current !== hopId) return;
      marked.current = null;
      onMarkHop.current(null);
    };
    return { onMouseEnter: set, onFocus: set, onMouseLeave: clear, onBlur: clear };
  };
  useEffect(() => {
    if (marked.current != null && !hops.some((h) => h.id === marked.current)) {
      marked.current = null;
      onMarkHop.current(null);
    }
  }, [hops]);
  useEffect(
    () => () => {
      if (marked.current != null) onMarkHop.current(null);
      marked.current = null;
    },
    [],
  );

  // ---- a hop opened from outside the list: its row comes into view
  const listRef = useRef<HTMLOListElement>(null);
  const revealed = useRef<number | null>(null);
  // @spec ACP-LIST-006
  useEffect(() => {
    if (!p.reveal || revealed.current === p.reveal.key) return;
    revealed.current = p.reveal.key;
    listRef.current?.querySelector(`[data-hop-id="${p.reveal.hopId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.reveal]);

  // The panel changing how it scrolls — a flight opening or closing beside it, the window resized —
  // puts its list somewhere else in the panel: the current row stays in view.
  const modeSeen = useRef(false);
  useEffect(() => {
    if (!modeSeen.current) {
      modeSeen.current = true;
      return;
    }
    if (p.currentHopId == null) return;
    listRef.current?.querySelector(`[data-hop-id="${p.currentHopId}"]`)?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.listAlone]);

  const digest = usePlanDigest(a.id, hops, state);
  const last = hops.length ? hops[hops.length - 1] : null;
  const parkedAt = last ? state.airports[last.dest] : undefined;

  return (
    <>
      {/* @spec ACP-HEAD-001, ACP-HEAD-002, ACP-ACT-004 */}
      <header className="acp-head">
        <span className="plane-head small" dangerouslySetInnerHTML={{ __html: iconInnerHtml(a) }} />
        <div className="acp-title">
          <span className="name">{a.name}</span>
          {a.livery && <span className="code">{a.livery}</span>}
        </div>
        <IconButton icon="pencil" label="Edit aircraft" onClick={p.onEditAircraft} />
        <div className="acp-parked">
          {last ? (
            <>
              parked at <b className="code">{last.dest}</b>
              {parkedAt && <> · {parkedAt.name}</>}
            </>
          ) : (
            <span className="muted">no hops yet</span>
          )}
        </div>
        {!a.visible && <div className="acp-hidden">hidden from the map</div>}
      </header>

      <div className="acp-under">
        <Picture aircraft={a} />
        <Toggles aircraft={a} fleet={state.aircraft} reload={p.reload} alive={alive} />

        {hops.length === 0 ? (
          <p className="acp-empty muted">No hops logged for this aircraft.</p>
        ) : (
          <TourBlock summary={summary} onOpenHop={(h) => p.onOpenHop(h, "longest")} marking={marking} />
        )}

        {/* @spec ACP-ACT-001, ACP-ACT-002, ACP-ACT-003 */}
        <div className="acp-actions">
          <button type="button" className="small" onClick={p.onPlanNext}>
            Plan next hop
          </button>
          <button type="button" className="small" onClick={p.onLogHop}>
            Log a hop
          </button>
          <button type="button" className="small" onClick={p.onZoomTour} disabled={!a.visible || hops.length === 0}>
            Zoom to tour
          </button>
        </div>

        {hops.length > 0 && (
          <>
            <h3 className="acp-list-title">Hops</h3>
            <div className="acp-scroll">
              {/* @spec ACP-LIST-008 */}
              <ol className="acp-list" ref={listRef}>
                {latestFirst.map((r) => (
                  <HopRow
                    key={r.hop.id}
                    row={r}
                    current={p.currentHopId === r.hop.id}
                    entry={digestEntry(r.hop, digest)}
                    onOpen={() => p.onOpenHop(r.hop, "row")}
                    marking={marking(r.hop.id)}
                  />
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * The digest of the aircraft's plans: asked for while it has a hop with a plan, again when those
 * links change, and, after a request that failed, when the map state next loads.
 */
// @spec ACP-PLAN-002, ACP-PLAN-003
function usePlanDigest(aircraftId: number, hops: Hop[], state: AppState): PlanDigestEntry[] | null {
  const links = hops
    .filter((h) => h.briefing_id != null)
    .map((h) => `${h.id}:${h.briefing_id}`)
    .join(",");
  const [digest, setDigest] = useState<PlanDigestEntry[] | null>(null);
  const [retry, setRetry] = useState(0);
  const failed = useRef(false);

  useEffect(() => {
    failed.current = false;
    if (!links) {
      setDigest(null);
      return;
    }
    let cancelled = false;
    api
      .aircraftPlans(aircraftId)
      .then((d) => !cancelled && setDigest(d))
      .catch(() => {
        // Rows keep their "SimBrief" mark; the plan itself is in the flight panel's SimBrief card.
        if (!cancelled) failed.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [aircraftId, links, retry]);

  useEffect(() => {
    if (failed.current) setRetry((n) => n + 1);
  }, [state]);

  return digest;
}

/** The aircraft's icon, large, when it is an image; nothing for a built-in icon or an image that will not load. */
// @spec ACP-HEAD-003, ACP-HEAD-004
function Picture({ aircraft: a }: { aircraft: Aircraft }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (a.icon.startsWith("builtin:") || failed === a.icon) return null;
  return (
    <div className={`acp-picture${loaded === a.icon ? " loaded" : ""}`}>
      <img key={a.icon} src={a.icon} alt={aircraftLabel(a)} onLoad={() => setLoaded(a.icon)} onError={() => setFailed(a.icon)} />
    </div>
  );
}

/** Hide this plane and Hide other planes: the fleet's map-visibility flag, read from the map state. */
// @spec ACP-VIS-001, ACP-VIS-002, ACP-VIS-003, ACP-VIS-004
function Toggles({ aircraft: a, fleet, reload, alive }: { aircraft: Aircraft; fleet: Aircraft[]; reload: () => Promise<void>; alive: { current: boolean } }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = fleet.filter((x) => x.id !== a.id);
  const othersHidden = others.length > 0 && others.every((x) => !x.visible);

  const change = async (send: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await send();
      if (alive.current) setError(null);
      await reload();
    } catch (e) {
      if (alive.current) setError(errMsg(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="acp-vis">
      <div className="acp-toggles">
        <button
          type="button"
          className={`layer-toggle${othersHidden ? " on" : ""}`}
          aria-pressed={othersHidden}
          disabled={busy || others.length === 0}
          title="Take every other plane's tour off the map"
          onClick={() => void change(() => api.setVisibility(othersHidden, a.id))}
        >
          Hide other planes
        </button>
        <button
          type="button"
          className={`layer-toggle${a.visible ? "" : " on"}`}
          aria-pressed={!a.visible}
          disabled={busy}
          title="Take this plane's tour off the map"
          onClick={() => void change(() => api.updateAircraft(a.id, { visible: !a.visible }))}
        >
          Hide this plane
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          Could not change what the map shows: {error}
        </div>
      )}
    </div>
  );
}

type Marking = (hopId: number) => { onMouseEnter: () => void; onFocus: () => void; onMouseLeave: () => void; onBlur: () => void };

/** What the tour adds up to. */
// @spec ACP-TOUR-002, ACP-TOUR-004, ACP-TOUR-006, ACP-TOUR-007, ACP-TOUR-008, ACP-TOUR-009, ACP-TOUR-010
function TourBlock({ summary: s, onOpenHop, marking }: { summary: TourSummary; onOpenHop: (hop: Hop) => void; marking: Marking }) {
  const flown = s.first && s.latest ? (fmtDate(s.first) === fmtDate(s.latest) ? fmtDate(s.first) : `${fmtDate(s.first)} – ${fmtDate(s.latest)}`) : "—";
  const longest = s.longest;
  return (
    <dl className="acp-tour">
      <div>
        <dt>Hops</dt>
        <dd>
          {s.hops} hop{s.hops === 1 ? "" : "s"}
          {s.loggedMin > 0 && <> · {fmtDuration(s.loggedMin)} logged</>}
        </dd>
      </div>
      <div>
        <dt>Distance</dt>
        <dd title="flown where tracked, direct otherwise">{fmtNm(s.distanceNm)}</dd>
      </div>
      <div>
        <dt>Fuel burned</dt>
        <dd>
          {s.fuelLb == null ? (
            "—"
          ) : (
            <>
              {fmtLb(s.fuelLb)}
              {s.fuelHops < s.hops && (
                <span className="muted">
                  {" "}
                  · {s.fuelHops} of {s.hops} hops
                </span>
              )}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Airports</dt>
        <dd>{s.airports}</dd>
      </div>
      <div>
        <dt>Flown</dt>
        <dd>{flown}</dd>
      </div>
      <div>
        <dt>Longest hop</dt>
        <dd>
          {longest && longest.distanceNm != null ? (
            <button type="button" className="link acp-longest" onClick={() => onOpenHop(longest.hop)} {...marking(longest.hop.id)}>
              <b className="code">{longest.hop.origin}</b> → <b className="code">{longest.hop.dest}</b> · {fmtNm(longest.distanceNm)}
            </button>
          ) : (
            "—"
          )}
        </dd>
      </div>
      <div>
        <dt>Landings</dt>
        <dd>
          {s.landings.count === 0 ? (
            <span className="muted">none recorded</span>
          ) : (
            <>
              avg {s.landings.avgFpm} fpm
              {s.landings.byRating.map(({ rating, count }) => {
                const m = RATING_META[rating];
                const label = `${count} ${m.label}`;
                return (
                  <span key={rating} className="acp-rating" role="img" aria-label={label} title={label} style={{ "--rc": m.color } as CSSProperties}>
                    {m.icon} {count}
                  </span>
                );
              })}
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** One hop: how far, how long, how it landed, what it burned, and its SimBrief plan. */
// @spec ACP-LIST-002, ACP-LIST-003, ACP-LIST-004, ACP-LIST-005, ACP-PLAN-001, ACP-PLAN-004, ACP-PLAN-005
function HopRow({
  row: r,
  current,
  entry,
  onOpen,
  marking,
}: {
  row: HopFigures;
  current: boolean;
  entry: PlanDigestEntry | null;
  onOpen: () => void;
  marking: ReturnType<Marking>;
}) {
  const h = r.hop;
  const figures: string[] = [];
  if (r.distanceNm != null) figures.push(r.distanceKind === "direct" ? `${fmtNm(r.distanceNm)} direct` : fmtNm(r.distanceNm));
  if (r.durationMin != null) figures.push(fmtDuration(r.durationMin));
  if (r.fuelLb != null) figures.push(fmtLb(r.fuelLb));

  const planned: string[] = [];
  if (entry) {
    const { eteMin, burnLb } = plannedFigures(entry);
    if (eteMin != null) planned.push(fmtDuration(eteMin));
    if (burnLb != null) planned.push(fmtLb(burnLb));
  }
  const pdf = entry ? outsideLink(entry.pdf_url) : null;

  return (
    <li data-hop-id={h.id} className={current ? "current" : undefined}>
      <button type="button" className="acp-row" aria-current={current ? "true" : undefined} onClick={onOpen} title="Zoom to this hop and open its profile" {...marking}>
        <span className="seq">{h.seq}</span>
        <span className="route">
          <b className="code">{h.origin}</b> → <b className="code">{h.dest}</b>
        </span>
        {r.touchdown && <LandingBadge landing={r.touchdown} compact />}
        <span className={r.when ? "when" : "when muted"}>{r.when ? fmtDateTime(r.when) : "no times"}</span>
        {figures.length > 0 && <span className="figures">{figures.join(" · ")}</span>}
        {h.briefing_id != null && <span className="plan-mark">SimBrief</span>}
        {planned.length > 0 && <span className="planned">planned {planned.join(" · ")}</span>}
        {h.notes && <span className="notes">{h.notes}</span>}
      </button>
      {pdf && (
        <a className="button small acp-pdf" href={pdf} target="_blank" rel="noopener noreferrer" title="Open this plan's PDF from SimBrief">
          PDF
        </a>
      )}
    </li>
  );
}
