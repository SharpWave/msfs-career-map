/**
 * The aircraft panel on the page, with the map and the live event stream stood in for: what opens
 * it, which aircraft it shows, what closes it, the part of the map it covers, what its actions hand
 * off to, and the page's other answers to a hidden aircraft (Show all planes, the "Logged" toast).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveState } from "../../src/client/tracker.ts";
import type { AppState, Hop } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, liveState, planResult, trackerStatus } from "../support/page-data.ts";
import { answerChange, fakeServer } from "../support/page-server.ts";

interface MapProps {
  selectedId: number | null;
  focus: { key: number; points: unknown[]; clear?: { top: number; right: number; bottom: number; left: number } } | null;
  markedHopId?: number | null;
  onPickAircraft: (id: number) => void;
  onOpenHop: (hop: Hop) => void;
}

const stub = vi.hoisted(() => ({
  map: null as null | MapProps,
  live: null as unknown as LiveState,
  onHop: null as null | ((hop: Hop) => void),
}));

vi.mock("../../src/client/components/MapView.tsx", () => ({
  MapView: (p: MapProps) => {
    stub.map = p;
    return <div data-testid="map" />;
  },
}));
vi.mock("../../src/client/tracker.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/tracker.ts")>()),
  useTracker: (onHop: (hop: Hop) => void) => {
    stub.onHop = onHop;
    return stub.live;
  },
}));
vi.mock("../../src/client/navigation.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/navigation.ts")>()),
  reloadPage: () => {},
}));

const { App } = await import("../../src/client/App.tsx");

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const comanche = aircraft({ id: 1 });
const tbm = aircraft({ id: 2, name: "TBM 850", livery: "Feather Red", color: "#cdd4d5", cruise_kts: 300 });
const cub = aircraft({ id: 3, name: "Piper Cub", livery: "NC1776", color: "#ffd23f", visible: 0 });
const HOPS: Hop[] = [
  hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }),
  hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" }),
  hop({ id: 21, aircraft_id: 2, seq: 1, origin: "KBOS", dest: "KACK" }),
  hop({ id: 31, aircraft_id: 3, seq: 1, origin: "KPVD", dest: "KACK" }),
];
const STATE: AppState = appState({ aircraft: [comanche, tbm, cub], hops: HOPS });
const ALL_SHOWN: AppState = { ...STATE, aircraft: STATE.aircraft.map((a) => ({ ...a, visible: 1 })) };

const scrolled: Element[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  stub.live = liveState(trackerStatus(), { connection: 1 });
  stub.map = null;
  stub.onHop = null;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

async function renderPage(state: AppState = STATE) {
  const served = fakeServer({ state });
  answerFetch(/\/api\/aircraft\/\d+\/plans$/, () => Response.json([]));
  render(<App />);
  await screen.findByRole("heading", { name: "Plan next hop" });
  await screen.findByTestId("map");
  return served;
}

const panel = () => document.querySelector<HTMLElement>(".aircraft-panel");
const shows = () => panel()?.querySelector(".acp-head .name")?.textContent ?? null;
const rows = () => Array.from(panel()!.querySelectorAll<HTMLElement>(".acp-list > li"));
const flight = () => document.querySelector(".flight-panel .route")?.textContent ?? null;
const toast = () => document.querySelector(".toast")?.textContent ?? null;
const region = (name: string) => {
  const el = document.querySelector<HTMLElement>(`section.drawer[aria-label="${name}"]`);
  if (!el) throw new Error(`no ${name} drawer`);
  return el;
};
const shown = (el: Element) => el.closest("[hidden]") === null;
const chooseFromMenu = (entry: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Career Map" }));
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
};
const pick = (id: number) => act(() => stub.map!.onPickAircraft(id));
const card = (id: number) => document.getElementById(`aircraft-${id}`) as HTMLElement;
/** A hop row in the Fleet drawer's card, which opens the hop and highlights its aircraft. */
const clickFleetHopRow = (aircraftId: number, index = 0) => {
  const fleet = document.querySelector('section.drawer[aria-label="Fleet"]');
  if (!fleet || !shown(fleet)) chooseFromMenu("Fleet");
  const c = card(aircraftId);
  if (!c.querySelector(".hop-list")) fireEvent.click(c.querySelector("button.count") as HTMLElement);
  fireEvent.click(c.querySelectorAll<HTMLElement>(".hop-main")[index]);
};
const setHash = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};
const focusKey = () => stub.map?.focus?.key ?? 0;

describe("what opens the aircraft panel", () => {
  // @spec ACP-OPEN-007
  it("is closed when the page loads", async () => {
    await renderPage();
    expect(panel()).toBeNull();
    expect(stub.map?.selectedId).toBeNull();
  });

  // @spec ACP-OPEN-001, MAP-PARK-002, ACP-LAY-003
  it("opens on a parked aircraft's marker, highlighting it and fitting its tour left of the panel", async () => {
    await renderPage();
    const before = focusKey();
    pick(1);
    expect(shows()).toBe("Piper Comanche 250");
    expect(panel()!.getAttribute("aria-label")).toBe("Aircraft Piper Comanche 250 · N6229P");
    expect(stub.map?.selectedId).toBe(1);
    expect(focusKey()).toBeGreaterThan(before);
    // jsdom's window is 1024 × 768: a 400 px column on each side.
    expect(stub.map?.focus?.clear).toEqual({ top: 52, right: 12 + 400, bottom: 0, left: 12 + 400 });
  });

  // @spec ACP-OPEN-001, MAP-PATH-004, ACP-LAY-003
  it("opens on a hop's path, with the hop in the flight panel and the zoom between the panels", async () => {
    await renderPage();
    act(() => stub.map!.onOpenHop(HOPS[2]));
    expect(shows()).toBe("TBM 850");
    expect(flight()).toBe("KBOS → KACK");
    expect(stub.map?.selectedId).toBe(2);
    expect(stub.map?.focus?.clear).toEqual({ top: 52, right: 12 + 400, bottom: 12 + 307, left: 12 + 400 });
  });

  // @spec ACP-OPEN-001, FLEET-CARD-001
  it("opens on an aircraft card's name or badge in the Fleet drawer", async () => {
    await renderPage();
    chooseFromMenu("Fleet");
    fireEvent.click(card(2).querySelector(".title-btn") as HTMLElement);
    expect(shows()).toBe("TBM 850");
    expect(stub.map?.selectedId).toBe(2);
    fireEvent.click(card(1).querySelector(".badge-btn") as HTMLElement);
    expect(shows()).toBe("Piper Comanche 250");
    expect(stub.map?.selectedId).toBe(1);
  });

  // @spec ACP-OPEN-002, MAP-PARK-002, FLEET-CARD-001
  it("clears the highlight on a second click on the marker or card of the aircraft it shows", async () => {
    await renderPage();
    pick(1);
    pick(1);
    expect(panel()).toBeNull();
    expect(stub.map?.selectedId).toBeNull();

    chooseFromMenu("Fleet");
    fireEvent.click(card(2).querySelector(".title-btn") as HTMLElement);
    expect(shows()).toBe("TBM 850");
    fireEvent.click(card(2).querySelector(".title-btn") as HTMLElement);
    expect(panel()).toBeNull();
    expect(stub.map?.selectedId).toBeNull();
  });

  // @spec ACP-OPEN-001, ACP-OPEN-002
  it("moves to another aircraft whose marker is clicked, and never clears the highlight on a path click", async () => {
    await renderPage();
    pick(1);
    pick(2);
    expect(shows()).toBe("TBM 850");
    act(() => stub.map!.onOpenHop(HOPS[2]));
    act(() => stub.map!.onOpenHop(HOPS[2]));
    expect(shows()).toBe("TBM 850");
    expect(stub.map?.selectedId).toBe(2);
  });

  // @spec ACP-OPEN-001, ACP-OPEN-004, MAP-ZOOM-003
  it("opens, without clearing, on the marker of an aircraft highlighted with the panel closed, and fits its tour again", async () => {
    await renderPage();
    clickFleetHopRow(1);
    expect(stub.map?.selectedId).toBe(1);
    expect(panel()).toBeNull();
    const before = focusKey();
    pick(1);
    expect(shows()).toBe("Piper Comanche 250");
    expect(stub.map?.selectedId).toBe(1);
    expect(focusKey()).toBeGreaterThan(before);
    expect(stub.map?.focus?.clear?.right).toBe(12 + 400);
  });

  // @spec ACP-OPEN-008
  it("leaves the keyboard focus where it was", async () => {
    await renderPage();
    const menu = screen.getByRole("button", { name: "Career Map" });
    menu.focus();
    pick(1);
    expect(document.activeElement).toBe(menu);
  });
});

describe("what highlights without opening it", () => {
  // @spec ACP-OPEN-004
  it("stays closed for a hop row in the Fleet drawer, a hop named in the address and a planner search", async () => {
    await renderPage();

    clickFleetHopRow(2);
    expect(stub.map?.selectedId).toBe(2);
    expect(panel()).toBeNull();

    await setHash("#hop=12");
    await waitFor(() => expect(flight()).toBe("KPVD → KHYA"));
    expect(stub.map?.selectedId).toBe(1);
    expect(panel()).toBeNull();

    fireEvent.click(within(region("Fleet")).getByRole("button", { name: "Close" }));
    const planner = document.querySelector(".card-plan") as HTMLElement;
    fireEvent.change(planner.querySelector("select") as HTMLSelectElement, { target: { value: "2" } });
    answerFetch(/\/api\/plan\?/, () => Response.json(planResult(2, ["KACK"])));
    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    await screen.findByRole("button", { name: "Clear plan" });
    expect(panel()).toBeNull();
  });

  // @spec ACP-OPEN-003
  it("follows the highlight to another aircraft while it is open", async () => {
    await renderPage();
    pick(1);
    clickFleetHopRow(2);
    expect(shows()).toBe("TBM 850");

    await setHash("#hop=12");
    await waitFor(() => expect(shows()).toBe("Piper Comanche 250"));

    fireEvent.click(within(region("Fleet")).getByRole("button", { name: "Close" }));
    const planner = document.querySelector(".card-plan") as HTMLElement;
    fireEvent.change(planner.querySelector("select") as HTMLSelectElement, { target: { value: "2" } });
    answerFetch(/\/api\/plan\?/, () => Response.json(planResult(2, ["KACK"])));
    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    await waitFor(() => expect(shows()).toBe("TBM 850"));
  });
});

describe("what closes it", () => {
  // @spec ACP-OPEN-005, MAP-HL-002
  it("closes with its close button, keeping the highlight, and moves the focus to Clear highlight", async () => {
    await renderPage();
    pick(1);
    fireEvent.click(within(panel()!).getByRole("button", { name: "Close the aircraft panel" }));
    expect(panel()).toBeNull();
    expect(stub.map?.selectedId).toBe(1);
    const clear = screen.getByRole("button", { name: "Clear highlight" });
    await waitFor(() => expect(document.activeElement).toBe(clear));
  });

  // @spec ACP-OPEN-006, ACP-OPEN-004
  it("closes when the highlight is cleared, and a later highlight does not bring it back", async () => {
    await renderPage();
    pick(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear highlight" }));
    expect(panel()).toBeNull();
    expect(stub.map?.selectedId).toBeNull();

    clickFleetHopRow(2);
    expect(stub.map?.selectedId).toBe(2);
    expect(panel()).toBeNull();
  });

  // @spec ACP-OPEN-006, MAP-HL-003
  it("closes when the highlighted aircraft is gone from the fleet", async () => {
    const { server } = await renderPage();
    pick(2);
    expect(shows()).toBe("TBM 850");
    // The TBM is deleted elsewhere; the next load of the map state no longer has it.
    server.state = appState({ aircraft: [comanche, cub], hops: HOPS.filter((h) => h.aircraft_id !== 2) });
    answerChange(server, "/api/aircraft/visibility", () => Response.json([]));
    fireEvent.click(screen.getByRole("button", { name: "Show all planes" }));
    await waitFor(() => expect(panel()).toBeNull());
    expect(stub.map?.selectedId).toBeNull();
  });
});

describe("where it sits", () => {
  // @spec ACP-LAY-003, APP-UI-020
  it("gives the map's right side back to the zooms once it is closed", async () => {
    await renderPage();
    pick(1);
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(stub.map?.focus?.clear?.right).toBe(12 + 400);
    fireEvent.click(within(panel()!).getByRole("button", { name: "Close the aircraft panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(stub.map?.focus?.clear?.right).toBe(0);
  });

  // @spec ACP-LAY-002
  it("scrolls its hop list alone while it has the room, and everything as one once a flight is open", async () => {
    await renderPage();
    pick(1);
    // 768 px high: 692 px of room, 373 px above a 307 px flight panel
    expect(panel()!.classList.contains("list-alone")).toBe(true);
    fireEvent.click(rows()[0].querySelector(".acp-row") as HTMLElement);
    expect(flight()).toBe("KPVD → KHYA");
    expect(panel()!.classList.contains("list-alone")).toBe(false);
    expect(panel()!.classList.contains("scroll-all")).toBe(true);
  });

  // @spec APP-UI-021, APP-UI-022, APP-UI-043
  it("tells the page's styles how much of the map's right side it covers, for the attribution, the toast, the banner and the notices", async () => {
    await renderPage();
    const app = document.querySelector(".app") as HTMLElement;
    expect(app.style.getPropertyValue("--clear-right")).toBe("0px");
    pick(1);
    expect(app.style.getPropertyValue("--clear-right")).toBe("412px");
    fireEvent.click(within(panel()!).getByRole("button", { name: "Close the aircraft panel" }));
    expect(app.style.getPropertyValue("--clear-right")).toBe("0px");
  });

  // @spec ACP-LAY-005, APP-UI-022
  it("is a panel of its own beside the left column and the flight panel, under the top bar", async () => {
    await renderPage();
    act(() => stub.map!.onOpenHop(HOPS[0]));
    const app = document.querySelector(".app") as HTMLElement;
    expect(panel()!.parentElement).toBe(app);
    expect(panel()!.classList.contains("glass")).toBe(true);
    expect(app.classList.contains("aircraft-panel-open")).toBe(true);
    expect(document.querySelector(".left-column")!.contains(panel())).toBe(false);
    expect(document.querySelector(".flight-panel")!.contains(panel())).toBe(false);
  });
});

describe("its actions", () => {
  // @spec ACP-ACT-001, APP-UI-044, PLAN-FORM-013, ACP-ACT-005
  it("Plan next hop shows the sidebar, opens a collapsed planner card on its aircraft and focuses the flight-time field, without searching", async () => {
    localStorage.setItem("card.plan", "0");
    await renderPage();
    pick(2);
    const planner = () => document.querySelector(".card-plan") as HTMLElement;
    // The planner followed the highlight to the TBM; it is then set to the Comanche by hand.
    fireEvent.change(planner().querySelector("select") as HTMLSelectElement, { target: { value: "1" } });
    chooseFromMenu("Fleet");
    expect(shown(document.querySelector(".sidebar")!)).toBe(false);

    fireEvent.click(within(panel()!).getByRole("button", { name: "Plan next hop" }));
    expect(shown(document.querySelector(".sidebar")!)).toBe(true);
    // the Fleet drawer stays mounted behind it
    expect(document.querySelector('section.drawer[aria-label="Fleet"]')).not.toBeNull();
    await waitFor(() => expect(planner().classList.contains("collapsed")).toBe(false));
    expect((planner().querySelector("select") as HTMLSelectElement).value).toBe("2");
    const minutes = planner().querySelector('input[type="number"]') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(minutes));
    // No search ran: an unanswered /api/plan request would fail this test.
    expect(screen.queryByRole("button", { name: "Clear plan" })).toBeNull();
    expect(shows()).toBe("TBM 850");
  });

  // @spec ACP-ACT-002, LOG-FORM-013, APP-UI-017, ACP-ACT-005
  it("Log a hop opens the hop form on its aircraft and its parked airport, keeping what was typed", async () => {
    await renderPage();
    pick(2);
    chooseFromMenu("Log a hop");
    const log = region("Log a hop");
    const form = log.querySelector(".hop-form") as HTMLFormElement;
    const fields = () => Array.from(form.querySelectorAll(".airport-input input")) as HTMLInputElement[];
    // The form followed the highlight to the TBM; it is then set to the Comanche by hand.
    fireEvent.change(within(log).getByRole("combobox"), { target: { value: "1" } });
    fireEvent.change(fields()[1], { target: { value: "KBOS" } });
    fireEvent.blur(fields()[1]);
    fireEvent.change(within(log).getByPlaceholderText("weather, squawks…"), { target: { value: "ferry" } });
    fireEvent.click(within(log).getByRole("button", { name: "Close" }));
    scrolled.length = 0;

    fireEvent.click(within(panel()!).getByRole("button", { name: "Log a hop" }));
    expect(shown(log)).toBe(true);
    expect(scrolled).toContain(form);
    expect((within(log).getByRole("combobox") as HTMLSelectElement).value).toBe("2");
    expect(fields()[0].value).toBe("KACK");
    expect(fields()[1].value).toBe("KBOS");
    expect((within(log).getByPlaceholderText("weather, squawks…") as HTMLInputElement).value).toBe("ferry");
    expect(shows()).toBe("TBM 850");
  });

  // @spec ACP-ACT-003, MAP-ZOOM-003
  it("Zoom to tour fits the view to its aircraft's hops", async () => {
    await renderPage();
    pick(1);
    const before = focusKey();
    fireEvent.click(within(panel()!).getByRole("button", { name: "Zoom to tour" }));
    expect(focusKey()).toBeGreaterThan(before);
    expect(stub.map?.focus?.points.length).toBeGreaterThan(0);
    expect(stub.map?.focus?.clear?.right).toBe(12 + 400);
  });

  // @spec ACP-ACT-004, APP-UI-017, ACP-ACT-005
  it("Edit aircraft opens its aircraft's edit form in the Fleet drawer", async () => {
    await renderPage();
    pick(2);
    fireEvent.click(within(panel()!).getByRole("button", { name: "Edit aircraft" }));
    const fleet = region("Fleet");
    expect(shown(fleet)).toBe(true);
    expect((within(card(2)).getByPlaceholderText("A2A Aerostar 600") as HTMLInputElement).value).toBe("TBM 850");
    expect(scrolled).toContain(card(2));
    expect(shows()).toBe("TBM 850");
  });
});

describe("its hop list on the page", () => {
  // @spec ACP-LIST-004, ACP-LIST-005, ACP-LIST-006, PANEL-OPEN-001, MAP-ZOOM-004
  it("opens a hop from its row in the flight panel, zooms to it and marks the row, keeping the row in view as the flight panel takes its room", async () => {
    await renderPage();
    pick(1);
    const before = focusKey();
    scrolled.length = 0;
    fireEvent.click(rows()[1].querySelector(".acp-row") as HTMLElement);
    expect(flight()).toBe("KBOS → KPVD");
    expect(focusKey()).toBeGreaterThan(before);
    expect(stub.map?.focus?.clear).toEqual({ top: 52, right: 12 + 400, bottom: 12 + 307, left: 12 + 400 });
    expect(rows().map((r) => r.querySelector(".acp-row")!.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(shows()).toBe("Piper Comanche 250");
    // The flight panel took the room the list scrolled alone in: the row clicked is kept in view.
    expect(scrolled.filter((el) => panel()!.contains(el))).toEqual([rows()[1]]);

    // With the flight panel already open, a click on another row scrolls nothing.
    scrolled.length = 0;
    fireEvent.click(rows()[0].querySelector(".acp-row") as HTMLElement);
    expect(flight()).toBe("KPVD → KHYA");
    expect(scrolled.filter((el) => panel()!.contains(el))).toEqual([]);
  });

  // @spec ACP-LIST-006
  it("brings the row into view when its hop is opened from the Fleet drawer, the map or the address", async () => {
    await renderPage();
    pick(1);
    scrolled.length = 0;
    clickFleetHopRow(1, 0);
    await waitFor(() => expect(scrolled).toContain(rows()[1]));

    scrolled.length = 0;
    act(() => stub.map!.onOpenHop(HOPS[1]));
    await waitFor(() => expect(scrolled).toContain(rows()[0]));

    scrolled.length = 0;
    await setHash("#hop=11");
    await waitFor(() => expect(scrolled).toContain(rows()[1]));
  });

  // @spec ACP-LIST-007, MAP-HL-004
  it("hands the map the hop whose row is pointed at, and none once the pointer leaves or the panel closes", async () => {
    await renderPage();
    pick(1);
    expect(stub.map?.markedHopId ?? null).toBeNull();
    const row = rows()[0].querySelector(".acp-row") as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(stub.map?.markedHopId).toBe(12);
    fireEvent.mouseLeave(row);
    expect(stub.map?.markedHopId ?? null).toBeNull();

    fireEvent.mouseEnter(row);
    expect(stub.map?.markedHopId).toBe(12);
    fireEvent.click(screen.getByRole("button", { name: "Clear highlight" }));
    expect(stub.map?.markedHopId ?? null).toBeNull();
  });

  // @spec ACP-LIST-004, ACP-VIS-005
  it("opens a hidden aircraft's hop and leaves the view where it is", async () => {
    await renderPage();
    chooseFromMenu("Fleet");
    fireEvent.click(card(3).querySelector(".title-btn") as HTMLElement);
    expect(shows()).toBe("Piper Cub");
    const before = focusKey();
    fireEvent.click(rows()[0].querySelector(".acp-row") as HTMLElement);
    expect(flight()).toBe("KPVD → KACK");
    expect(focusKey()).toBe(before);
    expect(shows()).toBe("Piper Cub");
  });
});

describe("hiding aircraft on the page", () => {
  // @spec ACP-VIS-002, ACP-VIS-003, FLEET-LOOK-012
  it("Hide other planes sends one request, reloads the map state and reads on once it has", async () => {
    const { server } = await renderPage(ALL_SHOWN);
    expect(screen.queryByRole("button", { name: "Show all planes" })).toBeNull();
    pick(1);
    answerChange(server, "/api/aircraft/visibility", () => {
      server.state = { ...STATE, aircraft: STATE.aircraft.map((a) => ({ ...a, visible: a.id === 1 ? 1 : 0 })) };
      return Response.json([]);
    });
    const others = within(panel()!).getByRole("button", { name: "Hide other planes" });
    expect(others.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(others);
    await waitFor(() => expect(within(panel()!).getByRole("button", { name: "Hide other planes" }).getAttribute("aria-pressed")).toBe("true"));
    expect(server.changes).toEqual(['PUT /api/aircraft/visibility {"visible":false,"except":1}']);
    expect(screen.getByRole("button", { name: "Show all planes" })).toBeTruthy();
    expect(shows()).toBe("Piper Comanche 250");
  });

  // @spec FLEET-LOOK-012
  it("offers Show all planes in the toolbar while any aircraft is hidden, which shows every aircraft", async () => {
    const { server } = await renderPage();
    const chip = screen.getByRole("button", { name: "Show all planes" });
    expect(chip.getAttribute("title")).toBe("Show every hidden plane on the map");
    expect(document.querySelector(".map-toolbar")!.contains(chip)).toBe(true);
    answerChange(server, "/api/aircraft/visibility", () => {
      server.state = ALL_SHOWN;
      return Response.json(ALL_SHOWN.aircraft);
    });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show all planes" })).toBeNull());
    expect(server.changes).toEqual(['PUT /api/aircraft/visibility {"visible":true}']);
  });

  // @spec FLEET-LOOK-012
  it("says so in a toast when Show all planes fails", async () => {
    const { server } = await renderPage();
    answerChange(server, "/api/aircraft/visibility", () => Response.json({ error: "the logbook is busy" }, { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "Show all planes" }));
    await waitFor(() => expect(toast()).toBe("Could not show all planes: the logbook is busy"));
    expect(screen.getByRole("button", { name: "Show all planes" })).toBeTruthy();
  });
});

describe("a hop logged for a hidden aircraft", () => {
  // @spec LIVE-CARD-009
  it("ends the Logged toast with 'hidden from the map'", async () => {
    await renderPage();
    act(() => stub.onHop!(hop({ id: 32, aircraft_id: 3, seq: 2, origin: "KACK", dest: "KHYA", duration_min: 40 })));
    await waitFor(() => expect(toast()).toBe("Logged KACK → KHYA · 40m · hidden from the map"));
  });

  // @spec LIVE-CARD-009
  it("leaves the toast as it is for an aircraft that is shown", async () => {
    await renderPage();
    act(() => stub.onHop!(hop({ id: 13, aircraft_id: 1, seq: 3, origin: "KHYA", dest: "KACK", duration_min: 40 })));
    await waitFor(() => expect(toast()).toBe("Logged KHYA → KACK · 40m"));
  });
});
