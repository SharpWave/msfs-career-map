/**
 * Quitting the shell (src/desktop/shell.ts; m2 contract §11.3, §11.5), on the stand-in ports of
 * §18.3: Quit reads the tracker, allowing 2 s, and asks only about a leg in the air
 * (DESK-SHELL-TRAY-021), then enters the quitting state, shuts the server down and exits
 * (TRAY-022, QUIT-001, SRV-019); `--quit` takes a backup, shuts down and exits whatever the backup
 * gave (CLI-008, BAK-005); a session end abandons a backup and shuts down at once (OS-003,
 * QUIT-005); while quitting, every tray item but Open and Show log and every later quit is ignored
 * (QUIT-003), no server starts (QUIT-004), a box open is closed as cancelled (QUIT-002), starts
 * handed over during Quit are kept and the one that shows the most relaunched (QUIT-006) while
 * those during `--quit` or a session end are logged and dropped (QUIT-008); the app exits once,
 * the window's place saved just before (WIN-025).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Shell } from "../../../src/desktop/shell.ts";
import type { CommandLine } from "../../../src/desktop/cli.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
import type { DesktopSettings, SavedWindow } from "../../../src/desktop/settings.ts";
import { flush } from "../support/clock.ts";
import {
  command,
  makePorts,
  never,
  screenOf,
  sseEvent,
  statusAnswer,
  tempFolder,
  testPlan,
  trackerAnswer,
  trackerStatus,
  type FakeChild,
  type FakePorts,
} from "../support/fakes.ts";

const win = path.win32;

const PROGRAM_FOLDER = "C:\\stand-in\\MSFS Career Map\\resources";
const STAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;
const QUIT_QUESTION = "A leg is in the air. Quit anyway? Nothing is recorded until MSFS Career Map starts again.";
const SHUTDOWN = { type: "shutdown" };
const AIRBORNE = { connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } };
const IDLE = { connected: true, sim_name: "MSFS 2024", phase: "ground" };

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

interface Harness {
  ports: FakePorts;
  plan: RunPlan;
  shell: Shell;
  root: string;
  settingsFile: string;
  logsFolder: string;
  desktopLog(): string[];
  /** The server process the shell started (the only one in these tests). */
  child(): FakeChild;
  /** A start of this test-mode folder's copy handed over. */
  handOver(o?: Partial<CommandLine>): void;
  /** Runs `fn` when the shell calls ports.exit, before the call is recorded. */
  atExit(fn: () => void): void;
}

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
 * A test-mode Shell, started with the given switch, its server spawned and its start-up work done,
 * the tracker answering `tracker` (read once at the done and kept as the last status). A daily
 * backup an hour old, so none is asked for.
 */
async function running(o: { tracker?: Record<string, unknown>; command?: Partial<CommandLine>; ready?: boolean } = {}): Promise<Harness> {
  const root = tempFolder("quit-");
  const plan = testPlan(root);
  fs.mkdirSync(plan.electronFolder, { recursive: true });
  const settingsFile = win.join(plan.electronFolder, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ ...DEFAULT_SETTINGS, lastDailyBackup: "2026-10-25T11:00:00.000Z" }, null, 2));
  const ports = makePorts();
  // Wrapped before the Shell is built, so the shell's exit always passes through it.
  const exitHooks: (() => void)[] = [];
  const recordExit = ports.exit.bind(ports);
  ports.exit = (code: number, relaunch: string[] | null) => {
    for (const fn of exitHooks) fn();
    recordExit(code, relaunch);
  };
  const shell = new Shell(
    {
      plan,
      command: command({ testData: root, ...o.command }),
      version: "0.8.0",
      programPath: "C:\\stand-in\\MSFS Career Map\\MSFS Career Map.exe",
      programFolder: PROGRAM_FOLDER,
      serverScript: `${PROGRAM_FOLDER}\\server.mjs`,
      env: { Path: "C:\\Windows\\system32" },
    },
    ports,
  );
  const logsFolder = win.join(plan.electronFolder, "logs");
  const h: Harness = {
    ports,
    plan,
    shell,
    root,
    settingsFile,
    logsFolder,
    desktopLog: () => logLines(win.join(logsFolder, "desktop.log")),
    child: () => ports.launcher.last(),
    handOver: (c = {}) => shell.handOver(command({ testData: root, ...c })),
    atExit: (fn) => exitHooks.push(fn),
  };
  if (o.ready !== false) {
    ports.http.on(plan.port, "/api/status", () => {
      const child = ports.launcher.starts.at(-1);
      return child && child.pid !== null && child.exited === null ? statusAnswer({ pid: child.pid }) : null;
    });
  }
  ports.http.on(plan.port, "/api/tracker", trackerAnswer(o.tracker ?? IDLE));
  await shell.start();
  h.child().spawn();
  await ports.clock.advance(0);
  return h;
}

const shutdowns = (child: FakeChild) => child.posted.filter((m) => (m as { type?: unknown }).type === "shutdown");

describe("Quit", () => {
  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-AWAY-003, DESK-SHELL-QUIT-001
  it("asks nothing with no leg in the air, reading the tracker with 2 s allowed", async () => {
    const h = await running();
    const reads = h.ports.http.calls.filter((c) => c.path === "/api/tracker").length;
    const quit = h.shell.menuChosen("quit");
    await flush();
    const quitRead = h.ports.http.calls.filter((c) => c.path === "/api/tracker");
    expect(quitRead).toHaveLength(reads + 1);
    expect(quitRead.at(-1)).toMatchObject({ port: 3280, path: "/api/tracker" });
    expect(h.ports.boxes.shown).toEqual([]);
    expect(h.shell.quitting()).toBe("quit");
    expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-TRAY-022, DESK-SHELL-QUIT-001, DESK-SHELL-SRV-019, DESK-SHELL-QUIT-004
  it("goes, in order: the quitting state, the tray's Quitting…, Shut down, then the exit, leaving nothing waiting", async () => {
    const h = await running();
    const order: string[] = [];
    const show = h.ports.tray.show.bind(h.ports.tray);
    // Only the first Quitting… counts: the shell may show the same model again (e.g. once the server has stopped).
    h.ports.tray.show = (m) => {
      if (m.tooltip === "MSFS Career Map — Quitting…" && !order.some((e) => e.startsWith("tray ")))
        order.push(`tray Quitting… (quitting: ${h.shell.quitting()})`);
      show(m);
    };
    const child = h.child();
    const post = child.post.bind(child);
    child.post = (msg) => {
      if ((msg as { type?: unknown }).type === "shutdown") order.push("shutdown");
      post(msg);
    };
    h.atExit(() => order.push("exit"));
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.http.openStreams()).toEqual([]);
    child.exit(0);
    await flush();
    await quit;
    expect(order).toEqual(["tray Quitting… (quitting: quit)", "shutdown", "exit"]);
    expect(h.ports.tray.last()).toMatchObject({ tooltip: "MSFS Career Map — Quitting…", dot: "none" });
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(h.ports.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-AWAY-003
  it("asks the exact question when the read finds a leg airborne; Cancel changes nothing", async () => {
    const h = await running();
    h.ports.http.on(3280, "/api/tracker", trackerAnswer(AIRBORNE));
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(1);
    const box = h.ports.boxes.shown[0];
    expect(box.options).toMatchObject({
      type: "warning",
      title: "MSFS Career Map",
      message: QUIT_QUESTION,
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    expect(box.options.signal).toBeInstanceOf(AbortSignal);
    expect(h.shell.quitting()).toBeNull();
    box.answer(1);
    await flush();
    await quit;
    expect(h.shell.quitting()).toBeNull();
    expect(h.child().posted).toEqual([]);
    expect(h.ports.exits).toEqual([]);
    expect(h.ports.tray.last()?.tooltip).not.toBe("MSFS Career Map — Quitting…");
    await h.ports.clock.advance(15_000);
    expect(h.ports.exits).toEqual([]);
    expect(h.child().killed).toBe(false);
  });

  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-TRAY-022
  it("goes on when the pilot chooses Quit in the box", async () => {
    const h = await running({ tracker: AIRBORNE });
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.ports.boxes.shown[0].answer(0);
    await flush();
    expect(h.shell.quitting()).toBe("quit");
    expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(h.ports.boxes.shown).toHaveLength(1);
  });

  // @spec DESK-SHELL-TRAY-021
  it("asks again on a later Quit after a Cancel, and ignores a Quit while the first is still asking", async () => {
    const h = await running({ tracker: AIRBORNE });
    const first = h.shell.menuChosen("quit");
    await flush();
    const second = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(1);
    h.ports.boxes.shown[0].answer(1);
    await flush();
    await Promise.all([first, second]);
    const third = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(2);
    h.ports.boxes.shown[1].answer(1);
    await flush();
    await third;
    expect(h.shell.quitting()).toBeNull();
  });

  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-SRV-037
  it("decides by the last status received when the read has no answer within 2 s on the clock", async () => {
    const h = await running({ tracker: IDLE });
    h.ports.http.streams[0].chunk(sseEvent("status", trackerStatus(AIRBORNE)));
    h.ports.http.on(3280, "/api/tracker", () => never());
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(0);
    await h.ports.clock.advance(1_999);
    expect(h.ports.boxes.shown).toHaveLength(0);
    await h.ports.clock.advance(1);
    expect(h.ports.boxes.shown).toHaveLength(1);
    expect(h.ports.boxes.shown[0].options.message).toBe(QUIT_QUESTION);
    h.ports.boxes.shown[0].answer(1);
    await flush();
    await quit;
    expect(h.shell.quitting()).toBeNull();
  });

  // @spec DESK-SHELL-TRAY-021
  it("asks nothing when the last status received is not airborne and the read has no answer", async () => {
    const h = await running({ tracker: IDLE });
    h.ports.http.on(3280, "/api/tracker", () => never());
    const quit = h.shell.menuChosen("quit");
    await h.ports.clock.advance(2_000);
    expect(h.ports.boxes.shown).toEqual([]);
    expect(h.shell.quitting()).toBe("quit");
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toHaveLength(1);
  });

  // @spec DESK-SHELL-TRAY-021
  it("takes the read's answer over an airborne last status", async () => {
    const h = await running({ tracker: AIRBORNE });
    h.ports.http.on(3280, "/api/tracker", trackerAnswer(IDLE));
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toEqual([]);
    expect(h.shell.quitting()).toBe("quit");
    h.child().exit(0);
    await flush();
    await quit;
  });

  // @spec DESK-SHELL-SRV-019
  it("sends Shut down to a server not yet ready", async () => {
    const h = await running({ ready: false });
    expect(h.ports.tray.last()?.tooltip).toBe("MSFS Career Map — Starting…");
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-004
  it("starts no server while quitting: a crash during the shutdown and a restart scheduled before it are both left ended", async () => {
    const crash = await running();
    const quit = crash.shell.menuChosen("quit");
    await flush();
    crash.child().exit(1);
    await crash.ports.clock.advance(10_000);
    await quit;
    expect(crash.ports.launcher.starts).toHaveLength(1);
    expect(crash.ports.exits).toEqual([{ code: 0, relaunch: null }]);

    const scheduled = await running();
    await scheduled.ports.clock.advance(61_000);
    scheduled.child().exit(1);
    await flush();
    expect(scheduled.ports.tray.last()?.tooltip).toBe("MSFS Career Map — Starting…");
    const quit2 = scheduled.shell.menuChosen("quit");
    await scheduled.ports.clock.advance(5_000);
    await quit2;
    expect(scheduled.ports.launcher.starts).toHaveLength(1);
    expect(scheduled.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(scheduled.ports.clock.pending()).toBe(0);
  });
});

describe("while quitting", () => {
  // @spec DESK-SHELL-QUIT-003, DESK-SHELL-TRAY-014, DESK-SHELL-LOG-009
  it("ignores every tray item but Open and Show log, and every later quit", async () => {
    const h = await running({ command: { background: true }, tracker: AIRBORNE });
    fs.mkdirSync(win.join(h.root, "Backups"));
    await h.shell.menuOpening();
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.ports.boxes.shown[0].answer(0);
    await flush();
    expect(h.shell.quitting()).toBe("quit");

    await h.shell.menuChosen("open-data");
    await h.shell.menuChosen("open-backups");
    await h.shell.menuChosen("try-again");
    await h.shell.menuChosen("quit");
    h.handOver({ quit: true });
    await flush();
    expect(h.ports.opener.folders).toEqual([]);
    expect(h.ports.boxes.shown).toHaveLength(1);
    expect(h.child().posted).toEqual([SHUTDOWN]);
    expect(h.shell.quitting()).toBe("quit");
    expect(h.ports.launcher.starts).toHaveLength(1);

    await h.shell.menuChosen("show-log");
    expect(h.ports.opener.folders).toEqual([h.logsFolder]);
    await h.shell.menuChosen("open");
    expect(h.ports.window.createdCount).toBe(1);
    expect(screenOf(h.ports.window.lastLoad() ?? "", 3280)).toBe("quitting");
    h.ports.window.close();
    h.shell.windowClosed(h.ports.window.placeNow);
    h.shell.trayClicked();
    await flush();
    expect(h.ports.window.createdCount).toBe(2);
    expect(screenOf(h.ports.window.lastLoad() ?? "", 3280)).toBe("quitting");

    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-002
  it("closes a box open when the quitting state begins, as if cancelled", async () => {
    const h = await running({ tracker: AIRBORNE });
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(1);
    h.handOver({ quit: true });
    await flush();
    expect(h.ports.boxes.shown[0].aborted).toBe(true);
    expect(h.shell.quitting()).toBe("quit-switch");
    await quit;
    expect(h.child().posted).toEqual([{ type: "backup", id: "backup-1", kind: "quit" }]);
    h.child().message({ type: "backup-done", id: "backup-1", file: "career-2026-10-25.db" });
    await flush();
    h.child().exit(0);
    await flush();
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(h.ports.boxes.shown).toHaveLength(1);
  });
});

describe("starts handed over during a quit", () => {
  // @spec DESK-SHELL-QUIT-006
  it("keeps them during Quit and relaunches the one that shows the most, with --test-data", async () => {
    const cases: [Partial<CommandLine>[], string[]][] = [
      [[{ background: true }], ["--background"]],
      [[{ background: true }, { updated: true }], ["--updated"]],
      [[{ updated: true }, {}, { background: true }], []],
    ];
    for (const [starts, switches] of cases) {
      const h = await running({ command: { background: true } });
      const quit = h.shell.menuChosen("quit");
      await flush();
      expect(h.shell.quitting()).toBe("quit");
      for (const s of starts) h.handOver(s);
      await flush();
      expect(h.ports.window.openCalls).toBe(0);
      h.child().exit(0);
      await flush();
      await quit;
      expect(h.ports.exits).toEqual([{ code: 0, relaunch: [...switches, `--test-data=${h.root}`] }]);
      expect(h.desktopLog().some((l) => l.startsWith("[cli] dropped"))).toBe(false);
    }
  });

  // @spec DESK-SHELL-QUIT-008, DESK-SHELL-LOG-003
  it("logs and drops them during --quit", async () => {
    const h = await running({ command: { background: true } });
    h.handOver({ quit: true });
    await flush();
    expect(h.shell.quitting()).toBe("quit-switch");
    h.handOver({});
    h.handOver({ background: true });
    h.handOver({ updated: true });
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.desktopLog().filter((l) => l.startsWith("[cli] "))).toEqual([
      "[cli] dropped a start handed over while quitting: no switch",
      "[cli] dropped a start handed over while quitting: --background",
      "[cli] dropped a start handed over while quitting: --updated",
    ]);
    h.child().message({ type: "backup-done", id: "backup-1", file: "career.db" });
    await flush();
    h.child().exit(0);
    await flush();
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-008, DESK-SHELL-QUIT-005
  it("logs and drops them during a session end, and a session end drops those a Quit kept", async () => {
    const h = await running({ command: { background: true } });
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.handOver({});
    await flush();
    h.shell.endSession();
    expect(h.shell.quitting()).toBe("session-end");
    h.handOver({ updated: true });
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.desktopLog()).toContain("[cli] dropped a start handed over while quitting: --updated");
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });
});

describe("--quit", () => {
  // @spec DESK-SHELL-CLI-008, DESK-SHELL-BAK-005, DESK-SHELL-QUIT-001, DESK-SHELL-AWAY-003
  it("asks nothing, takes a quit backup, then shuts the server down and exits", async () => {
    const h = await running({ tracker: AIRBORNE });
    h.handOver({ quit: true });
    await flush();
    expect(h.shell.quitting()).toBe("quit-switch");
    expect(h.ports.boxes.shown).toEqual([]);
    expect(h.ports.tray.last()?.tooltip).toBe("MSFS Career Map — Quitting…");
    expect(h.child().posted).toEqual([{ type: "backup", id: "backup-1", kind: "quit" }]);
    h.child().message({ type: "backup-progress", id: "backup-1" });
    await flush();
    expect(shutdowns(h.child())).toEqual([]);
    h.child().message({ type: "backup-done", id: "backup-1", file: "career-2026-10-25.db" });
    await flush();
    expect(h.child().posted).toEqual([{ type: "backup", id: "backup-1", kind: "quit" }, SHUTDOWN]);
    expect(h.ports.exits).toEqual([]);
    h.child().exit(0);
    await flush();
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-CLI-008, DESK-SHELL-BAK-006
  it("shuts down and exits when the backup fails or reports no progress for 60 s", async () => {
    const failed = await running();
    failed.handOver({ quit: true });
    await flush();
    failed.child().message({ type: "backup-failed", id: "backup-1", short: "disk full", reason: "the backups folder's disk is full" });
    await flush();
    expect(shutdowns(failed.child())).toEqual([SHUTDOWN]);
    failed.child().exit(0);
    await flush();
    expect(failed.ports.exits).toEqual([{ code: 0, relaunch: null }]);

    const silent = await running();
    silent.handOver({ quit: true });
    await silent.ports.clock.advance(59_999);
    expect(shutdowns(silent.child())).toEqual([]);
    await silent.ports.clock.advance(1);
    expect(shutdowns(silent.child())).toEqual([SHUTDOWN]);
    silent.child().exit(0);
    await flush();
    expect(silent.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-CLI-008, DESK-SHELL-BAK-008
  it("exits at once with no server to ask: given up, nothing sent", async () => {
    const h = await running({ ready: false });
    h.child().exit(11);
    await flush();
    expect(h.ports.tray.last()?.dot).toBe("red");
    h.handOver({ quit: true });
    await flush();
    expect(h.child().posted).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(h.ports.launcher.starts).toHaveLength(1);
  });
});

describe("the end of the Windows session", () => {
  // @spec DESK-SHELL-OS-003, DESK-SHELL-QUIT-001, DESK-SHELL-SRV-019
  it("enters the quitting state and sends Shut down from inside the handler, exiting once the server has ended", async () => {
    const h = await running();
    h.shell.endSession();
    expect(h.shell.quitting()).toBe("session-end");
    expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
    await flush();
    expect(h.ports.exits).toEqual([]);
    h.child().exit(0);
    await flush();
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-OS-003, DESK-SHELL-SRV-020
  it("exits after 10 s when the server has not ended, ending it", async () => {
    const h = await running();
    h.shell.endSession();
    await h.ports.clock.advance(9_999);
    expect(h.ports.exits).toEqual([]);
    await h.ports.clock.advance(1);
    await flush();
    expect(h.child().killed).toBe(true);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-005, DESK-SHELL-OS-003
  it("abandons --quit's backup and shuts down at once", async () => {
    const h = await running();
    h.handOver({ quit: true });
    await flush();
    expect(h.child().posted).toEqual([{ type: "backup", id: "backup-1", kind: "quit" }]);
    h.shell.endSession();
    expect(h.shell.quitting()).toBe("session-end");
    expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
    h.child().exit(0);
    await h.ports.clock.advance(20_000);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-005, DESK-SHELL-QUIT-002
  it("closes Quit's box and turns the Quit into a session end", async () => {
    const h = await running({ tracker: AIRBORNE });
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.boxes.shown).toHaveLength(1);
    h.shell.endSession();
    await flush();
    expect(h.ports.boxes.shown[0].aborted).toBe(true);
    expect(h.shell.quitting()).toBe("session-end");
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-OS-003, DESK-SHELL-TRAY-021
  it("during Quit's 2 s read: a session end, no box, no relaunch, one exit", async () => {
    const h = await running({ tracker: AIRBORNE });
    h.ports.http.on(3280, "/api/tracker", () => never());
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.shell.endSession();
    expect(h.shell.quitting()).toBe("session-end");
    await h.ports.clock.advance(2_000);
    expect(h.ports.boxes.shown).toEqual([]);
    h.child().exit(0);
    await flush();
    await quit;
    await h.ports.clock.advance(20_000);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-001, DESK-SHELL-QUIT-003
  it("exits once whatever overlaps", async () => {
    const h = await running();
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.handOver({ quit: true });
    h.shell.endSession();
    h.shell.endSession();
    await h.shell.menuChosen("quit");
    h.child().exit(0);
    await flush();
    await quit;
    await h.ports.clock.advance(30_000);
    expect(h.ports.exits).toHaveLength(1);
    expect(h.ports.exits[0].code).toBe(0);
  });
});

describe("the window's place at the exit", () => {
  // @spec DESK-SHELL-WIN-025
  it("saves the open window's place as settings.window just before the exit, with no close event", async () => {
    const h = await running();
    expect(h.ports.window.isOpen()).toBe(true);
    const atQuit: SavedWindow = { x: -1500, y: 40, width: 1100, height: 700, maximized: true };
    const moved: SavedWindow = { x: 200, y: 120, width: 1000, height: 650, maximized: false };
    h.ports.window.placeNow = atQuit;
    let savedAtExit: unknown = "not read";
    h.atExit(() => {
      savedAtExit = JSON.parse(fs.readFileSync(h.settingsFile, "utf8")).window;
    });
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.shell.settings().window).toEqual(atQuit);
    h.ports.window.placeNow = moved;
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toHaveLength(1);
    expect(savedAtExit).toEqual(moved);
    expect(h.shell.settings().window).toEqual(moved);
  });
});
