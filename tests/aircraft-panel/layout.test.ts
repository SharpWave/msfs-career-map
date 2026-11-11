/**
 * The aircraft panel in the page's layout numbers (src/client/layout.ts): the part of the map it
 * covers, the room it has, and when its hop list scrolls alone.
 */
import { describe, expect, it } from "vitest";
import { aircraftPanelRoom, clearInsets, listScrollsAlone } from "../../src/client/layout.ts";

describe("the clear part of the map with the aircraft panel open", () => {
  // @spec ACP-LAY-003, APP-UI-020
  it("ends one gutter left of the panel, which is as wide as the left column", () => {
    expect(clearInsets({ width: 1600, height: 1000 }, { columnShown: true, panelOpen: true, aircraftPanelOpen: true })).toEqual({
      top: 52,
      right: 12 + 400,
      bottom: 12 + 400,
      left: 12 + 400,
    });
    expect(clearInsets({ width: 900, height: 700 }, { columnShown: false, panelOpen: false, aircraftPanelOpen: true })).toEqual({
      top: 52,
      right: 12 + 340,
      bottom: 0,
      left: 12,
    });
  });

  // @spec APP-UI-020
  it("reaches the window's right edge while the panel is closed", () => {
    expect(clearInsets({ width: 1600, height: 1000 }, { columnShown: true, panelOpen: false, aircraftPanelOpen: false }).right).toBe(0);
    expect(clearInsets({ width: 1600, height: 1000 }, { columnShown: true, panelOpen: false }).right).toBe(0);
  });
});

describe("the aircraft panel's room", () => {
  // @spec ACP-LAY-001
  it("runs from the left column's top to the bottom gutter", () => {
    expect(aircraftPanelRoom({ width: 1920, height: 1080 }, { panelOpen: false })).toBe(1080 - 64 - 12);
    expect(aircraftPanelRoom({ width: 800, height: 600 }, { panelOpen: false })).toBe(524);
  });

  // @spec ACP-LAY-001
  it("stops one gutter above the flight panel while a flight is open", () => {
    // a 432 px flight panel on a 1080 px window
    expect(aircraftPanelRoom({ width: 1920, height: 1080 }, { panelOpen: true })).toBe(1080 - 64 - 12 - 432 - 12);
    // the flight panel's 260 px minimum
    expect(aircraftPanelRoom({ width: 800, height: 600 }, { panelOpen: true })).toBe(600 - 64 - 12 - 260 - 12);
    expect(aircraftPanelRoom({ width: 800, height: 588 }, { panelOpen: true })).toBe(240);
  });

  // @spec ACP-LAY-001
  it("runs to the bottom gutter, over the flight panel, in a window too short to leave it 240 px above", () => {
    expect(aircraftPanelRoom({ width: 800, height: 587 }, { panelOpen: true })).toBe(587 - 64 - 12);
    expect(aircraftPanelRoom({ width: 700, height: 520 }, { panelOpen: true })).toBe(444);
    expect(aircraftPanelRoom({ width: 480, height: 360 }, { panelOpen: true })).toBe(284);
  });
});

describe("how the aircraft panel scrolls", () => {
  // @spec ACP-LAY-002
  it("scrolls the hop list alone while the room leaves it 240 px under a set 380 px", () => {
    expect(listScrollsAlone(620, false)).toBe(true);
    expect(listScrollsAlone(619, false)).toBe(false);
    expect(listScrollsAlone(1004, false)).toBe(true);
  });

  // @spec ACP-LAY-002
  it("allows a further 180 px for a picture", () => {
    expect(listScrollsAlone(800, true)).toBe(true);
    expect(listScrollsAlone(799, true)).toBe(false);
    expect(listScrollsAlone(1004, true)).toBe(true);
  });

  // @spec ACP-LAY-002
  it("scrolls everything as one on a 1080 px window with a flight open", () => {
    const room = aircraftPanelRoom({ width: 1920, height: 1080 }, { panelOpen: true });
    expect(listScrollsAlone(room, false)).toBe(false);
    expect(listScrollsAlone(room, true)).toBe(false);
  });
});
