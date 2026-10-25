/**
 * The desktop shell's notifications (src/desktop/notifications.ts; m5a contract §3): what is notified and
 * when — a pending leg not yet seen in the run and a logged hop, both only while the window is not in front
 * (DESK-SHELL-NOTE-001, NOTE-002), the server given up on at once (NOTE-004), backups failing and an update
 * ready once the sim is not in use and once each (NOTE-019, NOTE-003), the pilot's first close of the window
 * (TRAY-023) — in the shell's fixed words around the tracker's and server's own (NOTE-005); the pending legs
 * seen across subscriptions (NOTE-007, NOTE-008) and a leg's notification closed once it leaves the list
 * (NOTE-010); every notice silent while the sim is in use and none urgent (AWAY-004, NOTE-011); and in test
 * mode each written to desktop.log instead (NOTE-006).
 */
import { describe, expect, it } from "vitest";
import { Notifier, type PendingNotice } from "../../../src/desktop/notifications.ts";
import { SettingsStore } from "../../../src/desktop/settings.ts";
import { FakeNotifications, tempFolder } from "../support/fakes.ts";

const GAVE_UP_TAIL = "Choose Try again or Show log in the tray icon's menu.";
const FIRST_CLOSE =
  "MSFS Career Map keeps running and logs your flights. Quit it from the tray icon's menu, under ^ on the taskbar (Settings > Personalization > Taskbar > Other system tray icons keeps it in view).";
const updateBody = (v: string) =>
  `Version ${v} installs when you quit MSFS Career Map or choose Restart to update in the tray, or by itself once MSFS and the MSFS Career Map window are closed.`;

const LEG_A: PendingNotice = { id: "6f1c2a7e-9d4b-4e21-8c3a-1b2d3e4f5a6b", sim: { title: "Cessna 172 Skyhawk G1000", livery: "Asobo White" }, reason: "No aircraft in the fleet matches this sim aircraft" };
const LEG_B: PendingNotice = { id: "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b", sim: { title: "Beechcraft King Air 350i", livery: "" }, reason: "The sim disconnected in flight" };
const LEG_C: PendingNotice = { id: "11111111-2222-4333-8444-555555555555", sim: null, reason: "Restored from the checkpoint, not resumed" };

interface Harness {
  n: Notifier;
  port: FakeNotifications;
  settings: SettingsStore;
  lines: string[];
  state: { inUse: boolean; foreground: boolean };
}

function harness(o: { mode?: "installed" | "test" } = {}): Harness {
  const folder = tempFolder("notify-");
  const lines: string[] = [];
  const settings = new SettingsStore(folder, (l) => lines.push(l));
  settings.load();
  const port = new FakeNotifications();
  const state = { inUse: false, foreground: false };
  const n = new Notifier({
    mode: o.mode ?? "installed",
    port,
    settings,
    simInUse: () => state.inUse,
    windowForeground: () => state.foreground,
    log: (l) => lines.push(l),
  });
  return { n, port, settings, lines, state };
}

describe("a pending leg", () => {
  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-005
  it("notifies a leg not seen in the run with the sim aircraft and the tracker's reason, a click opening it", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_A);
    expect(h.port.shown).toEqual([
      {
        title: "Leg waiting to be logged",
        body: "Cessna 172 Skyhawk G1000 · Asobo White\nNo aircraft in the fleet matches this sim aircraft",
        target: { kind: "pending", id: LEG_A.id },
        silent: false,
        closed: false,
      },
    ]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-005
  it("leaves out an empty livery, and the aircraft line when the sim aircraft is unknown", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_B);
    h.n.pendingEvent(LEG_C);
    expect(h.port.shown.map((s) => s.body)).toEqual([
      "Beechcraft King Air 350i\nThe sim disconnected in flight",
      "Restored from the checkpoint, not resumed",
    ]);
  });

  // @spec DESK-SHELL-NOTE-001
  it("brings nothing while the window is in front, and the leg counts as seen", () => {
    const h = harness();
    h.n.subscribed([]);
    h.state.foreground = true;
    h.n.pendingEvent(LEG_A);
    h.state.foreground = false;
    h.n.pendingEvent(LEG_A);
    h.n.subscribed([LEG_A]);
    expect(h.port.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-007
  it("notifies one pending leg at most once in the run, however often it is announced", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_A);
    h.n.pendingEvent(LEG_A);
    h.n.subscribed([LEG_A]);
    expect(h.port.titles()).toEqual(["Leg waiting to be logged"]);
  });
});

describe("pending legs across subscriptions", () => {
  // @spec DESK-SHELL-NOTE-007
  it("brings nothing for the legs already waiting at the run's first subscription", () => {
    const h = harness();
    h.n.subscribed([LEG_A, LEG_B]);
    h.n.pendingEvent(LEG_A);
    expect(h.port.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-008
  it("notifies, at a later subscription, each listed leg it had not seen, and none it had", () => {
    const h = harness();
    h.n.subscribed([LEG_A]);
    h.n.subscribed([LEG_A, LEG_B, LEG_C]);
    expect(h.port.shown.map((s) => s.target)).toEqual([
      { kind: "pending", id: LEG_B.id },
      { kind: "pending", id: LEG_C.id },
    ]);
  });

  // @spec DESK-SHELL-NOTE-008, DESK-SHELL-NOTE-001
  it("keeps to the window rule at a later subscription: nothing while it is in front", () => {
    const h = harness();
    h.n.subscribed([]);
    h.state.foreground = true;
    h.n.subscribed([LEG_B]);
    h.state.foreground = false;
    h.n.subscribed([LEG_B]);
    expect(h.port.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-010
  it("closes a leg's notification once the leg leaves the tracker's list, and only that one", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_A);
    h.n.pendingEvent(LEG_B);
    h.n.pendingListed([LEG_A.id, LEG_B.id]);
    expect(h.port.shown.map((s) => s.closed)).toEqual([false, false]);
    h.n.pendingListed([LEG_B.id]);
    expect(h.port.shown.map((s) => s.closed)).toEqual([true, false]);
    h.n.pendingListed([]);
    expect(h.port.shown.map((s) => s.closed)).toEqual([true, true]);
  });

  // @spec DESK-SHELL-NOTE-010, DESK-SHELL-NOTE-007
  it("does not notify a leg again after its notification was closed and the leg comes back listed", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_A);
    h.n.pendingListed([]);
    h.n.subscribed([LEG_A]);
    expect(h.port.shown).toHaveLength(1);
  });
});

describe("a logged hop", () => {
  // @spec DESK-SHELL-NOTE-002, DESK-SHELL-NOTE-005
  it("notifies the tracker's message word for word, a click opening that hop", () => {
    const h = harness();
    h.n.hopEvent({ id: 42, message: "Logged KBOS → KPVD, 45 min, 180 fpm butter" });
    expect(h.port.shown).toEqual([
      { title: "Hop logged", body: "Logged KBOS → KPVD, 45 min, 180 fpm butter", target: { kind: "hop", id: 42 }, silent: false, closed: false },
    ]);
  });

  // @spec DESK-SHELL-NOTE-002
  it("brings nothing while the window is in front", () => {
    const h = harness();
    h.state.foreground = true;
    h.n.hopEvent({ id: 42, message: "Logged KBOS → KPVD, 45 min" });
    expect(h.port.shown).toEqual([]);
  });
});

describe("the server given up on", () => {
  // @spec DESK-SHELL-NOTE-004, DESK-SHELL-NOTE-005
  it("notifies at once with the reason and the fixed advice, a click opening the failure screen", () => {
    const h = harness();
    h.n.gaveUp("Port 3380 is in use by another program");
    expect(h.port.shown).toEqual([
      {
        title: "MSFS Career Map stopped tracking",
        body: `Port 3380 is in use by another program\n${GAVE_UP_TAIL}`,
        target: { kind: "failure" },
        silent: false,
        closed: false,
      },
    ]);
  });

  // @spec DESK-SHELL-NOTE-004, DESK-SHELL-AWAY-004
  it("does not wait for the sim, but is silent while the sim is in use", () => {
    const h = harness();
    h.state.inUse = true;
    h.n.gaveUp("The server did not start within 60 s");
    expect(h.port.shown.map((s) => s.silent)).toEqual([true]);
  });

  // @spec DESK-SHELL-NOTE-004
  it("shows even while the window is in front", () => {
    const h = harness();
    h.state.foreground = true;
    h.n.gaveUp("The server did not start within 60 s");
    expect(h.port.titles()).toEqual(["MSFS Career Map stopped tracking"]);
  });
});

describe("silence and urgency", () => {
  // @spec DESK-SHELL-AWAY-004
  it("makes every notice silent while the sim is in use, and only then", () => {
    const h = harness();
    h.n.subscribed([]);
    h.state.inUse = true;
    h.n.pendingEvent(LEG_A);
    h.n.hopEvent({ id: 1, message: "Logged KBOS → KPVD" });
    h.state.inUse = false;
    h.n.hopEvent({ id: 2, message: "Logged KPVD → KBOS" });
    expect(h.port.shown.map((s) => s.silent)).toEqual([true, true, false]);
  });
});

describe("backups failing", () => {
  // @spec DESK-SHELL-NOTE-019, DESK-SHELL-NOTE-005
  it("notifies the folder and the server's short reason, a click opening the window, and records it shown", () => {
    const h = harness();
    h.n.backupsFailing("C:\\Users\\Pilot\\Documents\\MSFS Career Map\\Backups", "Windows refused the write");
    expect(h.port.shown).toEqual([
      {
        title: "Backups are failing",
        body: "MSFS Career Map could not back up the logbook to C:\\Users\\Pilot\\Documents\\MSFS Career Map\\Backups: Windows refused the write.",
        target: { kind: "window" },
        silent: false,
        closed: false,
      },
    ]);
    expect(h.settings.get().dailyBackupFailures.notified).toBe(true);
  });

  // @spec DESK-SHELL-NOTE-019
  it("waits while the sim is in use, showing once a recheck finds it out of use, and is not recorded before", () => {
    const h = harness();
    h.state.inUse = true;
    h.n.backupsFailing("D:\\Backups", "disk full");
    h.n.recheck();
    expect(h.port.shown).toEqual([]);
    expect(h.settings.get().dailyBackupFailures.notified).toBe(false);
    h.state.inUse = false;
    h.n.recheck();
    expect(h.port.titles()).toEqual(["Backups are failing"]);
    expect(h.port.shown[0].silent).toBe(false);
    expect(h.settings.get().dailyBackupFailures.notified).toBe(true);
    h.n.recheck();
    expect(h.port.shown).toHaveLength(1);
  });

  // @spec DESK-SHELL-NOTE-019
  it("keeps one waiting notice, the later call's words replacing the earlier's", () => {
    const h = harness();
    h.state.inUse = true;
    h.n.backupsFailing("D:\\Backups", "disk full");
    h.n.backupsFailing("D:\\Backups", "Windows refused the write");
    h.state.inUse = false;
    h.n.recheck();
    expect(h.port.shown.map((s) => s.body)).toEqual(["MSFS Career Map could not back up the logbook to D:\\Backups: Windows refused the write."]);
  });
});

describe("an update ready", () => {
  // @spec DESK-SHELL-NOTE-003, DESK-SHELL-NOTE-005
  it("notifies once per version, a click opening the window, recording the version in the settings", () => {
    const h = harness();
    h.n.updateReady("0.9.0");
    h.n.updateReady("0.9.0");
    expect(h.port.shown).toEqual([{ title: "Update ready", body: updateBody("0.9.0"), target: { kind: "window" }, silent: false, closed: false }]);
    expect(h.settings.get().updateNoticesShown).toEqual(["0.9.0"]);
    h.n.updateReady("0.9.1");
    expect(h.port.shown.map((s) => s.body)).toEqual([updateBody("0.9.0"), updateBody("0.9.1")]);
    expect(h.settings.get().updateNoticesShown).toEqual(["0.9.0", "0.9.1"]);
  });

  // @spec DESK-SHELL-NOTE-003
  it("shows nothing for a version the settings already record, as in a later run", () => {
    const h = harness();
    h.settings.update((s) => (s.updateNoticesShown = ["0.9.0"]));
    h.n.updateReady("0.9.0");
    expect(h.port.shown).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-003
  it("waits while the sim is in use and shows at the recheck that finds it out of use", () => {
    const h = harness();
    h.state.inUse = true;
    h.n.updateReady("0.9.0");
    h.n.recheck();
    expect(h.port.shown).toEqual([]);
    expect(h.settings.get().updateNoticesShown).toEqual([]);
    h.state.inUse = false;
    h.n.recheck();
    expect(h.port.titles()).toEqual(["Update ready"]);
    expect(h.settings.get().updateNoticesShown).toEqual(["0.9.0"]);
  });
});

describe("the pilot's first close of the window", () => {
  // @spec DESK-SHELL-TRAY-023
  it("notifies the fixed notice, a click opening the window, and records it shown", () => {
    const h = harness();
    h.n.firstClose();
    expect(h.port.shown).toEqual([{ title: "Still tracking in the tray", body: FIRST_CLOSE, target: { kind: "window" }, silent: false, closed: false }]);
    expect(h.settings.get().trayNoticeShown).toBe(true);
  });
});

describe("what is never notified", () => {
  // @spec DESK-SHELL-NOTE-018
  it("brings nothing for statuses alone, the sim connecting or disconnecting included", () => {
    const h = harness();
    h.n.subscribed([]);
    h.n.pendingListed([]);
    h.n.recheck();
    h.n.pendingListed([]);
    expect(h.port.shown).toEqual([]);
    expect(h.lines.filter((l) => l.startsWith("[notification]"))).toEqual([]);
  });
});

describe("test mode", () => {
  // @spec DESK-SHELL-NOTE-006
  it("writes each notice to desktop.log, each line break as \" · \", and shows none", () => {
    const h = harness({ mode: "test" });
    h.n.subscribed([]);
    h.n.pendingEvent(LEG_A);
    h.n.hopEvent({ id: 7, message: "Logged KBOS → KPVD, 45 min" });
    h.n.gaveUp("The server did not start within 60 s");
    h.n.firstClose();
    expect(h.port.shown).toEqual([]);
    expect(h.lines.filter((l) => l.startsWith("[notification]"))).toEqual([
      "[notification] Leg waiting to be logged: Cessna 172 Skyhawk G1000 · Asobo White · No aircraft in the fleet matches this sim aircraft",
      "[notification] Hop logged: Logged KBOS → KPVD, 45 min",
      `[notification] MSFS Career Map stopped tracking: The server did not start within 60 s · ${GAVE_UP_TAIL}`,
      `[notification] Still tracking in the tray: ${FIRST_CLOSE}`,
    ]);
    expect(h.settings.get().trayNoticeShown).toBe(true);
  });

  // @spec DESK-SHELL-NOTE-006, DESK-SHELL-NOTE-007
  it("keeps the same rules: the window in front, legs seen at the first subscription", () => {
    const h = harness({ mode: "test" });
    h.n.subscribed([LEG_A]);
    h.n.pendingEvent(LEG_A);
    h.state.foreground = true;
    h.n.hopEvent({ id: 7, message: "Logged KBOS → KPVD" });
    expect(h.lines.filter((l) => l.startsWith("[notification]"))).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-006, DESK-SHELL-NOTE-019
  it("writes a backups notice held for the sim once the sim is out of use, recorded as shown", () => {
    const h = harness({ mode: "test" });
    h.state.inUse = true;
    h.n.backupsFailing("C:\\t\\Backups", "disk full");
    expect(h.lines.filter((l) => l.startsWith("[notification]"))).toEqual([]);
    h.state.inUse = false;
    h.n.recheck();
    expect(h.lines.filter((l) => l.startsWith("[notification]"))).toEqual([
      "[notification] Backups are failing: MSFS Career Map could not back up the logbook to C:\\t\\Backups: disk full.",
    ]);
    expect(h.settings.get().dailyBackupFailures.notified).toBe(true);
  });
});
