/**
 * The tray's model (src/desktop/tray-model.ts; m2 contract §14): the status line, first of the
 * shell's own states and then the last tracker status received (DESK-SHELL-TRAY-002..010); the
 * waiting-legs line (TRAY-011); the tooltip, cut to the 127 characters Windows keeps (TRAY-012);
 * the icon's dot (TRAY-013); and the menu in order with each item shown only when it applies
 * (TRAY-015 less the update items, TRAY-016's "Version X", TRAY-018..020, TRAY-026), the two start-list
 * items as checkboxes in their place or left out (m4 contract §6; DESK-START-MSFS-013, DESK-START-TEST-001).
 */
import { describe, expect, it } from "vitest";
import {
  statusLine,
  trayDot,
  trayMenu,
  trayModel,
  waitingLine,
  type TrayInput,
  type TrayMenuItem,
} from "../../../src/desktop/tray-model.ts";
import type { ServerState } from "../../../src/desktop/supervisor.ts";
import type { TrayTracker } from "../../../src/desktop/tracker-feed.ts";

/** A running server, no tracker status yet, nothing failing, version 0.8.0, no backups folder, no start-list items (test mode). */
function input(o: Partial<TrayInput> = {}): TrayInput {
  return {
    quitting: false,
    server: { kind: "running" },
    tracker: null,
    backupsFailing: null,
    version: "0.8.0",
    backupsFolderExists: false,
    startLists: null,
    update: null,
    ...o,
  };
}

/** An idle, unconnected tracker status with `o` over it. */
function tracker(o: Partial<TrayTracker> = {}): TrayTracker {
  return {
    connected: false,
    sim_name: null,
    link_holder: null,
    phase: "idle",
    leg: null,
    pending: [],
    casual: null,
    ...o,
  };
}

const AIRBORNE = tracker({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } });
const EVERYTHING = tracker({
  connected: true,
  sim_name: "MSFS 2024",
  link_holder: { text: "Another MSFS Career Map holds the sim link" },
  phase: "airborne",
  leg: { origin: "KBOS" },
  pending: [{ id: "p1" }],
  casual: { since: "2026-10-25T11:00:00.000Z" },
});

const LEFTOVER_REASON =
  "An earlier MSFS Career Map server is still running: quit MSFS Career Map, end any MSFS Career Map still listed in Task Manager, and start it again";

describe("the tray's status line", () => {
  // @spec DESK-SHELL-TRAY-002, DESK-SHELL-TRAY-003
  it("reads Quitting… while quitting, over every other state", () => {
    const states: ServerState[] = [
      { kind: "not-started" },
      { kind: "starting", step: "upgrading" },
      { kind: "running" },
      { kind: "restarting" },
      { kind: "given-up", reason: "Port 3380 is in use by another program" },
      { kind: "stopped" },
    ];
    for (const server of states) {
      expect(statusLine(input({ quitting: true, server, tracker: EVERYTHING }))).toBe("Quitting…");
    }
  });

  // @spec DESK-SHELL-TRAY-002, DESK-SHELL-TRAY-004
  it("reads Starting… while the server is not started, starting or restarting, whatever the tracker says", () => {
    for (const server of [
      { kind: "not-started" },
      { kind: "starting", step: null },
      { kind: "restarting" },
    ] satisfies ServerState[]) {
      expect(statusLine(input({ server, tracker: EVERYTHING }))).toBe("Starting…");
    }
  });

  // @spec DESK-SHELL-TRAY-004
  it("names the start-up step a ready server reports", () => {
    const steps = [
      ["opening", "Starting… (opening the logbook)"],
      ["backing-up", "Starting… (backing up the logbook)"],
      ["upgrading", "Starting… (upgrading the logbook)"],
      ["bringing-in", "Starting… (bringing in the logbook)"],
    ] as const;
    for (const [step, line] of steps) {
      expect(statusLine(input({ server: { kind: "starting", step }, tracker: AIRBORNE }))).toBe(line);
    }
  });

  // @spec DESK-SHELL-TRAY-005
  it("reads Not tracking: <reason> while given up, over the tracker's last status", () => {
    expect(
      statusLine(input({ server: { kind: "given-up", reason: "The server did not start within 60 s" }, tracker: EVERYTHING })),
    ).toBe("Not tracking: The server did not start within 60 s");
  });

  // @spec DESK-SHELL-TRAY-006
  it("reads the link holder's own words over a leg, casual mode and a connection", () => {
    expect(statusLine(input({ tracker: EVERYTHING }))).toBe("Another MSFS Career Map holds the sim link");
  });

  // @spec DESK-SHELL-TRAY-007
  it("reads the phase and the leg's origin while airborne or landed, the word alone without an origin", () => {
    const casualConnected = { connected: true, sim_name: "MSFS 2024", casual: {}, pending: [{ id: "p1" }] };
    expect(statusLine(input({ tracker: tracker({ ...casualConnected, phase: "airborne", leg: { origin: "KBOS" } }) }))).toBe(
      "Airborne from KBOS",
    );
    expect(statusLine(input({ tracker: tracker({ ...casualConnected, phase: "landed", leg: { origin: "KPVD" } }) }))).toBe(
      "Landed from KPVD",
    );
    expect(statusLine(input({ tracker: tracker({ phase: "airborne", leg: { origin: null } }) }))).toBe("Airborne");
    expect(statusLine(input({ tracker: tracker({ phase: "landed", leg: null }) }))).toBe("Landed");
  });

  // @spec DESK-SHELL-TRAY-008
  it("reads Casual mode: nothing is logged over a connection", () => {
    expect(statusLine(input({ tracker: tracker({ connected: true, sim_name: "MSFS 2024", phase: "ground", casual: {} }) }))).toBe(
      "Casual mode: nothing is logged",
    );
  });

  // @spec DESK-SHELL-TRAY-009
  it("reads Connected to <the sim's name>, or to the sim when it has no name", () => {
    expect(statusLine(input({ tracker: tracker({ connected: true, sim_name: "MSFS 2024", phase: "ground" }) }))).toBe(
      "Connected to MSFS 2024",
    );
    expect(statusLine(input({ tracker: tracker({ connected: true, sim_name: null }) }))).toBe("Connected to the sim");
  });

  // @spec DESK-SHELL-TRAY-010, DESK-SHELL-TRAY-002
  it("reads Sim not running otherwise: no tracker status yet, or an idle unconnected one with legs waiting", () => {
    expect(statusLine(input())).toBe("Sim not running");
    expect(statusLine(input({ tracker: tracker() }))).toBe("Sim not running");
    expect(statusLine(input({ tracker: tracker({ pending: [{ id: "p1" }, { id: "p2" }] }) }))).toBe("Sim not running");
  });
});

describe("the waiting-legs line", () => {
  // @spec DESK-SHELL-TRAY-011
  it("is absent with none waiting, then counts one leg or several", () => {
    expect(waitingLine(0)).toBeNull();
    expect(waitingLine(1)).toBe("1 leg waiting to be logged");
    expect(waitingLine(2)).toBe("2 legs waiting to be logged");
    expect(waitingLine(12)).toBe("12 legs waiting to be logged");
  });
});

describe("the tooltip", () => {
  // @spec DESK-SHELL-TRAY-012
  it("reads MSFS Career Map — and the status line", () => {
    expect(trayModel(input()).tooltip).toBe("MSFS Career Map — Sim not running");
    expect(trayModel(input({ tracker: AIRBORNE })).tooltip).toBe("MSFS Career Map — Airborne from KBOS");
    expect(trayModel(input({ quitting: true })).tooltip).toBe("MSFS Career Map — Quitting…");
  });

  // @spec DESK-SHELL-TRAY-012
  it("keeps a tooltip of exactly 127 characters whole and cuts a longer one to 126 and …, the menu's status line whole", () => {
    const prefix = "MSFS Career Map — Not tracking: ";
    const fits = "r".repeat(127 - prefix.length);
    expect(trayModel(input({ server: { kind: "given-up", reason: fits } })).tooltip).toBe(prefix + fits);

    const i = input({ server: { kind: "given-up", reason: LEFTOVER_REASON } });
    const full = `MSFS Career Map — Not tracking: ${LEFTOVER_REASON}`;
    expect(full.length).toBeGreaterThan(127);
    const model = trayModel(i);
    expect(model.tooltip).toBe(`${full.slice(0, 126)}…`);
    expect(model.tooltip).toHaveLength(127);
    expect(model.menu).toContainEqual({ id: "status", label: `Not tracking: ${LEFTOVER_REASON}`, enabled: false });
  });
});

describe("the icon's dot", () => {
  // @spec DESK-SHELL-TRAY-013
  it("is red while given up, quitting or not", () => {
    const server: ServerState = { kind: "given-up", reason: "Port 3380 is in use by another program" };
    expect(trayDot(input({ server, tracker: AIRBORNE }))).toBe("red");
    const quitting = input({ quitting: true, server, tracker: AIRBORNE });
    expect(trayDot(quitting)).toBe("red");
    expect(statusLine(quitting)).toBe("Quitting…");
    expect(trayModel(quitting)).toMatchObject({ dot: "red", tooltip: "MSFS Career Map — Quitting…" });
  });

  // @spec DESK-SHELL-TRAY-013
  it("is none while quitting, stopped, not started, starting or restarting, whatever the tracker says", () => {
    expect(trayDot(input({ quitting: true, tracker: AIRBORNE }))).toBe("none");
    expect(trayDot(input({ quitting: true, server: { kind: "stopped" }, tracker: AIRBORNE }))).toBe("none");
    for (const server of [
      { kind: "not-started" },
      { kind: "starting", step: null },
      { kind: "starting", step: "opening" },
      { kind: "restarting" },
    ] satisfies ServerState[]) {
      expect(trayDot(input({ server, tracker: AIRBORNE }))).toBe("none");
    }
  });

  // @spec DESK-SHELL-TRAY-013, DESK-SHELL-TRAY-002
  it("follows the tracker by precedence: blue, violet, amber, green, else none", () => {
    const connected = { connected: true, sim_name: "MSFS 2024" };
    const waiting = { pending: [{ id: "p1" }] };
    expect(trayDot(input({ tracker: tracker({ ...connected, ...waiting, casual: {}, phase: "airborne", leg: { origin: "KBOS" } }) }))).toBe("blue");
    expect(trayDot(input({ tracker: tracker({ phase: "landed", leg: { origin: null } }) }))).toBe("blue");
    expect(trayDot(input({ tracker: tracker({ ...connected, ...waiting, casual: {}, phase: "ground" }) }))).toBe("violet");
    expect(trayDot(input({ tracker: tracker({ ...connected, ...waiting, phase: "ground" }) }))).toBe("amber");
    expect(trayDot(input({ tracker: tracker({ ...waiting }) }))).toBe("amber");
    expect(trayDot(input({ tracker: tracker({ ...connected, phase: "ground" }) }))).toBe("green");
    expect(trayDot(input({ tracker: tracker() }))).toBe("none");
    expect(trayDot(input())).toBe("none");
  });

  // @spec DESK-SHELL-TRAY-013
  it("shows no dot for another copy holding the sim link alone", () => {
    const i = input({ tracker: tracker({ link_holder: { text: "Another MSFS Career Map holds the sim link" } }) });
    expect(trayDot(i)).toBe("none");
    expect(statusLine(i)).toBe("Another MSFS Career Map holds the sim link");
  });
});

const OPEN: TrayMenuItem = { id: "open", label: "Open MSFS Career Map", enabled: true, isDefault: true };
const SEP: TrayMenuItem = { separator: true };
const VERSION: TrayMenuItem = { id: "version", label: "Version 0.8.0", enabled: false };
const OPEN_DATA: TrayMenuItem = { id: "open-data", label: "Open data folder", enabled: true };
const OPEN_BACKUPS: TrayMenuItem = { id: "open-backups", label: "Open backups folder", enabled: true };
const SHOW_LOG: TrayMenuItem = { id: "show-log", label: "Show log", enabled: true };
const TRY_AGAIN: TrayMenuItem = { id: "try-again", label: "Try again", enabled: true };
const QUIT: TrayMenuItem = { id: "quit", label: "Quit", enabled: true };

describe("the tray menu", () => {
  // @spec DESK-SHELL-TRAY-015, DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-018, DESK-SHELL-TRAY-020
  it("holds, in order, Open (the default), the status line, the version, the folders and the log, and Quit", () => {
    expect(trayMenu(input())).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Sim not running", enabled: false },
      SEP,
      VERSION,
      SEP,
      OPEN_DATA,
      SHOW_LOG,
      SEP,
      QUIT,
    ]);
  });

  // @spec DESK-SHELL-TRAY-011, DESK-SHELL-TRAY-015, DESK-SHELL-TRAY-018, DESK-SHELL-TRAY-026
  it("adds the waiting-legs line, the backups-failing line and Open backups folder when they apply", () => {
    const i = input({
      tracker: tracker({ connected: true, sim_name: "MSFS 2024", phase: "ground", pending: [{ id: "p1" }, { id: "p2" }] }),
      backupsFailing: "disk full",
      backupsFolderExists: true,
    });
    expect(trayMenu(i)).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Connected to MSFS 2024", enabled: false },
      { id: "waiting", label: "2 legs waiting to be logged", enabled: false },
      { id: "backups-failing", label: "Backups failing: disk full", enabled: false },
      SEP,
      VERSION,
      SEP,
      OPEN_DATA,
      OPEN_BACKUPS,
      SHOW_LOG,
      SEP,
      QUIT,
    ]);
    expect(trayMenu(input({ tracker: tracker({ pending: [{ id: "p1" }] }) }))).toContainEqual({
      id: "waiting",
      label: "1 leg waiting to be logged",
      enabled: false,
    });
  });

  // @spec DESK-SHELL-TRAY-019
  it("offers Try again only while given up, just before Quit", () => {
    const given = trayMenu(input({ server: { kind: "given-up", reason: "Port 3380 is in use by another program" } }));
    expect(given).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Not tracking: Port 3380 is in use by another program", enabled: false },
      SEP,
      VERSION,
      SEP,
      OPEN_DATA,
      SHOW_LOG,
      SEP,
      TRY_AGAIN,
      QUIT,
    ]);
    for (const server of [
      { kind: "not-started" },
      { kind: "starting", step: null },
      { kind: "running" },
      { kind: "restarting" },
    ] satisfies ServerState[]) {
      expect(trayMenu(input({ server })).some((item: TrayMenuItem) => "id" in item && item.id === "try-again")).toBe(false);
    }
  });

  // @spec DESK-SHELL-TRAY-015, DESK-SHELL-QUIT-003
  it("keeps every item enabled while quitting (the shell ignores them), the status line reading Quitting…", () => {
    const menu = trayMenu(input({ quitting: true, backupsFolderExists: true }));
    expect(menu).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Quitting…", enabled: false },
      SEP,
      VERSION,
      SEP,
      OPEN_DATA,
      OPEN_BACKUPS,
      SHOW_LOG,
      SEP,
      QUIT,
    ]);
  });

  // @spec DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-020
  it("shows the running version alone and no update or start-list item", () => {
    const ids = trayMenu(
      input({
        version: "1.2.3",
        server: { kind: "given-up", reason: "x" },
        tracker: tracker({ pending: [{ id: "p" }] }),
        backupsFailing: "disk full",
        backupsFolderExists: true,
      }),
    ).flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    expect(ids).toEqual(["open", "status", "waiting", "backups-failing", "version", "open-data", "open-backups", "show-log", "try-again", "quit"]);
    expect(trayMenu(input({ version: "1.2.3" }))).toContainEqual({ id: "version", label: "Version 1.2.3", enabled: false });
  });

  // @spec DESK-SHELL-TRAY-015, DESK-START-MSFS-013, DESK-START-WINDOWS-007
  it("puts Start with MSFS 2024 and Start with Windows, as checkboxes, between the status lines and the version line", () => {
    const i = input({
      tracker: tracker({ pending: [{ id: "p1" }] }),
      backupsFailing: "disk full",
      startLists: {
        msfs: { label: "Start with MSFS 2024 (close MSFS to change)", enabled: false, checked: true },
        windows: { label: "Start with Windows", enabled: true, checked: false },
      },
    });
    expect(trayMenu(i)).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Sim not running", enabled: false },
      { id: "waiting", label: "1 leg waiting to be logged", enabled: false },
      { id: "backups-failing", label: "Backups failing: disk full", enabled: false },
      SEP,
      { id: "start-msfs", label: "Start with MSFS 2024 (close MSFS to change)", enabled: false, checked: true },
      { id: "start-windows", label: "Start with Windows", enabled: true, checked: false },
      SEP,
      VERSION,
      SEP,
      OPEN_DATA,
      SHOW_LOG,
      SEP,
      QUIT,
    ]);
  });

  // @spec DESK-START-TEST-001, DESK-SHELL-TRAY-020
  it("leaves both start-list items out while there are none to show (test mode, or before the first read)", () => {
    const ids = trayMenu(input({ startLists: null })).flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    expect(ids).not.toContain("start-msfs");
    expect(ids).not.toContain("start-windows");
    expect(trayMenu(input()).filter((item: TrayMenuItem) => "checked" in item)).toEqual([]);
  });

  // @spec DESK-SHELL-QUIT-003
  it("keeps the start-list items as read while quitting (the shell ignores their clicks)", () => {
    const startLists = {
      msfs: { label: "Start with MSFS 2024", enabled: true, checked: false },
      windows: { label: "Start with Windows" as const, enabled: true as const, checked: true },
    };
    const menu = trayMenu(input({ quitting: true, startLists }));
    expect(menu).toContainEqual({ id: "start-msfs", label: "Start with MSFS 2024", enabled: true, checked: false });
    expect(menu).toContainEqual({ id: "start-windows", label: "Start with Windows", enabled: true, checked: true });
  });
});

describe("the tray menu's update items", () => {
  const CHECK: TrayMenuItem = { id: "check-updates", label: "Check for updates", enabled: true };

  // @spec DESK-SHELL-TRAY-015, DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-017, DESK-SHELL-TRAY-027
  it("puts the version line, Restart to update, Restart to update without a backup and Check for updates, in that order, before the folders", () => {
    const i = input({
      update: {
        line: "Version 0.8.0 — 0.9.0 waiting: backup failed (disk full)",
        restart: { label: "Restart to update", enabled: true },
        restartNoBackup: { enabled: true },
      },
    });
    expect(trayMenu(i)).toEqual([
      OPEN,
      SEP,
      { id: "status", label: "Sim not running", enabled: false },
      SEP,
      { id: "version", label: "Version 0.8.0 — 0.9.0 waiting: backup failed (disk full)", enabled: false },
      { id: "restart-update", label: "Restart to update", enabled: true },
      { id: "restart-update-no-backup", label: "Restart to update without a backup", enabled: true },
      CHECK,
      SEP,
      OPEN_DATA,
      SHOW_LOG,
      SEP,
      QUIT,
    ]);
  });

  // @spec DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-017
  it("shows the update state on the version line and only Check for updates while no update is ready", () => {
    const menu = trayMenu(input({ update: { line: "Version 0.8.0 — downloading 0.9.0", restart: null, restartNoBackup: null } }));
    const ids = menu.flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    expect(ids).toEqual(["open", "status", "version", "check-updates", "open-data", "show-log", "quit"]);
    expect(menu).toContainEqual({ id: "version", label: "Version 0.8.0 — downloading 0.9.0", enabled: false });
    expect(menu).toContainEqual(CHECK);
  });

  // @spec DESK-SHELL-TRAY-017
  it("shows Restart to update as it is given: unclickable, reading (after the sim closes), while the sim is in use", () => {
    const menu = trayMenu(
      input({
        update: {
          line: "Version 0.8.0 — 0.9.0 ready",
          restart: { label: "Restart to update (after the sim closes)", enabled: false },
          restartNoBackup: null,
        },
      }),
    );
    expect(menu).toContainEqual({ id: "restart-update", label: "Restart to update (after the sim closes)", enabled: false });
    expect(menu.flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []))).not.toContain("restart-update-no-backup");
  });

  // @spec DESK-SHELL-TRAY-027
  it("shows Restart to update without a backup only under Restart to update, clickable as it is given", () => {
    const menu = trayMenu(
      input({
        update: {
          line: "Version 0.8.0 — 0.9.0 waiting: backup failed (disk full)",
          restart: { label: "Restart to update", enabled: false },
          restartNoBackup: { enabled: false },
        },
      }),
    );
    const ids = menu.flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    expect(ids.indexOf("restart-update-no-backup")).toBe(ids.indexOf("restart-update") + 1);
    expect(menu).toContainEqual({ id: "restart-update-no-backup", label: "Restart to update without a backup", enabled: false });
  });

  // @spec DESK-SHELL-TRAY-020, DESK-SHELL-UPD-005
  it("leaves every update item out in test mode, the version line reading Version X alone", () => {
    const menu = trayMenu(input({ update: null }));
    const ids = menu.flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    for (const id of ["restart-update", "restart-update-no-backup", "check-updates"]) expect(ids).not.toContain(id);
    expect(menu).toContainEqual(VERSION);
  });

  // @spec DESK-SHELL-TRAY-015, DESK-START-MSFS-013
  it("keeps the start-list items before the version line and the update items after it", () => {
    const menu = trayMenu(
      input({
        startLists: {
          msfs: { label: "Start with MSFS 2024", enabled: true, checked: false },
          windows: { label: "Start with Windows", enabled: true, checked: true },
        },
        update: { line: "Version 0.8.0 — 0.9.0 ready", restart: { label: "Restart to update", enabled: true }, restartNoBackup: null },
      }),
    );
    const ids = menu.flatMap((item: TrayMenuItem) => ("id" in item ? [item.id] : []));
    expect(ids).toEqual(["open", "status", "start-msfs", "start-windows", "version", "restart-update", "check-updates", "open-data", "show-log", "quit"]);
  });

  // @spec DESK-SHELL-QUIT-003
  it("keeps the update items as given while quitting (the shell ignores their clicks)", () => {
    const menu = trayMenu(
      input({
        quitting: true,
        update: { line: "Version 0.8.0 — 0.9.0 ready", restart: { label: "Restart to update", enabled: true }, restartNoBackup: null },
      }),
    );
    expect(menu).toContainEqual({ id: "restart-update", label: "Restart to update", enabled: true });
    expect(menu).toContainEqual(CHECK);
  });
});

describe("the tray model", () => {
  // @spec DESK-SHELL-TRAY-012, DESK-SHELL-TRAY-013, DESK-SHELL-TRAY-015
  it("gathers the tooltip, the dot and the menu", () => {
    const cases = [
      input(),
      input({ tracker: AIRBORNE, backupsFolderExists: true }),
      input({ server: { kind: "given-up", reason: LEFTOVER_REASON } }),
      input({ quitting: true, tracker: EVERYTHING }),
    ];
    for (const i of cases) {
      const line = statusLine(i);
      const tooltip = `MSFS Career Map — ${line}`;
      expect(trayModel(i)).toEqual({
        tooltip: tooltip.length > 127 ? `${tooltip.slice(0, 126)}…` : tooltip,
        dot: trayDot(i),
        menu: trayMenu(i),
      });
    }
  });
});
