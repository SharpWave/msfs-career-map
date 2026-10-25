/**
 * The page's logbook entries: **Back up now** (APP-UI-037) and the **Bring in a logbook** drawer —
 * in the menu and opened at load (APP-UI-038), what it lists and asks (APP-UI-039), and waiting for
 * the server to come back with the logbook (APP-UI-040).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtDate, fmtDateTime } from "../../src/client/format.ts";
import type { LiveState } from "../../src/client/tracker.ts";
import type { AppState } from "../../src/client/types.ts";
import { resetAnswers } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, liveState, trackerStatus } from "../support/page-data.ts";
import { answerChange, fakeServer, statusBody, type OfferBody } from "../support/page-server.ts";

const stub = vi.hoisted(() => ({ live: null as unknown as LiveState, reloads: 0 }));

vi.mock("../../src/client/components/MapView.tsx", () => ({ MapView: () => <div data-testid="map" /> }));
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
const { PAGE_TIMING } = await import("../../src/client/notices.ts");

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const comanche = aircraft({ id: 1 });
const tbm = aircraft({ id: 2, name: "TBM 850" });
const EMPTY: AppState = appState({ aircraft: [comanche, tbm], hops: [] });
const FLOWN: AppState = appState({ aircraft: [comanche], hops: [hop({ id: 11, aircraft_id: 1, origin: "KBOS", dest: "KPVD" })] });
const OFFERED: OfferBody = {
  hops: 0,
  aircraft: 2,
  offers: [
    { kind: "folder", folder: "C:\\dev\\msfs-career-map\\data", hops: 214, newestHop: "2026-10-20T18:40:00.000Z" },
    { kind: "backup", file: "career-20261019T081500Z-daily-0123456789abcdef.db", time: "2026-10-19T08:15:00.000Z", hops: 180, newestHop: null },
  ],
  lastAttempt: null,
};

const saved = { ...PAGE_TIMING };
beforeEach(() => {
  localStorage.clear();
  stub.live = liveState(trackerStatus(), { connection: 1 });
  stub.reloads = 0;
  Object.assign(PAGE_TIMING, { restartPollMs: 20, restartGiveUpMs: 300 });
});
afterEach(() => {
  Object.assign(PAGE_TIMING, saved);
  vi.restoreAllMocks();
});

const menuItems = () => {
  fireEvent.click(screen.getByRole("button", { name: "Career Map" }));
  return screen.getAllByRole("menuitem").map((m) => m.textContent);
};
const drawer = () => document.querySelector('section.drawer[aria-label="Bring in a logbook"]') as HTMLElement | null;
const shown = (el: Element | null) => el !== null && el.closest("[hidden]") === null;
const toast = () => document.querySelector(".toast")?.textContent ?? null;

describe("Back up now (APP-UI-037)", () => {
  // @spec APP-UI-037, APP-UI-012
  it("closes the menu, asks the server for a backup and says where it went", async () => {
    const { server } = fakeServer({ state: FLOWN });
    answerChange(server, "/api/backups", () => Response.json({ file: "career-20261025T120000Z-manual-0123456789abcdef.db" }, { status: 201 }));
    render(<App />);
    await screen.findByTestId("map");
    expect(menuItems()).toEqual(["Log a hop", "Fleet", "Back up now"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Back up now" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(toast()).toBe("Backed up to career-20261025T120000Z-manual-0123456789abcdef.db"));
    expect(server.changes).toEqual(["POST /api/backups"]);
  });

  // @spec APP-UI-037, APP-BAK-008
  it("shows the full reason when the backup fails", async () => {
    const { server } = fakeServer({ state: FLOWN });
    const reason = "Windows refused the write (Controlled folder access?) — C:\\Users\\pilot\\Documents\\MSFS Career Map\\Backups: EPERM";
    answerChange(server, "/api/backups", () => Response.json({ error: reason, short: "Windows refused the write (Controlled folder access?)" }, { status: 500 }));
    render(<App />);
    await screen.findByTestId("map");
    menuItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back up now" }));
    await waitFor(() => expect(toast()).toBe(`Backup failed: ${reason}`));
  });
});

describe("the Bring in a logbook entry (APP-UI-038)", () => {
  // @spec APP-UI-038
  it("is in the menu only while the logbook holds no hops", async () => {
    fakeServer({ state: EMPTY });
    const r = render(<App />);
    await screen.findByTestId("map");
    expect(menuItems()).toEqual(["Log a hop", "Fleet", "Bring in a logbook", "Back up now"]);
    r.unmount();
    resetAnswers();
    fakeServer({ state: FLOWN });
    render(<App />);
    await screen.findByTestId("map");
    expect(menuItems()).not.toContain("Bring in a logbook");
  });

  // @spec APP-UI-038, APP-UI-013
  it("opens the drawer when the page loads and something is offered", async () => {
    fakeServer({ state: EMPTY, offer: OFFERED });
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
  });

  // @spec APP-UI-038
  it("does not open it at load when nothing is offered, and opens it from the menu", async () => {
    fakeServer({ state: EMPTY });
    render(<App />);
    await screen.findByTestId("map");
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(shown(drawer())).toBe(false);
    menuItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Bring in a logbook" }));
    expect(shown(drawer())).toBe(true);
    expect(drawer()!.textContent).toContain("This replaces the logbook here: 2 aircraft, no hops.");
  });
});

describe("the Bring in a logbook drawer (APP-UI-039)", () => {
  // @spec APP-UI-039
  it("lists each logbook offered with its hop count and newest hop, and what bringing one in replaces", async () => {
    fakeServer({ state: EMPTY, offer: OFFERED });
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
    const text = drawer()!.textContent!;
    expect(text).toContain("C:\\dev\\msfs-career-map\\data");
    expect(text).toContain(`214 hops · newest ${fmtDate("2026-10-20T18:40:00.000Z")}`);
    expect(text).toContain(`Backup of ${fmtDateTime("2026-10-19T08:15:00.000Z")}`);
    expect(text).toContain("180 hops");
    expect(text).toContain("This replaces the logbook here: 2 aircraft, no hops.");
    expect(within(drawer()!).getAllByRole("button", { name: "Bring in" })).toHaveLength(3);
    expect((within(drawer()!).getByRole("textbox", { name: "Another folder" }) as HTMLInputElement).value).toBe("");
  });

  // @spec APP-UI-039
  it("asks before bringing one in, and asks the server nothing when the pilot declines", async () => {
    const { server } = fakeServer({ state: EMPTY, offer: OFFERED });
    answerChange(server, "/api/logbook/import", () => Response.json({ restart: "automatic" }, { status: 202 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
    fireEvent.click(within(drawer()!).getAllByRole("button", { name: "Bring in" })[1]);
    expect(confirm).toHaveBeenCalledWith(`Bring in the backup of ${fmtDateTime("2026-10-19T08:15:00.000Z")}? This replaces the logbook here (2 aircraft, no hops).`);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(server.changes).toEqual([]);
  });

  // @spec APP-UI-039, APP-IMP-002
  it("shows a refusal's reason in the drawer, asking with the folder typed in", async () => {
    const { server } = fakeServer({ state: EMPTY, offer: OFFERED });
    answerChange(server, "/api/logbook/import", () => Response.json({ error: "Close the MSFS Career Map running on that folder first" }, { status: 409 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
    const field = within(drawer()!).getByRole("textbox", { name: "Another folder" });
    fireEvent.change(field, { target: { value: "D:\\old\\data" } });
    const buttons = within(drawer()!).getAllByRole("button", { name: "Bring in" });
    fireEvent.click(buttons[buttons.length - 1]);
    await within(drawer()!).findByText("Close the MSFS Career Map running on that folder first");
    expect(server.changes).toEqual([`POST /api/logbook/import {"folder":"D:\\\\old\\\\data"}`]);
  });

  // @spec APP-UI-039, APP-IMP-005
  it("says when the last logbook was not brought in, and why", async () => {
    fakeServer({ state: EMPTY, offer: { ...OFFERED, lastAttempt: { outcome: "not-brought-in", reason: "the logbook here held hops by then", at: "2026-10-25T07:00:00.000Z" } } });
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
    expect(drawer()!.textContent).toContain("The last logbook was not brought in: the logbook here held hops by then");
  });
});

describe("waiting for the logbook to come in (APP-UI-040)", () => {
  async function accepted(restart: "automatic" | "manual") {
    const f = fakeServer({ state: EMPTY, offer: OFFERED, status: statusBody({ pid: 100 }) });
    answerChange(f.server, "/api/logbook/import", () => Response.json({ restart }, { status: 202 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(shown(drawer())).toBe(true));
    fireEvent.click(within(drawer()!).getAllByRole("button", { name: "Bring in" })[0]);
    await within(drawer()!).findByText("Bringing in the logbook…");
    expect(f.server.changes).toEqual([`POST /api/logbook/import {"folder":"C:\\\\dev\\\\msfs-career-map\\\\data"}`]);
    return f;
  }

  // @spec APP-UI-040
  it("reloads once the server answers with another process id and its start-up done, not before", async () => {
    const { server } = await accepted("automatic");
    // The old server is exiting, then the new one starts.
    server.status = "down";
    await act(() => new Promise((r) => setTimeout(r, 60)));
    server.status = statusBody({ pid: 100 });
    await act(() => new Promise((r) => setTimeout(r, 60)));
    server.status = statusBody({ pid: 200, startup: "bringing-in" });
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(stub.reloads).toBe(0);
    server.status = statusBody({ pid: 200, startup: "done" });
    await waitFor(() => expect(stub.reloads).toBe(1));
  });

  // @spec APP-UI-040
  it("stops asking after the wait and says to reload once the app runs again", async () => {
    const { server, calls } = await accepted("automatic");
    server.status = "down";
    await within(drawer()!).findByText(
      "Bringing in the logbook is taking longer than expected. Reload the page once MSFS Career Map is running again.",
    );
    const asked = calls("/api/status");
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(calls("/api/status")).toBe(asked);
    expect(stub.reloads).toBe(0);
  });

  // @spec APP-UI-040
  it("says to start the server again when it will not start again by itself", async () => {
    const { calls } = await accepted("manual");
    await within(drawer()!).findByText("Start the server again to finish bringing in the logbook.");
    const asked = calls("/api/status");
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(calls("/api/status")).toBe(asked);
  });
});
