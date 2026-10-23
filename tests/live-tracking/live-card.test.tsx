import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LivePanel } from "../../src/client/components/LivePanel.tsx";
import type { TrackerStatus } from "../../src/client/types.ts";
import { answerFetch, resetAnswers } from "../support/fetch-guard.ts";
import { aircraft, airport, liveState, pendingLeg, touchdown, trackerStatus } from "../support/page-data.ts";

const POSITION: TrackerStatus["position"] = {
  lat: 41.72, lon: -71.43, alt_ft: 1250, gs_kts: 95, hdg_deg: 45, vs_fpm: 0, ias_kts: 92, fuel_lb: 300, on_ground: false,
  t: "2026-10-09T14:00:00.000Z",
};

function renderCard(status: TrackerStatus | null, open: boolean, onToggle = () => {}) {
  return render(
    <LivePanel
      live={liveState(status)}
      aircraft={[aircraft()]}
      reload={async () => {}}
      onFocusLive={() => {}}
      onOpenLive={() => {}}
      onSelect={() => {}}
      onNewFromSim={() => {}}
      open={open}
      onToggle={onToggle}
    />,
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
    renderCard(trackerStatus({ phase: "airborne", position: POSITION, pending: pendingLeg() }), false);
    const line = strip();
    expect(line).toBeTruthy();
    expect(line.querySelector(".pill")?.textContent).toBe("airborne");
    expect(line.textContent).toContain("1,250 ft · 95 kt · 045°");
    const waiting = Array.from(line.querySelectorAll(".caution")).find((e) => e.textContent === "Leg waiting to be logged");
    expect(waiting).toBeTruthy();
    expect(document.querySelector(".live-grid")?.closest("[hidden]")).not.toBeNull();
  });

  // @spec LIVE-CARD-011
  it("leaves the readout and the waiting note out of the line when they do not apply", () => {
    const r = renderCard(trackerStatus({ phase: "ground" }), false);
    expect(strip().textContent).not.toMatch(/ft ·/);
    expect(strip().textContent).not.toContain("Leg waiting to be logged");
    r.unmount();
    // A last position kept from before the sim went away is not shown as live.
    renderCard(trackerStatus({ connected: false, sim: null, position: POSITION }), false);
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
        onSelect={() => {}} onNewFromSim={() => {}} open={false} onToggle={() => {}} />,
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
    expect(screen.getByText(/^Casual mode: the path you fly is drawn on the map and nothing is logged\. Switching casual mode off, or stopping the app, clears it\.$/)).toBeTruthy();
    const path = screen.getByText("Path").nextElementSibling as HTMLElement;
    expect(path.textContent).toContain("42 points");
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
