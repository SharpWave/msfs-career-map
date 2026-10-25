/**
 * The window's size and place (src/desktop/window-place.ts; m2 contract §13.3), all in Windows'
 * scaled units: a smallest content size of 800 × 600 or the work area when smaller
 * (DESK-SHELL-WIN-022); with no saved place, or one whose title bar fits no display, 1280 × 800 or
 * the primary's work area, centred on the primary (WIN-023); a saved place whose title bar lies in
 * a display's work area over its full height and at least 100 of its width opens there, its size
 * clamped (WIN-024); the saved normal bounds and maximized flag (WIN-025) reopen maximized on the
 * display holding them, else the primary (WIN-026); never minimized (WIN-027).
 */
import { describe, expect, it } from "vitest";
import { type DisplayInfo, initialPlace, minContentSize } from "../../../src/desktop/window-place.ts";

const PRIMARY: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
/** A second display to the primary's left. */
const LEFT: DisplayInfo = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
/** A second display to the primary's right. */
const RIGHT: DisplayInfo = { id: 3, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
/** A second display above the primary. */
const ABOVE: DisplayInfo = { id: 4, workArea: { x: 0, y: -1080, width: 1920, height: 1040 } };

const saved = (x: number, y: number, width: number, height: number, maximized = false) => ({ x, y, width, height, maximized });
const CENTRED_ON_PRIMARY = { x: 320, y: 120, width: 1280, height: 800 };

describe("opening with no saved place", () => {
  // @spec DESK-SHELL-WIN-023, DESK-SHELL-WIN-027
  it("opens 1280 × 800, centred on the primary display, not maximized", () => {
    expect(initialPlace(null, [PRIMARY], PRIMARY)).toEqual({ bounds: CENTRED_ON_PRIMARY, maximized: false, displayId: 1 });
    expect(initialPlace(null, [LEFT, PRIMARY, RIGHT], PRIMARY)).toEqual({ bounds: CENTRED_ON_PRIMARY, maximized: false, displayId: 1 });
  });

  // @spec DESK-SHELL-WIN-023
  it("centres within the primary's work area, wherever it lies", () => {
    const taskbarLeft: DisplayInfo = { id: 5, workArea: { x: 62, y: 0, width: 1858, height: 1080 } };
    expect(initialPlace(null, [taskbarLeft], taskbarLeft).bounds).toEqual({ x: 351, y: 140, width: 1280, height: 800 });
    const negative: DisplayInfo = { id: 7, workArea: { x: -1920, y: -200, width: 1920, height: 1040 } };
    expect(initialPlace(null, [PRIMARY, negative], negative)).toEqual({
      bounds: { x: -1600, y: -80, width: 1280, height: 800 },
      maximized: false,
      displayId: 7,
    });
    // Math.round of a half.
    const odd: DisplayInfo = { id: 8, workArea: { x: 0, y: 0, width: 1281, height: 801 } };
    expect(initialPlace(null, [odd], odd).bounds).toEqual({ x: 1, y: 1, width: 1280, height: 800 });
  });

  // @spec DESK-SHELL-WIN-023
  it("takes the primary's work area when it is smaller than 1280 × 800, or than 800 × 600", () => {
    const small: DisplayInfo = { id: 9, workArea: { x: 0, y: 0, width: 1024, height: 728 } };
    expect(initialPlace(null, [small], small).bounds).toEqual({ x: 0, y: 0, width: 1024, height: 728 });
    const narrow: DisplayInfo = { id: 10, workArea: { x: 0, y: 40, width: 1100, height: 1000 } };
    expect(initialPlace(null, [narrow], narrow).bounds).toEqual({ x: 0, y: 140, width: 1100, height: 800 });
    const tiny: DisplayInfo = { id: 11, workArea: { x: 0, y: 0, width: 640, height: 480 } };
    expect(initialPlace(null, [tiny], tiny).bounds).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});

describe("opening at a saved place", () => {
  // @spec DESK-SHELL-WIN-024, DESK-SHELL-WIN-025
  it("opens at the saved normal bounds when the title bar fits a display", () => {
    expect(initialPlace(saved(200, 100, 1000, 700), [PRIMARY], PRIMARY)).toEqual({
      bounds: { x: 200, y: 100, width: 1000, height: 700 },
      maximized: false,
      displayId: 1,
    });
  });

  // @spec DESK-SHELL-WIN-024
  it("opens on a second display at negative coordinates", () => {
    expect(initialPlace(saved(-1500, 50, 1200, 900), [PRIMARY, LEFT], PRIMARY)).toEqual({
      bounds: { x: -1500, y: 50, width: 1200, height: 900 },
      maximized: false,
      displayId: 2,
    });
    expect(initialPlace(saved(100, -1000, 1000, 700), [PRIMARY, ABOVE], PRIMARY)).toEqual({
      bounds: { x: 100, y: -1000, width: 1000, height: 700 },
      maximized: false,
      displayId: 4,
    });
  });

  // @spec DESK-SHELL-WIN-024
  it("clamps the size to the work area it fits, keeping the place", () => {
    expect(initialPlace(saved(0, 0, 2500, 1300), [PRIMARY], PRIMARY)).toEqual({
      bounds: { x: 0, y: 0, width: 1920, height: 1040 },
      maximized: false,
      displayId: 1,
    });
    const small: DisplayInfo = { id: 12, workArea: { x: 1920, y: 0, width: 1024, height: 728 } };
    expect(initialPlace(saved(2000, 10, 1280, 800), [PRIMARY, small], PRIMARY)).toEqual({
      bounds: { x: 2000, y: 10, width: 1024, height: 728 },
      maximized: false,
      displayId: 12,
    });
  });

  // @spec DESK-SHELL-WIN-024
  it("needs the title bar's full 30 inside the work area's height", () => {
    // y + 30 exactly at the work area's bottom fits.
    expect(initialPlace(saved(100, 1010, 800, 600), [PRIMARY], PRIMARY).bounds).toEqual({ x: 100, y: 1010, width: 800, height: 600 });
    // One more and the bar crosses the bottom: centred on the primary instead.
    expect(initialPlace(saved(100, 1011, 800, 600), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED_ON_PRIMARY);
    // Above the work area's top.
    expect(initialPlace(saved(100, -1, 800, 600), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED_ON_PRIMARY);
    // The work area's top itself fits.
    expect(initialPlace(saved(100, 0, 800, 600), [PRIMARY], PRIMARY).bounds).toEqual({ x: 100, y: 0, width: 800, height: 600 });
  });

  // @spec DESK-SHELL-WIN-024, DESK-SHELL-WIN-023
  it("needs at least 100 of the title bar's width over the work area", () => {
    // Off the right edge: 100 left over the work area fits, 99 does not.
    expect(initialPlace(saved(1820, 200, 400, 300), [PRIMARY], PRIMARY).bounds).toEqual({ x: 1820, y: 200, width: 400, height: 300 });
    expect(initialPlace(saved(1821, 200, 400, 300), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED_ON_PRIMARY);
    // Off the left edge alike.
    expect(initialPlace(saved(-300, 200, 400, 300), [PRIMARY], PRIMARY).bounds).toEqual({ x: -300, y: 200, width: 400, height: 300 });
    expect(initialPlace(saved(-301, 200, 400, 300), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED_ON_PRIMARY);
  });

  // @spec DESK-SHELL-WIN-023
  it("opens as the first time when the saved place fits no display (a display unplugged)", () => {
    expect(initialPlace(saved(-1500, 50, 1200, 900), [PRIMARY], PRIMARY)).toEqual({
      bounds: CENTRED_ON_PRIMARY,
      maximized: false,
      displayId: 1,
    });
  });

  // @spec DESK-SHELL-WIN-024
  it("uses the first display, in the order given, that the title bar fits", () => {
    // A bar spanning the primary and the right-hand display, over each by more than 100.
    const place = saved(1700, 100, 600, 400);
    expect(initialPlace(place, [PRIMARY, RIGHT], PRIMARY).displayId).toBe(1);
    expect(initialPlace(place, [RIGHT, PRIMARY], PRIMARY).displayId).toBe(3);
    expect(initialPlace(place, [RIGHT, PRIMARY], PRIMARY).bounds).toEqual({ x: 1700, y: 100, width: 600, height: 400 });
  });
});

describe("opening maximized", () => {
  // @spec DESK-SHELL-WIN-026, DESK-SHELL-WIN-025
  it("opens maximized on the display holding the saved place", () => {
    expect(initialPlace(saved(-1800, 100, 1200, 800, true), [PRIMARY, LEFT], PRIMARY)).toEqual({
      bounds: { x: -1800, y: 100, width: 1200, height: 800 },
      maximized: true,
      displayId: 2,
    });
  });

  // @spec DESK-SHELL-WIN-026
  it("opens maximized on the primary when the saved place is off every display", () => {
    expect(initialPlace(saved(5000, 5000, 1200, 800, true), [PRIMARY, LEFT], PRIMARY)).toEqual({
      bounds: CENTRED_ON_PRIMARY,
      maximized: true,
      displayId: 1,
    });
  });

  // @spec DESK-SHELL-WIN-027
  it("never opens minimized: the outcome has no such field", () => {
    for (const s of [null, saved(200, 100, 1000, 700), saved(200, 100, 1000, 700, true), saved(9000, 9000, 10, 10)]) {
      const place = initialPlace(s, [PRIMARY], PRIMARY);
      expect(Object.keys(place).sort()).toEqual(["bounds", "displayId", "maximized"]);
      expect(Object.keys(place.bounds).sort()).toEqual(["height", "width", "x", "y"]);
    }
  });
});

describe("the smallest content size", () => {
  // @spec DESK-SHELL-WIN-022
  it("is 800 × 600, or less where the work area leaves less room in either direction", () => {
    expect(minContentSize(PRIMARY.workArea)).toEqual({ width: 800, height: 600 });
    expect(minContentSize({ x: 0, y: 0, width: 1024, height: 728 })).toEqual({ width: 800, height: 600 });
    expect(minContentSize({ x: 0, y: 0, width: 700, height: 900 })).toEqual({ width: 700, height: 600 });
    expect(minContentSize({ x: -1920, y: 0, width: 1920, height: 560 })).toEqual({ width: 800, height: 560 });
    expect(minContentSize({ x: 0, y: 0, width: 640, height: 480 })).toEqual({ width: 640, height: 480 });
  });
});
