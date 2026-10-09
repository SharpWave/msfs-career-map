import { useEffect, type RefObject } from "react";

/**
 * Close a menu on Esc and when the pointer goes down anywhere outside `ref` (its button included in
 * `ref`, so a second click on the button toggles it instead). The outside click is not swallowed:
 * it still does whatever it lands on. Listens in the capture phase, so the map's own handlers
 * cannot hide the click from it.
 */
// @spec APP-UI-016
export function useDismiss(ref: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}
