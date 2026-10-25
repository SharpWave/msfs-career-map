import type { SavedWindow } from "./settings.ts";

/** The window's size and place, all in Windows' scaled units. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  workArea: Rect;
}

/** The height of the title bar a saved place must keep on a display. */
const TITLE_BAR = 30;
/** How much of the title bar's width must lie over the display. */
const BAR_OVERLAP = 100;

/** Whether the saved place's title bar lies in the work area over its full height and at least 100 of its width. */
function fits(s: SavedWindow, wa: Rect): boolean {
  if (s.y < wa.y || s.y + TITLE_BAR > wa.y + wa.height) return false;
  const overlap = Math.min(s.x + s.width, wa.x + wa.width) - Math.max(s.x, wa.x);
  return overlap >= BAR_OVERLAP;
}

/** The saved place on the first display it fits, its size clamped; else 1280 × 800 or less, centred on the primary. Never minimized. */
// @spec DESK-SHELL-WIN-023, DESK-SHELL-WIN-024, DESK-SHELL-WIN-026, DESK-SHELL-WIN-027
export function initialPlace(
  saved: SavedWindow | null,
  displays: DisplayInfo[],
  primary: DisplayInfo,
): { bounds: Rect; maximized: boolean; displayId: number } {
  const maximized = saved?.maximized ?? false;
  const display = saved ? displays.find((d) => fits(saved, d.workArea)) : undefined;
  if (saved && display) {
    const wa = display.workArea;
    return {
      bounds: { x: saved.x, y: saved.y, width: Math.min(saved.width, wa.width), height: Math.min(saved.height, wa.height) },
      maximized,
      displayId: display.id,
    };
  }
  const wa = primary.workArea;
  const width = Math.min(1280, wa.width);
  const height = Math.min(800, wa.height);
  return {
    bounds: { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height },
    maximized,
    displayId: primary.id,
  };
}

/** 800 × 600, or the work area where it leaves less room; the glue adds the frame. */
// @spec DESK-SHELL-WIN-022
export function minContentSize(workArea: Rect): { width: number; height: number } {
  return { width: Math.min(800, workArea.width), height: Math.min(600, workArea.height) };
}
