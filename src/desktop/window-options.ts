import { isOwnOrigin } from "./address.ts";
import type { Rect } from "./window-place.ts";

/**
 * The window's options, stated outright rather than left to Electron's defaults, and the small rules
 * the glue applies to the window: its user agent, right-click menu, reload and DevTools keys, and
 * which main-frame loads count as failed.
 */

/** The page's own background (styles.css `--bg`), so the window never flashes another colour. */
export const PAGE_BACKGROUND = "#0a0e13";

export interface WindowOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  show: true;
  title: "MSFS Career Map";
  icon: string;
  backgroundColor: "#0a0e13";
  webPreferences: {
    nodeIntegration: false;
    nodeIntegrationInWorker: false;
    nodeIntegrationInSubFrames: false;
    contextIsolation: true;
    sandbox: true;
    webSecurity: true;
    allowRunningInsecureContent: false;
    webviewTag: false;
    spellcheck: false;
    devTools: boolean;
  };
}

/** No `preload` key at all; `devTools` is `!app.isPackaged`. */
// @spec DESK-SHELL-WIN-016, DESK-SHELL-WIN-018, DESK-SHELL-WIN-028
export function windowOptions(o: { bounds: Rect; icon: string; devTools: boolean }): WindowOptions {
  const { x, y, width, height } = o.bounds;
  return {
    x,
    y,
    width,
    height,
    show: true,
    title: "MSFS Career Map",
    icon: o.icon,
    backgroundColor: PAGE_BACKGROUND,
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: o.devTools,
    },
  };
}

/** Chromium's user agent with the package-name token dropped and Electron's token replaced by the app's. */
// @spec DESK-SHELL-WIN-012
export function windowUserAgent(fallback: string, version: string): string {
  return fallback
    .replace(/\(KHTML, like Gecko\) .*?(?=Chrome\/)/, "(KHTML, like Gecko) ")
    .replace(/Electron\/\S+/, `MSFSCareerMap/${version} (+https://github.com/SharpWave/msfs-career-map)`);
}

type EditRole = "cut" | "copy" | "paste" | "selectAll";

/** Cut, Copy, Paste and Select all in a text field; Copy on selected text elsewhere; else nothing. */
// @spec DESK-SHELL-WIN-014
export function contextMenuItems(p: {
  isEditable: boolean;
  selectionText: string;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}): { role: EditRole; enabled: boolean }[] {
  if (p.isEditable) {
    const f = p.editFlags;
    return [
      { role: "cut", enabled: f.canCut },
      { role: "copy", enabled: f.canCopy },
      { role: "paste", enabled: f.canPaste },
      { role: "selectAll", enabled: f.canSelectAll },
    ];
  }
  return p.selectionText.trim() !== "" ? [{ role: "copy", enabled: true }] : [];
}

interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** F5 alone, or Ctrl+R with no other modifier. */
// @spec DESK-SHELL-WIN-015
export function isReloadKey(i: KeyInput): boolean {
  if (i.type !== "keyDown") return false;
  if (i.key === "F5") return !i.control && !i.alt && !i.shift && !i.meta;
  return i.control && (i.key === "r" || i.key === "R") && !i.alt && !i.shift && !i.meta;
}

/** F12, or Ctrl+Shift+I; the glue acts on it only unpackaged. */
// @spec DESK-DIST-DEV-001
export function isDevToolsKey(i: KeyInput): boolean {
  if (i.type !== "keyDown") return false;
  return i.key === "F12" || (i.control && i.shift && (i.key === "i" || i.key === "I"));
}

/** A main-frame load of the own origin that got no answer (an abort aside) or an answer outside 2xx. */
// @spec DESK-SHELL-WIN-020
export function failedMainFrameLoad(
  e:
    | { kind: "did-fail-load"; url: string; errorCode: number; isMainFrame: boolean }
    | { kind: "did-navigate"; url: string; httpResponseCode: number },
  port: number,
): boolean {
  if (!isOwnOrigin(e.url, port)) return false;
  if (e.kind === "did-fail-load") return e.isMainFrame && e.errorCode !== -3;
  return e.httpResponseCode < 200 || e.httpResponseCode > 299;
}
