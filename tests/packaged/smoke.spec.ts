/**
 * The packaged smoke test (m3 contract §6.3; distribution design, Tests): the unpacked packaged build
 * started through Playwright's Electron support in test mode on temporary folders, one app at a time,
 * the tests in order and each building on the last. The first copy runs from the first test to the
 * Quit in the seventh; a synthetic leg flies KBOS → KPVD across them on the fake feed.
 *
 * Before the first test and after the last, everything outside the test's folders that a run must not
 * touch is looked at, and the two looks must agree (DESK-DIST-SMOKE-011).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { fixtureCounts } from "../support/run-folder.ts";
import {
  PAGE_URL,
  PROGRAM,
  REPO,
  TEST_PORT,
  closePageWindow,
  compareOutside,
  desktopLog,
  exited,
  electronEnv,
  folderComparisonSkipped,
  forceClose,
  holdPort,
  isPageUrl,
  launch,
  newTestFolder,
  outsideRequests,
  portFree,
  processRuns,
  sameFolder,
  sample,
  screenShowing,
  shownWindowCount,
  snapshotOutside,
  status,
  tracker,
  trayAlive,
  trayMenuClick,
  trayStatus,
  waitForExit,
  waitReady,
  watchOpenExternal,
  watchTray,
  windowCount,
  windowShowing,
  type Snapshot,
} from "./support/app.ts";

test.describe.configure({ mode: "serial" });

const VERSION = (JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { version: string }).version;

// -------------------------------------------------------------------------------------------------
// The synthetic leg: KBOS → KPVD (the fixture airports), on one aircraft of the test's own.

const KBOS = { lat: 42.36197, lon: -71.0079, elev: 20 };
const KPVD = { lat: 41.725038, lon: -71.425668, elev: 55 };
const AIRCRAFT = { title: "Packaged Smoke Aircraft", livery: "", atc_id: "N0PKG" };

/** Sample times: never behind the clock, always a second after the last. */
let lastT = 0;
function nextT(): number {
  lastT = Math.max(Date.now(), lastT + 1_000);
  return lastT;
}

/** A point a fraction `f` of the way from KBOS to KPVD (a straight line is close enough over 40 nm). */
function along(f: number): { lat: number; lon: number } {
  return { lat: KBOS.lat + (KPVD.lat - KBOS.lat) * f, lon: KBOS.lon + (KPVD.lon - KBOS.lon) * f };
}

function fix(at: { lat: number; lon: number }, o: { alt_ft: number; on_ground: boolean; gs_kts: number; hdg_deg?: number }) {
  return {
    t: nextT(),
    lat: at.lat,
    lon: at.lon,
    alt_ft: o.alt_ft,
    on_ground: o.on_ground,
    gs_kts: o.gs_kts,
    hdg_deg: o.hdg_deg ?? 225,
    vs_fpm: 0,
    ias_kts: o.gs_kts,
    g: 1,
    fuel_lb: 300,
    weight_lb: 2_400,
    ...AIRCRAFT,
  };
}

// -------------------------------------------------------------------------------------------------
// The run's state, shared by the tests in order

let before: Snapshot | null = null;
let outsideChecked = false;
const folders: string[] = [];
const apps: ElectronApplication[] = [];
let holder: { close(): Promise<void> } | null = null;

/** The first copy and its folder, from the first test to the Quit. */
let first: ElectronApplication;
let folderA: string;
let page: Page;
let opened: () => Promise<string[]>;

async function start(folder: string): Promise<{ app: ElectronApplication; opened: () => Promise<string[]> }> {
  const app = await launch(folder);
  apps.push(app);
  // Before anything could ask for the browser, so the pilot's browser never opens.
  const read = await watchOpenExternal(app);
  await watchTray(app);
  return { app, opened: read };
}

async function newFolder(): Promise<string> {
  const f = await newTestFolder();
  folders.push(f);
  return f;
}

async function untilPortFree(timeoutMs = 30_000): Promise<void> {
  await expect.poll(() => portFree(TEST_PORT), { message: `port ${TEST_PORT} free`, timeout: timeoutMs }).toBe(true);
}

/** SMOKE-011's comparison, with the note when the installed app's folders could not be compared. */
async function checkOutside(): Promise<string[]> {
  if (before === null) throw new Error("no look at the outside was taken before the run");
  const after = await snapshotOutside();
  const note = folderComparisonSkipped(before, after);
  if (note !== null) {
    console.log(`[smoke] ${note}`);
    test.info().annotations.push({ type: "note", description: note });
  }
  outsideChecked = true;
  return compareOutside(before, after);
}

test.beforeAll(async () => {
  if (!fs.existsSync(PROGRAM)) throw new Error(`The unpacked packaged build is missing (${PROGRAM}). Run npm run package first.`);
  before = await snapshotOutside();
});

test.afterAll(async () => {
  for (const app of apps) await forceClose(app);
  if (holder) await holder.close().catch(() => {});
  let differences: string[] = [];
  if (!outsideChecked && before !== null) differences = await checkOutside();
  for (const f of folders) {
    try {
      fs.rmSync(f, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      // Left for removeLeftovers (APP-RUN-015).
    }
  }
  if (differences.length > 0) throw new Error(`the packaged smoke run changed things outside its folders:\n${differences.join("\n")}`);
});

test.describe("the packaged app in test mode", () => {
  // @spec DESK-DIST-SMOKE-001, DESK-DIST-SMOKE-002, DESK-DIST-SMOKE-003
  test("shows the page from 127.0.0.1:3280 titled MSFS Career Map, its server ready with the fixture airports and package.json's version", async () => {
    folderA = await newFolder();
    ({ app: first, opened } = await start(folderA));

    page = await windowShowing(first, isPageUrl);
    expect(new URL(page.url()).origin).toBe(`http://127.0.0.1:${TEST_PORT}`);
    await expect(page).toHaveTitle("MSFS Career Map");

    const s = await waitReady();
    expect(s.airports).toBe(fixtureCounts().airports);
    expect(s.version).toBe(VERSION);
    // Test mode on this folder: its data folder, the fake feed.
    expect(sameFolder(s.dataFolder, path.join(folderA, "data")), `data folder ${s.dataFolder}`).toBe(true);
    expect(s.sim).toBe("fake");

    // The basemap asks for its tiles as soon as the map has a view; every outside request is blocked.
    await expect.poll(() => outsideRequests(first).blocked.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(outsideRequests(first).served).toEqual([]);
  });

  // @spec DESK-DIST-SMOKE-004
  test("shows a synthetic sample's aircraft on the page, and the tray's status line follows it", async () => {
    // Parked, a takeoff roll, then more than 5 s in the air: a leg from KBOS.
    for (let i = 0; i < 3; i++) await sample(fix(KBOS, { alt_ft: KBOS.elev, on_ground: true, gs_kts: 0 }));
    for (let i = 0; i < 2; i++) await sample(fix(KBOS, { alt_ft: KBOS.elev, on_ground: true, gs_kts: 60 }));
    for (let i = 1; i <= 8; i++) await sample(fix(along(0.005 * i), { alt_ft: KBOS.elev + 150 * i, on_ground: false, gs_kts: 110 }));

    const st = await tracker();
    expect(st.phase).toBe("airborne");
    expect(st.leg?.origin).toBe("KBOS");

    await expect(page.locator(".live-marker").first()).toBeAttached({ timeout: 15_000 });
    expect(await trayAlive(first)).toBe(true);
    await expect.poll(() => trayStatus(first), { timeout: 15_000 }).toBe("Airborne from KBOS");
  });

  // @spec DESK-DIST-SMOKE-005
  test("sends an outside link to the browser without opening a window, and keeps the page when the window is sent outside", async () => {
    const windowsBefore = await windowCount(first);

    await page.evaluate(() => {
      window.open("https://example.com/smoke-link", "_blank");
    });
    await expect.poll(opened, { timeout: 10_000 }).toContain("https://example.com/smoke-link");
    // Give a window that should not open time to show.
    await page.waitForTimeout(1_000);
    expect(await windowCount(first)).toBe(windowsBefore);

    await page.evaluate(() => {
      location.href = "https://example.com/smoke-navigation";
    });
    await expect.poll(opened, { timeout: 10_000 }).toContain("https://example.com/smoke-navigation");
    await page.waitForTimeout(1_000);
    // Read through the main process: Playwright counts the navigation the app cancelled as still under
    // way, so the page's own locators would wait on it.
    const kept = await first.evaluate(({ BrowserWindow }) =>
      Promise.all(
        BrowserWindow.getAllWindows()
          .filter((w) => w.webContents.getURL().startsWith("http://127.0.0.1:3280/"))
          .map(async (w) => ({
            url: w.webContents.getURL(),
            loading: w.webContents.isLoading(),
            marker: (await w.webContents.executeJavaScript("document.querySelector('.live-marker') !== null")) as boolean,
          })),
      ),
    );
    expect(kept).toHaveLength(1);
    expect(isPageUrl(kept[0].url)).toBe(true);
    expect(kept[0].marker).toBe(true);
    expect(await windowCount(first)).toBe(windowsBefore);
    // A reload the test makes finishes a navigation, so the later tests' locators work again.
    await first.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith("http://127.0.0.1:3280/")) w.webContents.reload();
    });
    await page.waitForLoadState("load");
    await expect(page.locator(".live-marker").first()).toBeAttached({ timeout: 15_000 });
  });

  // @spec DESK-DIST-SMOKE-006
  test("keeps the tray and the server tracking with the window closed, and a second start on the same folder opens the window in the first copy", async () => {
    const closed = page.waitForEvent("close", { timeout: 15_000 });
    expect(await closePageWindow(first)).toBe(true);
    await closed;
    expect(await shownWindowCount(first)).toBe(0);
    expect(await trayAlive(first)).toBe(true);
    expect(exited(first)).toBe(false);

    const farther = along(0.1);
    await sample(fix(farther, { alt_ft: 2_500, on_ground: false, gs_kts: 120 }));
    const st = await tracker();
    expect(st.phase).toBe("airborne");
    expect(st.position?.lat).toBeCloseTo(farther.lat, 5);
    expect(st.position?.lon).toBeCloseTo(farther.lon, 5);

    const second = spawn(PROGRAM, [`--test-data=${folderA}`], { env: electronEnv(), stdio: "ignore" });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the second start did not exit within 30 s")), 30_000);
      second.once("error", reject);
      second.once("exit", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    expect(code).toBe(0);

    page = await windowShowing(first, isPageUrl, 30_000);
    await expect.poll(() => shownWindowCount(first), { timeout: 10_000 }).toBe(1);
    await expect(page).toHaveTitle("MSFS Career Map");
  });

  // @spec DESK-DIST-SMOKE-007
  test("starts a server ended from outside again, and the page reconnects to it", async () => {
    const was = await status();
    // Only ever this copy's own server: the one on the test's data folder.
    expect(sameFolder(was.dataFolder, path.join(folderA, "data")), `data folder ${was.dataFolder}`).toBe(true);
    await expect(page.locator(".live-marker").first()).toBeAttached({ timeout: 15_000 });

    const reconnected = page.waitForResponse((r) => r.url() === `${PAGE_URL}api/tracker/events` && r.status() === 200, { timeout: 90_000 });
    process.kill(was.pid);
    await expect.poll(() => processRuns(was.pid), { timeout: 10_000 }).toBe(false);

    const now = await waitReady(90_000, (s) => s.pid !== was.pid);
    expect(now.pid).not.toBe(was.pid);
    await reconnected;

    // A sample the restarted server takes reaches the page only over the new stream: the restored leg
    // resumes, and the marker turns to the new heading.
    await sample(fix(along(0.15), { alt_ft: 3_000, on_ground: false, gs_kts: 120, hdg_deg: 237 }));
    expect((await tracker()).leg?.origin).toBe("KBOS");
    await expect(page.locator(".live-marker").first()).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(".live-marker .hdg").first()).toHaveAttribute("style", /rotate\(237deg\)/, { timeout: 15_000 });
  });

  // @spec DESK-DIST-SMOKE-009
  test("a second test-mode copy on another folder gives up at once, naming port 3280 held by MSFS Career Map", async () => {
    const folderB = await newFolder();
    const { app: other } = await start(folderB);
    try {
      await screenShowing(other, "MSFS Career Map could not start its server", 60_000);
      const screen = await screenShowing(other, "Port 3280 is in use by MSFS Career Map in another Windows account, a test copy or a copy run from source", 5_000);
      await expect(screen).toHaveTitle("MSFS Career Map");
      // At once: no retry was counted.
      expect(desktopLog(folderB)).not.toContain("failure at start");
      // The first copy goes on as it was.
      expect(sameFolder((await status()).dataFolder, path.join(folderA, "data"))).toBe(true);
    } finally {
      await forceClose(other);
    }
  });

  // @spec DESK-DIST-SMOKE-010
  test("Quit from the tray with the leg landed ends the server and frees the port, and the next start restores the leg", async () => {
    for (const f of [0.4, 0.7, 0.95]) await sample(fix(along(f), { alt_ft: 1_500, on_ground: false, gs_kts: 110 }));
    for (let i = 0; i < 2; i++) await sample(fix(KPVD, { alt_ft: KPVD.elev, on_ground: true, gs_kts: 40 }));
    const landed = await tracker();
    expect(landed.phase).toBe("landed");
    expect(landed.leg?.origin).toBe("KBOS");
    expect(landed.leg?.touchdown_at).not.toBeNull();
    await expect.poll(() => trayStatus(first), { timeout: 15_000 }).toBe("Landed from KBOS");

    const serverPid = (await status()).pid;
    await trayMenuClick(first, "Quit");
    // Quit asked nothing (no leg in the air) and the app ended by itself.
    expect(await waitForExit(first, 60_000)).toBe(0);
    await expect.poll(() => processRuns(serverPid), { timeout: 15_000 }).toBe(false);
    await untilPortFree(15_000);

    const { app: again } = await start(folderA);
    try {
      await waitReady();
      const restored = await tracker();
      expect(restored.phase).toBe("landed");
      expect(restored.leg?.origin).toBe("KBOS");
      expect(restored.leg?.touchdown_at).toBe(landed.leg.touchdown_at);
      await trayMenuClick(again, "Quit");
      expect(await waitForExit(again, 60_000)).toBe(0);
    } finally {
      await forceClose(again);
    }
    await untilPortFree();
  });

  // @spec DESK-DIST-SMOKE-008
  test("with port 3280 held by a program that gives no HTTP answer, retries its server and then shows the failure screen", async () => {
    await untilPortFree();
    holder = await holdPort(TEST_PORT);
    const folder = await newFolder();
    const { app } = await start(folder);
    try {
      await screenShowing(app, "MSFS Career Map could not start its server", 90_000);
      await screenShowing(app, "Port 3280 is in use by another program", 5_000);
      // Retried before giving up: the third failure at start in a row gives up.
      const log = desktopLog(folder);
      expect(log).toContain("failure at start 1 of 3");
      expect(log).toContain("failure at start 2 of 3");
      expect(log).toContain("gave up: Port 3280 is in use by another program");
    } finally {
      await forceClose(app);
      await holder.close();
      holder = null;
    }
  });

  // @spec DESK-DIST-SMOKE-011
  test("leaves the sim's EXE.xml files, the start-up keys, the notification registration, the Start-menu shortcut and the installed app's folders as they were", async () => {
    for (const app of apps) await forceClose(app);
    expect(await checkOutside()).toEqual([]);
  });
});
