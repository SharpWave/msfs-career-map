/**
 * The "Log a hop" form taking an aircraft handed to it by the aircraft panel (LOG-FORM-013): the
 * aircraft and its parked airport change, what was typed stays. The planner's hand-off, which also
 * names a destination, still fills it (LOG-FORM-004).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { HopForm, type HopPreset } from "../../src/client/components/HopForm.tsx";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, airport, hop } from "../support/page-data.ts";

// The airport fields look up the code they hold.
beforeEach(() => {
  answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
});

const FLEET = [aircraft({ id: 1 }), aircraft({ id: 2, name: "TBM 850", livery: "Feather Red" }), aircraft({ id: 3, name: "Piper Cub", livery: "NC1776" })];
const HOPS = [
  hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }),
  hop({ id: 21, aircraft_id: 2, seq: 1, origin: "KBOS", dest: "KHYA" }),
  hop({ id: 22, aircraft_id: 2, seq: 2, origin: "KHYA", dest: "KACK" }),
];

function renderForm(preset: HopPreset | null = null) {
  const r = render(<HopForm aircraft={FLEET} hops={HOPS} defaultAircraftId={1} preset={preset} onSaved={() => {}} />);
  return { ...r, hand: (p: HopPreset | null) => r.rerender(<HopForm aircraft={FLEET} hops={HOPS} defaultAircraftId={1} preset={p} onSaved={() => {}} />) };
}

const aircraftField = () => screen.getByRole("combobox") as HTMLSelectElement;
const from = () => screen.getByPlaceholderText("KBOS") as HTMLInputElement;
const to = () => screen.getByPlaceholderText("KHYA") as HTMLInputElement;
const notes = () => screen.getByPlaceholderText("weather, squawks…") as HTMLInputElement;
const minutes = () => screen.getByPlaceholderText("auto from times") as HTMLInputElement;
const type = (el: HTMLInputElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe("an aircraft handed to the hop form", () => {
  // @spec LOG-FORM-013
  it("switches the form to that aircraft and its parked airport, keeping the destination, flight time and notes", () => {
    const { hand } = renderForm();
    expect(aircraftField().value).toBe("1");
    expect(from().value).toBe("KPVD");
    type(to(), "KBOS");
    type(minutes(), "45");
    type(notes(), "ferry");

    hand({ key: 1, aircraftId: 2 });
    expect(aircraftField().value).toBe("2");
    expect(from().value).toBe("KACK");
    expect(to().value).toBe("KBOS");
    expect(minutes().value).toBe("45");
    expect(notes().value).toBe("ferry");
  });

  // @spec LOG-FORM-013
  it("sets the origin again when the form is already on that aircraft with another origin typed", () => {
    const { hand } = renderForm();
    type(from(), "KBOS");
    hand({ key: 1, aircraftId: 1 });
    expect(aircraftField().value).toBe("1");
    expect(from().value).toBe("KPVD");
  });

  // @spec LOG-FORM-013
  it("leaves the origin blank for an aircraft without hops", () => {
    const { hand } = renderForm();
    hand({ key: 1, aircraftId: 3 });
    expect(aircraftField().value).toBe("3");
    expect(from().value).toBe("");
  });

  // @spec LOG-FORM-013
  it("acts again on a second hand-off of the same aircraft", () => {
    const { hand } = renderForm();
    hand({ key: 1, aircraftId: 2 });
    fireEvent.change(aircraftField(), { target: { value: "1" } });
    expect(aircraftField().value).toBe("1");
    hand({ key: 2, aircraftId: 2 });
    expect(aircraftField().value).toBe("2");
    expect(from().value).toBe("KACK");
  });

  // @spec LOG-FORM-004
  it("still fills the destination when the planner hands one over", () => {
    const { hand } = renderForm();
    type(to(), "KBOS");
    hand({ key: 1, aircraftId: 2, dest: "KPVD" });
    expect(aircraftField().value).toBe("2");
    expect(from().value).toBe("KACK");
    expect(to().value).toBe("KPVD");
  });
});
