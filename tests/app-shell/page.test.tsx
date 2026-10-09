/**
 * The page as a whole, with the map and the live event stream stood in for: where things sit, the
 * menu and its drawers, hand-offs between panels, and the clear part of the map each zoom gets.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/client/types.ts";
import type { LiveState } from "../../src/client/tracker.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, airport, appState, hop, liveState, planResult, trackerStatus } from "../support/page-data.ts";

const stub = vi.hoisted(() => ({
  map: null as null | { focus: { key: number; clear?: unknown } | null; onSelect: (id: number | null) => void },
  live: null as unknown as LiveState,
}));

vi.mock("../../src/client/components/MapView.tsx", () => ({
  MapView: (p: NonNullable<typeof stub.map>) => {
    stub.map = p;
    return <div data-testid="map" />;
  },
}));
vi.mock("../../src/client/tracker.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/tracker.ts")>()),
  useTracker: () => stub.live,
}));

const { App } = await import("../../src/client/App.tsx");

const comanche = aircraft({ id: 1 });
const tbm = aircraft({ id: 2, name: "TBM 850", livery: "Feather Red", cruise_kts: null, color: "#cdd4d5" });
const HOPS = [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }), hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" })];
const STATE: AppState = appState({ aircraft: [comanche, tbm], hops: HOPS });

const scrolled: Element[] = [];

function answerPage(state: AppState = STATE) {
  answerFetch("/api/state", () => Response.json(state));
  answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
  answerFetch("/api/simbrief/aircraft", () => Response.json({ types: [], source: "test", fetched_at: null }));
  answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  answerFetch(/\/api\/metars\?/, () => Response.json({ metars: {}, fetched_at: "2026-10-09T14:00:00.000Z" }));
}

async function renderPage() {
  const r = render(<App />);
  await screen.findByRole("heading", { name: "Plan next hop" });
  return r;
}

const menuButton = () => screen.getByRole("button", { name: "Career Map" });
const chooseFromMenu = (entry: string) => {
  fireEvent.click(menuButton());
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
};
// A drawer by its label, whether or not it is showing (Testing Library gives a hidden element no
// accessible name, so a hidden drawer has no role to find it by); the tests check which it is.
const region = (name: string) => {
  const el = document.querySelector<HTMLElement>(`section.drawer[aria-label="${name}"]`);
  if (!el) throw new Error(`no ${name} drawer`);
  return el;
};
const shown = (el: Element) => el.closest("[hidden]") === null;
const sidebar = () => document.querySelector(".sidebar") as HTMLElement;
const lastClear = () => stub.map?.focus?.clear;

// The profile chart sizes itself with a ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  localStorage.clear();
  stub.live = liveState(null);
  stub.map = null;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("the page", () => {
  // @spec APP-UI-001
  it("lays out the top bar over the map and the sidebar in the left column", async () => {
    answerPage();
    await renderPage();
    expect(screen.getByTestId("map")).toBeTruthy();
    const bar = document.querySelector(".top-bar") as HTMLElement;
    for (const name of ["Career Map", "Hide sidebar", "Layers", "Fit all"]) {
      expect(within(bar).getByRole("button", { name })).toBeTruthy();
    }
    const column = document.querySelector(".left-column") as HTMLElement;
    expect(column.contains(sidebar())).toBe(true);
    expect(within(sidebar()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Live from the sim", "Plan next hop"]);
  });

  // @spec APP-UI-012
  it("shows the menu before the map state loads, with its entries disabled until it does", async () => {
    let release = () => {};
    answerPage();
    answerFetch("/api/state", () => new Promise((resolve) => (release = () => resolve(Response.json(STATE)))));
    render(<App />);
    fireEvent.click(menuButton());
    for (const item of screen.getAllByRole("menuitem")) expect((item as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("menu").textContent).toContain("2 aircraft · 2 hops · 72,609 airports · 48,291 runways"));
  });
});

describe("the menu's drawers", () => {
  // @spec APP-UI-013, APP-UI-014
  it("opens a drawer in place of the sidebar, replaces it with the other, and returns to the sidebar when closed", async () => {
    answerPage();
    await renderPage();
    chooseFromMenu("Fleet");
    expect(shown(region("Fleet"))).toBe(true);
    expect(shown(sidebar())).toBe(false);

    chooseFromMenu("Log a hop");
    expect(shown(region("Log a hop"))).toBe(true);
    expect(shown(region("Fleet"))).toBe(false);

    fireEvent.click(within(region("Log a hop")).getByRole("button", { name: "Close" }));
    expect(shown(sidebar())).toBe(true);
    expect(shown(region("Log a hop"))).toBe(false);
    expect(document.activeElement).toBe(menuButton());
  });

  // @spec APP-UI-002
  it("hides the left column with the sidebar toggle, closing a drawer, and shows the sidebar again", async () => {
    answerPage();
    await renderPage();
    chooseFromMenu("Fleet");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect((document.querySelector(".left-column") as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(shown(sidebar())).toBe(true);
    expect(shown(region("Fleet"))).toBe(false);
  });

  // @spec APP-UI-016
  it("closes the menu when the Layers menu opens, and the other way round", async () => {
    answerPage();
    await renderPage();
    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Layers" })).toBeTruthy();
    fireEvent.click(menuButton());
    expect(screen.queryByRole("dialog", { name: "Layers" })).toBeNull();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  // @spec LOG-FORM-009
  it("shows how to start in place of the hop form while the fleet has no aircraft", async () => {
    answerPage(appState());
    await renderPage();
    chooseFromMenu("Log a hop");
    const log = region("Log a hop");
    expect(log.textContent).toContain("Add an aircraft to the fleet first, then log hops here.");
    expect(log.querySelector("form")).toBeNull();
  });

  // @spec APP-UI-019, APP-UI-018
  it("keeps the Log a hop drawer open after a hop is logged from it", async () => {
    answerPage();
    let posted: unknown;
    answerFetch("/api/hops", async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return Response.json(hop({ id: 13, seq: 3, origin: "KHYA", dest: "KACK" }));
    });
    await renderPage();
    chooseFromMenu("Log a hop");
    const log = region("Log a hop");
    const to = within(log).getByPlaceholderText("KHYA") as HTMLInputElement;
    fireEvent.change(to, { target: { value: "KACK" } });
    fireEvent.blur(to);
    fireEvent.click(within(log).getByRole("button", { name: "Add hop" }));
    await within(log).findByText("Logged KHYA → KACK");
    expect(posted).toMatchObject({ aircraft_id: 1, origin: "KHYA", dest: "KACK" });
    expect(shown(region("Log a hop"))).toBe(true);
  });
});

describe("hand-offs to a drawer", () => {
  // @spec LOG-FORM-004, APP-UI-017, APP-UI-015
  it("opens Log a hop at the planned leg when a planner candidate is used", async () => {
    answerPage();
    answerFetch(/\/api\/plan\?/, () => Response.json(planResult(1, ["KACK"])));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use" }));

    const log = region("Log a hop");
    expect(shown(log)).toBe(true);
    const form = log.querySelector(".hop-form") as HTMLFormElement;
    expect(scrolled).toContain(form);
    expect((within(log).getByRole("combobox") as HTMLSelectElement).value).toBe("1");
    const [from, to] = Array.from(form.querySelectorAll(".airport-input input")) as HTMLInputElement[];
    expect(from.value).toBe("KHYA");
    expect(to.value).toBe("KACK");
    await waitFor(() => expect(document.activeElement).toBe(to));
  });

  // @spec FLEET-SIM-003, APP-UI-017, APP-UI-015
  it("opens Fleet at a new-aircraft form filled from the sim when the live card's + New is used", async () => {
    stub.live = liveState(trackerStatus());
    answerPage();
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));

    const fleet = region("Fleet");
    expect(shown(fleet)).toBe(true);
    const form = fleet.querySelector("#aircraft-form-new") as HTMLElement;
    expect(form).not.toBeNull();
    expect(scrolled).toContain(form);
    const name = within(form).getByPlaceholderText("A2A Aerostar 600") as HTMLInputElement;
    expect(name.value).toBe("Comanche 250");
    expect(document.activeElement).toBe(name);
  });

  // @spec PLAN-FORM-003, APP-UI-017
  it("opens Fleet at the aircraft's form from the planner's Edit aircraft", async () => {
    answerPage();
    await renderPage();
    fireEvent.change(within(sidebar()).getAllByRole("combobox")[0], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit aircraft" }));

    const fleet = region("Fleet");
    expect(shown(fleet)).toBe(true);
    const card = fleet.querySelector("#aircraft-2") as HTMLElement;
    expect(scrolled).toContain(card);
    expect((within(card).getByPlaceholderText("A2A Aerostar 600") as HTMLInputElement).value).toBe("TBM 850");
  });

  // @spec LOG-FORM-003
  it("switches the Log a hop form to a newly highlighted aircraft while its drawer is hidden", async () => {
    answerPage();
    await renderPage();
    chooseFromMenu("Log a hop");
    fireEvent.click(within(region("Log a hop")).getByRole("button", { name: "Close" }));
    act(() => stub.map!.onSelect(2));
    chooseFromMenu("Log a hop");
    expect((within(region("Log a hop")).getByRole("combobox") as HTMLSelectElement).value).toBe("2");
  });
});

describe("the clear part of the map", () => {
  // @spec APP-UI-020
  it("goes with each zoom, worked out from the panels open after the action that asked for it", async () => {
    answerPage();
    await renderPage();
    // jsdom's window is 1024 × 768: a 400 px column, and a 307 px flight panel.
    chooseFromMenu("Fleet");
    fireEvent.click(within(region("Fleet")).getByRole("button", { name: "Show 2 hops" }));
    fireEvent.click(within(region("Fleet")).getAllByTitle("Zoom to this hop and open its profile")[1]);
    expect(lastClear()).toEqual({ top: 52, right: 0, bottom: 12 + 307, left: 12 + 400 });

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(lastClear()).toEqual({ top: 52, right: 0, bottom: 12 + 307, left: 12 });
  });
});
