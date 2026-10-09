import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fleet } from "../../src/client/components/Fleet.tsx";
import type { AppState } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop } from "../support/page-data.ts";

const bound = aircraft({ id: 1, ifr_capable: 0, sim_title: "Comanche 250", sim_livery: "Blue Stripe" });
const hidden = aircraft({ id: 2, name: "TBM 850", livery: "Feather Red", visible: 0, cruise_kts: 300, ceiling_ft: 31000 });
const hops = [
  hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }),
  hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" }),
  hop({ id: 13, aircraft_id: 1, seq: 3, origin: "KHYA", dest: "KACK" }),
];

function renderFleet(state: AppState = appState({ aircraft: [bound, hidden], hops }), reload = async () => {}) {
  return render(
    <Fleet state={state} selectedId={null} onSelect={() => {}} onFocusHop={() => {}} reload={reload} form={null} onFormChange={() => {}} />,
  );
}

const card = (id: number) => document.getElementById(`aircraft-${id}`) as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("the aircraft card", () => {
  // @spec FLEET-CARD-002
  it("shows each detail as its own item, with a link icon and 'sim' when bound", () => {
    renderFleet();
    const items = Array.from(card(1).querySelectorAll(".meta > *")).map((e) => e.textContent?.trim());
    expect(items).toEqual(["N6229P", "parked at KACK", "160 kts", "ceil 12k", "VFR only", "sim"]);
    const sim = card(1).querySelector(".meta > [title]") as HTMLElement;
    expect(sim.getAttribute("title")).toBe("Tracked from the sim as “Comanche 250” / Blue Stripe");
    expect(sim.querySelector("svg[data-icon='link']")).not.toBeNull();
    expect(card(1).textContent).not.toContain("🔗");
  });

  // @spec FLEET-LOOK-010
  it("names the visibility button for what it does and crosses out the eye while hidden", () => {
    renderFleet();
    const hide = within(card(1)).getByRole("button", { name: "Hide from map" });
    expect(hide.querySelector("svg[data-icon='eye']")).not.toBeNull();
    const show = within(card(2)).getByRole("button", { name: "Show on map" });
    expect(show.querySelector("svg[data-icon='eye-off']")).not.toBeNull();
    expect(card(2).classList.contains("hidden")).toBe(true);
  });

  // @spec FLEET-LOOK-010
  it("toggles whether the aircraft is drawn on the map", async () => {
    const reload = vi.fn(async () => {});
    let body: unknown;
    answerFetch("/api/aircraft/2", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(hidden);
    });
    renderFleet(undefined, reload);
    fireEvent.click(within(card(2)).getByRole("button", { name: "Show on map" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(body).toEqual({ visible: true });
  });
});

describe("the hop list in an aircraft card", () => {
  const expand = () => fireEvent.click(within(card(1)).getByRole("button", { name: "Show 3 hops" }));
  const rows = () => Array.from(card(1).querySelectorAll(".hop-list > li")) as HTMLElement[];

  // @spec LOG-LIST-004
  it("offers Move earlier and Move later, disabled at the ends of the list", () => {
    renderFleet();
    expand();
    const [first, , last] = rows();
    expect((within(first).getByRole("button", { name: "Move earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(first).getByRole("button", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(last).getByRole("button", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // @spec LOG-LIST-004
  it("swaps a hop with its neighbour and saves the new order", async () => {
    let body: unknown;
    answerFetch("/api/aircraft/1/hops/order", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json([]);
    });
    renderFleet();
    expand();
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Move earlier" }));
    await waitFor(() => expect(body).toEqual({ ids: [12, 11, 13] }));
  });

  // @spec LOG-LIST-005
  it("deletes a hop from Delete hop after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let deleted = false;
    answerFetch("/api/hops/12", () => {
      deleted = true;
      return new Response(null, { status: 204 });
    });
    renderFleet();
    expand();
    const del = within(rows()[1]).getByRole("button", { name: "Delete hop" });
    expect(del.querySelector("svg[data-icon='trash']")).not.toBeNull();
    fireEvent.click(del);
    expect(window.confirm).toHaveBeenCalledWith("Delete hop KPVD → KHYA?");
    await waitFor(() => expect(deleted).toBe(true));
  });

  // @spec LOG-LIST-004, LOG-LIST-005, APP-UI-026
  it("draws its actions as icons with names, not text glyphs", () => {
    renderFleet();
    expand();
    const row = rows()[1];
    for (const name of ["Move earlier", "Move later", "Edit hop", "Delete hop"]) {
      const b = within(row).getByRole("button", { name });
      expect(b.getAttribute("title")).toBe(name);
      expect(b.querySelector("svg[data-icon]")).not.toBeNull();
      expect(b.textContent?.trim()).toBe("");
    }
  });
});
