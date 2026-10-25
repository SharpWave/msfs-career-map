/**
 * The "Live from the sim" card: the strip and the open card, the legs waiting to be logged, casual
 * mode, and what it says for the sim mode, the sim's host and another copy holding the sim link.
 * Specs: LIVE-CARD-001, LIVE-CARD-003, LIVE-CARD-005, LIVE-CARD-006, LIVE-CARD-008, LIVE-CARD-010,
 * LIVE-CARD-011, LIVE-CARD-012, LIVE-CARD-013, LIVE-CARD-014, PANEL-LOOK-004.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LivePanel } from "../../src/client/components/LivePanel.tsx";
import { fmtDuration, fmtTimeShort } from "../../src/client/format.ts";
import type { Aircraft, TrackerStatus } from "../../src/client/types.ts";
import { answerFetch, resetAnswers } from "../support/fetch-guard.ts";
import { aircraft, airport, hop, liveState, pendingLeg, touchdown, trackerStatus } from "../support/page-data.ts";

const POSITION: TrackerStatus["position"] = {
  lat: 41.72, lon: -71.43, alt_ft: 1250, gs_kts: 95, hdg_deg: 45, vs_fpm: 0, ias_kts: 92, fuel_lb: 300, on_ground: false,
  t: "2026-10-09T14:00:00.000Z",
};

function renderCard(status: TrackerStatus | null, open: boolean, onToggle = () => {}, onOpenPending: (id: string) => void = vi.fn()) {
  return render(card(status, open, onToggle, onOpenPending));
}

/** The live card as the page renders it, for `render` or a test's `rerender`. */
function card(
  status: TrackerStatus | null,
  open: boolean,
  onToggle = () => {},
  onOpenPending: (id: string) => void = vi.fn(),
  fleet: Aircraft[] = [aircraft()],
) {
  return (
    <LivePanel
      live={liveState(status)}
      aircraft={fleet}
      reload={async () => {}}
      onFocusLive={() => {}}
      onOpenLive={() => {}}
      onOpenPending={onOpenPending}
      onSelect={() => {}}
      onNewFromSim={() => {}}
      open={open}
      onToggle={onToggle}
    />
  );
}

const strip = () => document.querySelector(".live-strip") as HTMLElement;

describe("the live card", () => {
  beforeEach(() => {
    // The SimBrief controls ask for the alias as soon as a sim aircraft is connected.
    answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
    // A pending leg's airport fields look their codes up for the hint line.
    answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  });

  // @spec LIVE-CARD-011
  it("shows one line while collapsed: the status, altitude, ground speed and heading, and a waiting leg in amber", () => {
    renderCard(trackerStatus({ phase: "airborne", position: POSITION, pending: [pendingLeg()] }), false);
    const line = strip();
    expect(line).toBeTruthy();
    expect(line.querySelector(".pill")?.textContent).toBe("airborne");
    expect(line.textContent).toContain("1,250 ft · 95 kt · 045°");
    const waiting = Array.from(line.querySelectorAll(".caution")).find((e) => e.textContent === "Leg waiting to be logged");
    expect(waiting).toBeTruthy();
    expect(document.querySelector(".live-grid")?.closest("[hidden]")).not.toBeNull();
  });

  // @spec LIVE-CARD-011, LIVE-CARD-008
  it("leaves the readout and the waiting note out of the line when they do not apply, and shows no pending block while none waits", () => {
    let r = renderCard(trackerStatus({ phase: "ground", pending: [] }), false);
    expect(strip().textContent).not.toMatch(/ft ·/);
    expect(strip().textContent).not.toContain("Leg waiting to be logged");
    r.unmount();
    // The open card, with no leg waiting, has no pending block.
    r = renderCard(trackerStatus({ phase: "ground", pending: [] }), true);
    expect(screen.queryByText("Leg waiting to be logged")).toBeNull();
    expect(screen.queryByRole("button", { name: "Log hop" })).toBeNull();
    r.unmount();
    // A last position kept from before the sim went away is not shown as live.
    renderCard(trackerStatus({ connected: false, sim: null, position: POSITION, pending: [] }), false);
    expect(strip().textContent).not.toMatch(/ft ·/);
  });

  // @spec LIVE-CARD-011
  it("opens when the line is clicked", () => {
    const onToggle = vi.fn();
    renderCard(trackerStatus(), false, onToggle);
    fireEvent.click(strip());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // @spec LIVE-CARD-011
  it("shows the full card, not the line, while open", () => {
    renderCard(trackerStatus({ position: POSITION }), true);
    expect(strip()).toBeNull();
    expect(screen.getByRole("heading", { name: "Live from the sim" })).toBeTruthy();
    expect(document.querySelector(".live-grid")?.closest("[hidden]")).toBeNull();
  });

  // @spec LIVE-CARD-001
  it("colors the status pill by state", () => {
    const pillFor = (s: TrackerStatus | null) => {
      const r = renderCard(s, true);
      const cls = (document.querySelector(".pill") as HTMLElement).className;
      r.unmount();
      return cls.split(/\s+/).filter((c) => c && c !== "pill");
    };
    expect(pillFor(trackerStatus({ phase: "ground" }))).toEqual(["on"]);
    expect(pillFor(trackerStatus({ phase: "airborne" }))).toEqual(["air"]);
    expect(pillFor(trackerStatus({ phase: "landed" }))).toEqual(["air"]);
    expect(pillFor(trackerStatus({ paused: true }))).toEqual(["warn"]);
    expect(pillFor(trackerStatus({ sim_running: false }))).toEqual(["warn"]);
    expect(pillFor(trackerStatus({ connected: false, sim: null }))).toEqual([]);
  });

  // @spec LIVE-CARD-005, PANEL-LOOK-004
  it("badges the leg with the first touchdown of its latest landing", () => {
    const landings = [touchdown(0, 300, "solid"), touchdown(300, 450, "hard"), touchdown(303, 80, "butter")];
    const leg = { origin: "KPVD", departed_at: "2026-10-21T14:55:00.000Z", touchdown_at: landings[2].t, points: 90, landings, max_alt_ft: 1500, fuel_used_lb: null };
    renderCard(trackerStatus({ phase: "landed", position: { ...POSITION!, on_ground: true }, leg }), true);
    const row = screen.getByText("Leg").nextElementSibling as HTMLElement;
    expect(row.querySelector(".landing-badge")?.textContent).toBe("💥 450 fpm");
  });
});

/** Two legs waiting to be logged, oldest first, differing in every field the card shows. */
const OLDER = pendingLeg({
  id: "0b6f3a52-7c1d-4e8a-9f20-3d4c5b6a7e81",
  sim: { title: "Cessna Skyhawk G1000", livery: "Red Tail", atc_id: "N172RT" },
  aircraft_id: null,
  origin: null,
  dest: "KPVD",
  departed_at: "2026-10-09T14:00:00.000Z",
  arrived_at: "2026-10-09T14:40:00.000Z",
  duration_min: 40,
  points: 480,
  reason: "no fleet aircraft is bound to this sim aircraft",
});
const NEWER = pendingLeg({
  id: "c4e9d1f7-2a3b-4c5d-8e6f-7a8b9c0d1e2f",
  sim: { title: "Comanche 250", livery: "Blue Stripe", atc_id: "N6229P" },
  aircraft_id: 1,
  origin: "KHYA",
  dest: null,
  departed_at: "2026-10-10T09:15:00.000Z",
  arrived_at: "2026-10-10T10:20:00.000Z",
  duration_min: 65,
  points: 735,
  reason: "the sim disconnected in flight",
});

/**
 * The open card's pending-leg blocks in page order: for each "Leg waiting to be logged" heading, the
 * nearest element around it that also holds a Log hop button.
 */
function pendingBlocks(): HTMLElement[] {
  return screen.getAllByText("Leg waiting to be logged").map((heading) => {
    let el: HTMLElement | null = heading;
    while (el && within(el).queryAllByRole("button", { name: "Log hop" }).length === 0) el = el.parentElement;
    expect(el).toBeTruthy();
    return el!;
  });
}

/** A block's Aircraft, From or To field, found by its label. */
const field = (block: HTMLElement, label: RegExp) => within(block).getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

/** Answers every `/api/tracker/pending…` request with a fresh `reply()`, recording its method, path and body. */
function answerPending(reply: () => Response) {
  const asked: { method?: string; path: string; body?: unknown }[] = [];
  answerFetch(/\/api\/tracker\/pending(\/|$)/, (url, init) => {
    asked.push({ method: init?.method, path: url.pathname, body: init?.body != null ? JSON.parse(String(init.body)) : undefined });
    return reply();
  });
  return asked;
}

describe("pending legs in the live card", () => {
  beforeEach(() => {
    answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
    answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  });

  // @spec LIVE-CARD-008
  it("shows a block for each leg waiting to be logged, oldest first, with the sim aircraft, reason, times, flight time and points", () => {
    renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true);
    const blocks = pendingBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).not.toBe(blocks[1]);
    [OLDER, NEWER].forEach((leg, i) => {
      const text = blocks[i].textContent ?? "";
      expect(text).toContain(leg.sim.title);
      expect(text).toContain(leg.sim.livery);
      expect(text).toContain(leg.reason);
      expect(text).toContain(fmtTimeShort(leg.departed_at));
      expect(text).toContain(fmtTimeShort(leg.arrived_at));
      expect(text).toContain(fmtDuration(leg.duration_min));
      expect(text).toMatch(new RegExp(`\\b${leg.points}\\b.*points`));
    });
  });

  // @spec LIVE-CARD-008
  it("prefills each block's aircraft, From and To with what is known of that leg", () => {
    renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true);
    const [older, newer] = pendingBlocks();
    expect(field(older, /^Aircraft/).value).toBe("");
    expect(field(older, /^From/).value).toBe("");
    expect(field(older, /^To/).value).toBe("KPVD");
    expect(field(newer, /^Aircraft/).value).toBe(String(NEWER.aircraft_id));
    expect(field(newer, /^From/).value).toBe("KHYA");
    expect(field(newer, /^To/).value).toBe("");
  });

  // @spec LIVE-CARD-008, LIVE-BIND-003
  it("fills in a block's aircraft when binding sets one on its leg, keeping an aircraft the pilot already chose", () => {
    const fleet = [aircraft(), aircraft({ id: 2, name: "Cessna Skyhawk", livery: "Red Tail" })];
    const unbound = { ...NEWER, aircraft_id: null };
    const r = render(card(trackerStatus({ pending: [OLDER, unbound] }), true, () => {}, vi.fn(), fleet));
    let [older, newer] = pendingBlocks();
    expect(field(older, /^Aircraft/).value).toBe("");
    fireEvent.change(field(newer, /^Aircraft/), { target: { value: "1" } });

    // The next status gives both legs the aircraft just bound.
    r.rerender(card(trackerStatus({ pending: [{ ...OLDER, aircraft_id: 2 }, { ...unbound, aircraft_id: 2 }] }), true, () => {}, vi.fn(), fleet));
    [older, newer] = pendingBlocks();
    expect(field(older, /^Aircraft/).value).toBe("2");
    expect(field(newer, /^Aircraft/).value).toBe("1");
  });

  // @spec LIVE-CARD-008
  it("logs a block's leg by its id, with the aircraft, From and To its fields hold", async () => {
    const asked = answerPending(() => Response.json(hop({ id: 7, aircraft_id: 1, origin: "KHYA", dest: "KACK" }), { status: 201 }));
    renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true);
    const newer = pendingBlocks()[1];
    const to = field(newer, /^To/);
    fireEvent.change(to, { target: { value: "KACK" } });
    fireEvent.blur(to);
    fireEvent.click(within(newer).getByRole("button", { name: "Log hop" }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({ method: "POST", path: `/api/tracker/pending/${NEWER.id}`, body: { aircraft_id: 1, origin: "KHYA", dest: "KACK" } });
  });

  // @spec LIVE-CARD-008
  it("keeps each block's fields with its own leg when the list changes", async () => {
    const asked = answerPending(() => Response.json(hop({ id: 7, aircraft_id: 1, origin: "KHYA", dest: "KACK" }), { status: 201 }));
    const r = renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true);
    const to = field(pendingBlocks()[1], /^To/);
    fireEvent.change(to, { target: { value: "KACK" } });
    fireEvent.blur(to);

    // The older leg is logged or discarded: only the newer one, with the To typed into it, is left.
    r.rerender(card(trackerStatus({ pending: [NEWER] }), true));
    const blocks = pendingBlocks();
    expect(blocks).toHaveLength(1);
    const [left] = blocks;
    expect(left.textContent).toContain(NEWER.sim.title);
    expect(field(left, /^Aircraft/).value).toBe(String(NEWER.aircraft_id));
    expect(field(left, /^From/).value).toBe("KHYA");
    expect(field(left, /^To/).value).toBe("KACK");

    fireEvent.click(within(left).getByRole("button", { name: "Log hop" }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({ method: "POST", path: `/api/tracker/pending/${NEWER.id}`, body: { aircraft_id: 1, origin: "KHYA", dest: "KACK" } });
  });

  // @spec LIVE-CARD-008
  it("discards a block's leg by its id, and only after the pilot confirms", async () => {
    const asked = answerPending(() => Response.json(trackerStatus({ pending: [NEWER] })));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true);
      const older = pendingBlocks()[0];
      fireEvent.click(within(older).getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm).toHaveBeenCalledWith("Discard this leg? Its recorded track will be lost.");
      expect(asked).toEqual([]);

      confirm.mockReturnValue(true);
      fireEvent.click(within(older).getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(asked).toEqual([{ method: "DELETE", path: `/api/tracker/pending/${OLDER.id}` }]));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenLastCalledWith("Discard this leg? Its recorded track will be lost.");
    } finally {
      confirm.mockRestore();
    }
  });

  // @spec LIVE-CARD-010
  it("offers Profile in each block, opening that block's leg", () => {
    const onOpenPending = vi.fn();
    renderCard(trackerStatus({ pending: [OLDER, NEWER] }), true, () => {}, onOpenPending);
    const [older, newer] = pendingBlocks();
    fireEvent.click(within(newer).getByRole("button", { name: "Profile" }));
    expect(onOpenPending.mock.calls).toEqual([[NEWER.id]]);
    fireEvent.click(within(older).getByRole("button", { name: "Profile" }));
    expect(onOpenPending.mock.calls).toEqual([[NEWER.id], [OLDER.id]]);
  });
});

const CASUAL: TrackerStatus["casual"] = { since: "2026-10-12T14:05:00.000Z", points: 42 };

/** Answers `PUT /api/tracker/casual` with each reply in turn, recording what was asked. */
function answerCasual(...replies: Response[]) {
  const asked: unknown[] = [];
  answerFetch("/api/tracker/casual", (_url, init) => {
    expect(init?.method).toBe("PUT");
    asked.push(JSON.parse(String(init?.body)));
    return replies.shift() ?? Response.json(trackerStatus({ casual: CASUAL }));
  });
  return asked;
}

const casualSwitch = () => screen.getByRole("switch", { name: "Casual" });

describe("casual mode in the live card", () => {
  beforeEach(() => {
    answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
  });

  // @spec LIVE-CARD-001
  it("reads casual in violet while casual mode is on and the sim is connected and running", () => {
    const pill = (s: TrackerStatus) => {
      const r = renderCard(s, true);
      const el = document.querySelector(".pill") as HTMLElement;
      const out = { text: el.textContent, cls: el.className.split(/\s+/).filter((c) => c && c !== "pill") };
      r.unmount();
      return out;
    };
    expect(pill(trackerStatus({ casual: CASUAL, phase: "idle", position: POSITION }))).toEqual({ text: "casual", cls: ["casual"] });
    expect(pill(trackerStatus({ casual: CASUAL, paused: true }))).toEqual({ text: "paused", cls: ["warn"] });
    expect(pill(trackerStatus({ casual: CASUAL, connected: false, sim: null }))).toEqual({ text: "sim not running", cls: [] });
  });

  // @spec LIVE-CARD-012
  it("shows the Casual switch in the title row and in the strip, whatever the sim is doing, while the app server is reachable", () => {
    let r = renderCard(trackerStatus({ casual: CASUAL }), true);
    expect(document.querySelector(".live-head")?.contains(casualSwitch())).toBe(true);
    expect(casualSwitch().getAttribute("aria-checked")).toBe("true");
    r.unmount();

    r = renderCard(trackerStatus({ connected: false, sim: null }), false);
    expect(strip().contains(casualSwitch())).toBe(true);
    expect(casualSwitch().getAttribute("aria-checked")).toBe("false");
    r.unmount();

    render(
      <LivePanel live={liveState(trackerStatus(), { online: false })} aircraft={[]} reload={async () => {}} onFocusLive={() => {}} onOpenLive={() => {}}
        onOpenPending={() => {}} onSelect={() => {}} onNewFromSim={() => {}} open={false} onToggle={() => {}} />,
    );
    expect(screen.queryByRole("switch", { name: "Casual" })).toBeNull();
  });

  // @spec LIVE-CARD-011, LIVE-CARD-012
  it("switches from the strip without opening the card", async () => {
    const asked = answerCasual();
    const onToggle = vi.fn();
    renderCard(trackerStatus(), false, onToggle);
    fireEvent.click(casualSwitch());
    await waitFor(() => expect(asked).toEqual([{ on: true }]));
    expect(onToggle).not.toHaveBeenCalled();
  });

  // @spec LIVE-CARD-012
  it("switches casual mode off from the title row", async () => {
    const asked = answerCasual(Response.json(trackerStatus()));
    renderCard(trackerStatus({ casual: CASUAL }), true);
    fireEvent.click(casualSwitch());
    await waitFor(() => expect(asked).toEqual([{ on: false }]));
  });

  // @spec LIVE-CARD-013
  it("asks before dropping a fleet aircraft's leg the server protects, and repeats the request only if the pilot agrees", async () => {
    const refusal = { error: "a leg is being flown", aircraft_id: 1, name: "Piper Comanche 250 · N6229P", origin: "KPVD", departed_at: "2026-10-12T14:00:00.000Z" };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      let asked = answerCasual(Response.json(refusal, { status: 409 }));
      let r = renderCard(trackerStatus({ phase: "airborne" }), true);
      fireEvent.click(casualSwitch());
      await waitFor(() => expect(asked).toEqual([{ on: true }, { on: true, drop_leg: true }]));
      expect(confirm).toHaveBeenCalledWith("Piper Comanche 250 · N6229P is flying a leg from KPVD. Switch to casual mode? The leg will not be logged.");
      r.unmount();

      confirm.mockClear();
      confirm.mockReturnValue(false);
      // The first answer for a URL wins, so start the answers afresh.
      resetAnswers();
      answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
      asked = answerCasual(Response.json({ ...refusal, origin: null }, { status: 409 }));
      r = renderCard(trackerStatus({ phase: "airborne" }), true);
      fireEvent.click(casualSwitch());
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm).toHaveBeenCalledWith("Piper Comanche 250 · N6229P is flying a leg that started in the air. Switch to casual mode? The leg will not be logged.");
      expect(asked).toEqual([{ on: true }]);
      expect(document.querySelector(".error")).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  // @spec LIVE-CARD-014, LIVE-CARD-003
  it("leaves out the Fleet and Leg rows and shows the casual note and the path with Clear", async () => {
    let cleared = 0;
    answerFetch("/api/tracker/path", (_url, init) => {
      expect(init?.method).toBe("DELETE");
      cleared++;
      return Response.json(trackerStatus({ casual: { ...CASUAL!, points: 0 } }));
    });
    renderCard(trackerStatus({ casual: CASUAL, phase: "idle", position: POSITION }), true);
    expect(screen.queryByText("Fleet")).toBeNull();
    expect(screen.queryByText("Leg")).toBeNull();
    expect(screen.queryByRole("option", { name: "Bind to…" })).toBeNull();
    expect(screen.getByText("Position")).toBeTruthy();
    expect(
      screen.getByText("Casual mode: the path you fly is drawn on the map and nothing is logged until you switch casual mode off, quit the app or close MSFS."),
    ).toBeTruthy();
    const path = screen.getByText("Path").nextElementSibling as HTMLElement;
    expect(path.textContent).toContain("42 points");
    expect(path.textContent).toContain(fmtTimeShort(CASUAL!.since));
    fireEvent.click(within(path).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(cleared).toBe(1));
  });

  // @spec LIVE-CARD-014, LIVE-CARD-006
  it("shows the casual note and the path in place of the start hint while the sim is not connected", () => {
    renderCard(trackerStatus({ casual: CASUAL, connected: false, sim: null }), true);
    expect(screen.getByText(/^Casual mode: the path you fly is drawn/)).toBeTruthy();
    expect(screen.queryByText(/^Start MSFS and the tracker connects by itself/)).toBeNull();
    expect((screen.getByText("Path").nextElementSibling as HTMLElement).textContent).toContain("42 points");
  });

  // @spec LIVE-CARD-003, LIVE-CARD-006
  it("offers binding and the start hint again while casual mode is off", () => {
    let r = renderCard(trackerStatus(), true);
    expect(screen.getByText("Fleet")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bind to…" })).toBeTruthy();
    r.unmount();
    r = renderCard(trackerStatus({ connected: false, sim: null }), true);
    expect(screen.getByText(/^Start MSFS and the tracker connects by itself/)).toBeTruthy();
    expect(screen.queryByText(/^Casual mode: the path you fly/)).toBeNull();
    expect(screen.queryByText("Path")).toBeNull();
  });
});

const DASH = "\u2014";
const NOT_LINKED = { connected: false, sim: null } as const;
const HOLDER: NonNullable<TrackerStatus["link_holder"]> = {
  holder: "installed",
  data_folder: "C:\\Users\\pilot\\AppData\\Roaming\\MSFS Career Map",
  text: "The sim is linked to another copy (the installed app)",
};
const OFF_HINT = "This copy does not link to the sim. Start it with npm run dev:sim to track flights from MSFS.";
const START_HINT = /^Start MSFS and the tracker connects by itself/;
const holderHint = (text: string) => `${text}. Flights are logged there; this copy links once it lets go.`;
const hostHint = (host: string) => `Linked to the sim on ${host}: a copy of MSFS Career Map on that PC is not checked, so run only one.`;

/** The pill's text and classes, with the card open (or collapsed) and the app server reachable (or not). */
function pillOf(status: TrackerStatus | null, o: { online?: boolean; open?: boolean } = {}) {
  const r = render(
    <LivePanel live={liveState(status, { online: o.online ?? true })} aircraft={[aircraft()]} reload={async () => {}} onFocusLive={() => {}}
      onOpenLive={() => {}} onOpenPending={() => {}} onSelect={() => {}} onNewFromSim={() => {}} open={o.open ?? true} onToggle={() => {}} />,
  );
  const el = document.querySelector(".pill") as HTMLElement;
  const out = { text: el.textContent, cls: el.className.split(/\s+/).filter((c) => c && c !== "pill") };
  r.unmount();
  return out;
}

/** The innermost elements within `root` whose text passes `test`. */
function innermost(root: HTMLElement, test: (text: string) => boolean): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => test(el.textContent ?? ""));
  return all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
}

/** The innermost element on the page whose whole text is exactly `text`, or null. */
const textElement = (text: string): HTMLElement | null => innermost(document.body, (t) => t === text)[0] ?? null;

/** A pending block's title line: "Leg waiting to be logged · …". */
function titleLine(block: HTMLElement): HTMLElement {
  const [line] = innermost(block, (t) => t.startsWith("Leg waiting to be logged ·"));
  expect(line, "the block's title line").toBeTruthy();
  return line;
}

/** A pending block's times line: "off … track points". */
function timesLine(block: HTMLElement): HTMLElement {
  const [line] = innermost(block, (t) => t.startsWith("off ") && t.includes("track points"));
  expect(line, "the block's times line").toBeTruthy();
  return line;
}

describe("the live card by sim mode and sim-link holder", () => {
  beforeEach(() => {
    answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
  });

  // @spec LIVE-CARD-001
  it("reads tracking off, plain, while the sim mode is off, connected, flying, in casual mode or with a holder", () => {
    const off = { text: "tracking off", cls: [] };
    expect(pillOf(trackerStatus({ sim_mode: "off", ...NOT_LINKED }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", ...NOT_LINKED }), { open: false })).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off" }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", phase: "airborne", position: POSITION }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", paused: true }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", casual: CASUAL }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", casual: CASUAL, ...NOT_LINKED }))).toEqual(off);
    expect(pillOf(trackerStatus({ sim_mode: "off", link_holder: HOLDER, ...NOT_LINKED }))).toEqual(off);
  });

  // @spec LIVE-CARD-001
  it("reads linked to another copy, amber, while another copy holds the sim link, ahead of sim not running", () => {
    const held = { text: "linked to another copy", cls: ["warn"] };
    expect(pillOf(trackerStatus({ link_holder: HOLDER, ...NOT_LINKED }))).toEqual(held);
    expect(pillOf(trackerStatus({ link_holder: HOLDER, ...NOT_LINKED }), { open: false })).toEqual(held);
    expect(pillOf(trackerStatus({ link_holder: HOLDER, casual: CASUAL, ...NOT_LINKED }))).toEqual(held);
    expect(pillOf(trackerStatus({ link_holder: HOLDER }))).toEqual(held);
    // With no holder, as before.
    expect(pillOf(trackerStatus({ ...NOT_LINKED }))).toEqual({ text: "sim not running", cls: [] });
    expect(pillOf(trackerStatus({ sim_mode: "fake", ...NOT_LINKED }))).toEqual({ text: "sim not running", cls: [] });
  });

  // @spec LIVE-CARD-001
  it("reads no connection to the app server first, whatever the sim mode or holder", () => {
    const offline = { text: "no connection to the app server", cls: [] };
    expect(pillOf(trackerStatus({ sim_mode: "off", ...NOT_LINKED }), { online: false })).toEqual(offline);
    expect(pillOf(trackerStatus({ sim_mode: "off", ...NOT_LINKED }), { online: false, open: false })).toEqual(offline);
    expect(pillOf(trackerStatus({ link_holder: HOLDER, ...NOT_LINKED }), { online: false })).toEqual(offline);
    // The other way round, the pill does change once the app server is back.
    expect(pillOf(trackerStatus({ sim_mode: "off", ...NOT_LINKED }), { online: true })).toEqual({ text: "tracking off", cls: [] });
  });

  // @spec LIVE-CARD-006
  it("says this copy does not link to the sim, naming npm run dev:sim, in place of the start hint while the sim mode is off, and not in casual mode", () => {
    let r = renderCard(trackerStatus({ sim_mode: "off", ...NOT_LINKED }), true);
    const hint = textElement(OFF_HINT);
    expect(hint).not.toBeNull();
    expect(Array.from(hint!.querySelectorAll("code")).map((c) => c.textContent)).toEqual(["npm run dev:sim"]);
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    // The off hint comes first, ahead of a holder's.
    r = renderCard(trackerStatus({ sim_mode: "off", link_holder: HOLDER, ...NOT_LINKED }), true);
    expect(textElement(OFF_HINT)).not.toBeNull();
    expect(textElement(holderHint(HOLDER.text))).toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    // In casual mode: the casual note, and neither hint.
    r = renderCard(trackerStatus({ sim_mode: "off", casual: CASUAL, ...NOT_LINKED }), true);
    expect(screen.getByText(/^Casual mode: the path you fly is drawn/)).toBeTruthy();
    expect(textElement(OFF_HINT)).toBeNull();
    expect(screen.queryByText(/does not link to the sim/)).toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    // Before the first status: only the wait, as before.
    renderCard(null, true);
    expect(screen.getByText("Waiting for the tracker…")).toBeTruthy();
    expect(textElement(OFF_HINT)).toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
  });

  // @spec LIVE-CARD-006
  it("says another copy holds the sim link, in the status's words, in place of the start hint, and not in casual mode", () => {
    let r = renderCard(trackerStatus({ link_holder: HOLDER, ...NOT_LINKED }), true);
    expect(textElement("The sim is linked to another copy (the installed app). Flights are logged there; this copy links once it lets go.")).not.toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    expect(textElement(OFF_HINT)).toBeNull();
    r.unmount();

    r = renderCard(trackerStatus({ link_holder: { holder: null, data_folder: null, text: "The sim is linked to another copy" }, ...NOT_LINKED }), true);
    expect(textElement("The sim is linked to another copy. Flights are logged there; this copy links once it lets go.")).not.toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    r = renderCard(trackerStatus({ link_holder: HOLDER, casual: CASUAL, ...NOT_LINKED }), true);
    expect(screen.getByText(/^Casual mode: the path you fly is drawn/)).toBeTruthy();
    expect(textElement(holderHint(HOLDER.text))).toBeNull();
    expect(screen.queryByText(/Flights are logged there/)).toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    // With no holder, the start hint as before, and neither of the new hints.
    renderCard(trackerStatus({ ...NOT_LINKED }), true);
    expect(textElement("Start MSFS and the tracker connects by itself. Takeoffs and landings are logged as hops with the flown track.")).not.toBeNull();
    expect(textElement(OFF_HINT)).toBeNull();
    expect(screen.queryByText(/Flights are logged there/)).toBeNull();
  });

  // @spec LIVE-CARD-006
  it("names the sim's host whenever the link reaches a sim on another PC, with casual mode on or off, beside the other hints", () => {
    const hint = hostHint("192.0.2.20");
    for (const over of [{}, { casual: CASUAL }, { phase: "airborne" as const, position: POSITION }]) {
      const r = renderCard(trackerStatus({ sim_host: "192.0.2.20", ...over }), true);
      expect(textElement(hint), JSON.stringify(over)).not.toBeNull();
      r.unmount();
    }

    // Not connected: the start hint as well, or in casual mode the casual note.
    let r = renderCard(trackerStatus({ sim_host: "192.0.2.20", ...NOT_LINKED }), true);
    expect(textElement(hint)).not.toBeNull();
    expect(screen.getByText(START_HINT)).toBeTruthy();
    r.unmount();
    r = renderCard(trackerStatus({ sim_host: "192.0.2.20", casual: CASUAL, ...NOT_LINKED }), true);
    expect(textElement(hint)).not.toBeNull();
    expect(screen.queryByText(START_HINT)).toBeNull();
    r.unmount();

    // Connected and waiting for the aircraft, with casual mode off and on.
    for (const casual of [null, CASUAL]) {
      const w = renderCard(trackerStatus({ sim_host: "192.0.2.20", sim: null, casual }), true);
      expect(textElement(hint)).not.toBeNull();
      expect(screen.getByText("Connected to MSFS 2024; waiting for the aircraft to load.")).toBeTruthy();
      w.unmount();
    }

    // No host: no such hint.
    renderCard(trackerStatus({ sim_host: null }), true);
    expect(screen.queryByText(/Linked to the sim on/)).toBeNull();
  });

});

describe("pending legs that ended in the air or lack fields", () => {
  beforeEach(() => {
    answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
    answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  });

  // @spec LIVE-CARD-008
  it("reads last seen for a leg marked as ended in the air and down for any other, each after off, going by the mark and not the reason", () => {
    const onGround = { ...OLDER, ended_in_air: false };
    const inAir = { ...NEWER, ended_in_air: true };
    // The same reason, without the mark.
    expect(NEWER.reason).toBe("the sim disconnected in flight");
    const notMarked = { ...NEWER, id: "7c9d1e3f-5a7b-4c9d-8e1f-6a8b0c2d4e57", ended_in_air: false };
    const unmarked = { ...NEWER, id: "8d0e2f4a-6b8c-4d0e-9f2a-7b9c1d3e5f68", ended_in_air: undefined } as never;
    renderCard(trackerStatus({ pending: [onGround, inAir, notMarked, unmarked] }), true);
    const [ground, air, ...others] = pendingBlocks();

    expect(timesLine(air).textContent).toContain(
      `off ${fmtTimeShort(inAir.departed_at)} · last seen ${fmtTimeShort(inAir.arrived_at)} · ${fmtDuration(inAir.duration_min)} · ${inAir.points} track points`,
    );
    expect(timesLine(air).textContent).not.toMatch(/\bdown\b/);
    expect(timesLine(ground).textContent).toContain(
      `off ${fmtTimeShort(onGround.departed_at)} · down ${fmtTimeShort(onGround.arrived_at)} · ${fmtDuration(onGround.duration_min)} · ${onGround.points} track points`,
    );
    expect(ground.textContent).not.toContain("last seen");
    expect(others).toHaveLength(2);
    for (const block of others) {
      expect(timesLine(block).textContent).toContain(`off ${fmtTimeShort(NEWER.departed_at)} · down ${fmtTimeShort(NEWER.arrived_at)} ·`);
      expect(block.textContent).not.toContain("last seen");
    }
  });

  // @spec LIVE-CARD-008
  it("shows — for each field a leg lacks, still offering Profile, Log hop and Discard, and renders the other legs in full", () => {
    const { sim, reason, departed_at, arrived_at, duration_min, points, ...rest } = pendingLeg({ id: "9d2e4f6a-1b3c-4d5e-8f7a-2b4c6d8e0f13" });
    void [sim, reason, departed_at, arrived_at, duration_min, points];
    const lacking = rest as never;
    renderCard(trackerStatus({ pending: [OLDER, lacking, NEWER] }), true);
    const blocks = pendingBlocks();
    expect(blocks).toHaveLength(3);
    const [older, bare, newer] = blocks;

    const title = titleLine(bare);
    expect(title.textContent).toBe(`Leg waiting to be logged · ${DASH}`);
    const times = timesLine(bare);
    expect(times.textContent).toContain(`off ${DASH} · down ${DASH} · ${DASH} · ${DASH} track points`);
    // The reason line: a — of its own, apart from the title and the times.
    const reasonDashes = Array.from(bare.querySelectorAll<HTMLElement>("*")).filter(
      (el) => el.textContent === DASH && !title.contains(el) && !times.contains(el),
    );
    expect(reasonDashes.length).toBeGreaterThan(0);
    expect(within(bare).getByRole("button", { name: "Profile" })).toBeTruthy();
    expect(within(bare).getByRole("button", { name: "Log hop" })).toBeTruthy();
    expect(within(bare).getByRole("button", { name: "Discard" })).toBeTruthy();
    // What the leg does carry is still prefilled.
    expect(field(bare, /^From/).value).toBe("KBOS");

    for (const [block, leg] of [[older, OLDER], [newer, NEWER]] as const) {
      expect(titleLine(block).textContent).toBe(`Leg waiting to be logged · ${leg.sim.title} · ${leg.sim.livery}`);
      expect(block.textContent).toContain(leg.reason);
      expect(timesLine(block).textContent).toContain(
        `off ${fmtTimeShort(leg.departed_at)} · down ${fmtTimeShort(leg.arrived_at)} · ${fmtDuration(leg.duration_min)} · ${leg.points} track points`,
      );
      expect(within(block).getByRole("button", { name: "Log hop" })).toBeTruthy();
    }
  });

  // @spec LIVE-CARD-008
  it("shows — for fields of the wrong type, leaves the livery out unless it is a non-empty string, and leaves Aircraft, From and To empty unless their values have the right type", () => {
    const odd = {
      ...pendingLeg({ id: "3e5f7a9b-2c4d-4e6f-9a1b-3c5d7e9f1a24" }),
      sim: { title: 7, livery: 9, atc_id: null },
      reason: 5,
      departed_at: "not a date",
      arrived_at: 12,
      duration_min: "40",
      points: "480",
      aircraft_id: "1",
      origin: 42,
      dest: ["KPVD"],
    } as never;
    const plain = pendingLeg({ id: "5a7b9c1d-3e5f-4a7b-8c9d-4e6f8a0b2c35", sim: { title: "Comanche 250", livery: "", atc_id: "N6229P" } });
    renderCard(trackerStatus({ pending: [odd, plain] }), true);
    const [oddBlock, plainBlock] = pendingBlocks();

    expect(titleLine(oddBlock).textContent).toBe(`Leg waiting to be logged · ${DASH}`);
    expect(timesLine(oddBlock).textContent).toContain(`off ${DASH} · down ${DASH} · ${DASH} · ${DASH} track points`);
    expect(oddBlock.textContent).not.toContain("not a date");
    expect(field(oddBlock, /^Aircraft/).value).toBe("");
    expect(field(oddBlock, /^From/).value).toBe("");
    expect(field(oddBlock, /^To/).value).toBe("");

    expect(titleLine(plainBlock).textContent).toBe("Leg waiting to be logged · Comanche 250");
    expect(field(plainBlock, /^From/).value).toBe("KBOS");
  });
});
