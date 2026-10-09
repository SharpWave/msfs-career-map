import { describe, expect, it } from "vitest";
import { clearInsets, columnReducer, columnWidth, initialColumn, panelHeight } from "../../src/client/layout.ts";

describe("panel sizes", () => {
  // @spec APP-UI-009
  it("makes the left column 400 px wide, 340 px in a window narrower than 960 px", () => {
    expect(columnWidth(1600)).toBe(400);
    expect(columnWidth(960)).toBe(400);
    expect(columnWidth(959)).toBe(340);
  });

  // @spec APP-UI-009
  it("makes the flight panel 40% of the window's height, at least 260 px", () => {
    expect(panelHeight(1000)).toBe(400);
    expect(panelHeight(768)).toBe(307);
    expect(panelHeight(600)).toBe(260);
  });
});

describe("the clear part of the map", () => {
  // @spec APP-UI-020
  it("lies right of the left column, below the top bar and above the flight panel", () => {
    expect(clearInsets({ width: 1600, height: 1000 }, { columnShown: true, panelOpen: true })).toEqual({
      top: 52,
      right: 0,
      bottom: 12 + 400,
      left: 12 + 400,
    });
  });

  // @spec APP-UI-020
  it("reaches the window's edge gutter while the column is hidden, and the bottom while no flight is open", () => {
    expect(clearInsets({ width: 1600, height: 1000 }, { columnShown: false, panelOpen: false })).toEqual({
      top: 52,
      right: 0,
      bottom: 0,
      left: 12,
    });
  });

  // @spec APP-UI-020
  it("follows the narrow column and the flight panel's minimum height", () => {
    expect(clearInsets({ width: 900, height: 600 }, { columnShown: true, panelOpen: true })).toEqual({
      top: 52,
      right: 0,
      bottom: 12 + 260,
      left: 12 + 340,
    });
  });
});

describe("the left column", () => {
  // @spec APP-UI-002
  it("opens with the sidebar shown", () => {
    expect(initialColumn).toEqual({ hidden: false, drawer: null });
  });

  // @spec APP-UI-002
  it("hides with the toggle, closing an open drawer, and shows the sidebar again", () => {
    const hidden = columnReducer({ hidden: false, drawer: "fleet" }, { type: "toggle" });
    expect(hidden).toEqual({ hidden: true, drawer: null });
    expect(columnReducer(hidden, { type: "toggle" })).toEqual({ hidden: false, drawer: null });
  });

  // @spec APP-UI-013
  it("shows a chosen drawer in place of the sidebar, replacing another, and shows a hidden column", () => {
    expect(columnReducer(initialColumn, { type: "open", drawer: "log" })).toEqual({ hidden: false, drawer: "log" });
    expect(columnReducer({ hidden: false, drawer: "log" }, { type: "open", drawer: "fleet" })).toEqual({ hidden: false, drawer: "fleet" });
    expect(columnReducer({ hidden: true, drawer: null }, { type: "open", drawer: "fleet" })).toEqual({ hidden: false, drawer: "fleet" });
    expect(columnReducer({ hidden: false, drawer: "fleet" }, { type: "open", drawer: "fleet" })).toEqual({ hidden: false, drawer: "fleet" });
  });

  // @spec APP-UI-014
  it("shows the sidebar again when the drawer closes", () => {
    expect(columnReducer({ hidden: false, drawer: "log" }, { type: "close" })).toEqual({ hidden: false, drawer: null });
  });
});
