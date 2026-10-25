/**
 * The start-list items in the Shell (src/desktop/shell.ts with src/desktop/start-lists.ts; m4 contract
 * §6): outside test mode the tray menu holds Start with MSFS 2024 and Start with Windows between the
 * status lines and the version line, read as the menu opens (DESK-SHELL-TRAY-015, DESK-START-MSFS-001,
 * DESK-START-WINDOWS-001); in test mode neither is offered nor any start list reached
 * (DESK-START-TEST-001, TEST-002); a click on either is ignored while quitting (DESK-SHELL-QUIT-003);
 * Quit lets a change under way finish before it shuts the server down, logging its outcome and
 * opening no box (DESK-SHELL-QUIT-012), while a session end waits for none (DESK-SHELL-QUIT-005); the
 * tick comes from the lists, never from the settings (DESK-SHELL-SET-006); and MSFS quitting leaves the
 * app running (DESK-START-MSFS-009).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Shell } from "../../../src/desktop/shell.ts";
import { installedProgramPath } from "../../../src/desktop/installed.ts";
import type { DesktopSettings } from "../../../src/desktop/settings.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
import type { TrayMenuItem } from "../../../src/desktop/tray-model.ts";
import { runValue } from "../../../src/desktop/windows-start.ts";
import { flush } from "../support/clock.ts";
import {
  command,
  installedPlan,
  makePorts,
  statusAnswer,
  testPlan,
  trackerAnswer,
  type FakeChild,
  type FakePorts,
} from "../support/fakes.ts";
import { Sims, fixture } from "./support/sims.ts";

const win = path.win32;
const PROGRAM_FOLDER = "C:\\stand-in\\MSFS Career Map\\resources";
const STAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;
const IDLE = { connected: true, sim_name: "MSFS 2024", phase: "ground" };
const SEP: TrayMenuItem = { separator: true };

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
  sims: Sims;
  program: string;
  desktopLog(): string[];
  child(): FakeChild;
  menu(): Promise<TrayMenuItem[]>;
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
 * A Shell on a Sims root: installed (its Local and Roaming the Sims' own, which the shell's env names)
 * or in test mode on a folder inside it. Started, the server spawned and its start-up work done.
 */
async function running(
  o: {
    mode?: "installed" | "test";
    settings?: (sims: Sims) => Partial<DesktopSettings>;
    before?: (h: Harness) => void;
  } = {},
): Promise<Harness> {
  const sims = new Sims();
  const plan = o.mode === "test" ? testPlan(win.join(sims.root, "test-copy")) : installedPlan(sims.root);
  fs.mkdirSync(plan.electronFolder, { recursive: true });
  const settings = { ...DEFAULT_SETTINGS, ...o.settings?.(sims) };
  fs.writeFileSync(win.join(plan.electronFolder, "settings.json"), JSON.stringify(settings, null, 2));
  const ports = makePorts();
  const program = installedProgramPath(sims.local);
  const shell = new Shell(
    {
      plan,
      command: command({ testData: plan.testFolder }),
      version: "0.8.0",
      programPath: program,
      programFolder: PROGRAM_FOLDER,
      serverScript: `${PROGRAM_FOLDER}\\server.mjs`,
      env: { Path: "C:\\Windows\\system32", ...sims.env },
    },
    ports,
  );
  const h: Harness = {
    ports,
    plan,
    shell,
    sims,
    program,
    desktopLog: () => logLines(win.join(plan.electronFolder, "logs", "desktop.log")),
    child: () => ports.launcher.last(),
    async menu() {
      await shell.menuOpening();
      return shell.trayModel().menu;
    },
  };
  o.before?.(h);
  ports.http.on(plan.port, "/api/status", () => {
    const child = ports.launcher.starts.at(-1);
    return child && child.pid !== null && child.exited === null ? statusAnswer({ pid: child.pid }) : null;
  });
  ports.http.on(plan.port, "/api/tracker", trackerAnswer(IDLE));
  await shell.start();
  h.child().spawn();
  await ports.clock.advance(0);
  return h;
}

const ids = (menu: TrayMenuItem[]) => menu.flatMap((item) => ("id" in item ? [item.id] : []));
const itemOf = (menu: TrayMenuItem[], id: string) => menu.find((item) => "id" in item && item.id === id);
const shutdowns = (child: FakeChild) => child.posted.filter((m) => (m as { type?: unknown }).type === "shutdown");

describe("the start-list items in the tray menu", () => {
  // @spec DESK-SHELL-TRAY-015, DESK-START-MSFS-001, DESK-START-WINDOWS-001, DESK-START-MSFS-014
  it("sit between the status lines and the version line outside test mode, both off at first", async () => {
    const h = await running();
    const menu = await h.menu();
    const msfs = menu.findIndex((item) => "id" in item && item.id === "start-msfs");
    expect(menu.slice(msfs - 2, msfs + 4)).toEqual([
      { id: "status", label: "Connected to MSFS 2024", enabled: false },
      SEP,
      { id: "start-msfs", label: "Start with MSFS 2024 (MSFS 2024 not found)", enabled: false, checked: false },
      { id: "start-windows", label: "Start with Windows", enabled: true, checked: false },
      SEP,
      { id: "version", label: "Version 0.8.0", enabled: false },
    ]);
  });

  // @spec DESK-START-MSFS-011, DESK-START-WINDOWS-004
  it("are read again each time the menu opens", async () => {
    const h = await running();
    await h.menu();
    h.sims.install("Store").put("Store", fixture("after-app.xml", { program: h.program }));
    h.ports.keys.run = runValue(h.program);
    const menu = await h.menu();
    expect(itemOf(menu, "start-msfs")).toEqual({ id: "start-msfs", label: "Start with MSFS 2024", enabled: true, checked: true });
    expect(itemOf(menu, "start-windows")).toEqual({ id: "start-windows", label: "Start with Windows", enabled: true, checked: true });
  });

  // @spec DESK-START-WINDOWS-005, DESK-START-WINDOWS-006
  it("act on a click: Start with Windows turned on, then shown ticked", async () => {
    const h = await running();
    await h.menu();
    await h.shell.menuChosen("start-windows");
    await flush();
    expect(h.ports.keys.run).toBe(runValue(h.program));
    expect(itemOf(await h.menu(), "start-windows")).toMatchObject({ checked: true });
  });

  // @spec DESK-START-MSFS-007, DESK-START-MSFS-012
  it("act on a click: Start with MSFS 2024 turned on for the installed edition", async () => {
    const h = await running();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await h.menu();
    await h.shell.menuChosen("start-msfs");
    await flush();
    expect(Buffer.from(h.sims.exe("Store")!).toString("utf8")).toContain("<Name>MSFS Career Map</Name>");
    expect(itemOf(await h.menu(), "start-msfs")).toMatchObject({ label: "Start with MSFS 2024", checked: true });
  });

  // @spec DESK-START-TEST-001, DESK-START-TEST-002, DESK-SHELL-TRAY-020
  it("are left out in test mode, and no start list is read or written", async () => {
    const h = await running({ mode: "test" });
    h.sims.install("Store").put("Store", fixture("after-app.xml", { program: h.program }));
    const menu = await h.menu();
    expect(ids(menu)).not.toContain("start-msfs");
    expect(ids(menu)).not.toContain("start-windows");
    await h.shell.menuChosen("start-msfs");
    await h.shell.menuChosen("start-windows");
    await flush();
    expect(h.ports.fs.calls).toEqual([]);
    expect(h.ports.keys.calls).toEqual([]);
    expect(h.ports.facts.calls).not.toContain("msfs2024Running");
  });

  // @spec DESK-SHELL-SET-006, DESK-START-MSFS-006, DESK-START-MSFS-017
  it("take the tick from the start lists, never from the settings' record of files last written", async () => {
    const h = await running({
      settings: (sims) => ({ exeXmlFiles: [sims.exeFile("Store")] }),
      before: (x) => x.sims.install("Store").put("Store", fixture("real-six.xml")),
    });
    expect(itemOf(await h.menu(), "start-msfs")).toEqual({
      id: "start-msfs",
      label: "Start with MSFS 2024 (removed by another program; click to add again)",
      enabled: true,
      checked: false,
    });
    expect(itemOf(await h.menu(), "start-windows")).toMatchObject({ checked: false });
  });
});

describe("the start-list items while quitting", () => {
  // @spec DESK-SHELL-QUIT-003
  it("ignore a click once the desktop shell is quitting", async () => {
    const h = await running();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await h.menu();
    const fsCalls = h.ports.fs.calls.length;
    const keyCalls = h.ports.keys.calls.length;
    h.shell.endSession();
    await h.shell.menuChosen("start-msfs");
    await h.shell.menuChosen("start-windows");
    await flush();
    expect(h.ports.fs.calls.slice(fsCalls).filter((c) => !c.startsWith("read ") && !c.startsWith("exists ") && !c.startsWith("list "))).toEqual([]);
    expect(h.ports.keys.calls.slice(keyCalls)).toEqual([]);
    expect(h.ports.keys.run).toBeNull();
  });

  // @spec DESK-SHELL-QUIT-012, DESK-SHELL-QUIT-002, DESK-SHELL-AWAY-003
  it("let Quit wait for a change under way before shutting the server down, its outcome logged and no box opened", async () => {
    const h = await running();
    await h.menu();
    let release!: () => void;
    h.ports.keys.gate = new Promise<void>((resolve) => (release = resolve));
    // A failure that would open a box had the shell not been quitting.
    h.ports.keys.fail.writeOn = "Electron refused the login item";
    const click = h.shell.menuChosen("start-windows");
    await flush();
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.shell.quitting()).toBe("quit");
    expect(shutdowns(h.child())).toEqual([]);
    release();
    h.ports.keys.gate = null;
    await flush();
    await click;
    expect(shutdowns(h.child())).toEqual([{ type: "shutdown" }]);
    expect(h.ports.boxes.shown).toEqual([]);
    expect(h.desktopLog().some((l) => l.startsWith("[start-lists]") && l.includes("Electron refused the login item"))).toBe(true);
    h.child().exit(0);
    await flush();
    await quit;
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: null }]);
  });

  // @spec DESK-SHELL-QUIT-012
  it("let --quit handed over wait for a change under way too", async () => {
    const h = await running();
    await h.menu();
    let release!: () => void;
    h.ports.keys.gate = new Promise<void>((resolve) => (release = resolve));
    void h.shell.menuChosen("start-windows");
    await flush();
    // The quit backup --quit takes, answered whenever it is asked for, so only the change holds the shutdown.
    const answered = new Set<string>();
    const answerBackups = async () => {
      for (const m of h.child().posted) {
        const msg = m as { type?: string; id?: string };
        if (msg.type !== "backup" || msg.id === undefined || answered.has(msg.id)) continue;
        answered.add(msg.id);
        h.child().message({ type: "backup-done", id: msg.id, file: "career-2026-10-25.db" });
      }
      await flush();
    };
    h.shell.handOver(command({ quit: true }));
    await flush();
    await answerBackups();
    expect(h.shell.quitting()).toBe("quit-switch");
    expect(shutdowns(h.child())).toEqual([]);
    release();
    h.ports.keys.gate = null;
    await flush();
    await answerBackups();
    expect(shutdowns(h.child())).toEqual([{ type: "shutdown" }]);
    expect(h.ports.keys.run).toBe(runValue(h.program));
    expect(h.ports.boxes.shown).toEqual([]);
  });

  // @spec DESK-SHELL-QUIT-005
  it("never hold up a session end", async () => {
    const h = await running();
    await h.menu();
    h.ports.keys.gate = new Promise<void>(() => {});
    void h.shell.menuChosen("start-windows");
    await flush();
    h.shell.endSession();
    await flush();
    expect(shutdowns(h.child())).toEqual([{ type: "shutdown" }]);
  });
});

describe("MSFS quitting", () => {
  // @spec DESK-START-MSFS-009
  it("leaves the app running in the tray", async () => {
    const h = await running();
    h.sims.install("Store").put("Store", fixture("after-app.xml", { program: h.program }));
    h.ports.facts.msfs = true;
    h.ports.facts.msfs2024 = true;
    expect(itemOf(await h.menu(), "start-msfs")).toMatchObject({ label: "Start with MSFS 2024 (close MSFS to change)", enabled: false, checked: true });
    await h.ports.clock.advance(10_000);
    h.ports.facts.msfs = false;
    h.ports.facts.msfs2024 = false;
    await h.ports.clock.advance(30_000);
    expect(itemOf(await h.menu(), "start-msfs")).toMatchObject({ label: "Start with MSFS 2024", enabled: true, checked: true });
    expect(h.shell.quitting()).toBeNull();
    expect(h.ports.exits).toEqual([]);
    expect(shutdowns(h.child())).toEqual([]);
  });
});
