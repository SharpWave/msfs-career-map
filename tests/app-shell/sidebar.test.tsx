import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Sidebar } from "../../src/client/components/Sidebar.tsx";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft, airport, appState, hop, liveState } from "../support/page-data.ts";

const noop = () => {};
const state = appState({ aircraft: [aircraft()], hops: [hop()] });

function renderSidebar() {
  return render(
    <Sidebar
      state={state}
      selectedId={null}
      onSelect={noop}
      reload={async () => {}}
      plan={null}
      metars={new Map()}
      flags={new Map()}
      hideFlagged
      onHideFlagged={noop}
      onPlan={noop}
      onPickCandidate={noop}
      onFocusCandidate={noop}
      onEditAircraft={noop}
      live={liveState(null)}
      onFocusLive={noop}
      onOpenLive={noop}
      onNewFromSim={noop}
    />,
  );
}

const isHidden = (el: Element) => el.closest("[hidden]") !== null;
const maxTime = () => screen.getByLabelText(/Max flight time/) as HTMLInputElement;

describe("the sidebar's cards", () => {
  beforeEach(() => {
    localStorage.clear();
    answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  });

  // @spec APP-UI-001
  it("holds Live from the sim above Plan next hop", () => {
    renderSidebar();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Live from the sim", "Plan next hop"]);
  });

  // @spec APP-UI-029
  it("opens both cards on a first visit", () => {
    renderSidebar();
    expect(isHidden(maxTime())).toBe(false);
    expect(isHidden(screen.getByText("Waiting for the tracker…"))).toBe(false);
  });

  // @spec APP-UI-029
  it("collapses a card without discarding what it holds", () => {
    renderSidebar();
    fireEvent.change(maxTime(), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Plan next hop" }));
    expect(isHidden(maxTime())).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Expand Plan next hop" }));
    expect(isHidden(maxTime())).toBe(false);
    expect(maxTime().value).toBe("120");
  });

  // @spec APP-UI-029
  it("remembers in the browser which cards were left collapsed", () => {
    const first = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Plan next hop" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Live from the sim" }));
    first.unmount();

    renderSidebar();
    expect(isHidden(maxTime())).toBe(true);
    expect(screen.getByRole("button", { name: "Expand Plan next hop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand Live from the sim" })).toBeTruthy();
  });
});
