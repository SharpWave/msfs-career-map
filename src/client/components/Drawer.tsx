import { useEffect, useRef, type ReactNode } from "react";
import type { ColumnState, DrawerKey } from "../layout";
import { prefersReducedMotion } from "../prefs";
import { IconButton } from "./Icon";

/** A request to show a drawer, made by the menu or by a hand-off from another panel. */
export interface DrawerRequest {
  /** New for every request, so a repeated hand-off scrolls again. */
  key: number;
  /** Selector, inside the drawer, of the form the hand-off fills. */
  target?: string;
  /** Where the keyboard focus goes back to when the drawer closes. */
  opener?: HTMLElement | null;
}

export interface DrawerContent {
  title: string;
  /** Controls beside the title, such as Fleet's + Aircraft. */
  actions?: ReactNode;
  body: ReactNode;
}

/** Takes a panel out of view, out of the tab order and out of what screen readers read. */
const away = (gone: boolean): Record<string, unknown> => (gone ? { hidden: true, inert: "" } : {});

/**
 * The left column: the sidebar, or the open drawer in its place. The sidebar mounts with the page
 * and each drawer the first time it opens; all of them stay mounted while hidden, so what they hold
 * is as the user left it.
 */
// @spec APP-UI-013, APP-UI-014, APP-UI-018
export function LeftColumn({
  column,
  request,
  sidebar,
  drawers,
  onClose,
  fallbackFocus,
}: {
  column: ColumnState;
  request: DrawerRequest | null;
  sidebar: ReactNode;
  drawers: Record<DrawerKey, DrawerContent>;
  onClose: () => void;
  /** Takes the focus back when whatever opened the drawer is gone, such as a closed map popup. */
  fallbackFocus?: HTMLElement | null;
}) {
  const shown = column.hidden ? null : column.drawer;
  const mounted = useRef(new Set<DrawerKey>());
  if (shown) mounted.current.add(shown);

  // When a drawer closes, the focus goes back to whatever opened it, if that can still take it.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown) {
      const opener = request?.opener;
      const usable = opener?.isConnected && !opener.closest("[hidden],[inert]");
      (usable ? opener : fallbackFocus)?.focus();
    }
    wasShown.current = shown;
  }, [shown, request, fallbackFocus]);

  return (
    <div className="left-column" {...away(column.hidden)}>
      <div className="sidebar-slot" {...away(shown !== null)}>
        {sidebar}
      </div>
      {(Object.keys(drawers) as DrawerKey[])
        .filter((k) => mounted.current.has(k))
        .map((k) => (
          <Drawer key={k} id={k} {...drawers[k]} open={shown === k} request={shown === k ? request : null} onClose={onClose} />
        ))}
    </div>
  );
}

// @spec APP-UI-015, APP-UI-017
function Drawer({ id, title, actions, body, open, request, onClose }: DrawerContent & { id: DrawerKey; open: boolean; request: DrawerRequest | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const handled = useRef<number | null>(null);

  // Each request is carried out once the drawer is showing: scroll to the form it fills and focus
  // the field it fills, or, with nothing handed over, focus the close button.
  useEffect(() => {
    if (!open || !request || handled.current === request.key) return;
    handled.current = request.key;
    const target = request.target ? bodyRef.current?.querySelector<HTMLElement>(request.target) : null;
    if (target) {
      target.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      const field = target.querySelector<HTMLElement>("[data-handoff-focus]");
      (field ?? closeRef.current)?.focus({ preventScroll: true });
    } else {
      closeRef.current?.focus();
    }
  }, [open, request]);

  return (
    <section className={`drawer glass drawer-${id}`} aria-label={title} {...away(!open)}>
      <header className="drawer-head">
        <h2>{title}</h2>
        {actions}
        <IconButton ref={closeRef} icon="close" label="Close" onClick={onClose} />
      </header>
      <div className="drawer-body" ref={bodyRef}>
        {body}
      </div>
    </section>
  );
}
