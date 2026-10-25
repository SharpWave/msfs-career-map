/**
 * The Electron glue's wiring, read as text (src/desktop/main.ts; m2 contract §16, §19 P6): the glue
 * cannot load in Node, so these checks prove only that each piece is written (the smoke test of
 * milestone 3 runs it). Electron's own folder is set before the single-instance lock and nothing
 * asks Electron for a folder first (DESK-SHELL-CLI-002); the hand-over, the window's guards and
 * events, the permission refusals, the session watcher, sleep, the utility process and the tray are
 * wired (WIN-011, 013, 017, 018, 019, 029; OS-001; TRAY-001; LOG-008); nothing that would bridge the
 * page to the shell, filter its requests or turn hardware acceleration off is there. Every other
 * module of src/desktop/ keeps `require` out (§1.1) and loads under the guard without reaching
 * anything (DESK-SHELL-TEST-001).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { takeGuardHits } from "../support/guard.ts";

const DESKTOP = path.resolve(import.meta.dirname, "../../../src/desktop");
const MAIN = path.join(DESKTOP, "main.ts");

/** The modules contract §1.1 lists in src/desktop/. */
const MODULES = [
  "ports.ts",
  "clock.ts",
  "timing.ts",
  "version.ts",
  "cli.ts",
  "installed.ts",
  "start.ts",
  "server-inputs.ts",
  "logs.ts",
  "settings.ts",
  "errors.ts",
  "supervisor.ts",
  "sse.ts",
  "tracker-feed.ts",
  "backups.ts",
  "daily-backups.ts",
  "sim-in-use.ts",
  "first-run.ts",
  "address.ts",
  "window-options.ts",
  "window-place.ts",
  "screens.ts",
  "page-window.ts",
  "tray-model.ts",
  "shell.ts",
  "windows-facts.ts",
  "local-http.ts",
  "main.ts",
];

const mainText = () => fs.readFileSync(MAIN, "utf8");
const otherModules = () =>
  fs
    .readdirSync(DESKTOP)
    .filter((f) => f.endsWith(".ts") && f !== "main.ts")
    .sort();

describe("the order at the start", () => {
  // @spec DESK-SHELL-CLI-002, DESK-SHELL-LOG-008
  it("sets Electron's own folder before asking for the single-instance lock", () => {
    const text = mainText();
    const setPath = text.indexOf('app.setPath("userData"');
    const lock = text.indexOf("requestSingleInstanceLock(");
    expect(setPath).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(setPath).toBeLessThan(lock);
  });

  // @spec DESK-SHELL-CLI-002
  it("asks Electron for no folder before setting its own", () => {
    const text = mainText();
    const setPath = text.indexOf('app.setPath("userData"');
    expect(setPath).toBeGreaterThanOrEqual(0);
    expect(text.slice(0, setPath)).not.toContain("app.getPath(");
  });
});

describe("what the glue wires", () => {
  const wired: [string, string][] = [
    ['"second-instance"', "the hand-over to the running copy (CLI-003, CLI-016)"],
    ['"window-all-closed"', "closing the window keeps the app (WIN-029)"],
    ["setWindowOpenHandler", "new windows sent to the browser or refused (WIN-007, WIN-008)"],
    ['"will-navigate"', "main-frame navigations held (WIN-005, WIN-006)"],
    ['"will-frame-navigate"', "navigations of the window and its frames (WIN-005, WIN-006, WIN-009)"],
    ['"will-attach-webview"', "<webview> refused (WIN-016)"],
    ["setPermissionRequestHandler", "permission requests refused (WIN-019)"],
    ["setPermissionCheckHandler", "permission checks refused (WIN-019)"],
    ["removeMenu()", "no menu bar (WIN-018)"],
    ['"query-session-end"', "Windows asking to end the session (OS-001, OS-002)"],
    ['"session-end"', "the session ending (OS-001, OS-003)"],
    ['"suspend"', "the PC suspending (SRV-038)"],
    ['"resume"', "the PC resuming (SRV-039)"],
    ["utilityProcess.fork", "the server in a utility process (SRV-001)"],
    ['stdio: "pipe"', "the server's output through a pipe (SRV-001, LOG-002)"],
    ["userAgentFallback", "the app's user agent (WIN-012)"],
    ['"render-process-gone"', "the renderer going away (WIN-020)"],
    ['"did-fail-load"', "a failed load (WIN-020)"],
    ['"did-navigate"', "a load answered outside 2xx (WIN-020)"],
    ['"before-input-event"', "F5, Ctrl+R and the DevTools keys (WIN-015)"],
    ['"context-menu"', "the right-click menu (WIN-014)"],
    ["installErrorHandlers", "the shell's own errors (SRV-002)"],
    ["popUpContextMenu", "the tray menu on a right-click (TRAY-015)"],
    ["menuOpening", "the backups folder looked up as the menu opens (TRAY-018)"],
  ];

  // @spec DESK-SHELL-WIN-011, DESK-SHELL-WIN-019, DESK-SHELL-WIN-029, DESK-SHELL-OS-001, DESK-SHELL-TRAY-001
  it.each(wired)("contains %s: %s", (text) => {
    expect(mainText()).toContain(text);
  });
});

describe("what the glue leaves out", () => {
  const absent: [string, string][] = [
    ["disableHardwareAcceleration", "hardware acceleration stays on (WIN-017)"],
    ["contextBridge", "no bridge between the page and the shell (WIN-018)"],
    ["ipcMain", "no bridge between the page and the shell (WIN-018); the page's confirm dialogs left to Electron (WIN-013)"],
    ["preload:", "no preload script (WIN-016, WIN-018)"],
    ["webRequest", "the page's own requests unfiltered (WIN-011)"],
    ['getPath("userData")', "no early folder made under %APPDATA% (CLI-002)"],
    ['getPath("documents")', "Documents read from the registry as the server reads it (SRV-009, TRAY-018)"],
    ["createFromBuffer", "tray icons given by their .ico path (TRAY-013)"],
    ["setContextMenu", "the tray menu built afresh as it opens (TRAY-015, TRAY-018)"],
  ];

  // @spec DESK-SHELL-WIN-011, DESK-SHELL-WIN-013, DESK-SHELL-WIN-017, DESK-SHELL-WIN-018
  it.each(absent)("does not contain %s: %s", (text) => {
    expect(mainText()).not.toContain(text);
  });
});

describe("the other modules of src/desktop/", () => {
  // @spec DESK-SHELL-TEST-001
  it("are the modules the contract lists", () => {
    const files = fs.readdirSync(DESKTOP).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(MODULES));
  });

  // @spec DESK-SHELL-TEST-001
  it("contain neither require( nor createRequire: only the glue may bypass the guard", () => {
    const offending = otherModules().filter((f) => {
      const text = fs.readFileSync(path.join(DESKTOP, f), "utf8");
      return text.includes("require(") || text.includes("createRequire");
    });
    expect(otherModules().length).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });

  // @spec DESK-SHELL-TEST-001
  it("load under the guard without reaching a process, a port or Electron", async () => {
    const files = otherModules();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      await import(/* @vite-ignore */ pathToFileURL(path.join(DESKTOP, f)).href);
    }
    expect(takeGuardHits()).toEqual([]);
  }, 30_000);
});
