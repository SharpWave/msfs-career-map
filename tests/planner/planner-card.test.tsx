/**
 * The planner card with forecast winds (PLAN-FORM-012, PLAN-RUN-005, PLAN-LIST-001, PLAN-LIST-010):
 * the winds switch and what it sends, the switch following a result, and the summary and notices
 * for a result timed in the wind or in still air.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Planner } from "../../src/client/components/Planner.tsx";
import type { PlanResult } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, appState, hop, planResult } from "../support/page-data.ts";

const STATE = appState({ aircraft: [aircraft({ id: 1 })], hops: [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" })] });

function renderCard(plan: PlanResult | null = null, onPlan = vi.fn()) {
  const props = {
    state: STATE,
    plan,
    metars: new Map(),
    flags: new Map(),
    hideFlagged: true,
    onHideFlagged: vi.fn(),
    selectedId: 1,
    onPlan,
    onPick: vi.fn(),
    onFocus: vi.fn(),
    onEditAircraft: vi.fn(),
  };
  const r = render(<Planner {...props} />);
  return { ...r, rerender: (p: PlanResult | null) => r.rerender(<Planner {...props} plan={p} />) };
}

const windSwitch = () => screen.getByRole("checkbox", { name: "Time legs with forecast winds" }) as HTMLInputElement;
const summary = () => (document.querySelector(".plan-summary")?.textContent ?? "").replace(/\s+/g, " ");

const OFF: PlanResult["wind"] = { status: "off", reason: null, hour: null, levels_hpa: [], grid_deg: null };
const UNAVAILABLE = (reason: string) => ({ status: "unavailable", reason, hour: null, levels_hpa: [], grid_deg: null }) as PlanResult["wind"];
/** 72 radii from `east` nm at 090° to `west` nm at 270°. */
const skewed = (east: number, west: number) =>
  Array.from({ length: 72 }, (_, i) => (east + west) / 2 + ((east - west) / 2) * Math.sin((i * 5 * Math.PI) / 180));

describe("the forecast-winds switch", () => {
  // @spec PLAN-FORM-012
  it("is on when the card opens and searches in still air while off", async () => {
    const urls: URL[] = [];
    answerFetch(/\/api\/plan\?/, (url) => {
      urls.push(url);
      return Response.json(planResult(1, ["KACK"]));
    });
    renderCard();
    expect(windSwitch().checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0].searchParams.get("wind")).not.toBe("0");

    fireEvent.click(windSwitch());
    expect(windSwitch().checked).toBe(false);
    await waitFor(() => expect((screen.getByRole("button", { name: "Find airports in range" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Find airports in range" }));
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[1].searchParams.get("wind")).toBe("0");
  });

  // @spec PLAN-RUN-005
  it("follows a result: off for still air by request, on otherwise", () => {
    const card = renderCard(planResult(1, ["KACK"], { wind: OFF }));
    expect(windSwitch().checked).toBe(false);
    card.rerender(planResult(1, ["KACK"], { wind: UNAVAILABLE("failed") }));
    expect(windSwitch().checked).toBe(true);
    card.rerender(planResult(1, ["KACK"], { wind: OFF }));
    expect(windSwitch().checked).toBe(false);
    card.rerender(planResult(1, ["KACK"]));
    expect(windSwitch().checked).toBe(true);
  });
});

describe("the result's summary", () => {
  // @spec PLAN-LIST-001
  it("gives the ring's shortest and longest reach and the forecast hour with winds", () => {
    const ring = skewed(199.6, 140.4);
    renderCard(planResult(1, ["KACK"], { ring_nm: ring, range_nm: Math.max(...ring), wind: { status: "forecast", reason: null, hour: "2026-11-02T14:00Z", levels_hpa: [900, 850, 800, 700], grid_deg: 0.5 } }));
    expect(summary()).toContain("1 airport within 140–200 nm of KPVD");
    expect(summary()).toContain("(1h 30m at 160 kts true airspeed, forecast winds for 14:00Z)");
    expect(summary()).toMatch(/climb, cruise and descent each fly in the wind at their own height/i);
  });

  // @spec PLAN-LIST-001
  it("gives one reach when the shortest and longest round to the same figure", () => {
    const ring = skewed(200.3, 199.7);
    renderCard(planResult(1, ["KACK"], { ring_nm: ring, range_nm: Math.max(...ring) }));
    expect(summary()).toContain("within 200 nm of KPVD");
    expect(summary()).not.toContain("–");
  });

  // @spec PLAN-LIST-001
  it("reads as before in still air", () => {
    renderCard(planResult(1, ["KACK"], { wind: OFF }));
    expect(summary()).toContain("1 airport within 200 nm of KPVD (1h 30m at 160 kts)");
    expect(summary()).not.toMatch(/true airspeed|in the wind/);
  });

  // @spec PLAN-LIST-010
  it("says when the winds were unavailable and the times are in still air", () => {
    const card = renderCard(planResult(1, ["KACK"], { wind: UNAVAILABLE("failed") }));
    expect(screen.getByText("Forecast winds unavailable, so times are in still air.")).toBeTruthy();
    card.rerender(planResult(1, ["KACK"], { wind: UNAVAILABLE("recent_failure") }));
    expect(screen.getByText("Forecast winds unavailable, so times are in still air.")).toBeTruthy();
    card.rerender(planResult(1, ["KACK"], { wind: UNAVAILABLE("too_wide") }));
    expect(screen.getByText("Forecast winds cover at most some 5,000 nm, so times are in still air.")).toBeTruthy();
    card.rerender(planResult(1, ["KACK"], { wind: OFF }));
    expect(screen.queryByText(/so times are in still air/)).toBeNull();
  });
});
