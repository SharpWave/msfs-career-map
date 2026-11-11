/**
 * The aircraft panel by itself (src/client/components/AircraftPanel.tsx): header and picture, the two
 * map toggles, the tour block, the actions, the hop list and its SimBrief plans. What opens and
 * closes it, and what its actions hand off to, is the page's (page.test.tsx).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtDate, fmtDateTime } from "../../src/client/format.ts";
import type { Aircraft, AppState, Hop, HopStats, PlanDigestEntry } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, touchdown } from "../support/page-data.ts";

// A landing of exactly 666 fpm makes the badge throw, to try the panel's error boundary.
vi.mock("../../src/client/components/LandingBadge.tsx", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/client/components/LandingBadge.tsx")>();
  return {
    LandingBadge: (p: Parameters<typeof real.LandingBadge>[0]) => {
      if (p.landing.fpm === 666) throw new Error("bad landing");
      return real.LandingBadge(p);
    },
  };
});

const { AircraftPanel } = await import("../../src/client/components/AircraftPanel.tsx");
type PanelProps = Parameters<typeof AircraftPanel>[0];

const stats = (over: Partial<HopStats>): string =>
  JSON.stringify({ fuel_start_lb: null, fuel_end_lb: null, fuel_used_lb: null, weight_start_lb: null, weight_end_lb: null, max_alt_ft: null, max_gs_kts: null, flown_nm: null, ...over });

const comanche = aircraft({ id: 1 });
const tbm = aircraft({ id: 2, name: "TBM 850", livery: "Feather Red", color: "#cdd4d5" });
const cub = aircraft({ id: 3, name: "Piper Cub", livery: "NC1776", color: "#ffd23f", visible: 0 });

const TOUR: Hop[] = [
  hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" }),
  hop({
    id: 12,
    aircraft_id: 1,
    seq: 2,
    origin: "KPVD",
    dest: "KHYA",
    departed_at: "2026-10-20T14:00:00.000Z",
    arrived_at: "2026-10-20T14:40:00.000Z",
    duration_min: 38,
    stats: stats({ flown_nm: 61.2, fuel_used_lb: 100.4 }),
    landings: JSON.stringify([touchdown(0, 90, "butter")]),
    briefing_id: 7,
    notes: "Smooth air over the bay.",
  }),
  hop({
    id: 13,
    aircraft_id: 1,
    seq: 3,
    origin: "KHYA",
    dest: "KACK",
    departed_at: "2026-10-25T23:14:00.000Z",
    arrived_at: "2026-10-25T23:44:00.000Z",
    stats: stats({ flown_nm: 30, fuel_used_lb: 61 }),
    landings: JSON.stringify([touchdown(0, 310, "hard"), touchdown(4, 60, "butter")]),
  }),
  hop({
    id: 14,
    aircraft_id: 1,
    seq: 4,
    origin: "KACK",
    dest: "KHYA",
    arrived_at: "2026-11-02T18:05:00.000Z",
    duration_min: 20,
    stats: stats({ flown_nm: 31, fuel_used_lb: 0 }),
    landings: JSON.stringify([touchdown(0, 85, "butter")]),
  }),
];
const OTHERS: Hop[] = [hop({ id: 21, aircraft_id: 2, seq: 1, origin: "KBOS", dest: "KACK" })];
const STATE = appState({ aircraft: [comanche, tbm, cub], hops: [...TOUR, ...OTHERS] });

const DIGEST: PlanDigestEntry[] = [
  { hop_id: 12, id: 7, ete_min: 35, fuel: { units: "lbs", burn: 96 }, pdf_url: "https://www.simbrief.com/ofp/flightplans/KPVDKHYA_PDF_1.pdf" },
];

function props(over: Partial<PanelProps> = {}): PanelProps {
  return {
    aircraft: comanche,
    state: STATE,
    currentHopId: null,
    reveal: null,
    listAlone: true,
    reload: async () => {},
    onClose: vi.fn(),
    onOpenHop: vi.fn(),
    onMarkHop: vi.fn(),
    onPlanNext: vi.fn(),
    onLogHop: vi.fn(),
    onZoomTour: vi.fn(),
    onEditAircraft: vi.fn(),
    ...over,
  };
}

/** What the plan digest is answered with now, and the requests for it so far in this test. */
const plans = { digest: DIGEST as PlanDigestEntry[] | number, asked: [] as string[] };

/** Render the panel, the plan digest answered with `digest` (or failing when it is a status). */
function renderPanel(over: Partial<PanelProps> = {}, digest: PlanDigestEntry[] | number = DIGEST) {
  plans.digest = digest;
  const asked = plans.asked;
  const p = props(over);
  const r = render(<AircraftPanel {...p} />);
  return { ...r, p, asked, rerender: (next: Partial<PanelProps>) => r.rerender(<AircraftPanel {...p} {...next} />) };
}

const panel = () => document.querySelector(".aircraft-panel") as HTMLElement;
const rows = () => Array.from(panel().querySelectorAll<HTMLElement>(".acp-list > li"));
const rowButton = (li: HTMLElement) => li.querySelector(".acp-row") as HTMLButtonElement;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** The tour block's value for a line, by its label. */
const tourLine = (label: string) => {
  const dt = Array.from(panel().querySelectorAll(".acp-tour dt")).find((e) => text(e) === label);
  if (!dt) throw new Error(`no "${label}" line in the tour block`);
  return dt.nextElementSibling as HTMLElement;
};
const toggle = (name: string) => within(panel()).getByRole("button", { name }) as HTMLButtonElement;

const scrolled: Element[] = [];
beforeEach(() => {
  plans.digest = DIGEST;
  plans.asked = [];
  answerFetch(/\/api\/aircraft\/\d+\/plans$/, (url) => {
    plans.asked.push(url.pathname);
    return typeof plans.digest === "number" ? Response.json({ error: "failed" }, { status: plans.digest }) : Response.json(plans.digest);
  });
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
});

describe("the header", () => {
  // @spec ACP-HEAD-001
  it("shows the badge, name and livery, where the aircraft is parked, Edit aircraft and a close button", () => {
    const { p } = renderPanel();
    const head = panel().querySelector(".acp-head") as HTMLElement;
    expect(head.querySelector(".plane-head svg")).not.toBeNull();
    expect(text(head.querySelector(".name"))).toBe("Piper Comanche 250");
    expect(text(head.querySelector(".code"))).toBe("N6229P");
    expect(text(panel().querySelector(".acp-parked"))).toBe("parked at KHYA · Cape Cod Gateway Airport");

    fireEvent.click(within(panel()).getByRole("button", { name: "Edit aircraft" }));
    expect(p.onEditAircraft).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel()).getByRole("button", { name: "Close the aircraft panel" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  // @spec ACP-HEAD-001
  it("reads 'no hops yet' for an aircraft without hops, and the ident alone for an airport the map state lacks", () => {
    const { unmount } = renderPanel({ aircraft: cub });
    expect(text(panel().querySelector(".acp-parked"))).toBe("no hops yet");
    unmount();

    const { KHYA: _gone, ...airports } = STATE.airports;
    renderPanel({ state: { ...STATE, airports } });
    expect(text(panel().querySelector(".acp-parked"))).toBe("parked at KHYA");
  });

  // @spec ACP-HEAD-002
  it("says when the aircraft is hidden from the map", () => {
    const { unmount } = renderPanel();
    expect(panel().textContent).not.toContain("hidden from the map");
    unmount();
    renderPanel({ aircraft: cub });
    expect(text(panel().querySelector(".acp-hidden"))).toBe("hidden from the map");
  });
});

describe("the picture", () => {
  const photographed = (icon: string): Aircraft => ({ ...comanche, icon });
  const picture = () => panel().querySelector<HTMLImageElement>(".acp-picture img");

  // @spec ACP-HEAD-003
  it("shows the aircraft's icon when it is an uploaded image or an image address, with its label as alternative text", () => {
    for (const icon of ["/images/aircraft-1.png?v=1793000000000", "https://example.org/comanche.jpg"]) {
      const { unmount } = renderPanel({ aircraft: photographed(icon) });
      expect(picture()?.getAttribute("src"), icon).toBe(icon);
      expect(picture()?.getAttribute("alt"), icon).toBe("Piper Comanche 250 · N6229P");
      unmount();
    }
  });

  // @spec ACP-HEAD-003
  it("shows no picture for an aircraft on a built-in icon", () => {
    renderPanel();
    expect(panel().querySelector(".acp-picture")).toBeNull();
  });

  // @spec ACP-HEAD-003
  it("takes no room until the image has loaded", () => {
    renderPanel({ aircraft: photographed("/images/aircraft-1.png?v=1") });
    const box = panel().querySelector(".acp-picture") as HTMLElement;
    expect(box.classList.contains("loaded")).toBe(false);
    fireEvent.load(picture()!);
    expect(box.classList.contains("loaded")).toBe(true);
  });

  // @spec ACP-HEAD-004
  it("is left out when the image does not load, and tried again when the icon changes", () => {
    const { rerender } = renderPanel({ aircraft: photographed("/images/aircraft-1.png?v=1") });
    fireEvent.error(picture()!);
    expect(panel().querySelector(".acp-picture")).toBeNull();

    rerender({ aircraft: photographed("/images/aircraft-1.png?v=2") });
    expect(picture()?.getAttribute("src")).toBe("/images/aircraft-1.png?v=2");
  });
});

describe("hiding aircraft", () => {
  const withFlags = (flags: Record<number, number>): AppState => ({ ...STATE, aircraft: STATE.aircraft.map((a) => ({ ...a, visible: flags[a.id] ?? a.visible })) });
  /** Answers changes to the flags, recording each as "METHOD path body". */
  function answerChanges(reply: () => Response | Promise<Response> = () => Response.json([])) {
    const sent: string[] = [];
    answerFetch(/\/api\/aircraft\/(\d+|visibility)$/, async (url, init) => {
      sent.push(`${init?.method} ${url.pathname} ${String(init?.body)}`);
      return reply();
    });
    return sent;
  }

  // @spec ACP-VIS-001
  it("offers Hide this plane, on while its aircraft is hidden", () => {
    const { unmount } = renderPanel();
    expect(toggle("Hide this plane").getAttribute("aria-pressed")).toBe("false");
    unmount();
    renderPanel({ aircraft: cub });
    expect(toggle("Hide this plane").getAttribute("aria-pressed")).toBe("true");
  });

  // @spec ACP-VIS-001
  it("hides or shows its own aircraft only", async () => {
    const sent = answerChanges(() => Response.json(comanche));
    const reload = vi.fn(async () => {});
    const { unmount } = renderPanel({ reload });
    fireEvent.click(toggle("Hide this plane"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(['PUT /api/aircraft/1 {"visible":false}']);
    unmount();

    renderPanel({ aircraft: cub, reload });
    fireEvent.click(toggle("Hide this plane"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(sent[1]).toBe('PUT /api/aircraft/3 {"visible":true}');
  });

  // @spec ACP-VIS-002
  it("offers Hide other planes, on only while every other aircraft is hidden", () => {
    const { unmount } = renderPanel();
    // the TBM is shown, the Cub hidden
    expect(toggle("Hide other planes").getAttribute("aria-pressed")).toBe("false");
    unmount();
    const { unmount: again } = renderPanel({ state: withFlags({ 2: 0, 3: 0 }) });
    expect(toggle("Hide other planes").getAttribute("aria-pressed")).toBe("true");
    again();
    // its own flag does not count
    const hiddenSelf = withFlags({ 1: 0, 2: 0, 3: 0 });
    renderPanel({ state: hiddenSelf, aircraft: hiddenSelf.aircraft[0] });
    expect(toggle("Hide other planes").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("Hide this plane").getAttribute("aria-pressed")).toBe("true");
  });

  // @spec ACP-VIS-002
  it("is disabled while the fleet holds no other aircraft", () => {
    renderPanel({ state: appState({ aircraft: [comanche], hops: TOUR }) });
    expect(toggle("Hide other planes").disabled).toBe(true);
    expect(toggle("Hide other planes").getAttribute("aria-pressed")).toBe("false");
    expect(toggle("Hide this plane").disabled).toBe(false);
  });

  // @spec ACP-VIS-002
  it("hides, or shows, every other aircraft in one request that names only its own", async () => {
    const sent = answerChanges();
    const reload = vi.fn(async () => {});
    const { unmount } = renderPanel({ reload });
    fireEvent.click(toggle("Hide other planes"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(['PUT /api/aircraft/visibility {"visible":false,"except":1}']);
    unmount();

    renderPanel({ reload, state: withFlags({ 2: 0, 3: 0 }) });
    fireEvent.click(toggle("Hide other planes"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(sent[1]).toBe('PUT /api/aircraft/visibility {"visible":true,"except":1}');
  });

  // @spec ACP-VIS-003
  it("disables both toggles until the server has answered and the map state has loaded again", async () => {
    let answer!: () => void;
    answerChanges(() => new Promise<Response>((r) => (answer = () => r(Response.json(comanche)))));
    let loaded!: () => void;
    const reload = vi.fn(() => new Promise<void>((r) => (loaded = r)));
    renderPanel({ reload });

    fireEvent.click(toggle("Hide this plane"));
    expect(toggle("Hide this plane").disabled).toBe(true);
    expect(toggle("Hide other planes").disabled).toBe(true);
    // still as the map state has it
    expect(toggle("Hide this plane").getAttribute("aria-pressed")).toBe("false");

    await act(async () => answer());
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(toggle("Hide this plane").disabled).toBe(true);

    await act(async () => loaded());
    await waitFor(() => expect(toggle("Hide this plane").disabled).toBe(false));
    expect(toggle("Hide other planes").disabled).toBe(false);
  });

  // @spec ACP-VIS-004
  it("shows a failed change under the toggles until a later change succeeds", async () => {
    let fail = true;
    answerChanges(() => (fail ? Response.json({ error: "the logbook is busy" }, { status: 500 }) : Response.json(comanche)));
    const reload = vi.fn(async () => {});
    renderPanel({ reload });

    fireEvent.click(toggle("Hide this plane"));
    const alert = await within(panel()).findByRole("alert");
    expect(text(alert)).toBe("Could not change what the map shows: the logbook is busy");
    expect(reload).not.toHaveBeenCalled();
    expect(toggle("Hide this plane").disabled).toBe(false);

    fail = false;
    fireEvent.click(toggle("Hide other planes"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(panel()).queryByRole("alert")).toBeNull());
  });

  // @spec ACP-VIS-004
  it("drops the message when the panel shows another aircraft", async () => {
    answerChanges(() => Response.json({ error: "the logbook is busy" }, { status: 500 }));
    const { rerender } = renderPanel();
    fireEvent.click(toggle("Hide this plane"));
    await within(panel()).findByRole("alert");
    rerender({ aircraft: tbm });
    expect(within(panel()).queryByRole("alert")).toBeNull();
  });

  // @spec ACP-VIS-004
  it("shows nothing for a failure answered after the panel moved to another aircraft", async () => {
    let answer!: () => void;
    answerChanges(() => new Promise<Response>((r) => (answer = () => r(Response.json({ error: "too late" }, { status: 500 })))));
    const { rerender } = renderPanel();
    fireEvent.click(toggle("Hide this plane"));
    rerender({ aircraft: tbm });
    await act(async () => answer());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(toggle("Hide this plane").disabled).toBe(false);
  });

  // @spec ACP-VIS-005
  it("stays on an aircraft that is hidden, with its hops listed", () => {
    const hiddenSelf = withFlags({ 1: 0 });
    renderPanel({ state: hiddenSelf, aircraft: hiddenSelf.aircraft[0] });
    expect(rows()).toHaveLength(4);
    expect(toggle("Hide this plane").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the tour block", () => {
  // @spec ACP-TOUR-002, ACP-TOUR-004, ACP-TOUR-006, ACP-TOUR-007
  it("shows the hops with their logged time, the distance, the fuel burned and the airports", () => {
    renderPanel();
    expect(text(tourLine("Hops"))).toBe("4 hops · 1h 28m logged");
    // 43 nm direct + 61.2 + 30 + 31 flown
    expect(text(tourLine("Distance"))).toBe("165 nm");
    expect(tourLine("Distance").querySelector("[title]")?.getAttribute("title") ?? tourLine("Distance").getAttribute("title")).toBe(
      "flown where tracked, direct otherwise",
    );
    expect(text(tourLine("Fuel burned"))).toBe("161 lb · 2 of 4 hops");
    expect(text(tourLine("Airports"))).toBe("4");
  });

  // @spec ACP-TOUR-002, ACP-TOUR-006
  it("leaves out the logged time when it is zero, and the count when every hop has a fuel figure", () => {
    const one = [hop({ id: 31, aircraft_id: 1, seq: 1, stats: stats({ flown_nm: 44, fuel_used_lb: 1234.4 }) })];
    renderPanel({ state: appState({ aircraft: [comanche], hops: one }) });
    expect(text(tourLine("Hops"))).toBe("1 hop");
    expect(text(tourLine("Fuel burned"))).toBe("1,234 lb");
  });

  // @spec ACP-TOUR-006, ACP-TOUR-008, ACP-TOUR-009, ACP-TOUR-010
  it("shows a dash or 'none recorded' for what a hand-logged tour does not have", () => {
    const { ZZZZ: _none, ...airports } = { ...STATE.airports };
    renderPanel({ state: { ...appState({ aircraft: [comanche], hops: [hop({ id: 31, aircraft_id: 1, origin: "KBOS", dest: "ZZZZ" })] }), airports } });
    expect(text(tourLine("Fuel burned"))).toBe("—");
    expect(text(tourLine("Flown"))).toBe("—");
    expect(text(tourLine("Longest hop"))).toBe("—");
    expect(text(tourLine("Landings"))).toBe("none recorded");
  });

  // @spec ACP-TOUR-008
  it("shows the dates of the earliest and latest hop, as one date when they are the same day", () => {
    const { unmount } = renderPanel();
    expect(text(tourLine("Flown"))).toBe(`${fmtDate("2026-10-20T14:00:00.000Z")} – ${fmtDate("2026-11-02T18:05:00.000Z")}`);
    unmount();
    renderPanel({ state: appState({ aircraft: [comanche], hops: [TOUR[1]] }) });
    expect(text(tourLine("Flown"))).toBe(fmtDate("2026-10-20T14:00:00.000Z"));
  });

  // @spec ACP-TOUR-009
  it("names the longest hop as a control that opens it and marks it on the map while pointed at", () => {
    const { p } = renderPanel();
    const longest = within(tourLine("Longest hop")).getByRole("button");
    expect(text(longest)).toBe("KPVD → KHYA · 61 nm");
    fireEvent.mouseEnter(longest);
    expect(p.onMarkHop).toHaveBeenLastCalledWith(12);
    fireEvent.mouseLeave(longest);
    expect(p.onMarkHop).toHaveBeenLastCalledWith(null);
    fireEvent.click(longest);
    expect(p.onOpenHop).toHaveBeenCalledWith(TOUR[1], "longest");
  });

  // @spec ACP-TOUR-010, PANEL-LOOK-001
  it("summarises the landings: the average descent rate and each rating that occurs with its count and word", () => {
    renderPanel();
    const line = tourLine("Landings");
    expect(text(line)).toContain("avg 162 fpm");
    const ratings = Array.from(line.querySelectorAll(".acp-rating"));
    expect(ratings.map(text)).toEqual(["🧈 2", "💥 1"]);
    expect(ratings.map((r) => r.getAttribute("aria-label"))).toEqual(["2 Butter", "1 Hard"]);
    expect(ratings.map((r) => r.getAttribute("title"))).toEqual(["2 Butter", "1 Hard"]);
  });

  // @spec ACP-TOUR-002
  it("reads 'No hops logged for this aircraft.' in place of its lines for an aircraft without hops", () => {
    renderPanel({ aircraft: cub });
    expect(panel().querySelector(".acp-tour")).toBeNull();
    expect(panel().textContent).toContain("No hops logged for this aircraft.");
    expect(rows()).toHaveLength(0);
  });

  // @spec ACP-TOUR-001
  it("follows the map state: a hop logged while the panel is open shows at once", () => {
    const { rerender } = renderPanel();
    const logged = hop({ id: 15, aircraft_id: 1, seq: 5, origin: "KHYA", dest: "KBOS", stats: stats({ flown_nm: 55, fuel_used_lb: 80 }) });
    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...TOUR, logged, ...OTHERS] }) });
    expect(text(tourLine("Hops"))).toBe("5 hops · 1h 28m logged");
    expect(text(rows()[0].querySelector(".route"))).toBe("KHYA → KBOS");
    expect(text(panel().querySelector(".acp-parked"))).toBe("parked at KBOS · Boston Logan International Airport");
  });
});

describe("the actions", () => {
  // @spec ACP-ACT-001, ACP-ACT-002, ACP-ACT-003
  it("offers Plan next hop, Log a hop and Zoom to tour", () => {
    const { p } = renderPanel();
    fireEvent.click(within(panel()).getByRole("button", { name: "Plan next hop" }));
    expect(p.onPlanNext).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel()).getByRole("button", { name: "Log a hop" }));
    expect(p.onLogHop).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel()).getByRole("button", { name: "Zoom to tour" }));
    expect(p.onZoomTour).toHaveBeenCalledTimes(1);
  });

  // @spec ACP-ACT-003
  it("disables Zoom to tour while the aircraft is hidden from the map or has no hops", () => {
    const { unmount } = renderPanel({ aircraft: cub });
    expect((within(panel()).getByRole("button", { name: "Zoom to tour" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const { unmount: again } = renderPanel({ aircraft: { ...comanche, visible: 0 } });
    expect((within(panel()).getByRole("button", { name: "Zoom to tour" }) as HTMLButtonElement).disabled).toBe(true);
    again();
    renderPanel({ aircraft: tbm });
    expect((within(panel()).getByRole("button", { name: "Zoom to tour" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the hop list", () => {
  // @spec ACP-LIST-001
  it("lists every hop of its aircraft under 'Hops', the latest first", () => {
    renderPanel();
    expect(within(panel()).getByRole("heading", { name: "Hops" })).toBeTruthy();
    expect(rows().map((r) => text(r.querySelector(".seq")))).toEqual(["4", "3", "2", "1"]);
    expect(rows().map((r) => text(r.querySelector(".route")))).toEqual(["KACK → KHYA", "KHYA → KACK", "KPVD → KHYA", "KBOS → KPVD"]);
  });

  // @spec ACP-LIST-002, PANEL-LOOK-003, PANEL-LOOK-004
  it("shows each hop's landing badge, distance, flight time, fuel burned and notes, leaving out what it lacks", () => {
    renderPanel();
    const [fourth, third, second, first] = rows();

    expect(text(second.querySelector(".landing-badge"))).toBe("🧈 90 fpm");
    expect(text(second.querySelector(".figures"))).toBe("61 nm · 38m · 100 lb");
    expect(text(second.querySelector(".notes"))).toBe("Smooth air over the bay.");

    // a bounced landing: its first touchdown; a flight time derived from its times
    expect(text(third.querySelector(".landing-badge"))).toBe("💥 310 fpm");
    expect(text(third.querySelector(".figures"))).toBe("30 nm · 30m · 61 lb");
    expect(third.querySelector(".notes")).toBeNull();

    // no fuel figure
    expect(text(fourth.querySelector(".figures"))).toBe("31 nm · 20m");

    // hand-logged: the direct distance, said to be so, and nothing else
    expect(first.querySelector(".landing-badge")).toBeNull();
    expect(text(first.querySelector(".figures"))).toBe("43 nm direct");
  });

  // @spec ACP-LIST-003
  it("shows when each hop was flown: its departure, else its arrival, with the year, or 'no times'", () => {
    renderPanel();
    const [fourth, third, , first] = rows();
    expect(text(third.querySelector(".when"))).toBe(fmtDateTime("2026-10-25T23:14:00.000Z"));
    expect(text(fourth.querySelector(".when"))).toBe(fmtDateTime("2026-11-02T18:05:00.000Z"));
    expect(text(third.querySelector(".when"))).toContain("2026");
    expect(text(first.querySelector(".when"))).toBe("no times");
  });

  // @spec ACP-LIST-004
  it("opens a hop when its row is clicked", () => {
    const { p } = renderPanel();
    fireEvent.click(rowButton(rows()[1]));
    expect(p.onOpenHop).toHaveBeenCalledWith(TOUR[2], "row");
    expect(p.onClose).not.toHaveBeenCalled();
  });

  // @spec ACP-LIST-005
  it("marks the row of the hop the flight panel shows as the current one", () => {
    const { rerender } = renderPanel({ currentHopId: 12 });
    expect(rows().map((r) => rowButton(r).getAttribute("aria-current"))).toEqual([null, null, "true", null]);
    rerender({ currentHopId: 21 });
    expect(rows().some((r) => rowButton(r).getAttribute("aria-current"))).toBe(false);
  });

  // @spec ACP-LIST-006
  it("brings into view the row of a hop opened from outside the list, and never scrolls for a click on a row", () => {
    const { rerender } = renderPanel();
    expect(scrolled).toHaveLength(0);
    fireEvent.click(rowButton(rows()[3]));
    rerender({ currentHopId: 11 });
    expect(scrolled).toHaveLength(0);

    rerender({ currentHopId: 13, reveal: { key: 1, hopId: 13 } });
    expect(scrolled).toEqual([rows()[1]]);
    // the same request is carried out once
    rerender({ currentHopId: 13, reveal: { key: 1, hopId: 13 } });
    expect(scrolled).toHaveLength(1);
    rerender({ currentHopId: 13, reveal: { key: 2, hopId: 13 } });
    expect(scrolled).toHaveLength(2);
  });

  // @spec ACP-LIST-006, ACP-LAY-002
  it("keeps the current row in view when the panel changes how it scrolls", () => {
    const { rerender } = renderPanel({ listAlone: true });
    // A click on a row opens the flight panel, which takes the room the list scrolled alone in.
    rerender({ listAlone: false, currentHopId: 12 });
    expect(scrolled).toEqual([rows()[2]]);
    // The same way of scrolling: another row becoming current scrolls nothing.
    rerender({ listAlone: false, currentHopId: 13 });
    expect(scrolled).toHaveLength(1);
    // The flight closes: nothing is current, and nothing scrolls.
    rerender({ listAlone: true, currentHopId: null });
    expect(scrolled).toHaveLength(1);
  });

  // @spec ACP-LIST-007
  it("marks the hop whose row is pointed at or focused, one at a time, and stops when the pointer or focus leaves", () => {
    const { p } = renderPanel();
    const [fourth, third] = rows();
    fireEvent.mouseEnter(rowButton(fourth));
    expect(p.onMarkHop).toHaveBeenLastCalledWith(14);
    fireEvent.focus(rowButton(third));
    expect(p.onMarkHop).toHaveBeenLastCalledWith(13);
    // the pointer leaving the row it was on before does not unmark the one now focused
    fireEvent.mouseLeave(rowButton(fourth));
    expect(p.onMarkHop).toHaveBeenLastCalledWith(13);
    fireEvent.blur(rowButton(third));
    expect(p.onMarkHop).toHaveBeenLastCalledWith(null);
  });

  // @spec ACP-LIST-007
  it("stops marking when the panel closes, shows another aircraft, or loses the hop", () => {
    const first = renderPanel();
    fireEvent.mouseEnter(rowButton(rows()[0]));
    expect(first.p.onMarkHop).toHaveBeenLastCalledWith(14);
    first.unmount();
    expect(first.p.onMarkHop).toHaveBeenLastCalledWith(null);

    const second = renderPanel();
    fireEvent.mouseEnter(rowButton(rows()[0]));
    second.rerender({ aircraft: tbm });
    expect(second.p.onMarkHop).toHaveBeenLastCalledWith(null);
    second.unmount();

    const third = renderPanel();
    fireEvent.mouseEnter(rowButton(rows()[0]));
    expect(third.p.onMarkHop).toHaveBeenLastCalledWith(14);
    third.rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...TOUR.slice(0, 3), ...OTHERS] }) });
    expect(third.p.onMarkHop).toHaveBeenLastCalledWith(null);
  });

  // @spec ACP-LIST-006
  it("starts at its top when the panel shows another aircraft", () => {
    const { rerender } = renderPanel();
    const list = () => panel().querySelector(".acp-scroll") as HTMLElement;
    list().scrollTop = 240;
    rerender({ aircraft: tbm });
    expect(list().scrollTop).toBe(0);
    expect(rows().map((r) => text(r.querySelector(".route")))).toEqual(["KBOS → KACK"]);
  });

  // @spec ACP-LIST-008
  it("offers nothing that reorders, edits or deletes a hop", () => {
    renderPanel();
    const list = panel().querySelector(".acp-list") as HTMLElement;
    for (const name of ["Move earlier", "Move later", "Edit hop", "Delete hop"]) {
      expect(within(list).queryByRole("button", { name })).toBeNull();
    }
    // one control a row, plus the one PDF link
    expect(within(list).getAllByRole("button")).toHaveLength(4);
  });

  // @spec ACP-LAY-002
  it("scrolls the list alone or everything under the header, as the page works out", () => {
    const { rerender } = renderPanel({ listAlone: true });
    expect(panel().classList.contains("list-alone")).toBe(true);
    rerender({ listAlone: false });
    expect(panel().classList.contains("list-alone")).toBe(false);
    expect(panel().classList.contains("scroll-all")).toBe(true);
  });
});

describe("SimBrief plans in the list", () => {
  const second = () => rows()[2];

  // @spec ACP-PLAN-001
  it("marks a hop that has a plan with 'SimBrief', before any digest arrives", () => {
    renderPanel({}, 500);
    expect(text(second().querySelector(".plan-mark"))).toBe("SimBrief");
    expect(rows().filter((r) => r.querySelector(".plan-mark"))).toHaveLength(1);
  });

  // @spec ACP-PLAN-002
  it("asks for the digest of an aircraft with a plan, and not for one without", async () => {
    const first = renderPanel();
    await waitFor(() => expect(first.asked).toEqual(["/api/aircraft/1/plans"]));
    first.unmount();
    renderPanel({ aircraft: tbm });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(plans.asked).toEqual(["/api/aircraft/1/plans"]);
  });

  // @spec ACP-PLAN-002
  it("asks again when the aircraft shown changes and when its hops' plan links change", async () => {
    const tbmPlanned = [hop({ id: 21, aircraft_id: 2, seq: 1, origin: "KBOS", dest: "KACK", briefing_id: 9 })];
    const { asked, rerender } = renderPanel();
    await waitFor(() => expect(asked).toHaveLength(1));

    // the same links again: nothing asked
    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...TOUR, ...OTHERS] }) });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(asked).toHaveLength(1);

    const relinked = TOUR.map((h) => (h.id === 13 ? { ...h, briefing_id: 8 } : h));
    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...relinked, ...tbmPlanned] }) });
    await waitFor(() => expect(asked).toHaveLength(2));

    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...relinked, ...tbmPlanned] }), aircraft: tbm });
    await waitFor(() => expect(asked).toEqual(["/api/aircraft/1/plans", "/api/aircraft/1/plans", "/api/aircraft/2/plans"]));
  });

  // @spec ACP-PLAN-002, ACP-PLAN-003
  it("shows only the mark, and no error, when the digest fails, and asks again when the map state next loads", async () => {
    const { asked, rerender } = renderPanel({}, 503);
    await waitFor(() => expect(asked).toHaveLength(1));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(text(second().querySelector(".plan-mark"))).toBe("SimBrief");
    expect(second().querySelector(".planned")).toBeNull();
    expect(second().querySelector(".acp-pdf")).toBeNull();
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(panel().textContent).not.toContain("failed");

    // the map state loads again, with nothing changed in it
    rerender({ state: { ...STATE } });
    await waitFor(() => expect(asked).toHaveLength(2));
  });

  // @spec ACP-PLAN-004, SB-CARD-009
  it("offers PDF beside the row for an address on another origin, opening in a new window without opening the hop", async () => {
    const { p } = renderPanel();
    const pdf = (await waitFor(() => {
      const a = second().querySelector<HTMLAnchorElement>("a.acp-pdf");
      if (!a) throw new Error("no PDF link yet");
      return a;
    })) as HTMLAnchorElement;
    expect(text(pdf)).toBe("PDF");
    expect(pdf.getAttribute("href")).toBe("https://www.simbrief.com/ofp/flightplans/KPVDKHYA_PDF_1.pdf");
    expect(pdf.getAttribute("target")).toBe("_blank");
    expect(pdf.getAttribute("rel")).toBe("noopener noreferrer");
    // beside the row's button, not inside it
    expect(rowButton(second()).contains(pdf)).toBe(false);
    fireEvent.click(pdf);
    expect(p.onOpenHop).not.toHaveBeenCalled();
  });

  // @spec ACP-PLAN-004, SB-CARD-009
  it("offers no PDF for an address the page may not link to, or a plan without one", async () => {
    for (const pdf_url of ["javascript:alert(1)", "/api/state", `${window.location.origin}/x.pdf`, null]) {
      const before = plans.asked.length;
      const { asked, unmount } = renderPanel({}, [{ ...DIGEST[0], pdf_url }]);
      await waitFor(() => expect(asked).toHaveLength(before + 1));
      await waitFor(() => expect(second().querySelector(".planned")).not.toBeNull());
      expect(second().querySelector(".acp-pdf"), String(pdf_url)).toBeNull();
      unmount();
    }
  });

  // @spec ACP-PLAN-005
  it("shows the planned time en route and burn in pounds, leaving out what the plan does not give", async () => {
    const cases: [Partial<PlanDigestEntry>, string | null][] = [
      [{}, "planned 35m · 96 lb"],
      [{ fuel: { units: "kgs", burn: 500 } }, "planned 35m · 1,102 lb"],
      [{ fuel: { units: "gal", burn: 60 } }, "planned 35m"],
      [{ ete_min: null }, "planned 96 lb"],
      [{ ete_min: null, fuel: { units: "lbs", burn: null }, pdf_url: null }, null],
    ];
    for (const [over, expected] of cases) {
      const before = plans.asked.length;
      const { asked, unmount } = renderPanel({}, [{ ...DIGEST[0], ...over }]);
      await waitFor(() => expect(asked).toHaveLength(before + 1));
      if (expected) await waitFor(() => expect(text(second().querySelector(".planned")), expected).toBe(expected));
      else {
        await act(() => new Promise((r) => setTimeout(r, 20)));
        expect(second().querySelector(".planned")).toBeNull();
      }
      unmount();
    }
  });

  // @spec ACP-PLAN-003
  it("uses a digest entry only while its plan is the one the hop links to", async () => {
    const { rerender } = renderPanel();
    await waitFor(() => expect(second().querySelector(".planned")).not.toBeNull());
    // The hop's plan is replaced by plan 8: the figures and PDF of plan 7 go at once, and a digest
    // that still describes plan 7 is not used for it.
    const relinked = TOUR.map((h) => (h.id === 12 ? { ...h, briefing_id: 8 } : h));
    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...relinked, ...OTHERS] }) });
    expect(second().querySelector(".planned")).toBeNull();
    expect(second().querySelector(".acp-pdf")).toBeNull();
    expect(text(second().querySelector(".plan-mark"))).toBe("SimBrief");
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(second().querySelector(".planned")).toBeNull();
    expect(second().querySelector(".acp-pdf")).toBeNull();
  });
});

describe("a panel that fails to render", () => {
  // @spec ACP-OPEN-009, APP-UI-005
  it("says so with Retry inside its frame, keeps its close button, and renders afresh for another aircraft", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = TOUR.map((h) => (h.id === 14 ? { ...h, landings: JSON.stringify([touchdown(0, 666, "hospital")]) } : h));
    const { p, rerender } = renderPanel({ state: appState({ aircraft: STATE.aircraft, hops: [...broken, ...OTHERS] }) });

    expect(text(panel())).toContain("Aircraft panel failed: bad landing");
    expect(within(panel()).getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole("button", { name: "Close the aircraft panel" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);

    rerender({ state: appState({ aircraft: STATE.aircraft, hops: [...broken, ...OTHERS] }), aircraft: tbm });
    expect(text(panel())).not.toContain("failed");
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
