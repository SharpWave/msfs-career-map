/**
 * The page and the server it talks to: the starting state while the server's start-up work runs
 * (APP-UI-030), the airport-data notice (APP-UI-031), reloading for another version or another
 * logbook (APP-UI-036, APP-UI-042, APP-API-005), and the reload of the map and lists on a reconnect
 * (LIVE-API-005) with the planner's results kept or dropped (PLAN-RUN-006, PLAN-RUN-007). The map
 * and the tracker stream are stood in for; the stream's reconnects are played by `live.connection`.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveState } from "../../src/client/tracker.ts";
import type { AppState } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, liveState, planResult, trackerStatus } from "../support/page-data.ts";
import { PACKAGE_VERSION, answerChange, fakeServer, statusBody } from "../support/page-server.ts";

const stub = vi.hoisted(() => ({
  map: null as null | { plan: unknown; data: { hops?: unknown } },
  live: null as unknown as LiveState,
  reloads: 0,
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
  reloadPage: () => {
    stub.reloads++;
  },
}));

const { App } = await import("../../src/client/App.tsx");
const { PAGE_VERSION } = await import("../../src/client/version.ts");
const { PAGE_TIMING } = await import("../../src/client/notices.ts");

const comanche = aircraft({ id: 1 });
const HOPS = [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" })];
const STATE: AppState = appState({ aircraft: [comanche], hops: HOPS });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const saved = { ...PAGE_TIMING };
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stub.live = liveState(trackerStatus(), { connection: 1 });
  stub.map = null;
  stub.reloads = 0;
  // Quick polls; the defaults are checked on their own.
  Object.assign(PAGE_TIMING, { startingRetryMs: 50, airportPollMs: 50, restartPollMs: 50, restartGiveUpMs: 400 });
});
afterEach(() => {
  Object.assign(PAGE_TIMING, saved);
});

/** Another connection of the tracker stream, with the status the server sent as it opened. */
function reconnect(rerender: (ui: React.ReactElement) => void) {
  stub.live = { ...stub.live, connection: stub.live.connection + 1, online: true };
  rerender(<App />);
}

describe("the page's built version (APP-API-005)", () => {
  // @spec APP-API-005
  it("is package.json's version, and polls as the spec says by default", () => {
    expect(PAGE_VERSION).toBe(PACKAGE_VERSION);
    expect(saved).toEqual({ startingRetryMs: 1000, airportPollMs: 2000, restartPollMs: 1000, restartGiveUpMs: 60_000 });
  });
});

describe("starting (APP-UI-030)", () => {
  // @spec APP-UI-030, APP-UI-004
  it("shows the start-up step for a 503 in place of Loading… and an error, and loads once the server is up", async () => {
    const { server } = fakeServer({ state: STATE, status: statusBody({ startup: "upgrading" }) });
    server.state = 503;
    render(<App />);
    await screen.findByText("Starting… (upgrading the logbook)");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();

    server.status = statusBody({ startup: "backing-up" });
    await screen.findByText("Starting… (backing up the logbook)");
    server.state = STATE;
    server.status = statusBody();
    await screen.findByTestId("map");
    expect(screen.queryByText(/Starting/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // @spec APP-UI-030
  it("names each start-up step", async () => {
    const { startingText } = await import("../../src/client/notices.ts");
    expect(startingText("opening")).toBe("Starting… (opening the logbook)");
    expect(startingText("bringing-in")).toBe("Starting… (bringing in the logbook)");
    expect(startingText("backing-up")).toBe("Starting… (backing up the logbook)");
    expect(startingText("upgrading")).toBe("Starting… (upgrading the logbook)");
    expect(startingText(null)).toBe("Starting…");
  });

  // @spec APP-UI-004
  it("still shows a server error for any other failure of the first load", async () => {
    const { server } = fakeServer({ state: STATE });
    server.state = 500;
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Server error");
  });

  // @spec APP-UI-030, APP-UI-036
  it("checks the server's version once a load is answered after a 503, reloading for another", async () => {
    const { server } = fakeServer({ state: STATE, status: statusBody({ startup: "opening" }) });
    server.state = 503;
    render(<App />);
    await screen.findByText("Starting… (opening the logbook)");
    server.state = STATE;
    server.status = statusBody({ version: "9.9.9" });
    await waitFor(() => expect(stub.reloads).toBe(1));
  });
});

describe("the airport-data notice (APP-UI-031)", () => {
  // @spec APP-UI-031
  it("words each step of airport preparation, and says nothing while waiting or done", async () => {
    const { airportNotice } = await import("../../src/client/notices.ts");
    const tail = " Airport searches work once this finishes.";
    expect(airportNotice({ state: "seeding" })).toBe(`Preparing airport data: copying the airport lists.${tail}`);
    expect(airportNotice({ state: "downloading", list: "runways" })).toBe(`Preparing airport data: downloading the runways list.${tail}`);
    expect(airportNotice({ state: "importing", list: "airports", rows: 12345, total: 80000 })).toBe(
      `Preparing airport data: importing airports: 12,345 of 80,000.${tail}`,
    );
    expect(airportNotice({ state: "failed", error: "airports.csv is missing and airport downloads are off" })).toBe(
      "Airport data could not be prepared: airports.csv is missing and airport downloads are off",
    );
    expect(airportNotice({ state: "waiting" })).toBeNull();
    expect(airportNotice({ state: "done" })).toBeNull();
  });

  // @spec APP-UI-031, APP-API-009
  it("follows the preparation as it runs, a repeated one after a failure included, and goes once it is done", async () => {
    const { server, calls } = fakeServer({ state: STATE, status: statusBody({ airportData: { state: "importing", list: "airports", rows: 100, total: 2000 } }) });
    render(<App />);
    await screen.findByText(/importing airports: 100 of 2,000/);
    server.status = statusBody({ airportData: { state: "failed", error: "download of airports.csv failed: HTTP 503" } });
    await screen.findByText("Airport data could not be prepared: download of airports.csv failed: HTTP 503");
    // A daily check repeats the preparation; ready stays true throughout.
    server.status = statusBody({ ready: true, airportData: { state: "importing", list: "runways", rows: 5, total: 50 } });
    await screen.findByText(/importing runways: 5 of 50/);
    server.status = statusBody();
    await waitFor(() => expect(document.querySelector(".airport-notice")).toBeNull());
    const asked = calls("/api/status");
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(calls("/api/status")).toBe(asked);
  });

  // @spec APP-UI-031, APP-UI-020
  it("sits at the top of the clear part of the map", async () => {
    fakeServer({ state: STATE, status: statusBody({ airportData: { state: "seeding" } }) });
    render(<App />);
    const notice = await screen.findByText(/copying the airport lists/);
    expect(notice.closest(".notices")).not.toBeNull();
  });
});

describe("another version or another logbook (APP-UI-036, APP-UI-042)", () => {
  // @spec APP-UI-036
  it("reloads once for a server of another version found at a reconnect, sending no change after", async () => {
    const { server } = fakeServer({ state: STATE });
    answerChange(server, "/api/tracker/casual", () => Response.json(trackerStatus()));
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    server.status = statusBody({ version: "9.9.9" });
    reconnect(rerender);
    await waitFor(() => expect(stub.reloads).toBe(1));
    expect(sessionStorage.getItem("msfs-career-map.reloadedFor")).toBe("9.9.9");
    fireEvent.click(screen.getByRole("switch", { name: /Casual/ }));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(server.changes).toEqual([]);
  });

  // @spec APP-UI-036
  it("after its one reload for that version, shows the notice instead and goes on working", async () => {
    sessionStorage.setItem("msfs-career-map.reloadedFor", "9.9.9");
    const { server } = fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    server.status = statusBody({ version: "9.9.9" });
    reconnect(rerender);
    await screen.findByText(`This page is version ${PAGE_VERSION}; the server runs version 9.9.9. Reload the page once it is rebuilt.`);
    expect(stub.reloads).toBe(0);
  });

  // @spec APP-UI-036
  it("does nothing at a reconnect to a server of the same version", async () => {
    fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    reconnect(rerender);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(stub.reloads).toBe(0);
    expect(screen.queryByText(/This page is version/)).toBeNull();
  });

  // @spec APP-UI-042
  it("reloads, sending no change, when the server holds another logbook after a reconnect, before taking in the reload", async () => {
    const { server, calls } = fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    const loads = calls("/api/state");
    server.status = statusBody({ logbookId: "ffffeeeeddddcccc" });
    // Reloaded for this version already: the logbook check reloads all the same.
    sessionStorage.setItem("msfs-career-map.reloadedFor", PAGE_VERSION);
    reconnect(rerender);
    await waitFor(() => expect(stub.reloads).toBe(1));
    expect(calls("/api/state")).toBe(loads);
  });
});

describe("a reconnect's reload (LIVE-API-005, PLAN-RUN-006, PLAN-RUN-007)", () => {
  // @spec LIVE-API-005
  it("reloads the map and the lists on every reconnect after the first, without a toast", async () => {
    const { server, calls } = fakeServer({ state: STATE });
    const { rerender } = render(<App />);
    await screen.findByTestId("map");
    const loads = calls("/api/state");
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" })] });
    reconnect(rerender);
    await waitFor(() => expect(calls("/api/state")).toBe(loads + 1));
    fireEvent.click(screen.getByRole("button", { name: "Career Map" }));
    await waitFor(() => expect(screen.getByRole("menu").textContent).toContain("1 aircraft · 2 hops"));
    expect(screen.queryByRole("status", { name: /Logged/ })).toBeNull();
    expect(document.querySelector(".toast")).toBeNull();
  });

  /** A page with a planner result for the Comanche on screen. */
  async function withPlan() {
    const f = fakeServer({ state: STATE });
    answerFetch(/\/api\/plan\?/, () => Response.json(planResult(1, ["KHYA", "KACK"])));
    const r = render(<App />);
    await screen.findByTestId("map");
    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    await waitFor(() => expect(stub.map?.plan).not.toBeNull());
    return { ...f, ...r };
  }

  // @spec PLAN-RUN-006, LIVE-API-005
  it("keeps the planner's result when the reload brings no hop the page did not hold", async () => {
    const { rerender, calls } = await withPlan();
    const loads = calls("/api/state");
    reconnect(rerender);
    await waitFor(() => expect(calls("/api/state")).toBe(loads + 1));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(stub.map?.plan).not.toBeNull();
  });

  // @spec PLAN-RUN-007, LIVE-API-005
  it("drops the planner's result when the reload brings a hop logged while the stream was away", async () => {
    const { server, rerender } = await withPlan();
    server.state = appState({ aircraft: [comanche], hops: [...HOPS, hop({ id: 12, aircraft_id: 1, seq: 2, origin: "KPVD", dest: "KHYA" })] });
    reconnect(rerender);
    await waitFor(() => expect(stub.map?.plan).toBeNull());
  });
});

