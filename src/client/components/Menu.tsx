import { forwardRef, useCallback, useRef } from "react";
import { iconInnerHtml } from "../icons";
import type { DrawerKey } from "../layout";
import { Icon, IconButton } from "./Icon";
import { useDismiss } from "./useDismiss";

export interface Counts {
  aircraft: number;
  hops: number;
  airports: number;
  runways: number;
}

interface Props {
  /** null until the map state has loaded. */
  counts: Counts | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (drawer: DrawerKey) => void;
  /** Back up now: ask the server for a backup. */
  onBackup?: () => void;
  columnHidden: boolean;
  onToggleColumn: () => void;
}

type Entry = [DrawerKey | "backup", string];

/** Log a hop and Fleet; Bring in a logbook while the logbook holds no hops; Back up now. */
const entries = (counts: Counts | null): Entry[] => [
  ["log", "Log a hop"],
  ["fleet", "Fleet"],
  ...(counts?.hops === 0 ? ([["import", "Bring in a logbook"]] as Entry[]) : []),
  ["backup", "Back up now"],
];

/**
 * The top bar's left end: the menu button with what a session needs only now and then behind it,
 * and the sidebar toggle.
 */
// @spec APP-UI-001, APP-UI-002, APP-UI-012, APP-UI-013, APP-UI-037, APP-UI-038
export const Menu = forwardRef<HTMLButtonElement, Props>(function Menu({ counts, open, onOpenChange, onChoose, onBackup, columnHidden, onToggleColumn }, buttonRef) {
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismiss(wrap, open, close);

  return (
    <div className="top-left">
      <div className="menu-wrap" ref={wrap}>
        <button
          ref={buttonRef}
          type="button"
          className="menu-button glass"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <span className="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconInnerHtml({ icon: "builtin:single-piston", name: "" }) }} />
          <span className="wordmark">Career Map</span>
          <Icon name="menu" className="menu-glyph" />
        </button>
        {open && (
          <div className="menu glass" role="menu" aria-label="Career Map">
            {counts && (
              <div className="menu-counts" role="presentation">
                {counts.aircraft} aircraft · {counts.hops} hops · {counts.airports.toLocaleString()} airports · {counts.runways.toLocaleString()} runways
              </div>
            )}
            {entries(counts).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={!counts}
                onClick={() => {
                  close();
                  if (key === "backup") onBackup?.();
                  else onChoose(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <IconButton icon="sidebar" label={columnHidden ? "Show sidebar" : "Hide sidebar"} className="glass bar-button" onClick={onToggleColumn} />
    </div>
  );
});
