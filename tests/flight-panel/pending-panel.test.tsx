/**
 * Pending legs in the flight panel: opened from **Profile** in the live card (LIVE-CARD-010,
 * PANEL-OPEN-002) with their header (PANEL-HEAD-005) and statistics (PANEL-STAT-003), following a leg
 * logged here into the logbook and closing for one gone otherwise (PANEL-OPEN-006); and the live
 * panel following only its own leg (PANEL-OPEN-013), across a reconnect too (PANEL-OPEN-014).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fmtDuration, fmtTimeShort } from "../../src/client/format.ts";
import type { LiveState } from "../../src/client/tracker.ts";
import type { AppState, Hop, PendingLeg } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, liveState, pendingLeg, trackerStatus } from "../support/page-data.ts";
import { fakeServer } from "../support/page-server.ts";

const stub = vi.hoisted(() => ({
  live: null as unknown as LiveState,
  onHop: null as null | ((hop: Hop) => void),
}));

vi.mock("../../src/client/components/MapView.tsx", () => ({ MapView: () => <div data-testid="map" /> }));
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
const HOPS = [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" })];
const STATE: AppState = appState({ aircraft: [comanche], hops: HOPS });
const LEG: PendingLeg = pendingLeg({
  id: "leg-one",
  origin: "KBOS",
  dest: "KPVD",
  stats: { fuel_start_lb: 420, fuel_end_lb: 380, fuel_used_lb: 40, weight_start_lb: 2900, weight_end_lb: 2860, max_alt_ft: 5500, max_gs_kts: 168, flown_nm: 52 },
});
const UNKNOWN_DEST: PendingLeg = pendingLeg({ id: "leg-two", origin: "KHYA", dest: null, ended_in_air: true, departed_at: "2026-10-09T16:00:00.000Z", arrived_at: "2026-10-09T16:30:00.000Z", duration_min: 30 });

/** The leg in full for GET; any other request goes to `other` (Log hop's POST). */
function answerDetail(leg: PendingLeg, other?: (init?: RequestInit) => Response | Promise<Response>) {
  const { points: _points, ...rest } = leg;
  answerFetch(`/api/tracker/pending/${leg.id}`, (_u, init) =>
    init?.method && init.method !== "GET" && other ? other(init) : Response.json({
      ...rest,
      track: [
        [42.36, -71.0, 0, 1760018400, 0, 0, 0, 420],
        [42.1, -71.2, 5500, 1760019600, 160, 0, 150, 400],
        [41.72, -71.43, 0, 1760020800, 0, 0, 0, 380],
      ],
      briefing: null,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  stub.live = liveState(trackerStatus({ pending: [LEG, UNKNOWN_DEST] }), { connection: 1 });
  stub.onHop = null;
});

const panel = () => document.querySelector(".flight-panel") as HTMLElement | null;
const panelTitle = () => panel()?.querySelector(".route")?.textContent ?? null;
const block = (id: string) => document.querySelector(`.pending[data-pending-id="${id}"]`) as HTMLElement;
const profileOf = (id: string) => within(block(id)).getByRole("button", { name: "Profile" });

describe("opening a pending leg (LIVE-CARD-010, PANEL-OPEN-002)", () => {
  // @spec LIVE-CARD-010, PANEL-OPEN-002, PANEL-HEAD-005, PANEL-STAT-003
  it("shows the leg from its Profile, with its route, waiting to be logged, its times, statistics and direct distance", async () => {
    fakeServer({ state: STATE });
    answerDetail(LEG);
    render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(profileOf("leg-one"));
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    const head = panel()!.querySelector(".fp-head") as HTMLElement;
    expect(head.textContent).toContain(`waiting to be logged · off ${fmtTimeShort(LEG.departed_at)} · down ${fmtTimeShort(LEG.arrived_at)} · ${fmtDuration(40)}`);
    // No fleet aircraft: the sim aircraft's title.
    expect(head.textContent).toContain("Comanche 250");
    await waitFor(() => expect(panel()!.textContent).toMatch(/52 nm flown · \d+ nm direct/));
    expect(panel()!.textContent).toContain("40 lb");
    expect(panel()!.textContent).toContain("5,500 ft");
    expect(panel()!.textContent).toContain("2,900 lb at takeoff");
    expect(panel()!.querySelector(".pill.air")).toBeNull();
  });

  // @spec PANEL-HEAD-005, PANEL-STAT-003
  it("writes ? for an unknown airport, says when a leg ending in the air was last seen, and gives no direct distance", async () => {
    fakeServer({ state: STATE });
    answerDetail(UNKNOWN_DEST);
    render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(profileOf("leg-two"));
    await waitFor(() => expect(panelTitle()).toBe("KHYA → ?"));
    expect(panel()!.textContent).toContain(`last seen ${fmtTimeShort(UNKNOWN_DEST.arrived_at)}`);
    expect(panel()!.textContent).not.toMatch(/nm direct/);
  });

  // @spec PANEL-OPEN-002
  it("replaces the flight already shown", async () => {
    fakeServer({ state: STATE });
    answerDetail(LEG);
    answerDetail(UNKNOWN_DEST);
    render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(profileOf("leg-one"));
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    fireEvent.click(profileOf("leg-two"));
    await waitFor(() => expect(panelTitle()).toBe("KHYA → ?"));
  });
});

describe("a shown pending leg leaving the list (PANEL-OPEN-006)", () => {
  // @spec PANEL-OPEN-006
  it("shows the new hop when the leg is logged with Log hop here, even when the status drops the leg before the answer", async () => {
    const { server } = fakeServer({ state: STATE });
    const logged = hop({ id: 21, aircraft_id: 1, seq: 2, origin: "KBOS", dest: "KPVD", departed_at: LEG.departed_at, arrived_at: LEG.arrived_at });
    let answer!: () => void;
    answerDetail(LEG, (init) => {
      server.changes.push(`${init?.method} /api/tracker/pending/leg-one`);
      return new Promise((r) => (answer = () => r(Response.json(logged))));
    });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(profileOf("leg-one"));
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));

    const form = block("leg-one");
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log hop" }));
    await waitFor(() => expect(server.changes.length).toBe(1));
    // The status arrives first, without the leg; the panel waits for the answer.
    stub.live = liveState(trackerStatus({ pending: [UNKNOWN_DEST] }), { connection: 1 });
    rerender(<App />);
    expect(panel()).not.toBeNull();
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, logged] });
    await act(async () => answer());
    await waitFor(() => expect(panel()?.textContent).toContain("hop 2"));
    expect(panelTitle()).toBe("KBOS → KPVD");
  });

  // @spec PANEL-OPEN-006
  it("closes when the leg is discarded, or logged in another window", async () => {
    fakeServer({ state: STATE });
    answerDetail(LEG);
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(profileOf("leg-one"));
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    stub.live = liveState(trackerStatus({ pending: [UNKNOWN_DEST] }), { connection: 1 });
    rerender(<App />);
    await waitFor(() => expect(panel()).toBeNull());
  });
});

describe("the live panel's own leg (PANEL-OPEN-013, PANEL-OPEN-014)", () => {
  const DEPARTED = "2026-10-09T18:00:00.000Z";
  const flying = () =>
    trackerStatus({
      phase: "airborne",
      pending: [LEG],
      leg: { origin: "KACK", departed_at: DEPARTED, touchdown_at: null, points: 10, landings: [] } as never,
    });

  // @spec PANEL-OPEN-013, PANEL-OPEN-005
  it("stays on the live leg when a hop logged from a pending leg arrives, and follows its own leg into the logbook", async () => {
    // The live card's own Profile opens the live leg.
    stub.live = liveState(flying(), { connection: 1 });
    const { server } = fakeServer({ state: STATE });
    render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(within(document.querySelector(".live-body") as HTMLElement).getAllByRole("button", { name: "Profile" })[0]);
    await waitFor(() => expect(panel()?.querySelector(".pill.air")).not.toBeNull());

    const fromPending = hop({ id: 21, aircraft_id: 1, seq: 2, origin: "KBOS", dest: "KPVD", departed_at: LEG.departed_at });
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, fromPending] });
    await act(async () => stub.onHop!(fromPending));
    expect(panel()?.querySelector(".pill.air")).not.toBeNull();

    const own = hop({ id: 22, aircraft_id: 1, seq: 3, origin: "KACK", dest: "KHYA", departed_at: DEPARTED });
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, fromPending, own] });
    await act(async () => stub.onHop!(own));
    await waitFor(() => expect(panelTitle()).toBe("KACK → KHYA"));
  });

  // @spec PANEL-OPEN-014, LIVE-API-005
  it("after a reconnect, shows the hop its leg became while the stream was away", async () => {
    stub.live = liveState(flying(), { connection: 1 });
    const { server } = fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(within(document.querySelector(".live-body") as HTMLElement).getAllByRole("button", { name: "Profile" })[0]);
    await waitFor(() => expect(panel()?.querySelector(".pill.air")).not.toBeNull());

    const own = hop({ id: 22, aircraft_id: 1, seq: 2, origin: "KACK", dest: "KHYA", departed_at: DEPARTED });
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, own] });
    stub.live = liveState(trackerStatus({ pending: [LEG], leg: null }), { connection: 2 });
    rerender(<App />);
    await waitFor(() => expect(panelTitle()).toBe("KACK → KHYA"));
  });

  // @spec PANEL-OPEN-014
  it("stays on the live view after a reconnect when no reloaded hop is its leg's", async () => {
    stub.live = liveState(flying(), { connection: 1 });
    fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(within(document.querySelector(".live-body") as HTMLElement).getAllByRole("button", { name: "Profile" })[0]);
    await waitFor(() => expect(panel()?.querySelector(".pill.air")).not.toBeNull());
    stub.live = liveState(trackerStatus({ pending: [LEG], leg: null }), { connection: 2 });
    rerender(<App />);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(panel()?.querySelector(".pill.air")).not.toBeNull();
  });

});
