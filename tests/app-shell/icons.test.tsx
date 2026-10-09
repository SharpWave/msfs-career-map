import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, IconButton } from "../../src/client/components/Icon.tsx";
import { Fleet } from "../../src/client/components/Fleet.tsx";
import { Menu } from "../../src/client/components/Menu.tsx";
import { MapToolbar } from "../../src/client/components/MapToolbar.tsx";
import { Sidebar } from "../../src/client/components/Sidebar.tsx";
import { aircraft, appState, hop, liveState } from "../support/page-data.ts";

/** Text glyphs the page once used as controls; one icon set replaces them all. */
const GLYPHS = /[◀▶▾▸✎✕↑↓👁🚫🔗]/u;

describe("the icon set", () => {
  // @spec APP-UI-026
  it("draws an icon as inline SVG, hidden from screen readers", () => {
    const { container } = render(<Icon name="layers" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("data-icon")).toBe("layers");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  // @spec APP-UI-026
  it("names an icon-only button with the words of its tooltip", () => {
    render(<IconButton icon="pencil" label="Edit aircraft" onClick={() => {}} />);
    const b = screen.getByRole("button", { name: "Edit aircraft" });
    expect(b.getAttribute("title")).toBe("Edit aircraft");
    expect(b.querySelector("svg[data-icon='pencil']")).not.toBeNull();
  });

  // @spec APP-UI-026
  it("leaves no text glyph on any control, and names every icon-only button", () => {
    const noop = () => {};
    const state = appState({ aircraft: [aircraft({ sim_title: "Comanche 250" })], hops: [hop()] });
    render(
      <div>
        <Menu counts={null} open onOpenChange={noop} onChoose={noop} columnHidden={false} onToggleColumn={noop} />
        <MapToolbar
          basemap="dark"
          onBasemap={noop}
          nightOn
          onToggleNight={noop}
          hazards={new Set()}
          onToggleHazard={noop}
          hazardStatus={null}
          layersOpen
          onLayersOpenChange={noop}
          onFitAll={noop}
          highlighted
          onClearHighlight={noop}
          planShown
          onClearPlan={noop}
        />
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
        />
        <Fleet state={state} selectedId={null} onSelect={noop} onFocusHop={noop} reload={async () => {}} form={null} onFormChange={noop} />
      </div>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(GLYPHS);
      if ((b.textContent ?? "").trim() === "") {
        const name = b.getAttribute("aria-label");
        expect(name, b.outerHTML).toBeTruthy();
        expect(b.getAttribute("title")).toBe(name);
      }
    }
  });
});
