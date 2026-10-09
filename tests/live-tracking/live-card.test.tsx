import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LivePanel } from "../../src/client/components/LivePanel.tsx";
import type { TrackerStatus } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, airport, liveState, pendingLeg, trackerStatus } from "../support/page-data.ts";

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
});
