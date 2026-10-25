/**
 * The hand-off fragment (`#hop=<id>`, `#pending=<id>`): acted on only on fresh state from the server
 * (APP-UI-032), opening the leg in the live card and the flight panel (APP-UI-033, LIVE-CARD-015,
 * PANEL-OPEN-010) or the hop in the flight panel with the map fitted (APP-UI-034, PANEL-OPEN-009),
 * and an id that names nothing leaving all as it was (APP-UI-035, PANEL-OPEN-011).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveState } from "../../src/client/tracker.ts";
import type { AppState, PendingLeg } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, liveState, pendingLeg, trackerStatus } from "../support/page-data.ts";
import { fakeServer } from "../support/page-server.ts";

const stub = vi.hoisted(() => ({
  map: null as null | { focus: { key: number; points: unknown[] } | null },
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
const HOPS = [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }), hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" })];
const STATE: AppState = appState({ aircraft: [comanche], hops: HOPS });
const LEG: PendingLeg = pendingLeg({ id: "leg-one", origin: "KBOS", dest: "KPVD" });
const OTHER: PendingLeg = pendingLeg({ id: "leg-two", origin: "KHYA", dest: null, departed_at: "2026-10-09T16:00:00.000Z", arrived_at: "2026-10-09T16:30:00.000Z" });

const scrolled: Element[] = [];

function answerPending(leg: PendingLeg) {
  const { points: _points, ...rest } = leg;
  answerFetch(`/api/tracker/pending/${leg.id}`, () => Response.json({ ...rest, track: [], briefing: null }));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  stub.live = liveState(trackerStatus({ pending: [LEG, OTHER] }), { connection: 1 });
  stub.map = null;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const setHash = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};
const panelTitle = () => document.querySelector(".flight-panel .route")?.textContent ?? null;
const toast = () => document.querySelector(".toast")?.textContent ?? null;
const sidebar = () => document.querySelector(".sidebar") as HTMLElement;
const shown = (el: Element) => el.closest("[hidden]") === null;

describe("acting only on fresh state (APP-UI-032)", () => {
  // @spec APP-UI-032, APP-UI-034, PANEL-OPEN-009
  it("acts on a fragment in the address at load once the map state and the stream's status are in, then clears it", async () => {
    window.history.replaceState(null, "", "/#hop=12");
    fakeServer({ state: STATE });
    render(<App />);
    await waitFor(() => expect(panelTitle()).toBe("KPVD → KHYA"));
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/");
  });

  // @spec APP-UI-032
  it("waits while the event stream is away, keeping the fragment, and acts once it is open with its status", async () => {
    stub.live = liveState(null, { online: false, connection: 0 });
    window.history.replaceState(null, "", "/#hop=11");
    fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(panelTitle()).toBeNull();
    expect(window.location.hash).toBe("#hop=11");

    stub.live = liveState(trackerStatus({ pending: [LEG] }), { connection: 1 });
    rerender(<App />);
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    expect(window.location.hash).toBe("");
  });

  // @spec APP-UI-032, APP-UI-035
  it("waits for a reconnect's reload, so a hop logged while the stream was away is found", async () => {
    const { server } = fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    // The stream comes back; its reload is held while the fragment arrives.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const newer = appState({ aircraft: [comanche], hops: [...HOPS, hop({ id: 13, aircraft_id: 1, seq: 3, origin: "KHYA", dest: "KACK" })] });
    server.state = async () => {
      await held;
      return newer;
    };
    stub.live = { ...stub.live, connection: 2 };
    rerender(<App />);
    await setHash("#hop=13");
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(panelTitle()).toBeNull();
    expect(toast()).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(panelTitle()).toBe("KHYA → KACK"));
  });

  // @spec APP-UI-032
  it("acts again when the fragment changes, and when the same one is set again", async () => {
    fakeServer({ state: STATE });
    render(<App />);
    await screen.findByTestId("map");
    await setHash("#hop=11");
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    fireEvent.click(screen.getByRole("button", { name: "Close the flight panel" }));
    await setHash("#hop=11");
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    await setHash("#hop=12");
    await waitFor(() => expect(panelTitle()).toBe("KPVD → KHYA"));
  });
});

describe("#hop= (APP-UI-034, PANEL-OPEN-009)", () => {
  // @spec APP-UI-034, PANEL-OPEN-009, MAP-ZOOM-004
  it("shows the hop in the flight panel, replacing what it showed, fits the map to it, and leaves the left column as it is", async () => {
    fakeServer({ state: STATE });
    render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(screen.getByRole("button", { name: "Career Map" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Fleet" }));
    await setHash("#hop=11");
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    const before = stub.map?.focus?.key ?? 0;
    await setHash("#hop=12");
    await waitFor(() => expect(panelTitle()).toBe("KPVD → KHYA"));
    expect(stub.map?.focus?.key).toBeGreaterThan(before);
    // The Fleet drawer is still the one showing.
    expect(shown(document.querySelector('section.drawer[aria-label="Fleet"]')!)).toBe(true);
  });
});

describe("#pending= (APP-UI-033, LIVE-CARD-015, PANEL-OPEN-010)", () => {
  // @spec APP-UI-033, LIVE-CARD-015, PANEL-OPEN-010
  it("shows the sidebar, opens a collapsed live card at that leg's block, and shows the leg in the flight panel", async () => {
    localStorage.setItem("card.live", "0");
    fakeServer({ state: STATE });
    answerPending(OTHER);
    render(<App />);
    await screen.findByTestId("map");
    // A drawer open and the column hidden: the hand-off shows the sidebar, the drawer stays mounted.
    fireEvent.click(screen.getByRole("button", { name: "Career Map" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Fleet" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    await setHash("#pending=leg-two");
    await waitFor(() => expect(panelTitle()).toBe("KHYA → ?"));
    expect((document.querySelector(".left-column") as HTMLElement).hidden).toBe(false);
    expect(shown(sidebar())).toBe(true);
    expect(document.querySelector('section.drawer[aria-label="Fleet"]')).not.toBeNull();
    const card = document.querySelector(".card-live") as HTMLElement;
    expect(card.classList.contains("collapsed")).toBe(false);
    const block = document.querySelector('.pending[data-pending-id="leg-two"]');
    expect(block).not.toBeNull();
    expect(scrolled).toContain(block);
    expect(window.location.hash).toBe("");
  });

  // @spec LIVE-CARD-015
  it("brings the block into view again for a second hand-off of the same leg", async () => {
    fakeServer({ state: STATE });
    answerPending(LEG);
    render(<App />);
    await screen.findByTestId("map");
    await setHash("#pending=leg-one");
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));
    const n = scrolled.length;
    await setHash("#pending=leg-one");
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(n));
  });
});

describe("an id that names nothing (APP-UI-035, PANEL-OPEN-011)", () => {
  // @spec APP-UI-035, PANEL-OPEN-011
  it("leaves the open flight and the column as they were, with a toast for a hop or a leg", async () => {
    fakeServer({ state: STATE });
    render(<App />);
    await screen.findByTestId("map");
    await setHash("#hop=11");
    await waitFor(() => expect(panelTitle()).toBe("KBOS → KPVD"));

    await setHash("#hop=999");
    await waitFor(() => expect(toast()).toBe("That hop no longer exists"));
    expect(panelTitle()).toBe("KBOS → KPVD");
    expect(window.location.hash).toBe("");

    await setHash("#pending=gone-already");
    await waitFor(() => expect(toast()).toBe("That leg has already been logged or discarded"));
    expect(panelTitle()).toBe("KBOS → KPVD");
  });

  // @spec PANEL-OPEN-011
  it("keeps the panel closed when it was", async () => {
    fakeServer({ state: STATE });
    render(<App />);
    await screen.findByTestId("map");
    await setHash("#pending=gone-already");
    await waitFor(() => expect(toast()).toBe("That leg has already been logged or discarded"));
    expect(document.querySelector(".flight-panel")).toBeNull();
    expect(within(document.body).queryByText(/Close the flight panel/)).toBeNull();
  });
});

describe("parsing the fragment (APP-UI-032)", () => {
  // @spec APP-UI-032
  it("reads #hop= with a positive whole id and #pending= with any id, and nothing else", async () => {
    const { parseFragment } = await import("../../src/client/navigation.ts");
    expect(parseFragment("#hop=12")).toEqual({ kind: "hop", id: 12 });
    expect(parseFragment("#pending=6f1c2b9e-4d3a")).toEqual({ kind: "pending", id: "6f1c2b9e-4d3a" });
    expect(parseFragment("#pending=a%20b")).toEqual({ kind: "pending", id: "a b" });
    for (const h of ["", "#", "#hop=", "#hop=0", "#hop=-3", "#hop=1.5", "#hop=x", "#pending=", "#plan=1", "hop=3"]) expect(parseFragment(h), h).toBeNull();
  });
});
