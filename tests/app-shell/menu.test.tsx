import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Menu, type Counts } from "../../src/client/components/Menu.tsx";
import type { DrawerKey } from "../../src/client/layout.ts";

const COUNTS: Counts = { aircraft: 7, hops: 25, airports: 72609, runways: 48291 };

function Harness({ counts = COUNTS, onChoose = () => {} }: { counts?: Counts | null; onChoose?: (d: DrawerKey) => void }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <div>
      <Menu counts={counts} open={open} onOpenChange={setOpen} onChoose={onChoose} columnHidden={hidden} onToggleColumn={() => setHidden((h) => !h)} />
      <button type="button" onClick={() => document.body.setAttribute("data-clicked", "yes")}>
        Somewhere else
      </button>
    </div>
  );
}

const menuButton = () => screen.getByRole("button", { name: "Career Map" });

describe("the menu", () => {
  // @spec APP-UI-012
  it("shows the count line and the entries Log a hop and Fleet", () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(menuButton());
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("7 aircraft · 25 hops · 72,609 airports · 48,291 runways");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Log a hop", "Fleet"]);
    expect(items.every((i) => !(i as HTMLButtonElement).disabled)).toBe(true);
  });

  // @spec APP-UI-012
  it("leaves out the count line and disables its entries until the map state has loaded", () => {
    render(<Harness counts={null} />);
    fireEvent.click(menuButton());
    expect(screen.getByRole("menu").textContent).not.toMatch(/aircraft ·/);
    for (const item of screen.getAllByRole("menuitem")) expect((item as HTMLButtonElement).disabled).toBe(true);
  });

  // @spec APP-UI-013
  it("closes and hands over the chosen entry", () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Fleet" }));
    expect(onChoose).toHaveBeenCalledWith("fleet");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // @spec APP-UI-016
  it("closes on Esc, on its button, and on a pointer down outside it, which still acts", () => {
    render(<Harness />);
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(menuButton());
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(menuButton());
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(menuButton());
    const elsewhere = screen.getByRole("button", { name: "Somewhere else" });
    fireEvent.pointerDown(elsewhere);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(elsewhere);
    expect(document.body.getAttribute("data-clicked")).toBe("yes");
  });

  // @spec APP-UI-002
  it("offers the sidebar toggle beside the menu button, named for what it does", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(toggle.getAttribute("title")).toBe("Hide sidebar");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
  });
});
