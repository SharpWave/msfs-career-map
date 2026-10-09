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

export type DrawerKey = "log" | "fleet";

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

/**
 * The part of the map the panels leave clear: right of the left column (or of the edge gutter while
 * it is hidden), below the top bar, above the flight panel. Worked out from which panels are open,
 * not measured, so a zoom asked for in the same update that opens a panel already allows for it.
 */
// @spec APP-UI-020
export function clearInsets(win: { width: number; height: number }, open: { columnShown: boolean; panelOpen: boolean }): Insets {
  return {
    top: GUTTER + TOP_BAR_H,
    right: 0,
    bottom: open.panelOpen ? GUTTER + panelHeight(win.height) : 0,
    left: open.columnShown ? GUTTER + columnWidth(win.width) : GUTTER,
  };
}

/** What the left column shows: the open drawer, else the sidebar, unless it is hidden. */
export interface ColumnState {
  hidden: boolean;
  drawer: DrawerKey | null;
}

export type ColumnAction = { type: "toggle" } | { type: "open"; drawer: DrawerKey } | { type: "close" };

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
  }
}
