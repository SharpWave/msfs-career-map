/**
 * The page's floating layout in numbers: the left column, the flight panel and the part of the map
 * they leave clear. styles.css draws the same sizes; keep the two in step.
 */

/** Space between the panels and from the window's edges. */
export const GUTTER = 12;
/** Height of the top bar's buttons. */
export const TOP_BAR_H = 40;
/** Windows narrower than this get the narrow column. */
export const NARROW_BELOW = 960;

/** The aircraft panel: a set height for what sits above its hop list, more with a picture, and the least its list is left. */
export const ACP_ABOVE_LIST = 380;
export const ACP_PICTURE = 180;
export const ACP_LIST_MIN = 240;

export type DrawerKey = "log" | "fleet" | "import";

/** Distances in px from each edge of the window to the clear part of the map. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function columnWidth(windowWidth: number): number {
  return windowWidth < NARROW_BELOW ? 340 : 400;
}

export function panelHeight(windowHeight: number): number {
  return Math.max(260, Math.round(windowHeight * 0.4));
}

/** Which panels are open over the map. */
export interface OpenPanels {
  columnShown: boolean;
  panelOpen: boolean;
  aircraftPanelOpen?: boolean;
}

/**
 * The part of the map the panels leave clear: right of the left column (or of the edge gutter while
 * it is hidden), below the top bar, above the flight panel, left of the aircraft panel. Worked out
 * from which panels are open, not measured, so a zoom asked for in the same update that opens a
 * panel already allows for it.
 */
// @spec APP-UI-020, ACP-LAY-003
export function clearInsets(win: { width: number; height: number }, open: OpenPanels): Insets {
  return {
    top: GUTTER + TOP_BAR_H,
    right: open.aircraftPanelOpen ? GUTTER + columnWidth(win.width) : 0,
    bottom: open.panelOpen ? GUTTER + panelHeight(win.height) : 0,
    left: open.columnShown ? GUTTER + columnWidth(win.width) : GUTTER,
  };
}

/**
 * The height the aircraft panel may take: from the left column's top, under the top bar, down to
 * the bottom gutter, or to one gutter above the flight panel while a flight is open. In a window
 * so short that the flight panel would leave it less than its list's minimum, it runs to the
 * bottom gutter instead, over the flight panel's right end. styles.css says the same with a
 * height query: under 588 px the flight panel is 260 px tall and leaves less than 240 px.
 */
// @spec ACP-LAY-001
export function aircraftPanelRoom(win: { width: number; height: number }, open: { panelOpen: boolean }): number {
  const full = win.height - (GUTTER * 2 + TOP_BAR_H) - GUTTER;
  if (!open.panelOpen) return full;
  const aboveFlight = full - panelHeight(win.height) - GUTTER;
  return aboveFlight >= ACP_LIST_MIN ? aboveFlight : full;
}

/**
 * Whether the aircraft panel's hop list scrolls by itself: while the room leaves it its minimum
 * under the parts above it. Otherwise everything under the panel's header scrolls as one.
 */
// @spec ACP-LAY-002
export function listScrollsAlone(room: number, hasPicture: boolean): boolean {
  return room - ACP_ABOVE_LIST - (hasPicture ? ACP_PICTURE : 0) >= ACP_LIST_MIN;
}

/** What the left column shows: the open drawer, else the sidebar, unless it is hidden. */
export interface ColumnState {
  hidden: boolean;
  drawer: DrawerKey | null;
}

export type ColumnAction = { type: "toggle" } | { type: "open"; drawer: DrawerKey } | { type: "close" } | { type: "sidebar" };

export const initialColumn: ColumnState = { hidden: false, drawer: null };

// @spec APP-UI-002, APP-UI-013, APP-UI-014
export function columnReducer(state: ColumnState, action: ColumnAction): ColumnState {
  switch (action.type) {
    case "toggle":
      return { hidden: !state.hidden, drawer: null };
    case "open":
      return { hidden: false, drawer: action.drawer };
    case "close":
      return { ...state, drawer: null };
    case "sidebar":
      return { hidden: false, drawer: null };
  }
}
