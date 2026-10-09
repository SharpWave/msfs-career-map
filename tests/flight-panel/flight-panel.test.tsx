import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aircraft, appState, hop, liveState } from "../support/page-data.ts";

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
