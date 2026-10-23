import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Landing } from "../../src/client/types.ts";
import { aircraft, appState, hop, liveState, touchdown, trackerStatus } from "../support/page-data.ts";

const chart = vi.hoisted(() => ({ broken: false }));
vi.mock("../../src/client/components/ProfileChart.tsx", () => ({
  ProfileChart: () => {
    if (chart.broken) throw new Error("bad track");
    return <div>profile chart</div>;
  },
}));

const { FlightPanel } = await import("../../src/client/components/FlightPanel.tsx");

const state = appState({ aircraft: [aircraft()], hops: [hop({ id: 5 })] });
const swallow = (e: ErrorEvent) => e.preventDefault();

function renderPanel(onClose = () => {}) {
  return render(
    <FlightPanel source={{ kind: "hop", hopId: 5 }} state={state} live={liveState(null)} briefing={null} onClose={onClose} onBriefingChanged={() => {}} />,
  );
}

describe("the flight panel", () => {
  beforeEach(() => {
    chart.broken = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", swallow);
  });
  afterEach(() => {
    window.removeEventListener("error", swallow);
    vi.restoreAllMocks();
  });

  // @spec PANEL-OPEN-003
  it("closes from its close button", () => {
    const onClose = vi.fn();
    renderPanel(onClose);
    const close = screen.getByRole("button", { name: "Close the flight panel" });
    expect(close.querySelector("svg[data-icon='close']")).not.toBeNull();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // @spec APP-UI-005, PANEL-OPEN-007
  it("keeps its place, header and close button when its contents fail to render", () => {
    chart.broken = true;
    const onClose = vi.fn();
    const { container } = renderPanel(onClose);
    const panel = container.querySelector("section.flight-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Flight panel failed: bad track");
    expect(panel.textContent).toContain("KBOS → KPVD");
    fireEvent.click(screen.getByRole("button", { name: "Close the flight panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the landing card", () => {
  const card = () => screen.getByRole("heading", { name: "Landing" }).parentElement as HTMLElement;
  const descentRate = () => within(card()).getByText("Descent rate").nextElementSibling?.textContent;
  const chips = () => Array.from(card().querySelectorAll(".td-chip")).map((c) => c.textContent);

  beforeEach(() => {
    chart.broken = false;
  });

  // @spec PANEL-LAND-001, PANEL-LAND-002, PANEL-LOOK-004
  it("shows a bounced hop's first touchdown, with every touchdown as a chip", () => {
    const bounced = hop({ id: 6, landings: JSON.stringify([touchdown(0, 420, "hard", { g: 1.9 }), touchdown(4, 90, "butter", { g: 1.2 })]) });
    render(
      <FlightPanel source={{ kind: "hop", hopId: 6 }} state={appState({ aircraft: [aircraft()], hops: [bounced] })} live={liveState(null)} briefing={null} onClose={() => {}} onBriefingChanged={() => {}} />,
    );
    expect(card().querySelector(".word")?.textContent).toBe("Hard");
    expect(descentRate()).toBe("420 fpm");
    expect(within(card()).getByText("Peak G").nextElementSibling?.textContent).toBe("1.90 G");
    expect(chips()).toEqual(["💥 420", "🧈 90"]);
  });

  // @spec PANEL-LAND-001, PANEL-LOOK-004
  it("shows the first touchdown of the live leg's latest landing", () => {
    const landings: Landing[] = [touchdown(0, 300, "solid"), touchdown(300, 450, "hard"), touchdown(303, 80, "butter")];
    const leg = { origin: "KPVD", departed_at: "2026-10-21T14:55:00.000Z", touchdown_at: landings[2].t, points: 90, landings, max_alt_ft: 1500, fuel_used_lb: null };
    render(
      <FlightPanel source={{ kind: "live" }} state={appState({ aircraft: [aircraft()] })} live={liveState(trackerStatus({ phase: "landed", leg }))} briefing={null} onClose={() => {}} onBriefingChanged={() => {}} />,
    );
    expect(card().querySelector(".word")?.textContent).toBe("Hard");
    expect(descentRate()).toBe("450 fpm");
    expect(chips()).toEqual(["👍 300", "💥 450", "🧈 80"]);
  });
});
