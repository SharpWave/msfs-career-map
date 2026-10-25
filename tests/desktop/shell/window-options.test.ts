/**
 * The window's options and small rules (src/desktop/window-options.ts; m2 contract §13.2): every
 * setting stated outright when the window is created — Node integration off, context isolation,
 * the sandbox and web security on, no preload script, `<webview>` and insecure content refused
 * (DESK-SHELL-WIN-016), DevTools only unpackaged and no spell-check (WIN-018, DESK-DIST-DEV-001),
 * the page's title, the app's icon and the page's dark background (WIN-028); Chromium's user agent
 * with Electron's token replaced by the app's (WIN-012); the right-click menu (WIN-014); the reload
 * keys (WIN-015) and the DevTools key (DEV-001); and which main-frame loads count as failed
 * (WIN-020).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PAGE_BACKGROUND,
  contextMenuItems,
  failedMainFrameLoad,
  isDevToolsKey,
  isReloadKey,
  windowOptions,
  windowUserAgent,
} from "../../../src/desktop/window-options.ts";

/** A stand-in port: nothing listens on it. */
const PORT = 3280;
const ICON = "C:\\Program Files\\MSFS Career Map\\resources\\icons\\career-map.ico";
const BOUNDS = { x: 320, y: 120, width: 1280, height: 800 };

describe("the window's options", () => {
  // @spec DESK-SHELL-WIN-016, DESK-SHELL-WIN-018, DESK-SHELL-WIN-028
  it("states every setting outright, with no preload key at all", () => {
    const o = windowOptions({ bounds: BOUNDS, icon: ICON, devTools: true });
    expect(o).toStrictEqual({
      x: 320,
      y: 120,
      width: 1280,
      height: 800,
      show: true,
      title: "MSFS Career Map",
      icon: ICON,
      backgroundColor: "#0a0e13",
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
        devTools: true,
      },
    });
    expect("preload" in o.webPreferences).toBe(false);
    expect(Object.keys(o)).not.toContain("preload");
  });

  // @spec DESK-SHELL-WIN-018
  it("leaves DevTools out of a packaged build", () => {
    const o = windowOptions({ bounds: BOUNDS, icon: ICON, devTools: false });
    expect(o.webPreferences.devTools).toBe(false);
    expect(o.webPreferences.spellcheck).toBe(false);
    expect("preload" in o.webPreferences).toBe(false);
  });

  // @spec DESK-SHELL-WIN-028
  it("takes the bounds and icon it is given, and the page's own dark background", () => {
    const o = windowOptions({ bounds: { x: -1500, y: -40, width: 900, height: 640 }, icon: "D:\\x\\icons\\career-map.ico", devTools: true });
    expect([o.x, o.y, o.width, o.height]).toEqual([-1500, -40, 900, 640]);
    expect(o.icon).toBe("D:\\x\\icons\\career-map.ico");
    expect(o.show).toBe(true);
    expect(PAGE_BACKGROUND).toBe("#0a0e13");
    expect(o.backgroundColor).toBe(PAGE_BACKGROUND);
    // The page's own background (styles.css --bg), so the window never flashes another colour.
    const css = fs.readFileSync(new URL("../../../src/client/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/--bg:\s*#0a0e13;/);
  });
});

describe("the window's user agent", () => {
  const FALLBACK =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36";
  const EXPECTED =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 MSFSCareerMap/0.8.0 (+https://github.com/SharpWave/msfs-career-map) Safari/537.36";

  // @spec DESK-SHELL-WIN-012
  it("replaces Electron's token with the app's own", () => {
    expect(windowUserAgent(FALLBACK, "0.8.0")).toBe(EXPECTED);
  });

  // @spec DESK-SHELL-WIN-012
  it("drops the package-name token Electron puts before Chrome/", () => {
    const withName =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) msfs-career-map/0.8.0 Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36";
    expect(windowUserAgent(withName, "0.8.0")).toBe(EXPECTED);
  });

  // @spec DESK-SHELL-WIN-012
  it("names the version it is given, whatever Electron's version", () => {
    const other = FALLBACK.replace("Electron/45.0.0", "Electron/45.2.17");
    expect(windowUserAgent(other, "1.2.3")).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 MSFSCareerMap/1.2.3 (+https://github.com/SharpWave/msfs-career-map) Safari/537.36",
    );
  });
});

describe("the right-click menu", () => {
  const allFlags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
  const noFlags = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };

  // @spec DESK-SHELL-WIN-014
  it("offers Cut, Copy, Paste and Select all in a text field, each enabled by its flag", () => {
    expect(contextMenuItems({ isEditable: true, selectionText: "", editFlags: allFlags })).toEqual([
      { role: "cut", enabled: true },
      { role: "copy", enabled: true },
      { role: "paste", enabled: true },
      { role: "selectAll", enabled: true },
    ]);
    expect(
      contextMenuItems({ isEditable: true, selectionText: "", editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }),
    ).toEqual([
      { role: "cut", enabled: false },
      { role: "copy", enabled: false },
      { role: "paste", enabled: true },
      { role: "selectAll", enabled: true },
    ]);
  });

  // @spec DESK-SHELL-WIN-014
  it("offers the text field's four even with text selected in it", () => {
    expect(contextMenuItems({ isEditable: true, selectionText: "KBOS", editFlags: allFlags }).map((i) => i.role)).toEqual([
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
  });

  // @spec DESK-SHELL-WIN-014
  it("offers Copy on selected text outside a text field", () => {
    expect(contextMenuItems({ isEditable: false, selectionText: "Boston Logan", editFlags: noFlags })).toEqual([
      { role: "copy", enabled: true },
    ]);
  });

  // @spec DESK-SHELL-WIN-014
  it("offers nothing with no selection, or a blank one, outside a text field", () => {
    expect(contextMenuItems({ isEditable: false, selectionText: "", editFlags: allFlags })).toEqual([]);
    expect(contextMenuItems({ isEditable: false, selectionText: "  \n\t ", editFlags: allFlags })).toEqual([]);
  });
});

type Input = { type: string; key: string; control: boolean; alt: boolean; shift: boolean; meta: boolean };
const key = (k: string, o: Partial<Input> = {}): Input => ({ type: "keyDown", key: k, control: false, alt: false, shift: false, meta: false, ...o });

describe("the reload keys", () => {
  // @spec DESK-SHELL-WIN-015
  it("are F5 alone and Ctrl+R", () => {
    expect(isReloadKey(key("F5"))).toBe(true);
    expect(isReloadKey(key("r", { control: true }))).toBe(true);
    expect(isReloadKey(key("R", { control: true }))).toBe(true);
  });

  // @spec DESK-SHELL-WIN-015
  it("are not a key release, F5 with a modifier, R alone, or Ctrl+R with another modifier", () => {
    expect(isReloadKey(key("F5", { type: "keyUp" }))).toBe(false);
    expect(isReloadKey(key("r", { type: "keyUp", control: true }))).toBe(false);
    expect(isReloadKey(key("F5", { control: true }))).toBe(false);
    expect(isReloadKey(key("F5", { shift: true }))).toBe(false);
    expect(isReloadKey(key("F5", { alt: true }))).toBe(false);
    expect(isReloadKey(key("F5", { meta: true }))).toBe(false);
    expect(isReloadKey(key("r"))).toBe(false);
    expect(isReloadKey(key("R", { shift: true }))).toBe(false);
    expect(isReloadKey(key("r", { control: true, shift: true }))).toBe(false);
    expect(isReloadKey(key("r", { control: true, alt: true }))).toBe(false);
    expect(isReloadKey(key("r", { control: true, meta: true }))).toBe(false);
    expect(isReloadKey(key("F12"))).toBe(false);
  });
});

describe("the DevTools key", () => {
  // @spec DESK-DIST-DEV-001, DESK-SHELL-WIN-018
  it("is F12 and Ctrl+Shift+I", () => {
    expect(isDevToolsKey(key("F12"))).toBe(true);
    expect(isDevToolsKey(key("i", { control: true, shift: true }))).toBe(true);
    expect(isDevToolsKey(key("I", { control: true, shift: true }))).toBe(true);
  });

  // @spec DESK-DIST-DEV-001
  it("is not a key release, Ctrl+I, Shift+I or I alone", () => {
    expect(isDevToolsKey(key("F12", { type: "keyUp" }))).toBe(false);
    expect(isDevToolsKey(key("I", { type: "keyUp", control: true, shift: true }))).toBe(false);
    expect(isDevToolsKey(key("i", { control: true }))).toBe(false);
    expect(isDevToolsKey(key("I", { shift: true }))).toBe(false);
    expect(isDevToolsKey(key("i"))).toBe(false);
    expect(isDevToolsKey(key("F5"))).toBe(false);
  });
});

describe("a failed main-frame load", () => {
  const own = "http://127.0.0.1:3280/";

  // @spec DESK-SHELL-WIN-020
  it("is a main-frame load of the own origin that got no answer", () => {
    // -102 ERR_CONNECTION_REFUSED: F5 while the server restarts.
    expect(failedMainFrameLoad({ kind: "did-fail-load", url: own, errorCode: -102, isMainFrame: true }, PORT)).toBe(true);
    // -324 ERR_EMPTY_RESPONSE: a server that ends between readiness and the load.
    expect(failedMainFrameLoad({ kind: "did-fail-load", url: `${own}#hop=3`, errorCode: -324, isMainFrame: true }, PORT)).toBe(true);
  });

  // @spec DESK-SHELL-WIN-020
  it("is not an aborted load (-3), a sub-frame's, or another origin's", () => {
    expect(failedMainFrameLoad({ kind: "did-fail-load", url: own, errorCode: -3, isMainFrame: true }, PORT)).toBe(false);
    expect(failedMainFrameLoad({ kind: "did-fail-load", url: own, errorCode: -102, isMainFrame: false }, PORT)).toBe(false);
    expect(
      failedMainFrameLoad({ kind: "did-fail-load", url: "https://tile.openstreetmap.org/5/9/12.png", errorCode: -105, isMainFrame: true }, PORT),
    ).toBe(false);
    expect(failedMainFrameLoad({ kind: "did-fail-load", url: "http://127.0.0.1:3281/", errorCode: -102, isMainFrame: true }, PORT)).toBe(false);
  });

  // @spec DESK-SHELL-WIN-020
  it("is a navigation of the own origin answered outside 2xx", () => {
    for (const code of [503, 404, 500, 300, 199]) {
      expect(failedMainFrameLoad({ kind: "did-navigate", url: own, httpResponseCode: code }, PORT), String(code)).toBe(true);
    }
    for (const code of [200, 204, 299]) {
      expect(failedMainFrameLoad({ kind: "did-navigate", url: own, httpResponseCode: code }, PORT), String(code)).toBe(false);
    }
  });

  // @spec DESK-SHELL-WIN-020
  it("is not a navigation of another origin or of a screen", () => {
    expect(failedMainFrameLoad({ kind: "did-navigate", url: "https://example.com/", httpResponseCode: 404 }, PORT)).toBe(false);
    expect(failedMainFrameLoad({ kind: "did-navigate", url: "http://localhost:3280/", httpResponseCode: 503 }, PORT)).toBe(false);
    expect(
      failedMainFrameLoad({ kind: "did-navigate", url: "data:text/html;charset=utf-8,%3Ch1%3EStarting%3C%2Fh1%3E", httpResponseCode: -1 }, PORT),
    ).toBe(false);
  });
});
