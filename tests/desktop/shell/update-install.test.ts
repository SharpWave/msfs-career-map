/**
 * Installing an update, in the Shell (src/desktop/shell.ts with updates.ts; m5b contract §5): the three
 * ways an update installs — at the end of Quit (DESK-SHELL-UPD-011), on **Restart to update** with or
 * without a backup (UPD-012, UPD-030) and at a quiet moment (UPD-028) — each after the backup before an
 * update naming the version (UPD-015, BAK-005) or with no server to ask none (UPD-017), the version
 * recorded (UPD-018) and the install-under-way mark written before the last look (UPD-031, DIST-INST-025),
 * then `install()`; and each way one goes no further — the backup failed (UPD-016), the sim came into use
 * (UPD-013), a quiet moment's condition broke or the pilot called it off (UPD-029), the installer not
 * started (UPD-019) — leaving the quitting state (QUIT-009, QUIT-010) and acting on what was held
 * (QUIT-007, QUIT-011) and on the starts the mark gathered. Also: `--quit` and a session end install
 * nothing (UPD-014), the recorded version checked at start (UPD-020), the update items in the tray
 * (TRAY-015 to TRAY-017, TRAY-027), the update-ready notice (NOTE-003), and test mode never reaching the
 * updater (UPD-005).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Shell } from "../../../src/desktop/shell.ts";
import type { CommandLine } from "../../../src/desktop/cli.ts";
import { markLine, markPath, parseMark, type MarkRecord } from "../../../src/desktop/install-mark.ts";
import type { DesktopSettings } from "../../../src/desktop/settings.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
import type { TrayMenuItem } from "../../../src/desktop/tray-model.ts";
import { flush } from "../support/clock.ts";
import {
  command,
  installedPlan,
  makePorts,
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
const PROGRAM_PATH = "C:\\stand-in\\MSFS Career Map\\MSFS Career Map.exe";
const STAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;
const VERSION = "0.8.0";
const Y = "0.9.0";
const SHUTDOWN = { type: "shutdown" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UPDATE_READY_BODY = `Version ${Y} installs when you quit MSFS Career Map or choose Restart to update in the tray, or by itself once MSFS and the MSFS Career Map window are closed.`;

const DEFAULT_SETTINGS: DesktopSettings = {
  lastDailyBackup: "2026-10-25T11:00:00.000Z",
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
  /** The install-under-way mark's path (from the env's LOCALAPPDATA). */
  mark: string;
  desktopLog(): string[];
  child(): FakeChild;
  handOver(o?: Partial<CommandLine>): void;
  stream(): { chunk(text: string): void; end(): void };
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
 * A Shell on a fresh temp folder, installed by default (only an installed copy updates), its env naming
 * the folder's Local and Roaming as LOCALAPPDATA and APPDATA, with `settings` over a daily backup an hour
 * old, /api/status answering as its own server and /api/tracker answering `tracker`. Started with
 * `--background` by default, so no window is open. Not started.
 */
function harness(
  o: {
    mode?: "installed" | "test";
    command?: Partial<CommandLine>;
    settings?: Partial<DesktopSettings>;
    tracker?: Record<string, unknown>;
  } = {},
): Harness {
  const root = tempFolder("update-");
  const plan = o.mode === "test" ? testPlan(root) : installedPlan(root);
  fs.mkdirSync(plan.electronFolder, { recursive: true });
  const settingsFile = win.join(plan.electronFolder, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ ...DEFAULT_SETTINGS, ...o.settings }, null, 2));
  const local = win.join(root, "Local");
  const ports = makePorts();
  const shell = new Shell(
    {
      plan,
      command: command({ testData: plan.testFolder, background: true, ...o.command }),
      version: VERSION,
      programPath: PROGRAM_PATH,
      programFolder: PROGRAM_FOLDER,
      serverScript: `${PROGRAM_FOLDER}\\server.mjs`,
      env: { Path: "C:\\Windows\\system32", LOCALAPPDATA: local, APPDATA: win.join(root, "Roaming") },
    },
    ports,
  );
  ports.http.on(plan.port, "/api/status", () => {
    const child = ports.launcher.starts.at(-1);
    return child && child.pid !== null && child.exited === null ? statusAnswer({ pid: child.pid }) : null;
  });
  ports.http.on(plan.port, "/api/tracker", trackerAnswer(o.tracker ?? {}));
  return {
    ports,
    plan,
    shell,
    root,
    settingsFile,
    mark: markPath(local),
    desktopLog: () => logLines(win.join(plan.electronFolder, "logs", "desktop.log")),
    child: () => ports.launcher.last(),
    handOver: (c = {}) => shell.handOver(command({ testData: plan.testFolder, ...c })),
    stream: () => {
      const s = ports.http.openStreams().at(-1);
      if (!s) throw new Error("no event stream is open");
      return s;
    },
  };
}

/** Started, the server spawned and its start-up work done (the tracker read and the stream open). */
async function running(o: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(o);
  await h.shell.start();
  h.child().spawn();
  await h.ports.clock.advance(0);
  expect(h.ports.http.openStreams()).toHaveLength(1);
  return h;
}

/** The first check (1 minute after start) finds Y already downloaded; its download validates at once: ready. */
async function makeReady(h: Harness): Promise<void> {
  h.ports.updater.checkReply = { kind: "found", version: Y, downloaded: true };
  await h.ports.clock.advance(MINUTE);
  const d = h.ports.updater.downloads.at(-1);
  expect(d?.version).toBe(Y);
  d!.finish();
  await flush();
  expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} ready`);
}

async function readyRunning(o: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = await running(o);
  await makeReady(h);
  return h;
}

async function send(h: Harness, event: string, data: unknown): Promise<void> {
  h.stream().chunk(sseEvent(event, data));
  await flush();
}

const menu = (h: Harness): TrayMenuItem[] => h.shell.trayModel().menu;
function item(h: Harness, id: string): Extract<TrayMenuItem, { id: string }> | undefined {
  return menu(h).find((i): i is Extract<TrayMenuItem, { id: string }> => "id" in i && i.id === id);
}
const versionLine = (h: Harness): string | undefined => item(h, "version")?.label;
const ids = (h: Harness): string[] => menu(h).map((i) => ("id" in i ? i.id : "-"));

type Posted = { type?: unknown; id?: unknown; kind?: unknown; version?: unknown };
const backups = (child: FakeChild) => child.posted.filter((m): m is Posted => (m as Posted).type === "backup") as Posted[];
const shutdowns = (child: FakeChild) => child.posted.filter((m) => (m as Posted).type === "shutdown");
const settingsOnDisk = (h: Harness): DesktopSettings => JSON.parse(fs.readFileSync(h.settingsFile, "utf8"));
const markRecords = (h: Harness): MarkRecord[] => {
  const bytes = h.ports.markFiles.read(h.mark);
  return bytes === null ? [] : parseMark(bytes);
};
const page = (port: number, fragment = "") => `http://127.0.0.1:${port}/${fragment === "" ? "" : `#${fragment}`}`;

/** The update backup's request, answered done. */
async function backupDone(h: Harness, n = -1): Promise<void> {
  const b = backups(h.child()).at(n);
  expect(b).toMatchObject({ kind: "update", version: Y });
  h.child().message({ type: "backup-done", id: b!.id, file: `career.before-update-${Y}.db` });
  await flush();
}

async function backupFailed(h: Harness, short = "the disk is full"): Promise<void> {
  const b = backups(h.child()).at(-1);
  expect(b).toMatchObject({ kind: "update", version: Y });
  h.child().message({ type: "backup-failed", id: b!.id, short, reason: `could not write the backup: ${short}` });
  await flush();
}

/** The server ends after Shut down. */
async function serverEnds(h: Harness): Promise<void> {
  expect(shutdowns(h.child())).toEqual([SHUTDOWN]);
  h.child().exit(0);
  await flush();
}

/** facts.msfsRunning answering each value in turn, then the last one for good. */
function msfsAnswers(h: Harness, answers: boolean[]): void {
  const queue = [...answers];
  h.ports.facts.msfsRunning = () => {
    h.ports.facts.calls.push("msfsRunning");
    return Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]);
  };
}

/** The settings and the mark as `install()` finds them, and its call recorded. */
function watchInstall(h: Harness, reply: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const seen: { installingVersion: string | null; mark: MarkRecord[] }[] = [];
  const real = h.ports.updater.install.bind(h.ports.updater);
  h.ports.updater.installReply = reply;
  h.ports.updater.install = () => {
    seen.push({ installingVersion: settingsOnDisk(h).installingVersion, mark: markRecords(h) });
    return real();
  };
  return seen;
}

const installs = (h: Harness) => h.ports.updater.calls.filter((c) => c === "install");
const PROCESS: MarkRecord = { kind: "process", pid: 7300, program: PROGRAM_PATH };

// ---------------------------------------------------------------------------------------------

describe("Quit with an update ready", () => {
  // @spec DESK-SHELL-UPD-011, DESK-SHELL-UPD-015, DESK-SHELL-BAK-005, DESK-SHELL-UPD-018, DESK-SHELL-UPD-031, DESK-SHELL-UPD-010, DESK-DIST-INST-025
  it("backs up naming the version, shuts down, records it, writes the mark asking for no start, then installs, exiting nothing itself", async () => {
    const h = await readyRunning();
    const seen = watchInstall(h);
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.shell.quitting()).toBe("quit");
    expect(backups(h.child())).toEqual([{ type: "backup", id: expect.any(String), kind: "update", version: Y }]);
    expect(shutdowns(h.child())).toEqual([]);
    await backupDone(h);
    await serverEnds(h);
    await quit;
    expect(seen).toEqual([{ installingVersion: Y, mark: [PROCESS, { kind: "request", start: "none" }] }]);
    expect(installs(h)).toEqual(["install"]);
    expect(h.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-016, DESK-SHELL-UPD-011
  it("goes ahead without installing when the backup before the update fails", async () => {
    const h = await readyRunning();
    const quit = h.shell.menuChosen("quit");
    await flush();
    await backupFailed(h);
    await serverEnds(h);
    await quit;
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(h.ports.markFiles.has(h.mark)).toBe(false);
    expect(settingsOnDisk(h).installingVersion).toBeNull();
    expect(h.desktopLog().some((l) => l.includes("could not write the backup: the disk is full"))).toBe(true);
  });

  // @spec DESK-SHELL-UPD-017
  it("takes no backup and installs while there is no server to ask (one waiting out a restart delay)", async () => {
    const h = await readyRunning();
    // The server crashes after running: a restart after 1 s.
    h.child().exit(1);
    await flush();
    expect(h.ports.launcher.starts).toHaveLength(1);
    const quit = h.shell.menuChosen("quit");
    await flush();
    await quit;
    expect(h.ports.launcher.starts.flatMap((c) => backups(c))).toEqual([]);
    expect(installs(h)).toEqual(["install"]);
    expect(h.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-011, DESK-SHELL-QUIT-006, DESK-SHELL-UPD-031
  it("installs nothing when a start was handed over by its last look: the mark taken up, the record cleared, that start relaunched", async () => {
    const h = await readyRunning();
    const quit = h.shell.menuChosen("quit");
    await flush();
    h.handOver({ updated: true });
    await flush();
    await backupDone(h);
    await serverEnds(h);
    await quit;
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: ["--updated"] }]);
    expect(h.ports.markFiles.has(h.mark)).toBe(false);
    expect(settingsOnDisk(h).installingVersion).toBeNull();
  });

  // @spec DESK-SHELL-UPD-019, DESK-SHELL-UPD-031
  it("exits without installing when the installer cannot be started: discarded, record cleared, the mark taken up", async () => {
    const h = await readyRunning();
    watchInstall(h, { ok: false, reason: "No valid update available, can't quit and install" });
    const quit = h.shell.menuChosen("quit");
    await flush();
    await backupDone(h);
    await serverEnds(h);
    await quit;
    expect(h.ports.updater.calls).toContain("discard");
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
    expect(settingsOnDisk(h).installingVersion).toBeNull();
    expect(h.ports.markFiles.has(h.mark)).toBe(false);
    expect(h.ports.markFiles.calls).toContain(`rename ${h.mark} -> ${h.mark}.7300.taken`);
  });
});

describe("Restart to update", () => {
  // @spec DESK-SHELL-UPD-012, DESK-SHELL-UPD-015, DESK-SHELL-BAK-005, DESK-SHELL-UPD-018, DESK-SHELL-UPD-031, DESK-SHELL-UPD-010, DESK-DIST-INST-025
  it("enters the quitting state, backs up, shuts down, records the version, writes the mark asking for --updated, then installs", async () => {
    const h = await readyRunning();
    const seen = watchInstall(h);
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    expect(h.shell.quitting()).toBe("restart");
    expect(backups(h.child())).toEqual([{ type: "backup", id: expect.any(String), kind: "update", version: Y }]);
    await backupDone(h);
    await serverEnds(h);
    await restart;
    expect(seen).toEqual([{ installingVersion: Y, mark: [PROCESS, { kind: "request", start: "--updated" }] }]);
    expect(h.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-030, DESK-SHELL-TRAY-027
  it("without a backup, offered only after the backup failed, installs with no backup asked for", async () => {
    const h = await readyRunning();
    expect(item(h, "restart-update-no-backup")).toBeUndefined();
    const first = h.shell.menuChosen("restart-update");
    await flush();
    await backupFailed(h, "no access");
    await first;
    expect(h.shell.quitting()).toBeNull();
    expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} waiting: backup failed (no access)`);
    expect(item(h, "restart-update-no-backup")).toMatchObject({ label: "Restart to update without a backup", enabled: true });

    const seen = watchInstall(h);
    const restart = h.shell.menuChosen("restart-update-no-backup");
    await flush();
    expect(h.shell.quitting()).toBe("restart");
    expect(backups(h.child())).toHaveLength(1);
    await serverEnds(h);
    await restart;
    expect(seen).toEqual([{ installingVersion: Y, mark: [PROCESS, { kind: "request", start: "--updated" }] }]);
  });

  // @spec DESK-SHELL-UPD-016, DESK-SHELL-QUIT-009
  it("goes no further when the backup fails: leaves the quitting state with the server still running, the update still ready", async () => {
    const h = await readyRunning();
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    await backupFailed(h);
    await restart;
    expect(h.shell.quitting()).toBeNull();
    expect(shutdowns(h.child())).toEqual([]);
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(installs(h)).toEqual([]);
    expect(h.desktopLog().some((l) => l.includes("could not write the backup: the disk is full"))).toBe(true);
    // Taken up where it was: the stream subscribed again, the status line back.
    await h.ports.clock.advance(0);
    expect(h.ports.http.openStreams()).toHaveLength(1);
    expect(item(h, "status")?.label).not.toBe("Quitting…");
  });

  // @spec DESK-SHELL-UPD-013, DESK-SHELL-QUIT-009
  it("drops the restart when the sim has come into use after the backup, and again just before the shutdown", async () => {
    for (const answers of [[true], [false, true]]) {
      const h = await readyRunning();
      const restart = h.shell.menuChosen("restart-update");
      await flush();
      msfsAnswers(h, answers);
      await backupDone(h);
      await restart;
      expect(h.shell.quitting()).toBeNull();
      expect(shutdowns(h.child())).toEqual([]);
      expect(installs(h)).toEqual([]);
      expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} ready`);
      expect(item(h, "restart-update")).toMatchObject({ label: "Restart to update (after the sim closes)", enabled: false });
    }
  });

  // @spec DESK-SHELL-UPD-019, DESK-SHELL-QUIT-009, DESK-SHELL-UPD-031
  it("leaves the quitting state when the installer cannot be started: discarded, record cleared, the mark taken up, the server started again", async () => {
    const h = await readyRunning();
    watchInstall(h, { ok: false, reason: "No valid update available, can't quit and install" });
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    await backupDone(h);
    await serverEnds(h);
    await restart;
    expect(h.shell.quitting()).toBeNull();
    expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} could not be installed`);
    expect(h.ports.updater.calls).toContain("discard");
    expect(settingsOnDisk(h).installingVersion).toBeNull();
    expect(h.ports.markFiles.has(h.mark)).toBe(false);
    expect(h.ports.markFiles.calls).toContain(`rename ${h.mark} -> ${h.mark}.7300.taken`);
    expect(h.ports.launcher.starts).toHaveLength(2);
    expect(h.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-QUIT-010, DESK-SHELL-UPD-017
  it("with the server given up on, takes no backup, and an install that goes no further leaves it given up, Try again offered", async () => {
    const h = harness();
    await h.shell.start();
    h.child().spawn();
    h.child().exit(11);
    await flush();
    expect(item(h, "try-again")).toBeDefined();
    await makeReady(h);
    watchInstall(h, { ok: false, reason: "No valid update available, can't quit and install" });
    await h.shell.menuChosen("restart-update");
    await flush();
    expect(installs(h)).toEqual(["install"]);
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.launcher.starts).toHaveLength(1);
    expect(item(h, "try-again")).toBeDefined();
  });

  // @spec DESK-SHELL-QUIT-007
  it("holds starts handed over meanwhile: acted on when the restart goes no further, dropped when it goes ahead", async () => {
    const stopped = await readyRunning();
    const r1 = stopped.shell.menuChosen("restart-update");
    await flush();
    stopped.handOver({});
    await flush();
    expect(stopped.ports.window.openCalls).toBe(0);
    await backupFailed(stopped);
    await r1;
    expect(stopped.ports.window.openCalls).toBe(1);

    const ahead = await readyRunning();
    const r2 = ahead.shell.menuChosen("restart-update");
    await flush();
    ahead.handOver({});
    ahead.handOver({ background: true });
    await flush();
    await backupDone(ahead);
    await serverEnds(ahead);
    await r2;
    expect(installs(ahead)).toEqual(["install"]);
    expect(ahead.ports.window.openCalls).toBe(0);
    expect(ahead.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-QUIT-011, DESK-SHELL-QUIT-009
  it("holds a Quit and a --quit meanwhile: after going no further the --quit is acted on and the Quit dropped", async () => {
    const h = await readyRunning();
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    void h.shell.menuChosen("quit");
    h.handOver({ quit: true });
    await flush();
    expect(h.shell.quitting()).toBe("restart");
    await backupFailed(h);
    await restart;
    await flush();
    expect(h.shell.quitting()).toBe("quit-switch");
    expect(backups(h.child()).at(-1)).toMatchObject({ kind: "quit" });
  });

  // @spec DESK-SHELL-QUIT-011, DESK-SHELL-TRAY-021
  it("acts on a Quit held alone afresh once the restart goes no further", async () => {
    const h = await readyRunning();
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    void h.shell.menuChosen("quit");
    await flush();
    await backupFailed(h);
    await restart;
    await flush();
    // The Quit asked afresh (no leg in the air: no question), and it tries the backup before the update again.
    expect(h.shell.quitting()).toBe("quit");
    expect(h.ports.boxes.shown).toEqual([]);
    expect(backups(h.child()).filter((b) => b.kind === "update")).toHaveLength(2);
  });

  // @spec DESK-SHELL-UPD-031, DESK-SHELL-QUIT-009
  it("takes up the mark when it goes no further and acts on each start a start left in it", async () => {
    const h = await readyRunning();
    const real = h.ports.updater.install.bind(h.ports.updater);
    h.ports.updater.installReply = { ok: false, reason: "No valid update available, can't quit and install" };
    h.ports.updater.install = () => {
      // A start made by the pilot while the install was under way.
      expect(h.ports.markFiles.append(h.mark, markLine({ kind: "start", switches: "" }))).toBe(true);
      return real();
    };
    const restart = h.shell.menuChosen("restart-update");
    await flush();
    await backupDone(h);
    await serverEnds(h);
    await restart;
    await flush();
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.window.openCalls).toBe(1);
  });
});

describe("a quiet moment", () => {
  /** Ready, the sim out of use, the window closed, the server running and the stream open, an idle tracker. */
  async function quiet(o: Parameters<typeof harness>[0] = {}): Promise<Harness> {
    return readyRunning({ command: { background: true }, ...o });
  }

  // @spec DESK-SHELL-UPD-028, DESK-SHELL-UPD-015, DESK-SHELL-UPD-018, DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("after 5 unbroken minutes backs up, shuts down, records, writes the mark asking for --background and installs", async () => {
    const h = await quiet();
    const seen = watchInstall(h);
    await h.ports.clock.advance(5 * MINUTE - 1_000);
    expect(backups(h.child())).toEqual([]);
    await h.ports.clock.advance(1_000);
    expect(h.shell.quitting()).toBe("quiet");
    expect(backups(h.child())).toEqual([{ type: "backup", id: expect.any(String), kind: "update", version: Y }]);
    await backupDone(h);
    await serverEnds(h);
    expect(seen).toEqual([{ installingVersion: Y, mark: [PROCESS, { kind: "request", start: "--background" }] }]);
    expect(h.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-028
  it("waits for 5 unbroken minutes again after each condition breaks", async () => {
    const cases: [string, (h: Harness) => Promise<void>, (h: Harness) => Promise<void>][] = [
      [
        "the sim in use",
        (h) => send(h, "status", trackerStatus({ connected: true, sim_name: "MSFS 2024" })),
        (h) => send(h, "status", trackerStatus({})),
      ],
      [
        "a leg in progress",
        (h) => send(h, "status", trackerStatus({ phase: "airborne", leg: { origin: "KBOS" } })),
        (h) => send(h, "status", trackerStatus({})),
      ],
      [
        "casual mode",
        (h) => send(h, "status", trackerStatus({ casual: { since: "2026-10-25T11:00:00.000Z" } })),
        (h) => send(h, "status", trackerStatus({})),
      ],
      [
        "the window open",
        async (h) => {
          h.shell.trayClicked();
          await flush();
        },
        async (h) => {
          h.ports.window.close();
          h.shell.windowClosed(h.ports.window.placeNow);
          await flush();
        },
      ],
    ];
    for (const [what, breakIt, mendIt] of cases) {
      const h = await quiet();
      await h.ports.clock.advance(3 * MINUTE);
      await breakIt(h);
      await h.ports.clock.advance(3 * MINUTE);
      expect(backups(h.child()), what).toEqual([]);
      await mendIt(h);
      await h.ports.clock.advance(5 * MINUTE - 1_000);
      expect(backups(h.child()), what).toEqual([]);
      await h.ports.clock.advance(1_000);
      expect(h.shell.quitting(), what).toBe("quiet");
    }
  });

  // @spec DESK-SHELL-UPD-016, DESK-SHELL-UPD-028, DESK-SHELL-QUIT-009
  it("goes no further when its backup fails, and waits an hour or more after the failure before the next", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    await backupFailed(h);
    expect(h.shell.quitting()).toBeNull();
    expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} waiting: backup failed (the disk is full)`);
    await h.ports.clock.advance(30 * MINUTE);
    expect(backups(h.child())).toHaveLength(1);
    await h.ports.clock.advance(30 * MINUTE + 5 * MINUTE);
    expect(h.shell.quitting()).toBe("quiet");
    expect(backups(h.child())).toHaveLength(2);
  });

  // @spec DESK-SHELL-UPD-029
  it("is called off when the sim comes into use during its backup", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    msfsAnswers(h, [true]);
    await backupDone(h);
    expect(h.shell.quitting()).toBeNull();
    expect(shutdowns(h.child())).toEqual([]);
    expect(installs(h)).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-029, DESK-SHELL-QUIT-009
  it("is called off at once when the pilot opens the window, which then shows the page", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    expect(h.shell.quitting()).toBe("quiet");
    await h.shell.menuChosen("open");
    await flush();
    expect(h.shell.quitting()).toBeNull();
    await backupDone(h);
    expect(shutdowns(h.child())).toEqual([]);
    expect(installs(h)).toEqual([]);
    expect(h.ports.window.isOpen()).toBe(true);
    expect(h.ports.window.lastLoad()).toBe(page(h.plan.port));
  });

  // @spec DESK-SHELL-UPD-029
  it("is called off by a start handed over other than --background, then acted on", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    h.handOver({});
    await flush();
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.window.openCalls).toBe(1);
    expect(screenOf(h.ports.window.lastLoad() ?? "", h.plan.port)).toBe("page");
  });

  // @spec DESK-SHELL-UPD-029, DESK-SHELL-CLI-022, DESK-SHELL-NOTE-012
  it("is called off by a notification click, the window then opening on its hop", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    h.ports.notifications.click({ kind: "hop", id: 12 });
    await flush();
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.window.loads).toEqual([page(h.plan.port, "hop=12")]);
  });

  // @spec DESK-SHELL-UPD-032
  it("drops a --background handed over meanwhile, calling nothing off", async () => {
    const h = await quiet();
    await h.ports.clock.advance(5 * MINUTE);
    h.handOver({ background: true });
    await flush();
    expect(h.shell.quitting()).toBe("quiet");
    await backupDone(h);
    await serverEnds(h);
    expect(installs(h)).toEqual(["install"]);
    expect(h.ports.window.openCalls).toBe(0);
  });

  // @spec DESK-SHELL-QUIT-011, DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("asks the installer for no start when a Quit is held before the mark is written, and appends request none after", async () => {
    const before = await quiet();
    await before.ports.clock.advance(5 * MINUTE);
    void before.shell.menuChosen("quit");
    await flush();
    const seenBefore = watchInstall(before);
    await backupDone(before);
    await serverEnds(before);
    expect(seenBefore).toEqual([{ installingVersion: Y, mark: [PROCESS, { kind: "request", start: "none" }] }]);

    const after = await quiet();
    await after.ports.clock.advance(5 * MINUTE);
    // The Quit comes the moment the shell has written the mark.
    const write = after.ports.markFiles.write.bind(after.ports.markFiles);
    after.ports.markFiles.write = (file, bytes) => {
      write(file, bytes);
      void after.shell.menuChosen("quit");
    };
    const seenAfter = watchInstall(after);
    await backupDone(after);
    await serverEnds(after);
    expect(seenAfter).toEqual([
      { installingVersion: Y, mark: [PROCESS, { kind: "request", start: "--background" }, { kind: "request", start: "none" }] },
    ]);
    expect(after.ports.exits).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-028
  it("never comes while no update is ready", async () => {
    const h = await running();
    h.ports.updater.checkReply = { kind: "none" };
    await h.ports.clock.advance(2 * HOUR);
    expect(h.shell.quitting()).toBeNull();
    expect(backups(h.child())).toEqual([]);
  });
});

describe("other exits", () => {
  // @spec DESK-SHELL-UPD-014
  it("--quit installs nothing", async () => {
    const h = await readyRunning();
    h.handOver({ quit: true });
    await flush();
    expect(backups(h.child()).at(-1)).toMatchObject({ kind: "quit" });
    h.child().message({ type: "backup-done", id: backups(h.child()).at(-1)!.id, file: "career.db" });
    await flush();
    await serverEnds(h);
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-UPD-014
  it("a session end installs nothing", async () => {
    const h = await readyRunning();
    h.shell.endSession();
    await flush();
    await serverEnds(h);
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });
});

describe("entering the quitting state", () => {
  // @spec DESK-SHELL-QUIT-002
  it("cancels an update check under way", async () => {
    const h = await running();
    await h.ports.clock.advance(MINUTE);
    expect(h.ports.updater.checksWaiting()).toBe(1);
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.updater.calls).toEqual(["check", "cancelCheck"]);
    expect(h.ports.updater.checksWaiting()).toBe(0);
    await serverEnds(h);
    await quit;
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-002
  it("cancels an update download under way", async () => {
    const h = await running();
    h.ports.updater.checkReply = { kind: "found", version: Y, downloaded: false };
    await h.ports.clock.advance(MINUTE);
    expect(versionLine(h)).toBe(`Version ${VERSION} — downloading ${Y}`);
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.ports.updater.downloads.at(-1)?.cancelled).toBe(true);
    expect(backups(h.child())).toEqual([]);
    await serverEnds(h);
    await quit;
    expect(installs(h)).toEqual([]);
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });
});

describe("the recorded version at start", () => {
  // @spec DESK-SHELL-UPD-020, DESK-SHELL-UPD-025, DESK-SHELL-TRAY-016
  it("clears it, and when the running version is still below it says so on the version line until the first check", async () => {
    const failed = harness({ settings: { installingVersion: Y } });
    await failed.shell.start();
    expect(settingsOnDisk(failed).installingVersion).toBeNull();
    expect(versionLine(failed)).toBe(`Version ${VERSION} — ${Y} could not be installed`);
    expect(failed.desktopLog()).toContain(`[update] ${Y} could not be installed`);
    failed.child().spawn();
    failed.ports.updater.checkReply = { kind: "none" };
    await failed.ports.clock.advance(MINUTE);
    expect(versionLine(failed)).toBe(`Version ${VERSION} — up to date`);

    for (const recorded of [VERSION, "0.7.5"]) {
      const done = harness({ settings: { installingVersion: recorded } });
      await done.shell.start();
      expect(settingsOnDisk(done).installingVersion).toBeNull();
      expect(versionLine(done)).toBe(`Version ${VERSION}`);
      expect(done.desktopLog().some((l) => l.includes("could not be installed"))).toBe(false);
    }
  });
});

describe("the update items in the tray", () => {
  // @spec DESK-SHELL-TRAY-015, DESK-SHELL-TRAY-016, DESK-SHELL-UPD-025
  it("puts Restart to update, Restart to update without a backup and Check for updates under the version line", async () => {
    const h = await running();
    expect(versionLine(h)).toBe(`Version ${VERSION}`);
    expect(ids(h).slice(ids(h).indexOf("version"), ids(h).indexOf("version") + 3)).toEqual(["version", "check-updates", "-"]);
    await makeReady(h);
    const v = ids(h).indexOf("version");
    expect(ids(h).slice(v, v + 3)).toEqual(["version", "restart-update", "check-updates"]);
    expect(item(h, "check-updates")).toMatchObject({ label: "Check for updates", enabled: true });
    expect(ids(h).indexOf("check-updates")).toBeLessThan(ids(h).indexOf("open-data"));
  });

  // @spec DESK-SHELL-TRAY-017
  it("shows Restart to update only while ready, not clickable while the server is restarting or the sim is in use", async () => {
    const h = await running();
    expect(item(h, "restart-update")).toBeUndefined();
    await makeReady(h);
    expect(item(h, "restart-update")).toMatchObject({ label: "Restart to update", enabled: true });
    await send(h, "status", trackerStatus({ connected: true, sim_name: "MSFS 2024" }));
    expect(item(h, "restart-update")).toMatchObject({ label: "Restart to update (after the sim closes)", enabled: false });
    await send(h, "status", trackerStatus({}));
    expect(item(h, "restart-update")).toMatchObject({ label: "Restart to update", enabled: true });
    h.child().exit(1);
    await flush();
    expect(item(h, "restart-update")).toMatchObject({ enabled: false });
    // A click while not clickable does nothing.
    await h.shell.menuChosen("restart-update");
    expect(h.shell.quitting()).toBeNull();
  });

  // @spec DESK-SHELL-UPD-003
  it("Check for updates checks now, and is skipped while an update is ready", async () => {
    const h = await running();
    h.ports.updater.checkReply = { kind: "none" };
    await h.shell.menuChosen("check-updates");
    await flush();
    expect(h.ports.updater.calls).toEqual(["check"]);
    expect(versionLine(h)).toBe(`Version ${VERSION} — up to date`);
    await makeReady(h);
    const before = h.ports.updater.calls.length;
    await h.shell.menuChosen("check-updates");
    await flush();
    expect(h.ports.updater.calls.length).toBe(before);
    expect(versionLine(h)).toBe(`Version ${VERSION} — ${Y} ready`);
  });

  // @spec DESK-SHELL-SRV-039
  it("runs a check that fell due while the PC slept on resume", async () => {
    const h = await running();
    h.ports.updater.checkReply = { kind: "none" };
    await h.ports.clock.advance(MINUTE);
    expect(h.ports.updater.calls).toEqual(["check"]);
    h.ports.clock.setWall(new Date(h.ports.clock.wallNow().getTime() + 5 * HOUR));
    h.shell.resume();
    await flush();
    expect(h.ports.updater.calls).toEqual(["check", "check"]);
  });
});

describe("the update-ready notice", () => {
  // @spec DESK-SHELL-NOTE-003, DESK-SHELL-UPD-009
  it("shows once the update is ready, a click opening the window, recorded for that version", async () => {
    const h = await readyRunning();
    expect(h.ports.notifications.shown).toEqual([
      { title: "Update ready", body: UPDATE_READY_BODY, target: { kind: "window" }, silent: false, closed: false },
    ]);
    expect(settingsOnDisk(h).updateNoticesShown).toEqual([Y]);

    // A later run's check finding it downloaded again shows nothing more.
    const again = await running({ settings: { updateNoticesShown: [Y] } });
    await makeReady(again);
    expect(again.ports.notifications.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-003
  it("waits while the sim is in use", async () => {
    const h = await running();
    await send(h, "status", trackerStatus({ connected: true, sim_name: "MSFS 2024" }));
    await makeReady(h);
    expect(h.ports.notifications.shown).toEqual([]);
    await send(h, "status", trackerStatus({}));
    expect(h.ports.notifications.titles()).toEqual(["Update ready"]);
  });
});

describe("test mode", () => {
  // @spec DESK-SHELL-UPD-005, DESK-SHELL-TRAY-020
  it("never reaches the updater and offers no update item", async () => {
    const h = await running({ mode: "test" });
    await h.ports.clock.advance(9 * HOUR);
    await h.shell.menuChosen("check-updates");
    await flush();
    expect(h.ports.updater.calls).toEqual([]);
    expect(versionLine(h)).toBe(`Version ${VERSION}`);
    for (const id of ["restart-update", "restart-update-no-backup", "check-updates"]) expect(item(h, id)).toBeUndefined();
    const quit = h.shell.menuChosen("quit");
    await flush();
    await serverEnds(h);
    await quit;
    expect(h.ports.updater.calls).toEqual([]);
    expect(h.ports.markFiles.calls).toEqual([]);
  });
});
