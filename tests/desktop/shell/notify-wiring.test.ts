/**
 * The shell's notifications as they reach the Shell (src/desktop/shell.ts with notifications.ts; m5a
 * contract §5): the tracker's `pending` and `hop` events and each subscription's pending legs turned
 * into notices (DESK-SHELL-NOTE-001, NOTE-002, NOTE-007, NOTE-008), closed when their leg leaves the list
 * (NOTE-010), silent while the sim is in use (AWAY-004) and none for the sim connecting (NOTE-018); a
 * click opening the window on its hop or pending leg through the fragment — changed alone on a page
 * already shown, held on the start screen for the page's first load (NOTE-012, WIN-001, CLI-021) — and
 * taken while quitting as a start with no switch handed over (CLI-022); the gave-up notice at once
 * (NOTE-004), the backups notice from the third failure in a row, once, waiting while the sim is in use
 * (NOTE-019), and the one-time notice at the pilot's own first close (TRAY-023); the registrations
 * written at start outside test mode only (NOTE-013, NOTE-015, NOTE-016); and test mode writing every
 * notification to desktop.log instead (NOTE-006).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Shell } from "../../../src/desktop/shell.ts";
import type { CommandLine } from "../../../src/desktop/cli.ts";
import type { DesktopSettings, SavedWindow } from "../../../src/desktop/settings.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
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
const PLACE: SavedWindow = { x: 100, y: 100, width: 1280, height: 800, maximized: false };

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

const TRAY_NOTICE_BODY =
  "MSFS Career Map keeps running and logs your flights. Quit it from the tray icon's menu, under ^ on the taskbar (Settings > Personalization > Taskbar > Other system tray icons keeps it in view).";
const TRY_AGAIN = "Choose Try again or Show log in the tray icon's menu.";

/** A pending leg as the status and the `pending` event list it (LIVE-API-014), its track left out. */
function leg(id: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    sim: { title: "Cessna 172 Skyhawk G1000", livery: "Asobo Blue", atc_id: "N172SP" },
    aircraft_id: null,
    origin: "KBOS",
    dest: "KPVD",
    departed_at: "2026-10-25T10:00:00.000Z",
    arrived_at: "2026-10-25T10:45:00.000Z",
    sim_departed_at: null,
    sim_arrived_at: null,
    duration_min: 45,
    landings: [],
    stats: {},
    briefing_id: null,
    reason: "No aircraft in the fleet matches this sim aircraft",
    ended_in_air: false,
    points: 540,
    ...o,
  };
}
const LEG_A = "6f9c2b0e-4d1a-4c33-9a57-2b8e1d0c7a11";
const LEG_B = "0b7d4e2a-91c5-4f08-b6e3-5a2c9d1f8e44";
const LEG_C = "c3a1f5d7-2e9b-4a6c-8d0f-7b4e2a9c1d55";
const PENDING_BODY = "Cessna 172 Skyhawk G1000 · Asobo Blue\nNo aircraft in the fleet matches this sim aircraft";

/** A `hop` event: the hop's record (its id) and the tracker's message (LIVE-HOP-006). */
const hopEvent = (id: number, message: string) => ({ hop: { id, aircraft_id: 3, seq: 9, origin: "KBOS", dest: "KPVD" }, message });
const HOP_MESSAGE = "Logged KBOS → KPVD, 45 min, 180 fpm butter";

interface Harness {
  ports: FakePorts;
  plan: RunPlan;
  shell: Shell;
  root: string;
  settingsFile: string;
  desktopLog(): string[];
  child(): FakeChild;
  /** The open event stream (the last one). */
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
 * A Shell constructed on a fresh temp folder — installed by default, since only an installed copy shows
 * notifications — with `settings` over a daily backup an hour old, /api/status answering as its own
 * server (start-up work done unless `startup` says otherwise) and /api/tracker answering `tracker`.
 * Not started.
 */
function harness(
  o: {
    mode?: "installed" | "test";
    command?: Partial<CommandLine>;
    settings?: Partial<DesktopSettings>;
    tracker?: Record<string, unknown>;
  } = {},
): Harness {
  const root = tempFolder("notify-");
  const plan = o.mode === "test" ? testPlan(root) : installedPlan(root);
  fs.mkdirSync(plan.electronFolder, { recursive: true });
  const settingsFile = win.join(plan.electronFolder, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ ...DEFAULT_SETTINGS, ...o.settings }, null, 2));
  const ports = makePorts();
  const shell = new Shell(
    {
      plan,
      command: command({ testData: plan.testFolder, ...o.command }),
      version: "0.8.0",
      programPath: PROGRAM_PATH,
      programFolder: PROGRAM_FOLDER,
      serverScript: `${PROGRAM_FOLDER}\\server.mjs`,
      env: { Path: "C:\\Windows\\system32" },
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
    desktopLog: () => logLines(win.join(plan.electronFolder, "logs", "desktop.log")),
    child: () => ports.launcher.last(),
    stream: () => {
      const s = ports.http.openStreams().at(-1);
      if (!s) throw new Error("no event stream is open");
      return s;
    },
  };
}

/** Started, the server spawned and its start-up work done (the tracker read and the stream open). */
async function run(h: Harness): Promise<Harness> {
  await h.shell.start();
  h.child().spawn();
  await h.ports.clock.advance(0);
  expect(h.ports.http.openStreams()).toHaveLength(1);
  return h;
}

async function running(o: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  return run(harness(o));
}

async function send(h: Harness, event: string, data: unknown): Promise<void> {
  h.stream().chunk(sseEvent(event, data));
  await flush();
}

const page = (port: number, fragment = "") => `http://127.0.0.1:${port}/${fragment === "" ? "" : `#${fragment}`}`;
const settingsOnDisk = (h: Harness): DesktopSettings => JSON.parse(fs.readFileSync(h.settingsFile, "utf8"));

describe("the tracker's legs and hops", () => {
  // @spec DESK-SHELL-NOTE-007, DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-005
  it("brings none for the legs waiting at the run's first subscription, one for a pending leg that comes after", async () => {
    const h = await running({ tracker: { pending: [leg(LEG_A)] } });
    expect(h.ports.notifications.shown).toEqual([]);
    await send(h, "pending", leg(LEG_B));
    expect(h.ports.notifications.shown).toEqual([
      { title: "Leg waiting to be logged", body: PENDING_BODY, target: { kind: "pending", id: LEG_B }, silent: false, closed: false },
    ]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-005
  it("words a pending leg with the sim aircraft alone when it has no livery, and with the reason alone when the sim is unknown", async () => {
    const h = await running();
    await send(h, "pending", leg(LEG_A, { sim: { title: "Fenix A320", livery: "", atc_id: "" }, reason: "Disconnected in flight" }));
    await send(h, "pending", leg(LEG_B, { sim: null, reason: "Restored leg not resumed" }));
    expect(h.ports.notifications.shown.map((n) => n.body)).toEqual(["Fenix A320\nDisconnected in flight", "Restored leg not resumed"]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-007
  it("notifies a pending leg once in the run, whatever repeats it", async () => {
    const h = await running();
    await send(h, "pending", leg(LEG_A));
    await send(h, "pending", leg(LEG_A));
    await send(h, "status", trackerStatus({ pending: [leg(LEG_A)] }));
    expect(h.ports.notifications.titles()).toEqual(["Leg waiting to be logged"]);
  });

  // @spec DESK-SHELL-NOTE-002, DESK-SHELL-NOTE-005
  it("notifies a logged hop with the tracker's message, a click target of that hop", async () => {
    const h = await running();
    await send(h, "hop", hopEvent(12, HOP_MESSAGE));
    expect(h.ports.notifications.shown).toEqual([
      { title: "Hop logged", body: HOP_MESSAGE, target: { kind: "hop", id: 12 }, silent: false, closed: false },
    ]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-002
  it("brings none while the window is the foreground window, the leg still counted as seen", async () => {
    const h = await running();
    h.ports.window.foreground = true;
    await send(h, "pending", leg(LEG_A));
    await send(h, "hop", hopEvent(12, HOP_MESSAGE));
    expect(h.ports.notifications.shown).toEqual([]);

    // Seen: a later subscription that still lists it brings nothing for it.
    h.ports.window.foreground = false;
    h.ports.http.on(h.plan.port, "/api/tracker", trackerAnswer({ pending: [leg(LEG_A)] }));
    h.stream().end();
    await h.ports.clock.advance(2_000);
    expect(h.ports.http.openStreams()).toHaveLength(1);
    expect(h.ports.notifications.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-008, DESK-SHELL-NOTE-007
  it("on a later subscription notifies each listed leg it had not seen, after a stream that ended and after a server restart", async () => {
    const h = await running({ tracker: { pending: [leg(LEG_A)] } });
    // The stream ends; while it was away a leg was kept.
    h.ports.http.on(h.plan.port, "/api/tracker", trackerAnswer({ pending: [leg(LEG_A), leg(LEG_B)] }));
    h.stream().end();
    await h.ports.clock.advance(2_000);
    expect(h.ports.notifications.shown.map((n) => n.target)).toEqual([{ kind: "pending", id: LEG_B }]);

    // A requested restart: a new server, a new subscription, one more leg.
    h.ports.http.on(h.plan.port, "/api/tracker", trackerAnswer({ pending: [leg(LEG_A), leg(LEG_B), leg(LEG_C)] }));
    h.child().exit(12);
    await flush();
    h.child().spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.notifications.shown.map((n) => n.target)).toEqual([
      { kind: "pending", id: LEG_B },
      { kind: "pending", id: LEG_C },
    ]);
  });

  // @spec DESK-SHELL-NOTE-010
  it("closes a leg's notification once the leg leaves the tracker's list, and only that one", async () => {
    const h = await running();
    await send(h, "pending", leg(LEG_A));
    await send(h, "pending", leg(LEG_B));
    await send(h, "status", trackerStatus({ pending: [leg(LEG_B)] }));
    expect(h.ports.notifications.shown.map((n) => [n.target, n.closed])).toEqual([
      [{ kind: "pending", id: LEG_A }, true],
      [{ kind: "pending", id: LEG_B }, false],
    ]);
  });

  // @spec DESK-SHELL-AWAY-004
  it("shows them silent while the sim is in use: this copy's link connected, or MSFS running", async () => {
    const linked = await running({ tracker: { connected: true, sim_name: "MSFS 2024", phase: "ground" } });
    await send(linked, "hop", hopEvent(12, HOP_MESSAGE));
    expect(linked.ports.notifications.shown.map((n) => n.silent)).toEqual([true]);

    const msfs = harness();
    msfs.ports.facts.msfs = true;
    await run(msfs);
    await flush();
    await send(msfs, "pending", leg(LEG_A));
    expect(msfs.ports.notifications.shown.map((n) => n.silent)).toEqual([true]);
  });

  // @spec DESK-SHELL-NOTE-018
  it("brings none for the sim connecting or disconnecting", async () => {
    const h = await running();
    await send(h, "status", trackerStatus({ connected: true, sim_name: "MSFS 2024", phase: "ground" }));
    await send(h, "status", trackerStatus({ connected: false }));
    await send(h, "status", trackerStatus({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } }));
    expect(h.ports.notifications.shown).toEqual([]);
  });
});

describe("a click on a notification", () => {
  // @spec DESK-SHELL-NOTE-012, DESK-SHELL-NOTE-014
  it("on a window showing the page brings it forward and changes only the fragment", async () => {
    const h = await running();
    const loads = [...h.ports.window.loads];
    h.ports.notifications.click({ kind: "hop", id: 12 });
    await flush();
    h.ports.notifications.click({ kind: "pending", id: LEG_A });
    await flush();
    expect(h.ports.window.fragments).toEqual(["hop=12", `pending=${LEG_A}`]);
    expect(h.ports.window.loads).toEqual(loads);
    expect(h.ports.window.openCalls).toBe(3);
    expect(h.ports.window.createdCount).toBe(1);
  });

  // @spec DESK-SHELL-NOTE-012
  it("with the window closed opens it on the hop: its first load is the page with the fragment", async () => {
    const h = await running({ command: { background: true } });
    expect(h.ports.window.openCalls).toBe(0);
    h.ports.notifications.click({ kind: "hop", id: 12 });
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
    expect(h.ports.window.loads).toEqual([page(h.plan.port, "hop=12")]);
  });

  // @spec DESK-SHELL-NOTE-012, DESK-SHELL-WIN-001
  it("on the start screen holds the leg and makes it the fragment of the page's first load", async () => {
    const h = harness();
    await h.shell.start();
    expect(h.ports.window.loads.map((u) => screenOf(u, h.plan.port))).toEqual(["start"]);
    h.ports.notifications.click({ kind: "hop", id: 7 });
    h.ports.notifications.click({ kind: "pending", id: LEG_A });
    await flush();
    expect(h.ports.window.fragments).toEqual([]);
    expect(h.ports.window.loads.map((u) => screenOf(u, h.plan.port))).toEqual(["start"]);
    h.child().spawn();
    await h.ports.clock.advance(0);
    // The latest click wins; the page is loaded once, with it.
    expect(h.ports.window.loads.slice(1)).toEqual([page(h.plan.port, `pending=${LEG_A}`)]);
    expect(h.ports.window.fragments).toEqual([]);
  });

  // @spec DESK-SHELL-CLI-021, DESK-SHELL-NOTE-014, DESK-SHELL-WIN-001
  it("arriving before the shell has started (a start by the click) opens the window at start, on the hop once the start-up work is done", async () => {
    const h = harness({ command: { background: true } });
    h.ports.notifications.click({ kind: "hop", id: 12 });
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    await h.shell.start();
    expect(h.ports.window.createdCount).toBe(1);
    expect(h.ports.window.loads.map((u) => screenOf(u, h.plan.port))).toEqual(["start"]);
    h.child().spawn();
    await h.ports.clock.advance(0);
    expect(h.ports.window.loads.slice(1)).toEqual([page(h.plan.port, "hop=12")]);
  });

  // @spec DESK-SHELL-NOTE-003, DESK-SHELL-TRAY-023, DESK-SHELL-NOTE-019
  it("of a notice with no hop or leg opens the window, or brings it forward, loading nothing more", async () => {
    const h = await running({ command: { background: true } });
    h.ports.notifications.click({ kind: "window" });
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
    expect(h.ports.window.loads).toEqual([page(h.plan.port)]);
    h.ports.notifications.click({ kind: "window" });
    await flush();
    expect(h.ports.window.openCalls).toBe(2);
    expect(h.ports.window.loads).toEqual([page(h.plan.port)]);
    expect(h.ports.window.fragments).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-004
  it("of the gave-up notice opens the window on the failure screen", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.child().spawn();
    h.child().exit(11);
    await flush();
    h.ports.notifications.click({ kind: "failure" });
    await flush();
    expect(h.ports.window.createdCount).toBe(1);
    expect(h.ports.window.loads.map((u) => screenOf(u, h.plan.port))).toEqual(["failure"]);
  });

  // @spec DESK-SHELL-CLI-022, DESK-SHELL-QUIT-006
  it("while quitting is taken as a start with no switch handed over, its hop left out", async () => {
    const h = await running({ command: { background: true } });
    const quit = h.shell.menuChosen("quit");
    await flush();
    expect(h.shell.quitting()).toBe("quit");
    h.ports.notifications.click({ kind: "hop", id: 12 });
    await flush();
    expect(h.ports.window.openCalls).toBe(0);
    expect(h.ports.window.fragments).toEqual([]);
    h.child().exit(0);
    await flush();
    await quit;
    // Quit keeps it to its last look and starts the app again with no switch.
    expect(h.ports.exits).toEqual([{ code: 0, relaunch: [] }]);
  });
});

describe("the shell's own notices", () => {
  // @spec DESK-SHELL-NOTE-004, DESK-SHELL-NOTE-005
  it("shows the gave-up notice at once with the reason, a click target of the failure screen", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.child().spawn();
    h.child().exit(11);
    await flush();
    const tooltip = h.ports.tray.last()?.tooltip ?? "";
    expect(tooltip).toMatch(/^MSFS Career Map — Not tracking: /);
    const reason = tooltip.replace("MSFS Career Map — Not tracking: ", "");
    expect(h.ports.notifications.shown).toEqual([
      { title: "MSFS Career Map stopped tracking", body: `${reason}\n${TRY_AGAIN}`, target: { kind: "failure" }, silent: false, closed: false },
    ]);
  });

  // @spec DESK-SHELL-NOTE-004
  it("shows the gave-up notice once for each giving up, again after Try again gives up anew", async () => {
    const h = harness({ command: { background: true } });
    await h.shell.start();
    h.child().spawn();
    h.child().exit(11);
    await flush();
    await h.ports.clock.advance(60_000);
    expect(h.ports.notifications.titles()).toEqual(["MSFS Career Map stopped tracking"]);
    await h.shell.menuChosen("try-again");
    h.child().spawn();
    h.child().exit(11);
    await flush();
    expect(h.ports.notifications.titles()).toEqual(["MSFS Career Map stopped tracking", "MSFS Career Map stopped tracking"]);
  });

  /** Two daily backups failed in a row, the second over a day ago, so the third is asked for at once. */
  const TWO_FAILED: Partial<DesktopSettings> = {
    lastDailyBackup: null,
    dailyBackupFailures: { count: 2, lastAttempt: "2026-10-24T11:00:00.000Z", short: "the disk is full", notified: false },
  };

  async function thirdFailure(h: Harness): Promise<void> {
    const request = h.child().posted.find((m) => (m as { type?: unknown }).type === "backup") as { id: string } | undefined;
    expect(request).toBeDefined();
    h.child().message({ type: "backup-failed", id: request!.id, short: "the disk is full", reason: "could not write the backup: the disk is full" });
    await flush();
  }

  // @spec DESK-SHELL-NOTE-019, DESK-SHELL-NOTE-005
  it("shows the backups notice at the third daily backup failed in a row, naming the backups folder and the short reason, once", async () => {
    const h = harness({ settings: TWO_FAILED });
    const documents = tempFolder("documents-");
    h.ports.folders.documentsPath = documents;
    await run(h);
    expect(h.ports.notifications.shown).toEqual([]);
    await thirdFailure(h);
    const folder = win.join(documents, "MSFS Career Map", "Backups");
    expect(h.ports.notifications.shown).toEqual([
      {
        title: "Backups are failing",
        body: `MSFS Career Map could not back up the logbook to ${folder}: the disk is full.`,
        target: { kind: "window" },
        silent: false,
        closed: false,
      },
    ]);
    expect(settingsOnDisk(h).dailyBackupFailures).toMatchObject({ count: 3, notified: true });
    // Nothing more for the same run of failures.
    await h.ports.clock.advance(3_600_000);
    expect(h.ports.notifications.titles()).toEqual(["Backups are failing"]);
  });

  // @spec DESK-SHELL-NOTE-019, DESK-SHELL-AWAY-001
  it("holds the backups notice while MSFS runs and shows it once the sim is out of use", async () => {
    const h = harness({ settings: TWO_FAILED });
    h.ports.folders.documentsPath = tempFolder("documents-");
    h.ports.facts.msfs = true;
    await run(h);
    await flush();
    await thirdFailure(h);
    expect(h.ports.notifications.shown).toEqual([]);
    expect(settingsOnDisk(h).dailyBackupFailures.notified).toBe(false);
    h.ports.facts.msfs = false;
    await h.ports.clock.advance(10_000);
    expect(h.ports.notifications.shown.map((n) => [n.title, n.silent])).toEqual([["Backups are failing", false]]);
    expect(settingsOnDisk(h).dailyBackupFailures.notified).toBe(true);
  });

  // @spec DESK-SHELL-TRAY-023
  it("shows the one-time notice at the pilot's first close of the window, records it, and never again", async () => {
    const h = await running();
    h.ports.window.close();
    h.shell.windowClosed(PLACE);
    await flush();
    expect(h.ports.notifications.shown).toEqual([
      { title: "Still tracking in the tray", body: TRAY_NOTICE_BODY, target: { kind: "window" }, silent: false, closed: false },
    ]);
    expect(settingsOnDisk(h).trayNoticeShown).toBe(true);
    h.shell.trayClicked();
    h.ports.window.close();
    h.shell.windowClosed(PLACE);
    await flush();
    expect(h.ports.notifications.titles()).toEqual(["Still tracking in the tray"]);
  });

  // @spec DESK-SHELL-TRAY-023
  it("shows no one-time notice when it has shown before, while given up, or for a close while quitting, recording nothing", async () => {
    const shown = await running({ settings: { trayNoticeShown: true } });
    shown.ports.window.close();
    shown.shell.windowClosed(PLACE);
    await flush();
    expect(shown.ports.notifications.shown).toEqual([]);

    const gaveUp = harness();
    await gaveUp.shell.start();
    gaveUp.child().spawn();
    gaveUp.child().exit(11);
    await flush();
    gaveUp.ports.window.close();
    gaveUp.shell.windowClosed(PLACE);
    await flush();
    expect(gaveUp.ports.notifications.titles()).toEqual(["MSFS Career Map stopped tracking"]);
    expect(settingsOnDisk(gaveUp).trayNoticeShown).toBe(false);

    const quitting = await running();
    const quit = quitting.shell.menuChosen("quit");
    await flush();
    quitting.ports.window.close();
    quitting.shell.windowClosed(PLACE);
    await flush();
    expect(quitting.ports.notifications.shown).toEqual([]);
    expect(settingsOnDisk(quitting).trayNoticeShown).toBe(false);
    quitting.child().exit(0);
    await flush();
    await quit;
  });
});

describe("registrations and test mode", () => {
  // @spec DESK-SHELL-NOTE-013, DESK-SHELL-NOTE-015
  it("registers the AppUserModelID and the CLSID at an installed copy's start, before the server starts", async () => {
    const h = harness();
    let atServerStart = -1;
    const start = h.ports.launcher.start.bind(h.ports.launcher);
    h.ports.launcher.start = (o) => {
      atServerStart = h.ports.registrations.registered;
      return start(o);
    };
    await h.shell.start();
    expect(h.ports.registrations.registered).toBe(1);
    expect(atServerStart).toBe(1);
    expect(h.ports.registrations.removed).toBe(0);
  });

  // @spec DESK-SHELL-NOTE-013
  it("writes what registering could not do to desktop.log", async () => {
    const h = harness();
    h.ports.registrations.problems = ["the Start-menu shortcut could not be updated: access denied"];
    await run(h);
    expect(h.desktopLog()).toContain("[notifications] the Start-menu shortcut could not be updated: access denied");
  });

  // @spec DESK-SHELL-NOTE-016
  it("registers nothing in test mode", async () => {
    const h = await running({ mode: "test" });
    expect(h.ports.registrations.registered).toBe(0);
    expect(h.ports.registrations.removed).toBe(0);
  });

  // @spec DESK-SHELL-NOTE-006, DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-002, DESK-SHELL-TRAY-023
  it("in test mode writes each notification to desktop.log instead of showing it", async () => {
    const h = await running({ mode: "test" });
    await send(h, "pending", leg(LEG_A));
    await send(h, "hop", hopEvent(12, HOP_MESSAGE));
    h.ports.window.close();
    h.shell.windowClosed(PLACE);
    await flush();
    expect(h.ports.notifications.shown).toEqual([]);
    const lines = h.desktopLog().filter((l) => l.startsWith("[notification] "));
    expect(lines).toEqual([
      "[notification] Leg waiting to be logged: Cessna 172 Skyhawk G1000 · Asobo Blue · No aircraft in the fleet matches this sim aircraft",
      `[notification] Hop logged: ${HOP_MESSAGE}`,
      `[notification] Still tracking in the tray: ${TRAY_NOTICE_BODY}`,
    ]);
    expect(settingsOnDisk(h).trayNoticeShown).toBe(true);
  });

  // @spec DESK-SHELL-NOTE-006, DESK-SHELL-NOTE-004
  it("in test mode writes the gave-up notice to desktop.log", async () => {
    const h = harness({ mode: "test", command: { background: true } });
    await h.shell.start();
    h.child().spawn();
    h.child().exit(11);
    await flush();
    expect(h.ports.notifications.shown).toEqual([]);
    const reason = (h.ports.tray.last()?.tooltip ?? "").replace("MSFS Career Map — Not tracking: ", "");
    expect(h.desktopLog()).toContain(`[notification] MSFS Career Map stopped tracking: ${reason} · ${TRY_AGAIN}`);
  });
});
