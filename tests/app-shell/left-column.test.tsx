import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftColumn, type DrawerRequest } from "../../src/client/components/Drawer.tsx";
import type { ColumnState } from "../../src/client/layout.ts";

const scrolled: Element[] = [];
beforeEach(() => {
  scrolled.length = 0;
  // jsdom has no layout, so record what the page asks to scroll into view.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function Typed({ label }: { label: string }) {
  const [v, setV] = useState("");
  return (
    <label>
      <span>{label}</span>
      <input aria-label={label} value={v} onChange={(e) => setV(e.target.value)} />
    </label>
  );
}

function Column({ column, request = null, onClose = () => {} }: { column: ColumnState; request?: DrawerRequest | null; onClose?: () => void }) {
  return (
    <LeftColumn
      column={column}
      request={request}
      onClose={onClose}
      sidebar={<Typed label="Planner field" />}
      drawers={{
        log: {
          title: "Log a hop",
          body: (
            <form className="hop-form">
              <Typed label="Notes" />
              <input aria-label="To" data-handoff-focus="" />
            </form>
          ),
        },
        fleet: { title: "Fleet", body: <Typed label="Aircraft name" /> },
      }}
    />
  );
}

// A drawer by its label, whether or not it is showing (Testing Library gives a hidden element no
// accessible name, so a hidden drawer has no role to find it by); the tests check which it is.
const findDrawer = (title: string) => document.querySelector<HTMLElement>(`section.drawer[aria-label="${title}"]`);
const drawer = (title: string) => {
  const el = findDrawer(title);
  if (!el) throw new Error(`no ${title} drawer`);
  return el;
};
const isHidden = (el: Element) => el.closest("[hidden]") !== null;
const isInert = (el: Element) => el.closest("[inert]") !== null;

describe("the left column", () => {
  // @spec APP-UI-013, APP-UI-018
  it("mounts a drawer the first time it opens and shows it, titled and closable, in place of the sidebar", () => {
    const { rerender } = render(<Column column={{ hidden: false, drawer: null }} />);
    expect(findDrawer("Fleet")).toBeNull();
    const sidebarField = screen.getByLabelText("Planner field");
    expect(isHidden(sidebarField)).toBe(false);

    rerender(<Column column={{ hidden: false, drawer: "fleet" }} request={{ key: 1 }} />);
    const fleet = screen.getByRole("region", { name: "Fleet" });
    expect(within(fleet).getByRole("heading", { name: "Fleet" })).toBeTruthy();
    expect(within(fleet).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(isHidden(fleet)).toBe(false);
    expect(isHidden(sidebarField) && isInert(sidebarField)).toBe(true);
    expect(findDrawer("Log a hop")).toBeNull();
  });

  // @spec APP-UI-018
  it("keeps the sidebar and opened drawers mounted while hidden, inert and as the user left them", () => {
    const { rerender } = render(<Column column={{ hidden: false, drawer: null }} />);
    fireEvent.change(screen.getByLabelText("Planner field"), { target: { value: "90" } });

    rerender(<Column column={{ hidden: false, drawer: "log" }} request={{ key: 1 }} />);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "gusty" } });

    rerender(<Column column={{ hidden: false, drawer: "fleet" }} request={{ key: 2 }} />);
    const notes = screen.getByLabelText("Notes") as HTMLInputElement;
    expect(isHidden(notes) && isInert(notes)).toBe(true);

    rerender(<Column column={{ hidden: false, drawer: null }} />);
    expect((screen.getByLabelText("Planner field") as HTMLInputElement).value).toBe("90");
    expect(notes.value).toBe("gusty");
    expect(isHidden(drawer("Fleet"))).toBe(true);
    expect(isInert(drawer("Log a hop"))).toBe(true);
  });

  // @spec APP-UI-002
  it("hides everything it holds while the column is hidden", () => {
    render(<Column column={{ hidden: true, drawer: null }} />);
    expect(isHidden(screen.getByLabelText("Planner field"))).toBe(true);
  });

  // @spec APP-UI-014
  it("asks to close from the drawer's close button, and returns the focus to the opener when it has closed", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    const { rerender } = render(<Column column={{ hidden: false, drawer: "fleet" }} request={{ key: 1, opener }} onClose={onClose} />);
    fireEvent.click(within(drawer("Fleet")).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<Column column={{ hidden: false, drawer: null }} request={{ key: 1, opener }} onClose={onClose} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // @spec APP-UI-015
  it("moves the focus to the drawer's close button when nothing was handed to it", () => {
    render(<Column column={{ hidden: false, drawer: "fleet" }} request={{ key: 1 }} />);
    expect(document.activeElement).toBe(within(drawer("Fleet")).getByRole("button", { name: "Close" }));
  });

  // @spec APP-UI-015, APP-UI-017
  it("scrolls a hand-off's form into view and focuses the field it fills", () => {
    render(<Column column={{ hidden: false, drawer: "log" }} request={{ key: 1, target: ".hop-form" }} />);
    const form = drawer("Log a hop").querySelector(".hop-form");
    expect(scrolled).toContain(form);
    expect(document.activeElement).toBe(screen.getByLabelText("To"));
  });

  // @spec APP-UI-017
  it("scrolls again for each new hand-off to the drawer already showing", () => {
    const { rerender } = render(<Column column={{ hidden: false, drawer: "log" }} request={{ key: 1, target: ".hop-form" }} />);
    scrolled.length = 0;
    rerender(<Column column={{ hidden: false, drawer: "log" }} request={{ key: 2, target: ".hop-form" }} />);
    expect(scrolled).toHaveLength(1);
  });
});
