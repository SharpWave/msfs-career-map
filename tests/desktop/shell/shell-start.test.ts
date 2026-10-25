/**
 * The shell's start and its running life (src/desktop/shell.ts; m2 contract §11.1–11.4, §11.6), on
 * the stand-in ports of §18.3: the tray shown from the start (DESK-SHELL-TRAY-001); the window
 * opened by the start's own switch (CLI-004..006) and by starts handed over (CLI-016..018), those
 * handed over before the start acted on after the tray and the window (CLI-014); the server started
 * at once in test mode and after the look for a copy run from source when installed, offering the
 * folder found or remembered (SRV-004, FIRST-003..005, CLI-013); the folders written to
 * `desktop.log` at the start and at each server start (LOG-003, SRV-009); the server's output in
 * `server.log` (LOG-002, LOG-008); the tray's items (TRAY-014, 018, 019, 024, 025, LOG-009); the
 * tracker read and subscribed once the start-up work is done (SRV-016); the window following the
 * server (WIN-029, SRV-043) and never opened by restarts or failures (AWAY-002, AWAY-003); and
 * Save sent on suspend and on Windows asking to end the session (SRV-038, OS-002).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Shell } from "../../../src/desktop/shell.ts";
import type { CommandLine } from "../../../src/desktop/cli.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
import type { DesktopSettings, SavedWindow } from "../../../src/desktop/settings.ts";
import type { TrayMenuItem } from "../../../src/desktop/tray-model.ts";
import { flush } from "../support/clock.ts";
import {
  command,
  installedPlan,
  makePorts,
  never,
  screenHtmlOf,
  screenOf,
  sseEvent,
  statusAnswer,
  tempFolder,
  testPlan,
  trackerAnswer,
  trackerStatus,
  type FakePorts,
} from "../support/fakes.ts";

const win = path.win32;

const PROGRAM_FOLDER = "C:\\stand-in\\MSFS Career Map\\resources";
const PROGRAM_PATH = "C:\\stand-in\\MSFS Career Map\\MSFS Career Map.exe";
const SERVER_SCRIPT = `${PROGRAM_FOLDER}\\server.mjs`;
/** The shell's environment: two variables the server keeps and three it must not get (contract §5). */
const ENV = { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp", PORT: "3080", NODE_OPTIONS: "--inspect", ELECTRON_RUN_AS_NODE: "1" };
const SERVER_ENV = { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp" };
const STAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;

const DEFAULT_SETTINGS: DesktopSettings = {
  lastDailyBackup: null,
  dailyBackupFailures: { count: 0, lastAttempt: null, short: null, notified: false },
  window: null,
  trayNoticeShown: false,
  updateNoticesShown: [],
  installingVersion: null,
  sourceFolder: null,
  exeXmlFiles: [],
};
/** A daily backup an hour ago, so none falls due in a test that is not about it. */
const RECENT_BACKUP = "2026-10-25T11:00:00.000Z";

interface Harness {
  ports: FakePorts;
  plan: RunPlan;
  shell: Shell;
  root: string;
  logsFolder: string;
  settingsFile: string;
  desktopLog(): string[];
  serverLog(): string[];
}

/** The lines of a log, each checked for its stamp and given without it; [] when the file is absent. */
function logLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const m = STAMPED.exec(l);
      if (!m) throw new Error(`an unstamped log line: ${l}`);
      return m[2];
    });
}

/**
 * A Shell on a fresh temp folder: test mode (`testPlan`) or installed (`installedPlan`), its Electron
 * folder created (Electron creates it for its lock before the shell runs), `settings` written to
 * settings.json first when given. Constructed only; the test calls start().
 */
function harness(
  o: { mode?: "test" | "installed"; command?: Partial<CommandLine>; settings?: Partial<DesktopSettings> | null } = {},
): Harness {
  const root = tempFolder("shell-");
  const plan = o.mode === "installed" ? installedPlan(root) : testPlan(root);
  fs.mkdirSync(plan.electronFolder, { recursive: true });
  const settingsFile = win.join(plan.electronFolder, "settings.json");
  const settings = o.settings === undefined ? { lastDailyBackup: RECENT_BACKUP } : o.settings;
  if (settings) fs.writeFileSync(settingsFile, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }, null, 2));
  const ports = makePorts();
  const shell = new Shell(
    {
      plan,
      command: command({ testData: plan.testFolder, ...o.command }),
      version: "0.8.0",
      programPath: PROGRAM_PATH,
      programFolder: PROGRAM_FOLDER,
      serverScript: SERVER_SCRIPT,
      env: ENV,
    },
    ports,
  );
  const logsFolder = win.join(plan.electronFolder, "logs");
  return {
    ports,
    plan,
    shell,
    root,
    logsFolder,
    settingsFile,
    desktopLog: () => logLines(win.join(logsFolder, "desktop.log")),
    serverLog: () => logLines(win.join(logsFolder, "server.log")),
  };
}

/** /api/status answers as the latest server process (its own pid) while it runs, with `extra` over a done status. */
function answerAsOwnServer(h: Harness, extra: Record<string, unknown> = {}): void {
  h.ports.http.on(h.plan.port, "/api/status", () => {
    const child = h.ports.launcher.starts.at(-1);
    return child && child.pid !== null && child.exited === null ? statusAnswer({ pid: child.pid, ...extra }) : null;
  });
}

/** Started, the server spawned and its start-up work done, the tracker answering `tracker`. */
async function runningShell(h: Harness, tracker: Record<string, unknown> = {}): Promise<void> {
  answerAsOwnServer(h);
  h.ports.http.on(h.plan.port, "/api/tracker", trackerAnswer(tracker));
  await h.shell.start();
  h.ports.launcher.last().spawn();
  await h.ports.clock.advance(0);
  expect(h.shell.trayModel().tooltip).not.toMatch(/Starting…/);
}

/** The index of the first entry equal to `entry`, or -1. */
const firstOf = (order: string[], entry: string) => order.indexOf(entry);
const itemIds = (menu: TrayMenuItem[]) => menu.flatMap((item) => ("id" in item ? [item.id] : []));
const pageUrl = (port: number) => `http://127.0.0.1:${port}/`;
const isShutdown = (msg: object) => (msg as { type?: unknown }).type === "shutdown";

describe("starting the shell", () => {
  // @spec DESK-SHELL-TRAY-001, DESK-SHELL-LOG-008
  it("does nothing on construction but load its settings: no tray, window, server or log", () => {
    const h = harness({ settings: null });
    expect(h.ports.tray.models).toEqual([]);
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.ports.launcher.starts).toEqual([]);
    expect(h.ports.http.calls).toEqual([]);
    expect(fs.existsSync(win.join(h.logsFolder, "server.log"))).toBe(false);
    expect(fs.existsSync(h.settingsFile)).toBe(false);
    expect(h.shell.settings()).toEqual(DEFAULT_SETTINGS);
  });

  // @spec DESK-SHELL-TRAY-001, DESK-SHELL-CLI-004, DESK-SHELL-SRV-004
  it("shows the tray first, then opens the window, then starts the server", async () => {
    const h = harness();
    const order: string[] = [];
    const show = h.ports.tray.show.bind(h.ports.tray);
    h.ports.tray.show = (m) => {
      order.push(`tray ${m.tooltip}`);
      show(m);
    };
    const open = h.ports.window.open.bind(h.ports.window);
    h.ports.window.open = () => {
      order.push("window");
      return open();
    };
    const start = h.ports.launcher.start.bind(h.ports.launcher);
    h.ports.launcher.start = (o) => {
      order.push("server");
      return start(o);
    };
    await h.shell.start();
    expect(order[0]).toBe("tray MSFS Career Map — Starting…");
    expect(firstOf(order, "window")).toBeGreaterThan(0);
    expect(firstOf(order, "server")).toBeGreaterThan(firstOf(order, "window"));
    expect(h.ports.tray.models[0]).toMatchObject({ tooltip: "MSFS Career Map — Starting…", dot: "none" });
    expect(h.ports.window.createdCount).toBe(1);
    expect(screenOf(h.ports.window.loads[0], 3280)).toBe("start");
  });

  // @spec DESK-SHELL-CLI-005, DESK-SHELL-AWAY-002
  it("starts in the tray with the window closed for --background", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    await flush();
    expect(h.ports.tray.models.length).toBeGreaterThan(0);
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.ports.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-CLI-006, DESK-SHELL-AWAY-002
  it("opens the window for --updated only while MSFS is not running", async () => {
    const without = harness({ command: { updated: true } });
    await without.shell.start();
    await flush();
    expect(without.ports.facts.calls).toContain("msfsRunning");
    expect(without.ports.window.createdCount).toBe(1);

    const withMsfs = harness({ command: { updated: true } });
    withMsfs.ports.facts.msfs = true;
    await withMsfs.shell.start();
    await flush();
    expect(withMsfs.ports.window.openCalls).toBe(0);
    expect(withMsfs.ports.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-CLI-014
  it("acts on starts handed over before start() only after the tray and the start's own window", async () => {
    const h = harness({ command: { background: true } });
    const order: string[] = [];
    const show = h.ports.tray.show.bind(h.ports.tray);
    h.ports.tray.show = (m) => {
      order.push("tray");
      show(m);
    };
    const open = h.ports.window.open.bind(h.ports.window);
    h.ports.window.open = () => {
      order.push("window");
      return open();
    };
    h.shell.handOver(command({ testData: h.plan.testFolder }));
    await flush();
    expect(order).toEqual([]);
    expect(h.ports.launcher.starts).toEqual([]);
    await h.shell.start();
    await flush();
    expect(order[0]).toBe("tray");
    expect(firstOf(order, "window")).toBeGreaterThan(0);
    expect(h.ports.window.createdCount).toBe(1);

    const twice = harness();
    twice.shell.handOver(command({ testData: twice.plan.testFolder }));
    await twice.shell.start();
    await flush();
    expect(twice.ports.window.openCalls).toBe(2);
    expect(twice.ports.window.createdCount).toBe(1);
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-005, DESK-SHELL-SRV-010
  it("starts the server at once in test mode, with no look for a copy run from source and no --offer", async () => {
    const h = harness();
    h.ports.http.on(3080, "/api/status", statusAnswer({ pid: 77, sim: "off", dataFolder: h.root }));
    const before = h.ports.clock.now();
    await h.shell.start();
    expect(h.ports.clock.now()).toBe(before);
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(h.ports.http.calls.filter((c) => c.port === 3080)).toEqual([]);
    expect(h.ports.facts.calls.filter((c) => c.startsWith("isFixedDrive"))).toEqual([]);
    expect(h.ports.folders.calls).toBe(0);
    const o = h.ports.launcher.last().options;
    expect(o).toMatchObject({ script: SERVER_SCRIPT, cwd: h.plan.dataFolder, serviceName: "MSFS Career Map server" });
    expect(o.env).toEqual(SERVER_ENV);
    expect(o.args).toEqual([
      `--data=${h.plan.dataFolder}`,
      `--program=${PROGRAM_FOLDER}`,
      "--port=3280",
      `--backups=${win.join(h.root, "Backups")}`,
      "--sim=fake",
      "--airport-downloads=off",
      "--fresh-run",
    ]);
  });

  // @spec DESK-SHELL-LOG-003
  it("writes the folders it resolved as the first line of desktop.log, in test mode", async () => {
    const h = harness();
    await h.shell.start();
    const e = h.plan.electronFolder;
    expect(h.desktopLog()[0]).toBe(
      `[shell] MSFS Career Map 0.8.0 in test mode on ${h.root}: data folder ${h.plan.dataFolder}; Electron folder ${e}; logs folder ${e}\\logs; program folder ${PROGRAM_FOLDER}`,
    );
  });

  // @spec DESK-SHELL-LOG-003
  it("writes the folders it resolved as the first line of desktop.log, installed", async () => {
    const h = harness({ mode: "installed" });
    await h.shell.start();
    const e = h.plan.electronFolder;
    expect(h.desktopLog()[0]).toBe(
      `[shell] MSFS Career Map 0.8.0: data folder ${h.plan.dataFolder}; Electron folder ${e}; logs folder ${e}\\logs; program folder ${PROGRAM_FOLDER}`,
    );
  });

  // @spec DESK-SHELL-SRV-009
  it("writes the data and backups folders at each server start, in test mode as the literal folder", async () => {
    const h = harness();
    await h.shell.start();
    await flush();
    expect(h.desktopLog()).toContain(
      `[server] starting: data folder ${h.plan.dataFolder}; backups folder ${win.join(h.root, "Backups")}`,
    );
    expect(h.ports.folders.calls).toBe(0);
  });

  // @spec DESK-SHELL-SRV-009
  it("looks Documents up again at each server start, installed, and says when it cannot be found", async () => {
    const docsA = tempFolder("docs-a-");
    const docsB = tempFolder("docs-b-");
    const h = harness({ mode: "installed" });
    h.ports.folders.documentsPath = docsA;
    await h.shell.start();
    await flush();
    h.ports.folders.documentsPath = docsB;
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(12);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(2);
    h.ports.folders.documentsPath = null;
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(12);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(3);
    const starting = h.desktopLog().filter((l) => l.startsWith("[server] starting: "));
    const d = h.plan.dataFolder;
    expect(starting).toEqual([
      `[server] starting: data folder ${d}; backups folder ${win.join(docsA, "MSFS Career Map", "Backups")}`,
      `[server] starting: data folder ${d}; backups folder ${win.join(docsB, "MSFS Career Map", "Backups")}`,
      `[server] starting: data folder ${d}; backups folder MSFS Career Map\\Backups in Documents (Documents could not be found)`,
    ]);
  });

  // @spec DESK-SHELL-LOG-002, DESK-SHELL-LOG-008
  it("writes the server's output to server.log, its error stream marked [stderr]", async () => {
    const h = harness();
    await h.shell.start();
    const child = h.ports.launcher.last();
    child.spawn();
    child.stdout("[data] opening the logbook\nlisten");
    child.stdout("ing on 127.0.0.1:3280\r\n");
    child.stderr("(node:4000) ExperimentalWarning: SQLite\n");
    await flush();
    expect(h.serverLog()).toEqual([
      "[data] opening the logbook",
      "listening on 127.0.0.1:3280",
      "[stderr] (node:4000) ExperimentalWarning: SQLite",
    ]);
  });

  // @spec DESK-SHELL-TRAY-026
  it("shows Backups failing in the tray menu from settings recording three daily backups failed in a row", async () => {
    const h = harness({
      settings: {
        lastDailyBackup: "2026-10-20T08:00:00.000Z",
        dailyBackupFailures: { count: 3, lastAttempt: RECENT_BACKUP, short: "disk full", notified: false },
      },
    });
    await h.shell.start();
    await flush();
    expect(h.ports.tray.last()?.menu).toContainEqual({ id: "backups-failing", label: "Backups failing: disk full", enabled: false });
  });
});

describe("the look for a copy run from source, installed", () => {
  /** A real folder holding career.db, on a drive the fake facts call fixed. */
  function sourceFolder(h: Harness, prefix: string): string {
    const folder = tempFolder(prefix);
    fs.writeFileSync(win.join(folder, "career.db"), "");
    h.ports.facts.fixed = new Set([folder[0].toUpperCase()]);
    return folder;
  }

  // @spec DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004, DESK-SHELL-CLI-013, DESK-SHELL-SRV-004
  it("asks port 3080, remembers the folder found and offers it at every server start", async () => {
    const h = harness({ mode: "installed" });
    const found = sourceFolder(h, "source-");
    h.ports.http.on(3080, "/api/status", statusAnswer({ pid: 77, sim: "off", dataFolder: found }));
    await h.shell.start();
    expect(h.ports.http.calls).toContainEqual({ port: 3080, path: "/api/status", timeoutMs: 500 });
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(h.ports.launcher.last().options.args).toEqual([
      `--data=${h.plan.dataFolder}`,
      `--program=${PROGRAM_FOLDER}`,
      "--port=3380",
      "--backups-documents=MSFS Career Map\\Backups",
      "--sim=link",
      "--airport-downloads=on",
      `--offer=${found}`,
      "--fresh-run",
    ]);
    expect(h.shell.settings().sourceFolder).toBe(found);
    expect(JSON.parse(fs.readFileSync(h.settingsFile, "utf8")).sourceFolder).toBe(found);

    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(12);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(2);
    expect(h.ports.launcher.last().options.args).toContain(`--offer=${found}`);
  });

  // @spec DESK-SHELL-FIRST-004
  it("offers the remembered folder when nothing is found and it still passes", async () => {
    const root = tempFolder("remembered-");
    const remembered = win.join(root, "data");
    fs.mkdirSync(remembered);
    fs.writeFileSync(win.join(remembered, "career.db"), "");
    const h = harness({ mode: "installed", settings: { lastDailyBackup: RECENT_BACKUP, sourceFolder: remembered } });
    h.ports.facts.fixed = new Set([remembered[0].toUpperCase()]);
    await h.shell.start();
    expect(h.ports.launcher.last().options.args).toContain(`--offer=${remembered}`);
    expect(h.shell.settings().sourceFolder).toBe(remembered);
  });

  // @spec DESK-SHELL-FIRST-004
  it("drops a remembered folder that fails the rules, offering nothing", async () => {
    const remembered = tempFolder("no-logbook-");
    const h = harness({ mode: "installed", settings: { lastDailyBackup: RECENT_BACKUP, sourceFolder: remembered } });
    h.ports.facts.fixed = new Set([remembered[0].toUpperCase()]);
    await h.shell.start();
    expect(h.ports.launcher.last().options.args.some((a: string) => a.startsWith("--offer="))).toBe(false);
    expect(h.shell.settings().sourceFolder).toBeNull();
    expect(JSON.parse(fs.readFileSync(h.settingsFile, "utf8")).sourceFolder).toBeNull();
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-004
  it("starts the server at 500 ms on the clock when the drive look never ends, offering and remembering nothing found", async () => {
    const h = harness({ mode: "installed" });
    const found = sourceFolder(h, "slow-drive-");
    h.ports.facts.isFixedDriveReply = () => never();
    h.ports.http.on(3080, "/api/status", statusAnswer({ pid: 77, sim: "link", dataFolder: found }));
    const started = h.shell.start();
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(0);
    await h.ports.clock.advance(499);
    expect(h.ports.launcher.starts).toHaveLength(0);
    await h.ports.clock.advance(1);
    expect(h.ports.launcher.starts).toHaveLength(1);
    await started;
    expect(h.ports.launcher.last().options.args.some((a: string) => a.startsWith("--offer="))).toBe(false);
    expect(h.shell.settings().sourceFolder).toBeNull();
  });
});

describe("the tray's items", () => {
  // @spec DESK-SHELL-TRAY-014
  it("opens the window on a left-click and on Open, or brings it forward", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.shell.trayClicked();
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
    await h.shell.menuChosen("open");
    expect(h.ports.window.openCalls).toBe(2);
    expect(h.ports.window.createdCount).toBe(1);
  });

  // @spec DESK-SHELL-LOG-009, DESK-SHELL-TRAY-024
  it("opens the logs folder on Show log and the data folder on Open data folder", async () => {
    const h = harness();
    await h.shell.start();
    await h.shell.menuChosen("show-log");
    await h.shell.menuChosen("open-data");
    expect(h.ports.opener.folders).toEqual([h.logsFolder, h.plan.dataFolder]);
  });

  // @spec DESK-SHELL-TRAY-025
  it("opens <folder>\\Backups in test mode only once it exists, with no Documents look-up", async () => {
    const h = harness();
    await h.shell.start();
    await h.shell.menuChosen("open-backups");
    expect(h.ports.opener.folders).toEqual([]);
    const backups = win.join(h.root, "Backups");
    fs.mkdirSync(backups);
    await h.shell.menuChosen("open-backups");
    expect(h.ports.opener.folders).toEqual([backups]);
    expect(h.ports.folders.calls).toBe(0);
  });

  // @spec DESK-SHELL-TRAY-025, DESK-SHELL-TRAY-018
  it("looks Documents up again at the click, installed, and opens the backups folder there only when it exists", async () => {
    const docsA = tempFolder("docs-a-");
    const docsB = tempFolder("docs-b-");
    const docsC = tempFolder("docs-c-");
    fs.mkdirSync(win.join(docsA, "MSFS Career Map", "Backups"), { recursive: true });
    fs.mkdirSync(win.join(docsB, "MSFS Career Map", "Backups"), { recursive: true });
    const h = harness({ mode: "installed" });
    h.ports.folders.documentsPath = docsA;
    await h.shell.start();
    await h.shell.menuOpening();
    h.ports.folders.documentsPath = docsB;
    const calls = h.ports.folders.calls;
    await h.shell.menuChosen("open-backups");
    expect(h.ports.folders.calls).toBeGreaterThan(calls);
    expect(h.ports.opener.folders).toEqual([win.join(docsB, "MSFS Career Map", "Backups")]);
    h.ports.folders.documentsPath = docsC;
    await h.shell.menuChosen("open-backups");
    h.ports.folders.documentsPath = null;
    await h.shell.menuChosen("open-backups");
    expect(h.ports.opener.folders).toHaveLength(1);
  });

  // @spec DESK-SHELL-TRAY-018
  it("offers Open backups folder once the folder exists, looked up again as the menu opens", async () => {
    const t = harness();
    await t.shell.start();
    await flush();
    expect(itemIds(t.shell.trayModel().menu)).not.toContain("open-backups");
    fs.mkdirSync(win.join(t.root, "Backups"));
    await t.shell.menuOpening();
    expect(itemIds(t.shell.trayModel().menu)).toContain("open-backups");

    const docs = tempFolder("docs-");
    const h = harness({ mode: "installed" });
    h.ports.folders.documentsPath = docs;
    await h.shell.start();
    await flush();
    expect(itemIds(h.shell.trayModel().menu)).not.toContain("open-backups");
    fs.mkdirSync(win.join(docs, "MSFS Career Map", "Backups"), { recursive: true });
    const calls = h.ports.folders.calls;
    await h.shell.menuOpening();
    expect(h.ports.folders.calls).toBeGreaterThan(calls);
    expect(itemIds(h.shell.trayModel().menu)).toContain("open-backups");
    h.ports.folders.documentsPath = tempFolder("docs-moved-");
    await h.shell.menuOpening();
    expect(itemIds(h.shell.trayModel().menu)).not.toContain("open-backups");
  });

  // @spec DESK-SHELL-TRAY-019, DESK-SHELL-SRV-036
  it("acts on Try again only while given up, starting the server afresh", async () => {
    const h = harness();
    await h.shell.start();
    const child = h.ports.launcher.last();
    child.spawn();
    await h.shell.menuChosen("try-again");
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(1);
    child.exit(11);
    await flush();
    const model = h.ports.tray.last();
    expect(model?.tooltip).toBe("MSFS Career Map — Not tracking: Windows reserves port 3280 (an excluded port range); restarting Windows may free it");
    expect(model?.dot).toBe("red");
    expect(itemIds(model?.menu ?? [])).toContain("try-again");
    await h.shell.menuChosen("try-again");
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(2);
    expect(h.ports.tray.last()?.tooltip).toBe("MSFS Career Map — Starting…");
  });

  // @spec DESK-SHELL-SRV-016
  it("reads the tracker and subscribes once the start-up work after Try again is done", async () => {
    const h = harness();
    await h.shell.start();
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(11);
    await flush();
    expect(h.ports.http.calls.filter((c) => c.path === "/api/tracker")).toEqual([]);
    answerAsOwnServer(h);
    h.ports.http.on(3280, "/api/tracker", trackerAnswer({ connected: true, sim_name: "MSFS 2024", phase: "ground" }));
    await h.shell.menuChosen("try-again");
    h.ports.launcher.last().spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.http.calls.filter((c) => c.path === "/api/tracker")).toHaveLength(1);
    expect(h.ports.http.openStreams().map((s) => s.path)).toEqual(["/api/tracker/events"]);
    expect(h.ports.tray.last()).toMatchObject({ tooltip: "MSFS Career Map — Connected to MSFS 2024", dot: "green" });
  });
});

describe("the running server", () => {
  // @spec DESK-SHELL-TRAY-004
  it("shows a ready server's start-up step in the tray", async () => {
    const h = harness();
    answerAsOwnServer(h, { startup: "upgrading" });
    await h.shell.start();
    h.ports.launcher.last().spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.tray.last()?.tooltip).toBe("MSFS Career Map — Starting… (upgrading the logbook)");
  });

  // @spec DESK-SHELL-SRV-016, DESK-SHELL-CLI-013
  it("reads the tracker and subscribes once the start-up work is done, the tray following its status, and asks for a due daily backup", async () => {
    const h = harness({ settings: null });
    await runningShell(h, { connected: true, sim_name: "MSFS 2024", phase: "ground" });
    expect(h.ports.http.calls.filter((c) => c.path === "/api/tracker")).toHaveLength(1);
    expect(h.ports.http.openStreams().map((s) => s.path)).toEqual(["/api/tracker/events"]);
    expect(h.ports.tray.last()).toMatchObject({ tooltip: "MSFS Career Map — Connected to MSFS 2024", dot: "green" });
    expect(h.ports.launcher.last().posted).toContainEqual({ type: "backup", id: "backup-1", kind: "daily" });

    h.ports.http.streams[0].chunk(
      sseEvent("status", trackerStatus({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } })),
    );
    await flush();
    expect(h.ports.tray.last()).toMatchObject({ tooltip: "MSFS Career Map — Airborne from KBOS", dot: "blue" });
  });

  // @spec DESK-SHELL-WIN-029, DESK-SHELL-WIN-025
  it("closes only the window: saves its place and keeps the server, the stream and the tray", async () => {
    const h = harness();
    await runningShell(h);
    const place: SavedWindow = { x: 40, y: 60, width: 1024, height: 700, maximized: true };
    h.ports.window.close();
    h.shell.windowClosed(place);
    await h.ports.clock.advance(5_000);
    expect(h.shell.settings().window).toEqual(place);
    expect(JSON.parse(fs.readFileSync(h.settingsFile, "utf8")).window).toEqual(place);
    expect(h.ports.launcher.last().killed).toBe(false);
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(h.ports.http.openStreams()).toHaveLength(1);
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.exits).toEqual([]);
    h.shell.trayClicked();
    await flush();
    expect(h.ports.window.createdCount).toBe(2);
    expect(h.ports.window.lastLoad()).toBe(pageUrl(3280));
  });

  // @spec DESK-SHELL-AWAY-002, DESK-SHELL-SRV-045, DESK-SHELL-WIN-029
  it("has the window follow the server: start screen, page once done, page kept through a restart, failure screen once given up", async () => {
    const h = harness();
    answerAsOwnServer(h);
    h.ports.http.on(3280, "/api/tracker", trackerAnswer());
    await h.shell.start();
    expect(h.ports.window.loads.map((u) => screenOf(u, 3280))).toEqual(["start"]);
    const first = h.ports.launcher.last();
    first.spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.window.loads.map((u) => screenOf(u, 3280))).toEqual(["start", "page"]);

    await h.ports.clock.advance(61_000);
    first.exit(1);
    await h.ports.clock.advance(1_000);
    expect(h.ports.launcher.starts).toHaveLength(2);
    expect(h.ports.window.loads).toHaveLength(2);
    const second = h.ports.launcher.last();
    second.spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.window.loads).toHaveLength(2);

    second.exit(11);
    await flush();
    const last = h.ports.window.lastLoad() ?? "";
    expect(screenOf(last, 3280)).toBe("failure");
    expect(screenHtmlOf(last)).toContain("Windows reserves port 3280 (an excluded port range); restarting Windows may free it");
    expect(h.ports.window.openCalls).toBe(1);
    expect(h.ports.boxes.shown).toEqual([]);
    for (const child of h.ports.launcher.starts) expect(child.posted.some(isShutdown)).toBe(false);
  });

  // @spec DESK-SHELL-SRV-043, DESK-SHELL-SRV-016
  it("loads the page again once a requested restart's start-up work is done, and subscribes again", async () => {
    const h = harness();
    await runningShell(h);
    expect(h.ports.window.loads.map((u) => screenOf(u, 3280))).toEqual(["start", "page"]);
    h.ports.launcher.last().exit(12);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(2);
    h.ports.launcher.last().spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.window.loads.map((u) => screenOf(u, 3280))).toEqual(["start", "page", "page"]);
    expect(h.ports.http.calls.filter((c) => c.path === "/api/tracker")).toHaveLength(2);
    expect(h.ports.http.openStreams()).toHaveLength(1);
    expect(h.ports.launcher.starts.some((c) => c.posted.some(isShutdown))).toBe(false);
  });

  // @spec DESK-SHELL-AWAY-002
  it("has a failed page load or a lost renderer start the open window's page again, opening no window", async () => {
    const h = harness();
    await runningShell(h);
    const screens = () => h.ports.window.loads.map((u) => screenOf(u, 3280));
    expect(screens()).toEqual(["start", "page"]);
    h.shell.pageLoadFailed();
    await flush();
    expect(screens()).toEqual(["start", "page", "start"]);
    await h.ports.clock.advance(999);
    expect(screens()).toEqual(["start", "page", "start"]);
    await h.ports.clock.advance(1);
    expect(screens()).toEqual(["start", "page", "start", "page"]);
    h.shell.rendererGone();
    await flush();
    expect(screens()).toEqual(["start", "page", "start", "page", "start"]);
    await h.ports.clock.advance(1_000);
    expect(screens()).toEqual(["start", "page", "start", "page", "start", "page"]);

    h.ports.window.close();
    h.shell.windowClosed(h.ports.window.placeNow);
    h.shell.pageLoadFailed();
    h.shell.rendererGone();
    await h.ports.clock.advance(1_000);
    expect(h.ports.window.openCalls).toBe(1);
    expect(h.ports.boxes.shown).toEqual([]);
  });

  // @spec DESK-SHELL-AWAY-002, DESK-SHELL-AWAY-003
  it("opens no window and no message box for restarts, failures at start or giving up", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(1);
    await h.ports.clock.advance(1_000);
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(1);
    await h.ports.clock.advance(5_000);
    h.ports.launcher.last().spawn();
    h.ports.launcher.last().exit(1);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(3);
    expect(h.ports.tray.last()?.dot).toBe("red");
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.ports.boxes.shown).toEqual([]);
  });
});

describe("starts handed over while running", () => {
  // @spec DESK-SHELL-CLI-016
  it("opens the window for a start with no switch, or brings it forward", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.shell.handOver(command({ testData: h.plan.testFolder }));
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
    h.shell.handOver(command({ testData: h.plan.testFolder }));
    await flush();
    expect(h.ports.window.openCalls).toBe(2);
    expect(h.ports.window.createdCount).toBe(1);
  });

  // @spec DESK-SHELL-CLI-017
  it("does nothing for --background", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.shell.handOver(command({ testData: h.plan.testFolder, background: true }));
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.shell.quitting()).toBeNull();
  });

  // @spec DESK-SHELL-CLI-018
  it("opens the window for --updated only while MSFS is not running", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.ports.facts.msfs = true;
    h.shell.handOver(command({ testData: h.plan.testFolder, updated: true }));
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    h.ports.facts.msfs = false;
    h.shell.handOver(command({ testData: h.plan.testFolder, updated: true }));
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
  });
});

describe("saving the tracker's state", () => {
  // @spec DESK-SHELL-SRV-038, DESK-SHELL-OS-002
  it("posts save on suspend and when Windows asks to end the session, and changes nothing else", async () => {
    const h = harness();
    await h.shell.start();
    const child = h.ports.launcher.last();
    child.spawn();
    await flush();
    const trayShown = h.ports.tray.models.length;
    h.shell.suspend();
    h.shell.queryEndSession();
    await flush();
    expect(child.posted).toEqual([
      { type: "save", id: "save-1" },
      { type: "save", id: "save-2" },
    ]);
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.exits).toEqual([]);
    expect(child.killed).toBe(false);
    expect(h.ports.tray.models.slice(trayShown).every((m) => m.tooltip === "MSFS Career Map — Starting…")).toBe(true);
    await h.ports.clock.advance(1_000);
    expect(h.ports.launcher.starts).toHaveLength(1);
  });
});
