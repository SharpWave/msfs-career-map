/**
 * The window's address rules: the window and its frames load only the page's own origin,
 * `http://127.0.0.1:<port>`; other http and https addresses go to the pilot's browser; anything else
 * is refused. Acting on an outcome is the Electron glue's.
 */

export type NavigationOutcome = "load" | "browser" | "refuse";
export type NewWindowOutcome = "browser" | "refuse-own" | "refuse";

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** An http or https address with a host. */
function webAddress(url: string): URL | null {
  const u = parse(url);
  return u && (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "" ? u : null;
}

/** http:, host 127.0.0.1, the given port. */
// @spec DESK-SHELL-WIN-005
export function isOwnOrigin(url: string, port: number): boolean {
  const u = parse(url);
  return u !== null && u.protocol === "http:" && u.hostname === "127.0.0.1" && (u.port || "80") === String(port);
}

/** A navigation of the window or a frame: own origin → load; another http/https address with a host → browser; anything else → refuse. */
// @spec DESK-SHELL-WIN-005, DESK-SHELL-WIN-006, DESK-SHELL-WIN-009
export function navigationOutcome(url: string, port: number): NavigationOutcome {
  if (isOwnOrigin(url, port)) return "load";
  return webAddress(url) ? "browser" : "refuse";
}

/** A new window: another http/https address with a host → browser; own origin → refuse-own; anything else → refuse. */
// @spec DESK-SHELL-WIN-007, DESK-SHELL-WIN-008, DESK-SHELL-WIN-009
export function newWindowOutcome(url: string, port: number): NewWindowOutcome {
  if (isOwnOrigin(url, port)) return "refuse-own";
  return webAddress(url) ? "browser" : "refuse";
}

/** The re-serialised `new URL(url).href` when http/https with a host; else null. */
// @spec DESK-SHELL-WIN-010
export function browserAddress(url: string): string | null {
  return webAddress(url)?.href ?? null;
}
