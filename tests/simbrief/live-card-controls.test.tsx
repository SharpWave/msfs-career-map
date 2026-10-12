import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LivePanel } from "../../src/client/components/LivePanel.tsx";
import type { BriefingSummary, TrackerStatus } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, liveState, trackerStatus } from "../support/page-data.ts";

const CASUAL: TrackerStatus["casual"] = { since: "2026-10-12T14:05:00.000Z", points: 0 };

function plan(over: Partial<BriefingSummary> = {}): BriefingSummary {
  return {
    id: 7, ofp_id: "1760000000_ABC", static_id: null, generated_at: "2026-10-12T13:00:00.000Z", airline: null, flight_number: null,
    callsign: "N6229P", aircraft: { icao: "PA24", name: "Comanche", reg: "N6229P" },
    origin: { icao: "KPVD", name: "Providence", rwy: "05" }, dest: { icao: "KBOS", name: "Boston", rwy: "04R" }, alternate: null,
    route: "DCT", distance_nm: 41, cruise_alt_ft: 5000, ete_min: 22,
    fuel: { units: "lbs", ramp: null, takeoff: null, landing: null, burn: null },
    weights: { pax: 2, cargo: null, payload: null, zfw: null, tow: null, ldw: null }, pdf_url: null, fixes: [],
    ...over,
  };
}

function card(status: TrackerStatus) {
  return (
    <LivePanel live={liveState(status)} aircraft={[aircraft()]} reload={async () => {}} onFocusLive={() => {}} onOpenLive={() => {}}
      onSelect={() => {}} onNewFromSim={() => {}} open onToggle={() => {}} />
  );
}

describe("the SimBrief controls in the live card, in casual mode", () => {
  let alias: string | null;
  beforeEach(() => {
    alias = null;
    answerFetch("/api/settings", () => Response.json({ simbrief_username: alias }));
  });

  // @spec SB-CTRL-001
  it("offers the alias field only while casual mode is off", async () => {
    let r = render(card(trackerStatus()));
    expect(await screen.findByPlaceholderText("SimBrief alias or pilot ID")).toBeTruthy();
    r.unmount();
    r = render(card(trackerStatus({ casual: CASUAL })));
    await screen.findByText(/^Casual mode:/);
    await new Promise((res) => setTimeout(res, 20));
    expect(screen.queryByPlaceholderText("SimBrief alias or pilot ID")).toBeNull();
  });

  // @spec SB-CTRL-002
  it("offers Import SimBrief plan only while casual mode is off", async () => {
    alias = "sharpwave";
    const r = render(card(trackerStatus()));
    expect(await screen.findByRole("button", { name: "Import SimBrief plan" })).toBeTruthy();
    r.rerender(card(trackerStatus({ casual: CASUAL })));
    expect(screen.queryByRole("button", { name: "Import SimBrief plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "sharpwave" })).toBeNull();
  });

  // @spec SB-CTRL-003
  it("hides an open preview when casual mode switches on", async () => {
    alias = "sharpwave";
    answerFetch("/api/simbrief/latest", () => Response.json({ ...plan(), id: null, has_plan_html: true }));
    const r = render(card(trackerStatus()));
    fireEvent.click(await screen.findByRole("button", { name: "Import SimBrief plan" }));
    expect(await screen.findByText("Latest SimBrief plan")).toBeTruthy();
    r.rerender(card(trackerStatus({ casual: CASUAL })));
    expect(screen.queryByText("Latest SimBrief plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this plan" })).toBeNull();
  });

  // @spec SB-CTRL-004
  it("still shows a plan made current before casual mode, with Remove", async () => {
    alias = "sharpwave";
    render(card(trackerStatus({ casual: CASUAL, briefing: plan() })));
    expect(await screen.findByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByText("KPVD → KBOS")).toBeTruthy();
  });
});
