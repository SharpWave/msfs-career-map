/**
 * The Start with MSFS 2024 item (src/desktop/msfs-start.ts, src/desktop/start-lists.ts; m4 contract
 * §4.2, §6): its state — the editions installed, the EXE.xml files present and the app's entries in
 * them, MSFS 2024 running — read as the menu opens and again at the click, the click acting on that
 * fresh state; its tick and its words by the first that applies; MSFS running at the click; the one
 * box naming each file left as it was; the lines its reads log, once each time their state starts;
 * and an entry another program removed, said until the pilot clicks and never put back.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Programs } from "../../../src/desktop/exe-xml.ts";
import { editionFolders, msfsItem, msfsTicked, readMsfsState, type MsfsState } from "../../../src/desktop/msfs-start.ts";
import type { MessageBoxOptions } from "../../../src/desktop/ports.ts";
import { SettingsStore } from "../../../src/desktop/settings.ts";
import { StartLists } from "../../../src/desktop/start-lists.ts";
import { FakeClock } from "../support/clock.ts";
import { FakeBoxes, FakeFacts, FakeKeys, ScriptedFs, fsError } from "../support/fakes.ts";
import { Sims, TEST_PROGRAM, fixture, type Edition } from "./support/sims.ts";

const win = path.win32;
const PROGRAMS: Programs = { program: TEST_PROGRAM, earlier: [] };
const BLANK = Uint8Array.from(Buffer.from(" \r\n\t\r\n", "latin1"));

const LABEL = {
  notFound: "Start with MSFS 2024 (MSFS 2024 not found)",
  closeMsfs: "Start with MSFS 2024 (close MSFS to change)",
  cantRead: "Start with MSFS 2024 (EXE.xml can't be read; see log)",
  removed: "Start with MSFS 2024 (removed by another program; click to add again)",
  turnedOff: "Start with MSFS 2024 (turned off in EXE.xml)",
  plain: "Start with MSFS 2024",
};

const raw = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("latin1"));

async function drive<T>(clock: FakeClock, p: Promise<T>, limitMs = 20_000): Promise<T> {
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  p.then(
    (v) => {
      settled = true;
      value = v;
    },
    (e: unknown) => {
      settled = true;
      failed = true;
      error = e;
    },
  );
  for (let t = 0; !settled && t <= limitMs; t += 50) await clock.advance(50);
  if (!settled) throw new Error(`did not settle within ${limitMs} ms`);
  if (failed) throw error;
  return value as T;
}

// ---------------------------------------------------------------------------------------------
// The state and the words

interface Look {
  sims: Sims;
  fs: ScriptedFs;
  facts: FakeFacts;
  state(): Promise<MsfsState>;
}

function look(sims = new Sims()): Look {
  const scripted = new ScriptedFs();
  const facts = new FakeFacts();
  return {
    sims,
    fs: scripted,
    facts,
    state: () => readMsfsState({ folders: editionFolders(sims.env), fs: scripted, programs: PROGRAMS, facts }),
  };
}

function fileState(s: MsfsState, edition: Edition) {
  const f = s.files.find((x) => x.edition === edition);
  if (!f) throw new Error(`no file for ${edition}`);
  return f.state;
}

describe("the item's state", () => {
  // @spec DESK-START-MSFS-003, DESK-START-MSFS-011
  it("names the editions installed by UserCfg.opt and one file per edition's folder, Store first, absent included", async () => {
    const l = look();
    l.sims.install("Steam");
    l.sims.put("Store", fixture("real-six.xml")); // a folder without UserCfg.opt
    const s = await l.state();
    expect(s.installed).toEqual(["Steam"]);
    expect(s.files.map((f) => [f.edition, f.file])).toEqual([
      ["Store", l.sims.exeFile("Store")],
      ["Steam", l.sims.exeFile("Steam")],
    ]);
    expect(fileState(s, "Store")).toEqual({ kind: "read", blank: false, entries: [] });
    expect(fileState(s, "Steam")).toEqual({ kind: "absent" });
  });

  // @spec DESK-START-MSFS-004
  it("counts MSFS 2024 running by FlightSimulator2024.exe alone, not MSFS 2020", async () => {
    const l = look();
    l.facts.msfs = true;
    l.facts.msfs2024 = false;
    expect((await l.state()).running).toBe(false);
    l.facts.msfs2024 = true;
    expect((await l.state()).running).toBe(true);
    expect(l.facts.calls.filter((c) => c === "msfs2024Running")).toHaveLength(2);
    expect(l.facts.calls).not.toContain("msfsRunning");
  });

  // @spec DESK-START-MSFS-005, DESK-START-MSFS-016
  it("reads a blank file as read, and the app's entries with whether each is on and the same", async () => {
    const l = look();
    l.sims.install("Store").install("Steam").put("Store", BLANK).put("Steam", fixture("twice.xml"));
    const s = await l.state();
    expect(fileState(s, "Store")).toEqual({ kind: "read", blank: true, entries: [] });
    expect(fileState(s, "Steam")).toEqual({
      kind: "read",
      blank: false,
      entries: [
        { on: true, same: true },
        { on: false, same: false },
      ],
    });
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("gives why a file cannot be read: not XML, wrong root, another encoding, a path the encoding cannot hold, cannot be opened", async () => {
    const cases: [string, Uint8Array, RegExp, Programs?][] = [
      ["malformed", fixture("malformed.xml"), /^it does not parse as XML/],
      ["wrong root", fixture("wrong-root.xml"), /^its root is not SimBase\.Document with Type="Launch"$/],
      ["UTF-16", fixture("real-six.xml", { encoding: "utf-16le", bom: true }), /^its encoding, UTF-16, is neither UTF-8 nor windows-1252$/],
      [
        "path encoding",
        fixture("real-six-1252.xml", { encoding: "windows-1252" }),
        /^its encoding, windows-1252, cannot hold the program's path$/,
        { program: "C:\\Users\\Пилот\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe", earlier: [] },
      ],
    ];
    for (const [name, bytes, why, programs] of cases) {
      const sims = new Sims();
      sims.install("Store").put("Store", bytes);
      const s = await readMsfsState({ folders: editionFolders(sims.env), fs: new ScriptedFs(), programs: programs ?? PROGRAMS, facts: new FakeFacts() });
      const st = fileState(s, "Store");
      expect(st.kind, name).toBe("unreadable");
      expect(st.kind === "unreadable" ? st.why : "", name).toMatch(why);
    }
    const l = look();
    l.sims.install("Store").put("Store", fixture("real-six.xml"));
    l.fs.hook("read", l.sims.exeFile("Store"), () => {
      throw fsError("EACCES", "EACCES: permission denied");
    });
    const st = fileState(await l.state(), "Store");
    expect(st.kind === "unreadable" ? st.why : st.kind).toMatch(/^it cannot be opened: .*EACCES/);
  });

  // @spec DESK-START-MSFS-006
  it("is ticked while any EXE.xml present holds an entry of the app's turned on, one of two being enough", async () => {
    const l = look();
    l.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml")).put("Steam", fixture("with-app.xml"));
    expect(msfsTicked(await l.state())).toBe(true);
    l.sims.put("Steam", fixture("off-disabled.xml"));
    expect(msfsTicked(await l.state())).toBe(false);
    // An EXE.xml left in a folder whose edition is uninstalled still counts.
    const left = look();
    left.sims.put("Steam", fixture("after-app.xml"));
    expect(msfsTicked(await left.state())).toBe(true);
  });
});

describe("the item's words", () => {
  async function item(setup: (sims: Sims, facts: FakeFacts) => void, record: (sims: Sims) => string[] = () => []) {
    const l = look();
    setup(l.sims, l.facts);
    return msfsItem(await l.state(), record(l.sims));
  }

  // @spec DESK-START-MSFS-014
  it("cannot be clicked, unticked, when neither edition is installed", async () => {
    expect(await item(() => {})).toEqual({ label: LABEL.notFound, enabled: false, checked: false });
    // Not installed comes before MSFS running.
    expect(await item((_s, f) => (f.msfs2024 = true))).toEqual({ label: LABEL.notFound, enabled: false, checked: false });
  });

  // @spec DESK-START-MSFS-015
  it("cannot be clicked while MSFS 2024 runs, ticked or not", async () => {
    expect(
      await item((s, f) => {
        s.install("Store");
        f.msfs2024 = true;
      }),
    ).toEqual({ label: LABEL.closeMsfs, enabled: false, checked: false });
    expect(
      await item((s, f) => {
        s.install("Store").put("Store", fixture("with-app.xml"));
        f.msfs2024 = true;
      }),
    ).toEqual({ label: LABEL.closeMsfs, enabled: false, checked: true });
    // Ticked with no edition installed: not-found needs unticked, so MSFS running applies.
    expect(
      await item((s, f) => {
        s.put("Steam", fixture("with-app.xml"));
        f.msfs2024 = true;
      }),
    ).toEqual({ label: LABEL.closeMsfs, enabled: false, checked: true });
    // MSFS running comes before a file that cannot be read.
    expect(
      await item((s, f) => {
        s.install("Store").put("Store", fixture("malformed.xml"));
        f.msfs2024 = true;
      }),
    ).toEqual({ label: LABEL.closeMsfs, enabled: false, checked: false });
  });

  // @spec DESK-START-MSFS-016
  it("says an EXE.xml can't be read, clickable, before an entry removed or turned off", async () => {
    expect(await item((s) => s.install("Store").put("Store", fixture("malformed.xml")))).toEqual({ label: LABEL.cantRead, enabled: true, checked: false });
    expect(await item((s) => s.install("Store").put("Store", fixture("malformed.xml")).put("Steam", fixture("off-disabled.xml")))).toEqual({
      label: LABEL.cantRead,
      enabled: true,
      checked: false,
    });
    expect(
      await item(
        (s) => s.install("Store").put("Store", fixture("malformed.xml")).put("Steam", fixture("real-six.xml")),
        (s) => [s.exeFile("Steam")],
      ),
    ).toEqual({ label: LABEL.cantRead, enabled: true, checked: false });
    // A recorded file that cannot be read counts as unreadable, not as removed.
    expect(await item((s) => s.install("Store").put("Store", fixture("wrong-root.xml")), (s) => [s.exeFile("Store")])).toEqual({
      label: LABEL.cantRead,
      enabled: true,
      checked: false,
    });
  });

  // @spec DESK-START-MSFS-017
  it("says another program removed the entry when a recorded file no longer holds it, before an entry turned off", async () => {
    const recordStore = (s: Sims) => [s.exeFile("Store").toUpperCase()];
    for (const store of [fixture("real-six.xml"), BLANK, null]) {
      expect(
        await item((s) => {
          s.install("Store");
          if (store !== null) s.put("Store", store);
        }, recordStore),
      ).toEqual({ label: LABEL.removed, enabled: true, checked: false });
    }
    expect(await item((s) => s.install("Store").put("Store", fixture("real-six.xml")).put("Steam", fixture("off-disabled.xml")), recordStore)).toEqual({
      label: LABEL.removed,
      enabled: true,
      checked: false,
    });
  });

  // @spec DESK-START-MSFS-018
  it("says the entry is turned off in EXE.xml", async () => {
    expect(await item((s) => s.install("Store").put("Store", fixture("off-manualload.xml")))).toEqual({ label: LABEL.turnedOff, enabled: true, checked: false });
    // A recorded file still holding the entry, turned off, is not removed.
    expect(await item((s) => s.install("Store").put("Store", fixture("off-disabled.xml")), (s) => [s.exeFile("Store")])).toEqual({
      label: LABEL.turnedOff,
      enabled: true,
      checked: false,
    });
  });

  // @spec DESK-START-MSFS-019, DESK-START-MSFS-013
  it("is plain otherwise, ticked or not, whatever else the files hold while ticked", async () => {
    expect(await item((s) => s.install("Store").put("Store", fixture("real-six.xml")))).toEqual({ label: LABEL.plain, enabled: true, checked: false });
    expect(await item((s) => s.install("Store"))).toEqual({ label: LABEL.plain, enabled: true, checked: false });
    expect(await item((s) => s.install("Store").put("Store", fixture("with-app.xml")).put("Steam", fixture("malformed.xml")), (s) => [s.exeFile("Steam")])).toEqual({
      label: LABEL.plain,
      enabled: true,
      checked: true,
    });
    // Ticked from a folder left behind, no edition installed: clickable, to turn it off.
    expect(await item((s) => s.put("Steam", fixture("after-app.xml")))).toEqual({ label: LABEL.plain, enabled: true, checked: true });
  });
});

// ---------------------------------------------------------------------------------------------
// The item in the tray: StartLists

interface Tray {
  sims: Sims;
  fs: ScriptedFs;
  facts: FakeFacts;
  clock: FakeClock;
  settings: SettingsStore;
  lists: StartLists;
  lines: string[];
  boxes: Omit<MessageBoxOptions, "signal">[];
  click(quitting?: boolean): Promise<void>;
  refresh(): Promise<void>;
  label(): string | undefined;
}

function tray(sims = new Sims()): Tray {
  const scripted = new ScriptedFs();
  const facts = new FakeFacts();
  const clock = new FakeClock();
  const lines: string[] = [];
  const settings = new SettingsStore(sims.electron, (l) => lines.push(l));
  settings.load();
  const lists = new StartLists(
    { clock, fs: scripted, keys: new FakeKeys(), facts, boxes: new FakeBoxes(), settings, env: sims.env, electronFolder: sims.electron, log: (l) => lines.push(l) },
    PROGRAMS,
  );
  const boxes: Omit<MessageBoxOptions, "signal">[] = [];
  const openBox = async (o: Omit<MessageBoxOptions, "signal">) => {
    boxes.push(o);
    return 0;
  };
  return {
    sims,
    fs: scripted,
    facts,
    clock,
    settings,
    lists,
    lines,
    boxes,
    click: (quitting = false) => drive(clock, lists.click("msfs", () => quitting, openBox)),
    refresh: async () => {
      await drive(clock, lists.refresh());
    },
    label: () => lists.items()?.msfs.label,
  };
}

const appEntries = (sims: Sims, edition: Edition) => (raw(sims.exe(edition)) ?? "").split("<Name>MSFS Career Map</Name>").length - 1;

describe("Start with MSFS 2024 in the tray", () => {
  // @spec DESK-START-MSFS-011
  it("reads the state afresh at every menu opening", async () => {
    const t = tray();
    expect(t.lists.items()).toBeNull();
    t.sims.install("Store").put("Store", fixture("with-app.xml"));
    await t.refresh();
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.plain, enabled: true, checked: true });
    t.sims.put("Store", fixture("off-disabled.xml"));
    await t.refresh();
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.turnedOff, enabled: true, checked: false });
    expect(t.facts.calls.filter((c) => c === "msfs2024Running")).toHaveLength(2);
  });

  // @spec DESK-START-MSFS-012, DESK-START-MSFS-007
  it("acts at the click on the state read then, not the one read as the menu opened", async () => {
    const t = tray();
    t.sims.install("Store").put("Store", fixture("real-six.xml"));
    await t.refresh();
    expect(t.lists.items()?.msfs.checked).toBe(false);
    // Another program adds the entry between the menu opening and the click: the click turns it off.
    t.sims.put("Store", fixture("after-app.xml"));
    await t.click();
    expect(appEntries(t.sims, "Store")).toBe(0);
    expect(t.lists.items()?.msfs.checked).toBe(false);

    // And the other way: shown ticked, the entry gone by the click, so the click turns it on.
    t.sims.put("Store", fixture("with-app.xml"));
    await t.refresh();
    expect(t.lists.items()?.msfs.checked).toBe(true);
    t.sims.put("Store", fixture("real-six.xml"));
    await t.click();
    expect(appEntries(t.sims, "Store")).toBe(1);
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.plain, enabled: true, checked: true });
  });

  // @spec DESK-START-MSFS-020
  it("writes nothing and says to close MSFS when MSFS 2024 is running at the click", async () => {
    const t = tray();
    const bytes = fixture("real-six.xml");
    t.sims.install("Store").put("Store", bytes);
    await t.refresh();
    t.facts.msfs2024 = true;
    await t.click();
    expect(t.boxes.map((b) => b.message)).toEqual(["Close MSFS to change Start with MSFS 2024."]);
    expect(raw(t.sims.exe("Store"))).toBe(raw(bytes));
    expect(t.sims.backupNames()).toEqual([]);
    expect(t.fs.callsOf("write")).toEqual([]);
    expect(fs.existsSync(win.join(t.sims.electron, "settings.json"))).toBe(false);
    expect(t.label()).toBe(LABEL.closeMsfs);
  });

  // @spec DESK-START-MSFS-049, DESK-SHELL-AWAY-003
  it("still changes the other files, and shows one box naming each file left as it was and why", async () => {
    const t = tray();
    t.sims.install("Store").install("Steam").put("Store", fixture("malformed.xml")).put("Steam", fixture("real-six.xml"));
    await t.refresh();
    await t.click();
    expect(t.boxes).toHaveLength(1);
    const box = t.boxes[0];
    expect(box.type).toBe("warning");
    expect(box.title).toBe("MSFS Career Map");
    expect(box.buttons).toEqual(["OK"]);
    const lines = box.message.split(/\r?\n/);
    expect(lines[0]).toBe("Start with MSFS 2024: these files were left as they were:");
    expect(lines.slice(1)).toHaveLength(1);
    expect(lines[1]).toMatch(new RegExp(`^${t.sims.exeFile("Store").replace(/[\\.()]/g, "\\$&")}: it does not parse as XML`));
    expect(appEntries(t.sims, "Steam")).toBe(1);
    // Read again after the click: the files as they are.
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.plain, enabled: true, checked: true });
  });

  // @spec DESK-START-MSFS-049
  it("shows no box when every file changed", async () => {
    const t = tray();
    t.sims.install("Store").install("Steam");
    await t.refresh();
    await t.click();
    expect(t.boxes).toEqual([]);
    expect(appEntries(t.sims, "Store")).toBe(1);
    expect(appEntries(t.sims, "Steam")).toBe(1);
  });

  // @spec DESK-SHELL-QUIT-012
  it("opens no box for a change that ends once quitting has begun, and logs its outcome", async () => {
    const t = tray();
    t.sims.install("Store").install("Steam").put("Store", fixture("malformed.xml"));
    await t.refresh();
    await t.click(true);
    expect(t.boxes).toEqual([]);
    expect(t.lines.some((l) => l.startsWith(`[start-lists] EXE.xml ${t.sims.exeFile("Store")} left as it was:`))).toBe(true);
    expect(appEntries(t.sims, "Steam")).toBe(1);
  });

  // @spec DESK-START-MSFS-012
  it("ignores a click while a change is under way", async () => {
    const t = tray();
    t.sims.install("Store").put("Store", fixture("real-six.xml"));
    t.fs.hook("rename", t.sims.tempFile("Store"), (n) => {
      if (n <= 4) throw fsError("EBUSY");
    });
    await t.refresh();
    const boxes: unknown[] = [];
    const first = t.lists.click("msfs", () => false, async (o) => {
      boxes.push(o);
      return 0;
    });
    await t.clock.advance(0);
    expect(t.lists.busy()).not.toBeNull();
    await drive(t.clock, t.lists.click("msfs", () => false, async (o) => {
      boxes.push(o);
      return 0;
    }));
    await drive(t.clock, first);
    expect(t.lists.busy()).toBeNull();
    expect(appEntries(t.sims, "Store")).toBe(1);
    expect(t.sims.backupNames()).toHaveLength(1);
    expect(t.fs.callsOf("write").filter((c) => c === `write ${t.sims.tempFile("Store")}`)).toHaveLength(1);
    expect(boxes).toEqual([]);
  });

  // @spec DESK-START-MSFS-055, DESK-SHELL-LOG-003
  it("logs why a file cannot be read once each time that state starts, not at every read", async () => {
    const t = tray();
    const file = t.sims.exeFile("Store");
    const cantRead = () => t.lines.filter((l) => l.startsWith(`[start-lists] EXE.xml ${file} cannot be read: `));
    t.sims.install("Store").put("Store", fixture("malformed.xml"));
    await t.refresh();
    expect(cantRead()).toHaveLength(1);
    expect(cantRead()[0]).toMatch(/cannot be read: it does not parse as XML/);
    await t.refresh();
    await t.click(); // its read finds the same
    await t.refresh();
    expect(cantRead()).toHaveLength(1);
    t.sims.put("Store", fixture("real-six.xml"));
    await t.refresh();
    expect(cantRead()).toHaveLength(1);
    t.sims.put("Store", fixture("wrong-root.xml"));
    await t.refresh();
    expect(cantRead()).toHaveLength(2);
    // Gone, then unreadable again: a new start too.
    fs.rmSync(file);
    await t.refresh();
    t.sims.put("Store", fixture("malformed.xml"));
    await t.refresh();
    expect(cantRead()).toHaveLength(3);
  });

  // @spec DESK-START-MSFS-017, DESK-START-MSFS-051, DESK-START-MSFS-052, DESK-START-MSFS-053
  it("says another program removed the entry until the pilot clicks, never putting it back, logging it once each time", async () => {
    const t = tray();
    const file = t.sims.exeFile("Store");
    const removedLines = () => t.lines.filter((l) => l === `[start-lists] EXE.xml ${file} no longer holds the app's entry (removed by another program)`);
    t.sims.install("Store").put("Store", fixture("real-six.xml"));
    await t.refresh();
    await t.click();
    expect(t.settings.get().exeXmlFiles.map((f) => f.toLowerCase())).toEqual([file.toLowerCase()]);
    expect(t.label()).toBe(LABEL.plain);

    // Another add-on's installer rewrites the file without the entry.
    t.sims.put("Store", fixture("real-six.xml"));
    await t.refresh();
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.removed, enabled: true, checked: false });
    expect(removedLines()).toHaveLength(1);
    await t.refresh();
    await t.refresh();
    expect(removedLines()).toHaveLength(1);
    expect(appEntries(t.sims, "Store")).toBe(0);
    expect(t.fs.callsOf("rename")).toHaveLength(1); // only the pilot's first click wrote

    // The pilot clicks: the entry is written again and the record brought up to date.
    await t.click();
    expect(appEntries(t.sims, "Store")).toBe(1);
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.plain, enabled: true, checked: true });
    expect(t.settings.get().exeXmlFiles.map((f) => f.toLowerCase())).toEqual([file.toLowerCase()]);

    // Removed again: a new start of that state, logged again.
    t.sims.put("Store", fixture("real-six.xml"));
    await t.refresh();
    expect(removedLines()).toHaveLength(2);
  });

  // @spec DESK-START-MSFS-052, DESK-START-MSFS-017
  it("turning off empties the record, so the item never reads its own removal as another program's", async () => {
    const t = tray();
    t.sims.install("Store").install("Steam");
    await t.refresh();
    await t.click();
    expect(t.settings.get().exeXmlFiles).toHaveLength(2);
    await t.click();
    expect(t.settings.get().exeXmlFiles).toEqual([]);
    expect(t.lists.items()?.msfs).toEqual({ label: LABEL.plain, enabled: true, checked: false });
    // The record is in the settings file, as written.
    const onDisk = JSON.parse(fs.readFileSync(win.join(t.sims.electron, "settings.json"), "utf8")) as { exeXmlFiles: string[] };
    expect(onDisk.exeXmlFiles).toEqual([]);
  });

  // @spec DESK-START-MSFS-001, DESK-START-MSFS-051
  it("adds the entry only when the pilot turns it on: reads alone never write", async () => {
    const t = tray();
    t.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml"));
    for (let i = 0; i < 3; i++) await t.refresh();
    expect(t.fs.callsOf("write")).toEqual([]);
    expect(t.fs.callsOf("rename")).toEqual([]);
    expect(t.sims.exe("Steam")).toBeNull();
    expect(t.sims.backupNames()).toEqual([]);
  });
});
