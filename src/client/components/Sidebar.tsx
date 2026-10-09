import { useState } from "react";
import type { Flag } from "../constraints";
import type { MetarMap } from "../metar";
import { readPref, writePref } from "../prefs";
import type { LiveState } from "../tracker";
import type { AppState, PlanCandidate, PlanResult, SimAircraft } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";
import { IconButton } from "./Icon";
import { LivePanel } from "./LivePanel";
import { Planner } from "./Planner";

interface Props {
  state: AppState;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  reload: () => Promise<void>;
  plan: PlanResult | null;
  metars: MetarMap;
  flags: Map<string, Flag[]>;
  hideFlagged: boolean;
  onHideFlagged: (v: boolean) => void;
  onPlan: (p: PlanResult | null) => void;
  onPickCandidate: (c: PlanCandidate) => void;
  onFocusCandidate: (c: PlanCandidate) => void;
  /** Open an aircraft's form in the Fleet drawer. */
  onEditAircraft: (id: number) => void;
  live: LiveState;
  onFocusLive: () => void;
  onOpenLive: () => void;
  /** Open the new-aircraft form in the Fleet drawer, prefilled from what the sim reports. */
  onNewFromSim: (sim: SimAircraft) => void;
}

/** Whether a card was left open (default) or collapsed, remembered in the browser. */
function useCardOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => readPref(key, true, (s) => s !== "0"));
  const toggle = () =>
    setOpen((o) => {
      writePref(key, o ? "0" : "1");
      return !o;
    });
  return [open, toggle];
}

/**
 * What a session uses again and again: the live card above the planner card. Collapsing a card
 * hides its body without discarding it.
 */
// @spec APP-UI-001, APP-UI-010, APP-UI-029
export function Sidebar(p: Props) {
  const [liveOpen, toggleLive] = useCardOpen("card.live");
  const [planOpen, togglePlan] = useCardOpen("card.plan");

  return (
    <aside className="sidebar">
      <section className={`card glass card-live${liveOpen ? "" : " collapsed"}`}>
        <ErrorBoundary label="Live card">
          <LivePanel
            live={p.live}
            aircraft={p.state.aircraft}
            reload={p.reload}
            onFocusLive={p.onFocusLive}
            onOpenLive={p.onOpenLive}
            onSelect={(id) => p.onSelect(id)}
            onNewFromSim={p.onNewFromSim}
            open={liveOpen}
            onToggle={toggleLive}
          />
        </ErrorBoundary>
      </section>

      <section className={`card glass card-plan${planOpen ? "" : " collapsed"}`}>
        <div className="card-title">
          <h2>Plan next hop</h2>
          <IconButton icon={planOpen ? "chevron-down" : "chevron-right"} label={`${planOpen ? "Collapse" : "Expand"} Plan next hop`} aria-expanded={planOpen} onClick={togglePlan} />
        </div>
        <div className="card-body" hidden={!planOpen}>
          <Planner
            state={p.state}
            plan={p.plan}
            metars={p.metars}
            flags={p.flags}
            hideFlagged={p.hideFlagged}
            onHideFlagged={p.onHideFlagged}
            selectedId={p.selectedId}
            onPlan={p.onPlan}
            onPick={p.onPickCandidate}
            onFocus={p.onFocusCandidate}
            onEditAircraft={p.onEditAircraft}
          />
        </div>
      </section>
    </aside>
  );
}
