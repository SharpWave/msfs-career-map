import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MapToolbar, type MapToolbarProps } from "../../src/client/components/MapToolbar.tsx";
import { HAZARD_STYLE } from "../../src/client/components/HazardLayer.tsx";
import type { Basemap } from "../../src/client/components/MapView.tsx";
import type { HazardKind } from "../../src/client/types.ts";

type Extra = Partial<Omit<MapToolbarProps, "basemap" | "onBasemap" | "nightOn" | "onToggleNight" | "hazards" | "onToggleHazard" | "layersOpen" | "onLayersOpenChange">>;

/** The toolbar with its own view state, as the page keeps it. */
function Harness(extra: Extra & { initialHazards?: HazardKind[]; initialNight?: boolean }) {
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [nightOn, setNightOn] = useState(extra.initialNight ?? false);
  const [hazards, setHazards] = useState(new Set<HazardKind>(extra.initialHazards ?? []));
  const [open, setOpen] = useState(false);
  return (
    <MapToolbar
      basemap={basemap}
      onBasemap={setBasemap}
      nightOn={nightOn}
      onToggleNight={() => setNightOn((v) => !v)}
      hazards={hazards}
      onToggleHazard={(k) =>
        setHazards((s) => {
          const n = new Set(s);
          if (n.has(k)) n.delete(k);
          else n.add(k);
          return n;
        })
      }
      hazardStatus={extra.hazardStatus ?? null}
      layersOpen={open}
      onLayersOpenChange={setOpen}
      onFitAll={extra.onFitAll ?? (() => {})}
      highlighted={extra.highlighted ?? false}
      onClearHighlight={extra.onClearHighlight ?? (() => {})}
      planShown={extra.planShown ?? false}
      onClearPlan={extra.onClearPlan ?? (() => {})}
    />
  );
}

const layersButton = () => screen.getByRole("button", { name: "Layers" });
const pressed = (name: string) => within(screen.getByRole("dialog", { name: "Layers" })).getByRole("button", { name }).getAttribute("aria-pressed");

describe("the map toolbar", () => {
  // @spec MAP-VIEW-006
  it("offers Layers and Fit all, with no basemap or hazard buttons of its own", () => {
    render(<Harness />);
    expect(layersButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Fit all" })).toBeTruthy();
    for (const name of ["Dark", "Light", "Satellite", "Night shading", "Ice", "Storms"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  // @spec MAP-VIEW-006, MAP-HAZ-005
  it("opens a Layers menu with the basemaps, night shading and the four hazard toggles with what each covers", () => {
    render(<Harness />);
    fireEvent.click(layersButton());
    const menu = screen.getByRole("dialog", { name: "Layers" });
    for (const name of ["Dark", "Light", "Satellite", "Night shading", "Ice", "Turb", "IFR", "Storms"]) {
      expect(within(menu).getByRole("button", { name })).toBeTruthy();
    }
    for (const covers of ["Icing", "Turbulence", "IFR and mountain obscuration", "Convective, volcanic ash, tropical cyclones"]) {
      expect(menu.textContent).toContain(covers);
    }
    expect(menu.textContent).toContain("aviationweather.gov");
  });

  // @spec MAP-VIEW-006
  it("applies a choice at once and leaves the menu open", () => {
    render(<Harness />);
    fireEvent.click(layersButton());
    expect(pressed("Dark")).toBe("true");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Layers" })).getByRole("button", { name: "Satellite" }));
    expect(pressed("Satellite")).toBe("true");
    expect(pressed("Dark")).toBe("false");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Layers" })).getByRole("button", { name: "Night shading" }));
    expect(pressed("Night shading")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Layers" })).toBeTruthy();
  });

  // @spec MAP-HAZ-005
  it("shows a hazard toggle that is on in its hazard color", () => {
    render(<Harness initialHazards={["ICE"]} />);
    fireEvent.click(layersButton());
    const ice = within(screen.getByRole("dialog", { name: "Layers" })).getByRole("button", { name: "Ice" });
    expect(ice.getAttribute("aria-pressed")).toBe("true");
    expect(ice.style.getPropertyValue("--hz")).toBe(HAZARD_STYLE.ICE.color);
  });

  // @spec MAP-VIEW-007
  it("marks night shading with a moon and each hazard toggle that is on with a dot in its color", () => {
    const { unmount } = render(<Harness />);
    expect(layersButton().querySelector("[data-icon='moon']")).toBeNull();
    expect(layersButton().querySelectorAll(".hz-dot")).toHaveLength(0);
    unmount();

    render(<Harness initialNight initialHazards={["ICE", "CONVECTIVE"]} />);
    expect(layersButton().querySelector("[data-icon='moon']")).not.toBeNull();
    const dots = Array.from(layersButton().querySelectorAll(".hz-dot")) as HTMLElement[];
    expect(dots.map((d) => d.dataset.hazard)).toEqual(["ICE", "CONVECTIVE"]);
    expect(dots[0].style.background).not.toBe("");
  });

  // @spec MAP-HAZ-008
  it("shows the number of hazard areas drawn, or that hazards are unavailable, while a toggle is on", () => {
    const { unmount } = render(<Harness initialHazards={["IFR"]} hazardStatus={{ count: 12, fetched_at: "2026-10-09T14:00:00.000Z", error: null }} />);
    expect(screen.getByText("12 areas").getAttribute("title")).toMatch(/^fetched /);
    unmount();
    const r = render(<Harness initialHazards={["IFR"]} hazardStatus={{ count: 0, fetched_at: null, error: "down" }} />);
    expect(screen.getByText("hazards unavailable")).toBeTruthy();
    r.unmount();
    render(<Harness hazardStatus={{ count: 12, fetched_at: null, error: null }} />);
    expect(screen.queryByText("12 areas")).toBeNull();
  });

  // @spec MAP-HL-002, PLAN-RUN-002
  it("offers Clear highlight and Clear plan while they apply", () => {
    const onClearHighlight = vi.fn();
    const onClearPlan = vi.fn();
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole("button", { name: "Clear highlight" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear plan" })).toBeNull();
    unmount();
    render(<Harness highlighted planShown onClearHighlight={onClearHighlight} onClearPlan={onClearPlan} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear highlight" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear plan" }));
    expect(onClearHighlight).toHaveBeenCalledTimes(1);
    expect(onClearPlan).toHaveBeenCalledTimes(1);
  });

  // @spec APP-UI-016
  it("closes the Layers menu on Esc", () => {
    render(<Harness />);
    fireEvent.click(layersButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Layers" })).toBeNull();
  });
});
