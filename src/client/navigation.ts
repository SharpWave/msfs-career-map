/** The page's own address: reloading it, and the hand-off fragment (`#hop=<id>`, `#pending=<id>`). */

/** Reload the page, keeping its address (fragment included). */
export function reloadPage(): void {
  window.location.reload();
}

/** Clear the fragment without a new history entry, so the same fragment set again is a change. */
export function clearFragment(): void {
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

export type Fragment = { kind: "hop"; id: number } | { kind: "pending"; id: string };

/** What a fragment names: a hop by its positive whole id, a pending leg by any id; else null. */
// @spec APP-UI-032
export function parseFragment(hash: string): Fragment | null {
  const hop = /^#hop=([1-9]\d*)$/.exec(hash);
  if (hop) return { kind: "hop", id: Number(hop[1]) };
  const pending = /^#pending=(.+)$/.exec(hash);
  if (pending) {
    try {
      return { kind: "pending", id: decodeURIComponent(pending[1]) };
    } catch {
      return null;
    }
  }
  return null;
}
