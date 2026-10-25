/**
 * Start with Windows (src/desktop/windows-start.ts, src/desktop/start-lists.ts; m4 contract §5.2, §6):
 * the item ticked while the Run value named "MSFS Career Map" is there and StartupApproved does not mark
 * it disabled (DESK-START-WINDOWS-007); turning it on through Electron's login item, overriding a
 * Disable in Task Manager (WINDOWS-006); turning it off removing the value whatever it holds
 * (WINDOWS-008); the `.reg` export before any change, named in UTC and pruned to five, and none when
 * nothing changes (WINDOWS-002, WINDOWS-009); an export that cannot be written stopping the change
 * (WINDOWS-003); and the item's state read as the menu opens and again at the click, the click acting
 * on the fresh state (WINDOWS-004, WINDOWS-005). Windows' keys are a FakeKeys; the backups folder a
 * temp one.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MessageBoxOptions } from "../../../src/desktop/ports.ts";
import { SettingsStore } from "../../../src/desktop/settings.ts";
import { StartLists } from "../../../src/desktop/start-lists.ts";
import {
  approvedEnabled,
  runValue,
  turnWindowsOff,
  turnWindowsOn,
  windowsTicked,
  type WindowsOutcome,
} from "../../../src/desktop/windows-start.ts";
import { FakeClock, flush } from "../support/clock.ts";
import {
  APPROVED_DISABLED,
  APPROVED_ENABLED,
  FakeBoxes,
  FakeFacts,
  FakeKeys,
  ScriptedFs,
  never,
} from "../support/fakes.ts";
import { Sims, TEST_PROGRAM } from "./support/sims.ts";

const win = path.win32;

/** The FakeClock's wall time, 2026-10-25T12:00:00.000Z, as a backup's stamp. */
const STAMP = "20261025T120000Z";
const OTHER_PROGRAM = '"C:\\Games\\Other Tracker\\tracker.exe" --tray';

interface WindowsHarness {
  sims: Sims;
  keys: FakeKeys;
  fs: ScriptedFs;
  clock: FakeClock;
  lines: string[];
  on(): Promise<WindowsOutcome>;
  off(): Promise<WindowsOutcome>;
  /** The Run exports in the backups folder, sorted. */
  exports(): string[];
}

function windows(): WindowsHarness {
  const sims = new Sims();
  const keys = new FakeKeys();
  const sfs = new ScriptedFs();
  const clock = new FakeClock();
  const lines: string[] = [];
  const o = { keys, fs: sfs, clock, program: TEST_PROGRAM, backupsFolder: sims.backups, log: (l: string) => lines.push(l) };
  return {
    sims,
    keys,
    fs: sfs,
    clock,
    lines,
    on: () => turnWindowsOn(o),
    off: () => turnWindowsOff(o),
    exports: () => sims.backupNames().filter((n) => n.startsWith("Run.")),
  };
}

const OTHERS = () => JSON.parse(JSON.stringify(new FakeKeys().others)) as unknown;
const exportCalls = (k: FakeKeys) => k.calls.filter((c) => c.startsWith("exportTo "));
const callNames = (k: FakeKeys) => k.calls.map((c) => c.split(" ")[0]);

describe("the Start with Windows state", () => {
  // @spec DESK-START-WINDOWS-006
  it("writes the quoted installed program followed by --background", () => {
    expect(runValue(TEST_PROGRAM)).toBe(`"${TEST_PROGRAM}" --background`);
  });

  // @spec DESK-START-WINDOWS-007
  it("reads StartupApproved's mark as disabled when its first byte is odd, enabled when even or absent", () => {
    expect(approvedEnabled(null)).toBe(true);
    expect(approvedEnabled(APPROVED_ENABLED)).toBe(true);
    expect(approvedEnabled(Uint8Array.from([6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(approvedEnabled(APPROVED_DISABLED)).toBe(false);
    expect(approvedEnabled(Uint8Array.from([7, 0, 0, 0]))).toBe(false);
  });

  // @spec DESK-START-WINDOWS-007
  it("is ticked while the value named MSFS Career Map is in Run, whatever it holds, and its mark is not disabled", () => {
    expect(windowsTicked({ run: null, approved: null })).toBe(false);
    expect(windowsTicked({ run: null, approved: APPROVED_ENABLED })).toBe(false);
    expect(windowsTicked({ run: runValue(TEST_PROGRAM), approved: null })).toBe(true);
    expect(windowsTicked({ run: runValue(TEST_PROGRAM), approved: APPROVED_ENABLED })).toBe(true);
    expect(windowsTicked({ run: OTHER_PROGRAM, approved: null })).toBe(true);
    // Turned off in Task Manager's Startup apps.
    expect(windowsTicked({ run: runValue(TEST_PROGRAM), approved: APPROVED_DISABLED })).toBe(false);
  });
});

describe("turning Start with Windows on", () => {
  // @spec DESK-START-WINDOWS-006, DESK-START-WINDOWS-002
  it("exports both keys, then writes the login item named MSFS Career Map, marked enabled", async () => {
    const h = windows();
    expect(await h.on()).toEqual({ kind: "written" });
    expect(h.keys.run).toBe(`"${TEST_PROGRAM}" --background`);
    expect(h.keys.approved).toEqual(APPROVED_ENABLED);
    const exportFile = win.join(h.sims.backups, `Run.${STAMP}.reg`);
    expect(exportCalls(h.keys)).toEqual([`exportTo ${exportFile}`]);
    expect(h.keys.calls.indexOf(`exportTo ${exportFile}`)).toBeLessThan(h.keys.calls.indexOf(`writeOn ${TEST_PROGRAM}`));
    expect(h.exports()).toEqual([`Run.${STAMP}.reg`]);
    expect(h.keys.others).toEqual(OTHERS());
    expect(h.lines.some((l) => l.startsWith("[start-lists] Windows start-up keys: "))).toBe(true);
  });

  // @spec DESK-START-WINDOWS-006
  it("overrides a Disable in Task Manager's Startup apps", async () => {
    const h = windows();
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.approved = Uint8Array.from(APPROVED_DISABLED);
    expect(await h.on()).toEqual({ kind: "written" });
    expect(windowsTicked({ run: h.keys.run, approved: h.keys.approved })).toBe(true);
    expect(exportCalls(h.keys)).toHaveLength(1);
  });

  // @spec DESK-START-WINDOWS-006
  it("replaces a value of that name holding another program with the app's", async () => {
    const h = windows();
    h.keys.run = OTHER_PROGRAM;
    expect(await h.on()).toEqual({ kind: "written" });
    expect(h.keys.run).toBe(runValue(TEST_PROGRAM));
  });

  // @spec DESK-START-WINDOWS-009
  it("writes nothing and takes no export when the value and its mark are already as turning on leaves them", async () => {
    for (const [run, approved] of [
      [runValue(TEST_PROGRAM), APPROVED_ENABLED],
      [runValue(TEST_PROGRAM), null],
      [`"${TEST_PROGRAM.toUpperCase()}" --background`, Uint8Array.from([6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    ] as const) {
      const h = windows();
      h.keys.run = run;
      h.keys.approved = approved === null ? null : Uint8Array.from(approved);
      expect(await h.on()).toEqual({ kind: "unchanged" });
      expect(callNames(h.keys)).not.toContain("exportTo");
      expect(callNames(h.keys)).not.toContain("writeOn");
      expect(h.exports()).toEqual([]);
    }
  });

  // @spec DESK-START-WINDOWS-003
  it("changes neither key when the export cannot be written, naming the backup and the reason", async () => {
    const h = windows();
    h.keys.approved = Uint8Array.from(APPROVED_DISABLED);
    h.keys.fail.exportTo = "access denied";
    const outcome = await h.on();
    const exportFile = win.join(h.sims.backups, `Run.${STAMP}.reg`);
    expect(outcome).toEqual({ kind: "left", why: `the backup ${exportFile} could not be written: access denied` });
    expect(callNames(h.keys)).not.toContain("writeOn");
    expect(h.keys.run).toBeNull();
    expect(h.keys.approved).toEqual(APPROVED_DISABLED);
  });

  // @spec DESK-START-WINDOWS-006
  it("leaves the keys as they are and says why when the login item cannot be written", async () => {
    const h = windows();
    h.keys.fail.writeOn = "Electron refused the login item";
    const outcome = await h.on();
    expect(outcome.kind).toBe("left");
    expect((outcome as { why: string }).why).toContain("Electron refused the login item");
    expect(h.keys.run).toBeNull();
  });
});

describe("turning Start with Windows off", () => {
  // @spec DESK-START-WINDOWS-008, DESK-START-WINDOWS-002
  it("exports, then removes the value named MSFS Career Map from both keys and nothing else", async () => {
    const h = windows();
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.approved = Uint8Array.from(APPROVED_ENABLED);
    expect(await h.off()).toEqual({ kind: "written" });
    expect(h.keys.run).toBeNull();
    expect(h.keys.approved).toBeNull();
    const exportFile = win.join(h.sims.backups, `Run.${STAMP}.reg`);
    expect(h.keys.calls.indexOf(`exportTo ${exportFile}`)).toBeGreaterThanOrEqual(0);
    expect(h.keys.calls.indexOf(`exportTo ${exportFile}`)).toBeLessThan(h.keys.calls.indexOf("remove"));
    expect(h.keys.others).toEqual(OTHERS());
  });

  // @spec DESK-START-WINDOWS-008
  it("removes a value of that name holding another program, and a mark left with no Run value", async () => {
    const other = windows();
    other.keys.run = OTHER_PROGRAM;
    expect(await other.off()).toEqual({ kind: "written" });
    expect(other.keys.run).toBeNull();

    const markOnly = windows();
    markOnly.keys.approved = Uint8Array.from(APPROVED_DISABLED);
    expect(await markOnly.off()).toEqual({ kind: "written" });
    expect(markOnly.keys.approved).toBeNull();
  });

  // @spec DESK-START-WINDOWS-009
  it("writes nothing and takes no export when neither key holds the value", async () => {
    const h = windows();
    expect(await h.off()).toEqual({ kind: "unchanged" });
    expect(callNames(h.keys)).toEqual(["read"]);
    expect(h.exports()).toEqual([]);
  });

  // @spec DESK-START-WINDOWS-003
  it("removes nothing when the export cannot be written", async () => {
    const h = windows();
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.fail.exportTo = "disk full";
    const outcome = await h.off();
    expect(outcome).toEqual({ kind: "left", why: `the backup ${win.join(h.sims.backups, `Run.${STAMP}.reg`)} could not be written: disk full` });
    expect(callNames(h.keys)).not.toContain("remove");
    expect(h.keys.run).toBe(runValue(TEST_PROGRAM));
  });

  // @spec DESK-START-WINDOWS-008
  it("says why when the value stays", async () => {
    const h = windows();
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.fail.remove = "reg.exe: access is denied";
    const outcome = await h.off();
    expect(outcome.kind).toBe("left");
    expect((outcome as { why: string }).why).toContain("reg.exe: access is denied");
  });
});

describe("the .reg exports", () => {
  // @spec DESK-START-WINDOWS-002
  it("keeps the five newest of its own exports by the time in the name, deleting only older ones of its own", async () => {
    const h = windows();
    fs.mkdirSync(h.sims.backups, { recursive: true });
    const old = [
      "Run.20261019T080000Z.reg",
      "Run.20261020T080000Z.reg",
      "Run.20261021T080000Z.reg",
      "Run.20261022T080000Z.reg",
      "Run.20261023T080000Z.reg",
      "Run.20261023T080000Z-2.reg",
    ];
    const notOurs = ["notes.txt", "Run.backup.reg", "Run.20261001T000000.reg", "EXE.xml.Store.20261001T000000Z"];
    for (const n of [...old, ...notOurs]) fs.writeFileSync(win.join(h.sims.backups, n), "x");
    // The oldest by its name, written last, so a pruning by the files' own times would keep it.
    fs.utimesSync(win.join(h.sims.backups, old[0]), new Date("2030-01-01"), new Date("2030-01-01"));
    expect(await h.on()).toEqual({ kind: "written" });
    expect(h.sims.backupNames()).toEqual(
      [
        `Run.${STAMP}.reg`,
        "Run.20261021T080000Z.reg",
        "Run.20261022T080000Z.reg",
        "Run.20261023T080000Z.reg",
        "Run.20261023T080000Z-2.reg",
        ...notOurs,
      ].sort(),
    );
  });

  // @spec DESK-START-WINDOWS-002
  it("adds -2 before .reg for a second export within one second, keeping the first", async () => {
    const h = windows();
    expect(await h.on()).toEqual({ kind: "written" });
    expect(await h.off()).toEqual({ kind: "written" });
    expect(h.exports()).toEqual([`Run.${STAMP}-2.reg`, `Run.${STAMP}.reg`]);
  });
});

// -------------------------------------------------------------------------------------------------
// The item

interface ItemHarness {
  sims: Sims;
  keys: FakeKeys;
  lists: StartLists;
  lines: string[];
  boxes: Omit<MessageBoxOptions, "signal">[];
  click(quitting?: boolean): Promise<void>;
}

function item(): ItemHarness {
  const sims = new Sims();
  const keys = new FakeKeys();
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  const settings = new SettingsStore(sims.electron, log);
  settings.load();
  const lists = new StartLists(
    {
      clock: new FakeClock(),
      fs: new ScriptedFs(),
      keys,
      facts: new FakeFacts(),
      boxes: new FakeBoxes(),
      settings,
      env: sims.env,
      electronFolder: sims.electron,
      log,
    },
    { program: TEST_PROGRAM, earlier: [] },
  );
  const boxes: Omit<MessageBoxOptions, "signal">[] = [];
  return {
    sims,
    keys,
    lists,
    lines,
    boxes,
    click: (quitting = false) =>
      lists.click(
        "windows",
        () => quitting,
        async (o) => {
          boxes.push(o);
          return 0;
        },
      ),
  };
}

describe("the Start with Windows item", () => {
  // @spec DESK-START-WINDOWS-004, DESK-START-WINDOWS-007, DESK-START-WINDOWS-001
  it("is read as the menu opens: unticked until turned on, ticked while Windows will start the app, unticked after a Disable in Task Manager", async () => {
    const h = item();
    expect(h.lists.items()).toBeNull();
    expect((await h.lists.refresh()).windows).toEqual({ label: "Start with Windows", enabled: true, checked: false });
    h.keys.run = runValue(TEST_PROGRAM);
    expect((await h.lists.refresh()).windows.checked).toBe(true);
    h.keys.approved = Uint8Array.from(APPROVED_DISABLED);
    expect((await h.lists.refresh()).windows.checked).toBe(false);
    expect(h.lists.items()?.windows.checked).toBe(false);
  });

  // @spec DESK-START-WINDOWS-005
  it("reads the state again at the click and acts on it, not on the state read as the menu opened", async () => {
    const turnedOnElsewhere = item();
    await turnedOnElsewhere.lists.refresh();
    expect(turnedOnElsewhere.lists.items()?.windows.checked).toBe(false);
    turnedOnElsewhere.keys.run = runValue(TEST_PROGRAM);
    await turnedOnElsewhere.click();
    expect(callNames(turnedOnElsewhere.keys)).toContain("remove");
    expect(callNames(turnedOnElsewhere.keys)).not.toContain("writeOn");
    expect(turnedOnElsewhere.keys.run).toBeNull();

    const turnedOffElsewhere = item();
    turnedOffElsewhere.keys.run = runValue(TEST_PROGRAM);
    await turnedOffElsewhere.lists.refresh();
    expect(turnedOffElsewhere.lists.items()?.windows.checked).toBe(true);
    turnedOffElsewhere.keys.approved = Uint8Array.from(APPROVED_DISABLED);
    await turnedOffElsewhere.click();
    expect(callNames(turnedOffElsewhere.keys)).toContain("writeOn");
    expect(windowsTicked({ run: turnedOffElsewhere.keys.run, approved: turnedOffElsewhere.keys.approved })).toBe(true);
  });

  // @spec DESK-START-WINDOWS-005, DESK-START-WINDOWS-007
  it("shows the keys as they are after the click", async () => {
    const h = item();
    await h.lists.refresh();
    await h.click();
    expect(h.lists.items()?.windows.checked).toBe(true);
    await h.click();
    expect(h.lists.items()?.windows.checked).toBe(false);
    expect(h.boxes).toEqual([]);
  });

  // @spec DESK-START-WINDOWS-003, DESK-SHELL-AWAY-003
  it("shows one box naming the backup and the reason when the export cannot be written", async () => {
    const h = item();
    h.keys.fail.exportTo = "access denied";
    await h.lists.refresh();
    await h.click();
    expect(h.boxes).toHaveLength(1);
    expect(h.boxes[0]).toMatchObject({ type: "warning", title: "MSFS Career Map", buttons: ["OK"] });
    expect(h.boxes[0].message).toContain("Start with Windows could not be changed:");
    expect(h.boxes[0].message).toContain(win.join(h.sims.backups, `Run.${STAMP}.reg`));
    expect(h.boxes[0].message).toContain("access denied");
    expect(h.keys.run).toBeNull();
  });

  // @spec DESK-START-WINDOWS-004
  it("shows the item unticked and clickable when the keys cannot be read, logging that once each time it starts", async () => {
    const h = item();
    h.keys.fail.read = "reg.exe: the keys could not be read";
    const reported = () => h.lines.filter((l) => l.startsWith("[start-lists]") && l.includes("reg.exe: the keys could not be read"));
    expect((await h.lists.refresh()).windows).toEqual({ label: "Start with Windows", enabled: true, checked: false });
    await h.lists.refresh();
    expect(reported()).toHaveLength(1);
    delete h.keys.fail.read;
    await h.lists.refresh();
    h.keys.fail.read = "reg.exe: the keys could not be read";
    await h.lists.refresh();
    expect(reported()).toHaveLength(2);
  });

  // @spec DESK-START-WINDOWS-005
  it("ignores a click while a change is under way", async () => {
    const h = item();
    await h.lists.refresh();
    let release!: () => void;
    h.keys.gate = new Promise<void>((resolve) => (release = resolve));
    const first = h.click();
    await flush();
    expect(h.lists.busy()).not.toBeNull();
    await h.click();
    release();
    h.keys.gate = null;
    await first;
    expect(h.lists.busy()).toBeNull();
    expect(h.keys.calls.filter((c) => c.startsWith("writeOn"))).toHaveLength(1);
  });

  // @spec DESK-SHELL-QUIT-012
  it("writes the outcome to the log and opens no box when the desktop shell is quitting by the time the change ends", async () => {
    const h = item();
    h.keys.fail.exportTo = "access denied";
    await h.lists.refresh();
    await h.click(true);
    expect(h.boxes).toEqual([]);
    expect(h.lines.some((l) => l.startsWith("[start-lists]") && l.includes("access denied"))).toBe(true);
  });

  // @spec DESK-START-WINDOWS-005
  it("never settles a click until its change is done", async () => {
    const h = item();
    await h.lists.refresh();
    h.keys.gate = never();
    let done = false;
    void h.click().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    expect(h.lists.busy()).not.toBeNull();
  });
});
