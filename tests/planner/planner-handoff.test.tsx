/**
 * The planner form taking an aircraft handed to it by the aircraft panel (PLAN-FORM-013): the form
 * switches to it and the flight-time field takes the focus once the card is showing; no search runs.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Planner } from "../../src/client/components/Planner.tsx";
import { aircraft, appState, hop } from "../support/page-data.ts";

const STATE = appState({
  aircraft: [aircraft({ id: 1 }), aircraft({ id: 2, name: "TBM 850", livery: "Feather Red", cruise_kts: 300 })],
  hops: [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }), hop({ id: 21, aircraft_id: 2, seq: 1, origin: "KBOS", dest: "KACK" })],
});

type Handoff = { key: number; aircraftId: number } | null;

function renderCard(handoff: Handoff = null, shown = true) {
  const onPlan = vi.fn();
  const props = {
    state: STATE,
    plan: null,
    metars: new Map(),
    flags: new Map(),
    hideFlagged: true,
    onHideFlagged: vi.fn(),
    selectedId: 1,
    onPlan,
    onPick: vi.fn(),
    onFocus: vi.fn(),
    onEditAircraft: vi.fn(),
  };
  const r = render(<Planner {...props} handoff={handoff} shown={shown} />);
  return { ...r, onPlan, hand: (h: Handoff, s = true) => r.rerender(<Planner {...props} handoff={h} shown={s} />) };
}

const aircraftField = () => screen.getAllByRole("combobox")[0] as HTMLSelectElement;
const minutes = () => document.querySelector('.planner input[type="number"]') as HTMLInputElement;

describe("an aircraft handed to the planner", () => {
  // @spec PLAN-FORM-013
  it("switches the form to that aircraft, whatever it was set to, and focuses the flight-time field", async () => {
    const { hand, onPlan } = renderCard();
    // The form follows the highlight (the Comanche); it is then set to the TBM and back by hand.
    fireEvent.change(aircraftField(), { target: { value: "2" } });
    fireEvent.change(aircraftField(), { target: { value: "1" } });
    hand({ key: 1, aircraftId: 2 });
    expect(aircraftField().value).toBe("2");
    await waitFor(() => expect(document.activeElement).toBe(minutes()));
    // No search: an unanswered /api/plan request would fail this test.
    expect(onPlan).not.toHaveBeenCalled();
  });

  // @spec PLAN-FORM-013
  it("waits for the card to be showing before it takes the focus", async () => {
    const { hand } = renderCard(null, false);
    hand({ key: 1, aircraftId: 2 }, false);
    expect(aircraftField().value).toBe("2");
    expect(document.activeElement).not.toBe(minutes());
    hand({ key: 1, aircraftId: 2 }, true);
    await waitFor(() => expect(document.activeElement).toBe(minutes()));
  });

  // @spec PLAN-FORM-013
  it("acts once on each hand-off, and again on the next", async () => {
    const { hand } = renderCard();
    hand({ key: 1, aircraftId: 2 });
    await waitFor(() => expect(document.activeElement).toBe(minutes()));
    fireEvent.change(aircraftField(), { target: { value: "1" } });
    (document.activeElement as HTMLElement).blur();
    // the same hand-off rendered again changes nothing
    hand({ key: 1, aircraftId: 2 });
    expect(aircraftField().value).toBe("1");
    expect(document.activeElement).not.toBe(minutes());
    hand({ key: 2, aircraftId: 2 });
    expect(aircraftField().value).toBe("2");
    await waitFor(() => expect(document.activeElement).toBe(minutes()));
  });
});
