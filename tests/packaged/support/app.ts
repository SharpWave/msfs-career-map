/**
 * The packaged smoke test's support (m3 contract §6.3): the unpacked packaged build in
 * `release/win-unpacked` started through Playwright's Electron support in test mode on a temporary
 * folder (DESK-SHELL-CLI-010: port 3280, the fake feed, airport downloads off), its window kept from
 * every outside address (DESK-DIST-SMOKE-002), and the main process's tray and default-browser call
 * watched from inside (Playwright drives the main process through the inspect switches,
 * DESK-DIST-PKG-018).
 *
 * Nothing here starts anything at load. Each `app.evaluate` function runs in the app's main process,
 * so it may use only its arguments and `globalThis`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { _electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { packagedEnv, portFree, releaseFolder } from "../../../scripts/test-packaged.ts";
import { FIXTURES_DIR, makeRunFolder } from "../../support/run-folder.ts";

export { portFree };
export { compareOutside, folderComparisonSkipped, snapshotOutside, type Snapshot } from "./outside.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
/** electron-builder's output: release/, or CAREER_MAP_RELEASE's folder. */
export const RELEASE = releaseFolder(REPO);
export const UNPACKED = path.join(RELEASE, "win-unpacked");
export const PROGRAM = path.join(UNPACKED, "MSFS Career Map.exe");

/** Test mode's port (DESK-SHELL-CLI-010). */
export const TEST_PORT = 3280;
export const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
/** The page's address as the window loads it. */
export const PAGE_URL = `${ORIGIN}/`;

/** The window's own address, or one of the shell's `data:` screens; everything else is outside. */
export function isAppAddress(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "data:" || (u.protocol === "http:" && u.host === `127.0.0.1:${TEST_PORT}`);
  } catch {
    return false;
  }
}

export function isPageUrl(url: string): boolean {
  return url === PAGE_URL || url.startsWith(`${PAGE_URL}#`) || url.startsWith(`${PAGE_URL}?`);
}

// -------------------------------------------------------------------------------------------------
// Folders and starting the app

/** The time beside a seed list, as airports reads it: ISO 8601 UTC with seconds, ending in Z. */
function downloadedNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * A new temporary folder for test mode, its data folder (`<folder>\data`) holding the fixture airport
 * lists and their download times before the app starts, so seeding copies nothing in and the import
 * reads the fixtures (DESK-DIST-SMOKE-001).
 */
export async function newTestFolder(): Promise<string> {
  const folder = makeRunFolder("packaged-");
  const data = path.join(folder, "data");
  await fs.promises.mkdir(data, { recursive: true });
  for (const list of ["airports.csv", "runways.csv"]) {
    await fs.promises.copyFile(path.join(FIXTURES_DIR, list), path.join(data, list));
    await fs.promises.writeFile(path.join(data, `${list}.downloaded`), `${downloadedNow()}\n`);
  }
  return folder;
}

/** The environment Electron gets: the test's own, without ELECTRON_RUN_AS_NODE (DESK-DIST-DEV-005). */
export function electronEnv(): Record<string, string> {
  const env: NodeJS.ProcessEnv = packagedEnv(process.env);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

const outsideSeen = new WeakMap<ElectronApplication, { blocked: string[]; served: string[] }>();

/**
 * The packaged program started in test mode on `folder`, every request of its window to an address
 * other than `http://127.0.0.1:3280/` aborted (DESK-DIST-SMOKE-002) and recorded.
 */
// @spec DESK-DIST-SMOKE-001, DESK-DIST-SMOKE-002
export async function launch(folder: string): Promise<ElectronApplication> {
  const app = await _electron.launch({
    executablePath: PROGRAM,
    args: [`--test-data=${folder}`],
    env: electronEnv(),
    timeout: 60_000,
  });
  launched.set(app, app.process());
  const seen = { blocked: [] as string[], served: [] as string[] };
  outsideSeen.set(app, seen);
  const context = app.context();
  await context.route((url) => !isAppAddress(url.href), (route) => route.abort("blockedbyclient"));
  context.on("requestfailed", (r) => {
    if (!isAppAddress(r.url())) seen.blocked.push(r.url());
  });
  context.on("response", (r) => {
    if (!isAppAddress(r.url())) seen.served.push(r.url());
  });
  return app;
}

/** The outside requests the window made: those blocked, and any that got an answer (there should be none). */
export function outsideRequests(app: ElectronApplication): { blocked: string[]; served: string[] } {
  const seen = outsideSeen.get(app);
  return seen ? { blocked: [...seen.blocked], served: [...seen.served] } : { blocked: [], served: [] };
}

/**
 * The app's process as launched. Playwright's `app.process()` throws once the app is closed, so the
 * process is kept from the launch.
 */
const launched = new WeakMap<ElectronApplication, ReturnType<ElectronApplication["process"]>>();
export function processOf(app: ElectronApplication): ReturnType<ElectronApplication["process"]> {
  const p = launched.get(app);
  if (!p) throw new Error("not an app started by launch()");
  return p;
}

/** Whether the app's process has ended. */
export function exited(app: ElectronApplication): boolean {
  const p = processOf(app);
  return p.exitCode !== null || p.signalCode !== null;
}

/** The app's exit code once it has ended. */
export async function waitForExit(app: ElectronApplication, timeoutMs = 60_000): Promise<number | null> {
  const p = processOf(app);
  if (!exited(app)) {
    await Promise.race([
      new Promise<void>((resolve) => p.once("exit", () => resolve())),
      new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error(`the app did not exit within ${timeoutMs / 1000} s`)), timeoutMs)),
    ]);
  }
  return p.exitCode;
}

/**
 * Closes an app however it can: Playwright's close (Electron's `app.quit()`), then, if it has not
 * ended within 20 s, its process tree ended. For apps whose state no longer matters.
 */
export async function forceClose(app: ElectronApplication): Promise<void> {
  if (exited(app)) return;
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 20_000))]);
  if (exited(app)) return;
  const pid = processOf(app).pid;
  if (pid !== undefined) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      // Gone already.
    }
  }
}

// -------------------------------------------------------------------------------------------------
// The window, seen from the test

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The first open window whose address passes `accept`, waiting for one up to `timeoutMs`. */
export async function windowShowing(app: ElectronApplication, accept: (url: string) => boolean = isPageUrl, timeoutMs = 90_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const w of app.windows()) if (!w.isClosed() && accept(w.url())) return w;
    if (Date.now() > deadline) {
      throw new Error(`no window showing the address wanted within ${timeoutMs / 1000} s; windows: ${app.windows().map((w) => w.url()).join(", ") || "none"}`);
    }
    await sleep(250);
  }
}

/** The window showing one of the shell's screens (a `data:` address) whose text holds `text`. */
export async function screenShowing(app: ElectronApplication, text: string, timeoutMs = 90_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  for (;;) {
    for (const w of app.windows()) {
      if (w.isClosed() || !w.url().startsWith("data:")) continue;
      const body = await w
        .locator("body")
        .innerText({ timeout: 1_000 })
        .catch(() => "");
      seen = body;
      if (body.includes(text)) return w;
    }
    if (Date.now() > deadline) throw new Error(`no screen showing "${text}" within ${timeoutMs / 1000} s; last screen text: ${seen || "none"}`);
    await sleep(250);
  }
}

/** The windows the main process holds that are shown (the shell's hidden session-end watcher left out). */
export async function shownWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible()).length);
}

/** Every window the main process holds, shown or not. */
export async function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
}

/** Closes the page's window as its close button does (BrowserWindow.close); false when none shows the page. */
export async function closePageWindow(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, origin) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.isDestroyed() && b.webContents.getURL().startsWith(origin));
    if (!w) return false;
    w.close();
    return true;
  }, PAGE_URL);
}

// -------------------------------------------------------------------------------------------------
// The tray and the default browser, watched in the main process

interface SmokeGlobal {
  __smokeTrayWatch?: boolean;
  __smokeTray?: Electron.Tray | null;
  __smokeTooltips?: string[];
  __smokeMenu?: Electron.Menu | null;
  __smokeOpened?: string[];
}

/**
 * Patches `Tray.prototype` in the main process: `setToolTip` records the tray and the text and goes
 * on as before; `popUpContextMenu` records the tray and the menu and shows nothing.
 */
export async function watchTray(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Tray }) => {
    const g = globalThis as unknown as SmokeGlobal;
    if (g.__smokeTrayWatch) return;
    g.__smokeTrayWatch = true;
    g.__smokeTray = null;
    g.__smokeTooltips = [];
    g.__smokeMenu = null;
    const proto = Tray.prototype;
    const setToolTip = proto.setToolTip;
    proto.setToolTip = function (this: Electron.Tray, text: string) {
      g.__smokeTray = this;
      g.__smokeTooltips!.push(text);
      return setToolTip.call(this, text);
    };
    proto.popUpContextMenu = function (this: Electron.Tray, menu?: Electron.Menu) {
      g.__smokeTray = this;
      g.__smokeMenu = menu ?? null;
    };
  });
}

const TOOLTIP_PREFIX = "MSFS Career Map — ";

/** The tray's status line: the last tooltip set, "MSFS Career Map — " taken off; null before any. */
export async function trayStatus(app: ElectronApplication): Promise<string | null> {
  const last = await app.evaluate(() => {
    const tips = (globalThis as unknown as SmokeGlobal).__smokeTooltips ?? [];
    return tips.length > 0 ? tips[tips.length - 1] : null;
  });
  if (last === null) return null;
  return last.startsWith(TOOLTIP_PREFIX) ? last.slice(TOOLTIP_PREFIX.length) : last;
}

/** Whether the tray icon the shell made is there: recorded through setToolTip and not destroyed. */
export async function trayAlive(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(() => {
    const tray = (globalThis as unknown as SmokeGlobal).__smokeTray;
    return tray != null && !tray.isDestroyed();
  });
}

/**
 * A right-click on the tray icon (the shell builds its menu then), the menu waited for, and the
 * item with `label` clicked. The click runs just after this returns, so a Quit's exit cannot cut
 * the call short.
 */
export async function trayMenuClick(app: ElectronApplication, label: string): Promise<void> {
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as SmokeGlobal).__smokeTray != null), {
      message: "the tray icon was never seen (watchTray before its tooltip changes)",
      timeout: 15_000,
    })
    .toBe(true);
  await app.evaluate(() => {
    const g = globalThis as unknown as SmokeGlobal;
    g.__smokeMenu = null;
    g.__smokeTray!.emit("right-click", {}, { x: 0, y: 0, width: 0, height: 0 });
  });
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as SmokeGlobal).__smokeMenu != null), { message: "the tray menu never opened", timeout: 10_000 })
    .toBe(true);
  const labels = await app.evaluate((_electron, wanted) => {
    const menu = (globalThis as unknown as SmokeGlobal).__smokeMenu!;
    const item = menu.items.find((i) => i.label === wanted);
    if (!item) return menu.items.map((i) => i.label);
    setTimeout(() => item.click(), 0);
    return null;
  }, label);
  if (labels !== null) throw new Error(`the tray menu has no "${label}": ${labels.join(" | ")}`);
}

/**
 * Patches `shell.openExternal` in the main process to record each address and open nothing; returns
 * a reader of the addresses recorded. Call it before anything could ask for the browser.
 */
export async function watchOpenExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as SmokeGlobal;
    g.__smokeOpened = g.__smokeOpened ?? [];
    shell.openExternal = async (url: string) => {
      g.__smokeOpened!.push(url);
    };
  });
  return () => app.evaluate(() => [...((globalThis as unknown as SmokeGlobal).__smokeOpened ?? [])]);
}

// -------------------------------------------------------------------------------------------------
// The server, from outside

export interface AppStatus {
  ok: boolean;
  app: string;
  version: string;
  pid: number;
  dataFolder: string;
  ready: boolean;
  airports: number | null;
  runways: number | null;
  [key: string]: unknown;
}

/** GET http://127.0.0.1:3280/api/status; rejects when nothing answers. */
export async function status(): Promise<AppStatus> {
  const r = await fetch(`${ORIGIN}/api/status`, { signal: AbortSignal.timeout(5_000) });
  if (!r.ok) throw new Error(`/api/status answered ${r.status}`);
  return (await r.json()) as AppStatus;
}

/** /api/status once it reports `ready` and passes `also`, waiting up to `timeoutMs`. */
export async function waitReady(timeoutMs = 90_000, also: (s: AppStatus) => boolean = () => true): Promise<AppStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  for (;;) {
    try {
      const s = await status();
      last = s;
      if (s.ready && also(s)) return s;
    } catch (e) {
      last = e instanceof Error ? e.message : e;
    }
    if (Date.now() > deadline) throw new Error(`the server was not ready within ${timeoutMs / 1000} s; last: ${JSON.stringify(last)}`);
    await sleep(500);
  }
}

/** GET /api/tracker. */
export async function tracker(): Promise<any> {
  const r = await fetch(`${ORIGIN}/api/tracker`, { signal: AbortSignal.timeout(5_000) });
  if (!r.ok) throw new Error(`/api/tracker answered ${r.status}`);
  return r.json();
}

/** POST /api/tracker/sample: one synthetic sample on the fake feed (live-tracking, LIVE-API-004). */
export async function sample(s: object): Promise<void> {
  const r = await fetch(`${ORIGIN}/api/tracker/sample`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(s),
    signal: AbortSignal.timeout(5_000),
  });
  if (r.status !== 200) throw new Error(`/api/tracker/sample answered ${r.status}: ${await r.text()}`);
}

/** Whether a process with that id still runs. */
export function processRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Holds `port` on 127.0.0.1 as a program that is not an HTTP server: it accepts every connection
 * and never answers (DESK-SHELL-SRV-033).
 */
export async function holdPort(port: number): Promise<{ close(): Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Whether two paths name the same folder: fully resolved (8.3 short names expanded), compared ignoring case. */
export function sameFolder(a: string, b: string): boolean {
  const full = (p: string) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return full(a).toLowerCase() === full(b).toLowerCase();
}

/** The test-mode copy's desktop.log (`<folder>\desktop\logs\desktop.log`), or "" before it exists. */
export function desktopLog(folder: string): string {
  try {
    return fs.readFileSync(path.join(folder, "desktop", "logs", "desktop.log"), "utf8");
  } catch {
    return "";
  }
}
