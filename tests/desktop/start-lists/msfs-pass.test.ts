/**
 * The passes over the MSFS 2024 editions' folders (src/desktop/msfs-start.ts; m4 contract §4.1,
 * §4.3): the editions' folders (DESK-START-MSFS-002); turning Start with MSFS 2024 on — a new file
 * where none, a blank one replaced, an existing one changed, installed editions only — and off —
 * every EXE.xml present, never deleted; the backups in Electron's folder, five per edition; the
 * temporary file a change cut short left, deleted by every pass; the re-read before the rename, the
 * rename's retries; and the record of files last written, kept in an order a change cut short can
 * never turn into a false "removed by another program".
 *
 * Every test works on a temp account root (`Sims`) through a ScriptedFs, on a FakeClock whose wall
 * clock reads 2026-10-25T12:00:00Z, so a backup taken at once is named `…20261025T120000Z`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEntry, newExeXml, readExeXml, removeEntries, type Programs } from "../../../src/desktop/exe-xml.ts";
import {
  TEMP_NAME,
  editionFolders,
  turnMsfsOff,
  turnMsfsOn,
  unregisterMsfs,
  type FileOutcome,
  type PassPorts,
  type PassResult,
} from "../../../src/desktop/msfs-start.ts";
import { FakeClock } from "../support/clock.ts";
import { ScriptedFs, fsError } from "../support/fakes.ts";
import { Sims, TEST_PROGRAM, fixture, type Edition } from "./support/sims.ts";

const win = path.win32;
const PROGRAMS: Programs = { program: TEST_PROGRAM, earlier: [] };
const STAMP = "20261025T120000Z";

/** Bytes as a string that keeps every byte (latin1), for exact comparisons with readable diffs. */
const raw = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("latin1"));

/** A blank file: spaces, CR LF and a tab. */
const BLANK = Uint8Array.from(Buffer.from("  \r\n\t \r\n", "latin1"));

interface Harness {
  sims: Sims;
  fs: ScriptedFs;
  clock: FakeClock;
  lines: string[];
  /** The record as the pass last set it. */
  record(): string[];
  ports: PassPorts;
}

/** Ports for a pass on `sims`; every record.set is also written into fs.calls as `record <json>`, so its order against the file calls shows. */
function harness(sims = new Sims(), initialRecord: string[] = []): Harness {
  const scripted = new ScriptedFs();
  const clock = new FakeClock();
  const lines: string[] = [];
  let files = [...initialRecord];
  const ports: PassPorts = {
    fs: scripted,
    clock,
    programs: PROGRAMS,
    folders: editionFolders(sims.env),
    backupsFolder: sims.backups,
    record: {
      get: () => [...files],
      set: (next: string[]) => {
        files = [...next];
        scripted.calls.push(`record ${JSON.stringify(next)}`);
      },
    },
    log: (line) => lines.push(line),
  };
  return { sims, fs: scripted, clock, lines, record: () => [...files], ports };
}

/** Lets a pass run to its end, moving the FakeClock 50 ms at a time (for the rename's retries). */
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
  if (!settled) throw new Error(`the pass did not end within ${limitMs} ms`);
  if (failed) throw error;
  return value as T;
}

const on = (h: Harness, installed: Edition[]) => drive(h.clock, turnMsfsOn({ ...h.ports, installed }));
const off = (h: Harness) => drive(h.clock, turnMsfsOff(h.ports));

function outcomeOf(r: PassResult, file: string): FileOutcome | undefined {
  return r.outcomes.find((o) => o.file.toLowerCase() === file.toLowerCase());
}

/** The app's entries in a file as read now. */
function entriesIn(bytes: Uint8Array | null) {
  if (bytes === null) return null;
  const r = readExeXml(bytes, PROGRAMS);
  if (r.kind !== "read") throw new Error(`not readable: ${JSON.stringify(r)}`);
  return r.entries;
}

/** Index of the first call matching, failing the test when there is none. */
function at(calls: string[], prefix: string, from = 0): number {
  const i = calls.findIndex((c, k) => k >= from && c.startsWith(prefix));
  if (i < 0) throw new Error(`no call "${prefix}…" in:\n${calls.join("\n")}`);
  return i;
}

function backupPath(sims: Sims, name: string): string {
  return win.join(sims.backups, name);
}

describe("the editions' folders", () => {
  // @spec DESK-START-MSFS-002
  it("are the Store edition's LocalCache in Local and the Steam edition's folder in Roaming, Store first", () => {
    const sims = new Sims();
    expect(editionFolders(sims.env)).toEqual([
      { edition: "Store", folder: win.join(sims.local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache") },
      { edition: "Steam", folder: win.join(sims.roaming, "Microsoft Flight Simulator 2024") },
    ]);
    expect(TEMP_NAME).toBe("EXE.xml.msfs-career-map-tmp");
  });
});

describe("turning Start with MSFS 2024 on", () => {
  // @spec DESK-START-MSFS-007, DESK-START-MSFS-025, DESK-START-MSFS-038, DESK-START-MSFS-050
  it("writes a new EXE.xml where there is none, through the temporary file, re-read and renamed, and nothing else in the folder", async () => {
    const h = harness();
    h.sims.install("Store");
    const before = h.sims.folderNames("Store");
    const r = await on(h, ["Store"]);
    const exe = h.sims.exeFile("Store");
    const temp = h.sims.tempFile("Store");

    expect(outcomeOf(r, exe)).toEqual({ file: exe, kind: "written" });
    expect(raw(h.sims.exe("Store"))).toBe(raw(newExeXml(TEST_PROGRAM)));
    const calls = h.fs.calls;
    const w = at(calls, `write ${temp}`);
    const reread = at(calls, `read ${exe}`, w);
    at(calls, `rename ${temp} -> ${exe}`, reread);
    expect(h.sims.folderNames("Store")).toEqual([...before, "EXE.xml"].sort());
    // A new file has nothing to back up.
    expect(h.sims.backupNames()).toEqual([]);
  });

  // @spec DESK-START-MSFS-026, DESK-START-MSFS-029
  it("backs up a blank EXE.xml, then replaces it whole with a new file", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", BLANK);
    const r = await on(h, ["Store"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(raw(h.sims.exe("Store"))).toBe(raw(newExeXml(TEST_PROGRAM)));
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`]);
    expect(raw(new Uint8Array(fs.readFileSync(backupPath(h.sims, `EXE.xml.Store.${STAMP}`))))).toBe(raw(BLANK));
  });

  // @spec DESK-START-MSFS-026
  it("replaces an empty EXE.xml (0 bytes) the same way", async () => {
    const h = harness();
    h.sims.install("Steam").put("Steam", new Uint8Array(0));
    await on(h, ["Steam"]);
    expect(raw(h.sims.exe("Steam"))).toBe(raw(newExeXml(TEST_PROGRAM)));
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Steam.${STAMP}`]);
  });

  // @spec DESK-START-MSFS-007, DESK-START-MSFS-029, DESK-START-MSFS-032, DESK-START-MSFS-036
  it("adds the entry to an existing file as the editor makes it, after a backup of the bytes as they were", async () => {
    const h = harness();
    const original = fixture("real-six.xml");
    h.sims.install("Store").put("Store", original);
    const r = await on(h, ["Store"]);
    const edit = addEntry(original, PROGRAMS);
    if (edit.kind !== "changed") throw new Error("the fixture should need the entry");
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(raw(h.sims.exe("Store"))).toBe(raw(edit.bytes));
    expect(raw(new Uint8Array(fs.readFileSync(backupPath(h.sims, `EXE.xml.Store.${STAMP}`))))).toBe(raw(original));
    // The backup is taken before the temporary file is written.
    at(h.fs.calls, `write ${h.sims.tempFile("Store")}`, at(h.fs.calls, `write ${backupPath(h.sims, `EXE.xml.Store.${STAMP}`)}`));
  });

  // @spec DESK-START-MSFS-007, DESK-START-MSFS-003
  it("writes every edition installed, and no EXE.xml of an edition whose folder lacks UserCfg.opt", async () => {
    const h = harness();
    const steamBytes = fixture("real-six.xml");
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    h.sims.put("Steam", steamBytes); // a folder left behind: EXE.xml without UserCfg.opt
    const r = await on(h, ["Store"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind ?? "unchanged").toBe("unchanged");
    expect(raw(h.sims.exe("Steam"))).toBe(raw(steamBytes));
    expect(h.fs.calls.some((c) => c.startsWith(`write ${h.sims.tempFile("Steam")}`))).toBe(false);
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`]);
  });

  // @spec DESK-START-MSFS-007
  it("writes both editions when both are installed", async () => {
    const h = harness();
    h.sims.install("Store").install("Steam").put("Steam", fixture("minified.xml"));
    const r = await on(h, ["Store", "Steam"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind).toBe("written");
    expect(entriesIn(h.sims.exe("Store"))).toEqual([{ on: true, same: true }]);
    expect(entriesIn(h.sims.exe("Steam"))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-028, DESK-START-MSFS-052
  it("writes nothing and takes no backup for a file already holding the entry on and the same, and adds it to the record at once", async () => {
    const h = harness();
    const bytes = fixture("with-app.xml");
    h.sims.install("Store").put("Store", bytes);
    const r = await on(h, ["Store"]);
    const exe = h.sims.exeFile("Store");
    expect(outcomeOf(r, exe)).toEqual({ file: exe, kind: "unchanged" });
    expect(raw(h.sims.exe("Store"))).toBe(raw(bytes));
    expect(h.sims.backupNames()).toEqual([]);
    expect(h.fs.callsOf("write")).toEqual([]);
    expect(h.fs.callsOf("rename")).toEqual([]);
    expect(h.record().map((f) => f.toLowerCase())).toEqual([exe.toLowerCase()]);
  });

  // @spec DESK-START-MSFS-033
  it("rewrites an entry turned off in place", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("off-disabled.xml"));
    await on(h, ["Store"]);
    expect(entriesIn(h.sims.exe("Store"))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-027, DESK-START-MSFS-049
  it("leaves a file it refuses untouched and reports it, while the other edition's file is still changed", async () => {
    const h = harness();
    const bad = fixture("malformed.xml");
    h.sims.install("Store").install("Steam").put("Store", bad).put("Steam", fixture("real-six.xml"));
    const r = await on(h, ["Store", "Steam"]);
    const store = outcomeOf(r, h.sims.exeFile("Store"));
    expect(store?.kind).toBe("left");
    expect(store && "why" in store ? store.why : "").toMatch(/^it does not parse as XML/);
    expect(raw(h.sims.exe("Store"))).toBe(raw(bad));
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind).toBe("written");
    // Nothing is backed up for a file refused before its change begins.
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Steam.${STAMP}`]);
    expect(h.lines.some((l) => l.startsWith(`[start-lists] EXE.xml ${h.sims.exeFile("Store")} left as it was: it does not parse as XML`))).toBe(true);
  });

  // @spec DESK-START-MSFS-027
  it("refuses a file whose root is wrong, and one in UTF-16", async () => {
    const h = harness();
    const wrong = fixture("wrong-root.xml");
    const utf16 = fixture("real-six.xml", { encoding: "utf-16le", bom: true });
    h.sims.install("Store").install("Steam").put("Store", wrong).put("Steam", utf16);
    const r = await on(h, ["Store", "Steam"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))).toEqual({
      file: h.sims.exeFile("Store"),
      kind: "left",
      why: 'its root is not SimBase.Document with Type="Launch"',
    });
    expect(outcomeOf(r, h.sims.exeFile("Steam"))).toEqual({
      file: h.sims.exeFile("Steam"),
      kind: "left",
      why: "its encoding, UTF-16, is neither UTF-8 nor windows-1252",
    });
    expect(raw(h.sims.exe("Store"))).toBe(raw(wrong));
    expect(raw(h.sims.exe("Steam"))).toBe(raw(utf16));
  });

  // @spec DESK-START-MSFS-027
  it("reports a file it cannot open, and changes the other", async () => {
    const h = harness();
    h.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml")).put("Steam", fixture("real-six.xml"));
    h.fs.hook("read", h.sims.exeFile("Store"), () => {
      throw fsError("EACCES", "EACCES: permission denied");
    });
    const r = await on(h, ["Store", "Steam"]);
    const store = outcomeOf(r, h.sims.exeFile("Store"));
    expect(store?.kind).toBe("left");
    expect(store && "why" in store ? store.why : "").toMatch(/^it cannot be opened: .*EACCES/);
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind).toBe("written");
  });
});

describe("turning Start with MSFS 2024 off", () => {
  // @spec DESK-START-MSFS-008, DESK-START-MSFS-044, DESK-START-MSFS-036
  it("removes the app's entry from every EXE.xml present, an edition not installed included, as the editor removes it", async () => {
    const h = harness();
    const storeBytes = fixture("after-app.xml");
    const steamBytes = fixture("twice.xml");
    h.sims.install("Store").put("Store", storeBytes);
    h.sims.put("Steam", steamBytes); // its edition uninstalled, its folder left behind
    const r = await off(h);
    for (const [edition, before] of [
      ["Store", storeBytes],
      ["Steam", steamBytes],
    ] as const) {
      const edit = removeEntries(before, PROGRAMS);
      if (edit.kind !== "changed") throw new Error("the fixture should hold the entry");
      expect(outcomeOf(r, h.sims.exeFile(edition))?.kind).toBe("written");
      expect(raw(h.sims.exe(edition))).toBe(raw(edit.bytes));
    }
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Steam.${STAMP}`, `EXE.xml.Store.${STAMP}`]);
  });

  // @spec DESK-START-MSFS-046
  it("writes nothing and takes no backup for a blank file, one without the entry, or no file, and creates none", async () => {
    const h = harness();
    const plain = fixture("real-six.xml");
    h.sims.install("Store").install("Steam").put("Store", plain);
    const r = await off(h);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind ?? "unchanged").toBe("unchanged");
    expect(raw(h.sims.exe("Store"))).toBe(raw(plain));
    expect(h.sims.exe("Steam")).toBeNull();
    h.sims.put("Steam", BLANK);
    await off(h);
    expect(raw(h.sims.exe("Steam"))).toBe(raw(BLANK));
    expect(h.sims.backupNames()).toEqual([]);
    expect(h.fs.callsOf("write")).toEqual([]);
  });

  // @spec DESK-START-MSFS-047
  it("never deletes an EXE.xml, even when no entry is left in it", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", newExeXml(TEST_PROGRAM));
    await off(h);
    const left = h.sims.exe("Store");
    expect(left).not.toBeNull();
    expect(entriesIn(left)).toEqual([]);
    expect(h.fs.callsOf("remove").some((c) => c === `remove ${h.sims.exeFile("Store")}`)).toBe(false);
  });

  // @spec DESK-START-MSFS-027
  it("leaves a windows-1252 file that cannot hold the program's path as it was, with or without an entry of the app's", async () => {
    const program = "C:\\Users\\Пилот\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
    const h = harness();
    h.ports.programs = { program, earlier: [] };
    const bytes = fixture("real-six-1252.xml", { encoding: "windows-1252" });
    h.sims.install("Store").put("Store", bytes);
    const r = await off(h);
    expect(outcomeOf(r, h.sims.exeFile("Store"))).toEqual({
      file: h.sims.exeFile("Store"),
      kind: "left",
      why: "its encoding, windows-1252, cannot hold the program's path",
    });
    expect(raw(h.sims.exe("Store"))).toBe(raw(bytes));
  });
});

describe("the backups", () => {
  // @spec DESK-START-MSFS-029, DESK-START-MSFS-030
  it("keep the five newest of an edition by the time in the name, deleting only older ones of the app's own", async () => {
    const h = harness();
    fs.mkdirSync(h.sims.backups, { recursive: true });
    const old = [
      "EXE.xml.Store.20261020T080000Z",
      "EXE.xml.Store.20261021T080000Z",
      "EXE.xml.Store.20261022T080000Z",
      "EXE.xml.Store.20261023T080000Z",
      "EXE.xml.Store.20261023T080000Z-2",
      "EXE.xml.Store.20261024T080000Z",
    ];
    const foreign = ["notes.txt", "EXE.xml.Store.20261019T080000Z.keep", "EXE.xml.Steam.20261001T080000Z", "Run.20261001T080000Z.reg"];
    for (const name of [...old, ...foreign]) fs.writeFileSync(backupPath(h.sims, name), name);
    // Write times saying the opposite of the names: the names decide.
    for (const [i, name] of old.entries()) {
      const t = new Date(Date.UTC(2026, 9, 25) - i * 86_400_000);
      fs.utimesSync(backupPath(h.sims, name), t, t);
    }
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await on(h, ["Store"]);
    expect(h.sims.backupNames()).toEqual(
      [
        ...foreign,
        "EXE.xml.Store.20261022T080000Z",
        "EXE.xml.Store.20261023T080000Z",
        "EXE.xml.Store.20261023T080000Z-2",
        "EXE.xml.Store.20261024T080000Z",
        `EXE.xml.Store.${STAMP}`,
      ].sort(),
    );
  });

  // @spec DESK-START-MSFS-029
  it("name a second backup of the same edition within one second with -2", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await on(h, ["Store"]);
    await off(h);
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`, `EXE.xml.Store.${STAMP}-2`]);
  });

  // @spec DESK-START-MSFS-031, DESK-START-MSFS-050
  it("stop that file's change when the backup cannot be written, naming the backup and the reason", async () => {
    const h = harness();
    const bytes = fixture("real-six.xml");
    h.sims.install("Store").install("Steam").put("Store", bytes).put("Steam", fixture("real-six.xml"));
    const name = `EXE.xml.Store.${STAMP}`;
    h.fs.hook("write", name, () => {
      throw fsError("ENOSPC", "ENOSPC: no space left on device");
    });
    const r = await on(h, ["Store", "Steam"]);
    const store = outcomeOf(r, h.sims.exeFile("Store"));
    expect(store?.kind).toBe("left");
    expect(store && "why" in store ? store.why : "").toBe(
      `the backup ${backupPath(h.sims, name)} could not be written: ENOSPC: no space left on device`,
    );
    expect(raw(h.sims.exe("Store"))).toBe(raw(bytes));
    expect(fs.existsSync(h.sims.tempFile("Store"))).toBe(false);
    expect(h.record().some((f) => f.toLowerCase() === h.sims.exeFile("Store").toLowerCase())).toBe(false);
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind).toBe("written");
  });

  // @spec DESK-START-MSFS-031
  it("stop the change when the backups folder cannot be made", async () => {
    const h = harness();
    const bytes = fixture("real-six.xml");
    h.sims.install("Store").put("Store", bytes);
    h.fs.hook("mkdir", h.sims.backups, () => {
      throw fsError("EACCES", "EACCES: permission denied");
    });
    const r = await off(h); // nothing to remove: no backup, no mkdir needed
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind ?? "unchanged").toBe("unchanged");
    const r2 = await on(h, ["Store"]);
    const store = outcomeOf(r2, h.sims.exeFile("Store"));
    expect(store?.kind).toBe("left");
    expect(store && "why" in store ? store.why : "").toMatch(/^the backup .*EXE\.xml\.Store\.20261025T120000Z could not be written: EACCES/);
    expect(raw(h.sims.exe("Store"))).toBe(raw(bytes));
  });
});

describe("the temporary file a change cut short left", () => {
  function leaveTemps(sims: Sims): void {
    for (const e of ["Store", "Steam"] as const) {
      fs.mkdirSync(sims.folders[e], { recursive: true });
      fs.writeFileSync(sims.tempFile(e), "<half written");
    }
  }

  // @spec DESK-START-MSFS-043, DESK-START-MSFS-050
  it("is deleted from both folders by a turn-off that finds nothing to remove", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    leaveTemps(h.sims);
    await off(h);
    expect(h.sims.folderNames("Store")).toEqual(["EXE.xml", "UserCfg.opt"]);
    expect(h.sims.folderNames("Steam")).toEqual([]);
    expect(h.sims.backupNames()).toEqual([]);
  });

  // @spec DESK-START-MSFS-043
  it("is deleted by a turn-on that finds the entry already there", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("with-app.xml"));
    leaveTemps(h.sims);
    await on(h, ["Store"]);
    expect(fs.existsSync(h.sims.tempFile("Store"))).toBe(false);
    expect(fs.existsSync(h.sims.tempFile("Steam"))).toBe(false);
  });

  // @spec DESK-START-MSFS-043
  it("is deleted by --unregister's pass that finds nothing to remove", async () => {
    const h = harness();
    leaveTemps(h.sims);
    await drive(h.clock, unregisterMsfs(h.ports));
    expect(h.sims.folderNames("Store")).toEqual([]);
    expect(h.sims.folderNames("Steam")).toEqual([]);
  });

  // @spec DESK-START-MSFS-043
  it("is deleted before any EXE.xml is read", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    leaveTemps(h.sims);
    await on(h, ["Store"]);
    const removeTemp = at(h.fs.calls, `remove ${h.sims.tempFile("Steam")}`);
    expect(removeTemp).toBeLessThan(at(h.fs.calls, `read ${h.sims.exeFile("Store")}`));
  });
});

describe("the re-read before the rename", () => {
  const OTHER = fixture("minified.xml");

  // @spec DESK-START-MSFS-039
  it("starts the change again, with a fresh backup, when another program changed the file", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      if (n === 1) fs.writeFileSync(h.sims.exeFile("Store"), OTHER);
    });
    const r = await on(h, ["Store"]);
    const edit = addEntry(OTHER, PROGRAMS);
    if (edit.kind !== "changed") throw new Error("minified.xml should need the entry");
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(raw(h.sims.exe("Store"))).toBe(raw(edit.bytes));
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`, `EXE.xml.Store.${STAMP}-2`]);
    expect(raw(new Uint8Array(fs.readFileSync(backupPath(h.sims, `EXE.xml.Store.${STAMP}-2`))))).toBe(raw(OTHER));
  });

  // @spec DESK-START-MSFS-039, DESK-START-MSFS-026
  it("starts again from a blank file when another program emptied it", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      if (n === 1) fs.writeFileSync(h.sims.exeFile("Store"), "");
    });
    await on(h, ["Store"]);
    expect(raw(h.sims.exe("Store"))).toBe(raw(newExeXml(TEST_PROGRAM)));
  });

  // @spec DESK-START-MSFS-039, DESK-START-MSFS-025
  it("starts again with a new file when another program deleted it", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      if (n === 1) fs.rmSync(h.sims.exeFile("Store"));
    });
    await on(h, ["Store"]);
    expect(raw(h.sims.exe("Store"))).toBe(raw(newExeXml(TEST_PROGRAM)));
    // Only the first attempt had a file to back up.
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`]);
  });

  // @spec DESK-START-MSFS-039, DESK-START-MSFS-025
  it("starts again from the file another program created where there was none", async () => {
    const h = harness();
    h.sims.install("Store");
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      if (n === 1) fs.writeFileSync(h.sims.exeFile("Store"), OTHER);
    });
    await on(h, ["Store"]);
    const edit = addEntry(OTHER, PROGRAMS);
    if (edit.kind !== "changed") throw new Error("minified.xml should need the entry");
    expect(raw(h.sims.exe("Store"))).toBe(raw(edit.bytes));
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Store.${STAMP}`]);
  });

  // @spec DESK-START-MSFS-040
  it("gives up after the third difference, leaving the file as the other program left it and no temporary file", async () => {
    const h = harness();
    h.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml"));
    const versions: Uint8Array[] = [];
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      const v = fixture(n % 2 === 1 ? "minified.xml" : "real-six.xml", { eol: n % 2 === 1 ? "crlf" : "lf" });
      versions.push(v);
      fs.writeFileSync(h.sims.exeFile("Store"), v);
    });
    const r = await on(h, ["Store", "Steam"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))).toEqual({
      file: h.sims.exeFile("Store"),
      kind: "left",
      why: "another program is changing the file",
    });
    expect(h.fs.callsOf("write").filter((c) => c === `write ${h.sims.tempFile("Store")}`)).toHaveLength(3);
    expect(raw(h.sims.exe("Store"))).toBe(raw(versions.at(-1)!));
    expect(fs.existsSync(h.sims.tempFile("Store"))).toBe(false);
    expect(h.fs.callsOf("rename").some((c) => c.startsWith(`rename ${h.sims.tempFile("Store")}`))).toBe(false);
    // The other edition is still written.
    expect(outcomeOf(r, h.sims.exeFile("Steam"))?.kind).toBe("written");
  });

  // @spec DESK-START-MSFS-040, DESK-START-MSFS-039
  it("gives up after three differences when turning off too, the file kept out of the record", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml"));
    h.fs.hook("write", h.sims.tempFile("Store"), (n) => {
      fs.writeFileSync(h.sims.exeFile("Store"), fixture("after-app.xml", { eol: n % 2 === 1 ? "lf" : "crlf" }));
    });
    const r = await off(h);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("left");
    expect(h.record()).toEqual([]);
  });
});

describe("the rename", () => {
  // @spec DESK-START-MSFS-041
  it("is tried again every 250 ms while Windows reports the file busy, and then succeeds", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    const times: number[] = [];
    h.fs.hook("rename", h.sims.tempFile("Store"), (n) => {
      times.push(h.clock.now());
      if (n <= 3) throw fsError(n === 2 ? "EPERM" : "EBUSY");
    });
    const r = await on(h, ["Store"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("written");
    expect(times).toHaveLength(4);
    expect(times.slice(1).map((t, i) => t - times[i])).toEqual([250, 250, 250]);
    expect(entriesIn(h.sims.exe("Store"))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-041, DESK-START-MSFS-042
  it("gives up after 3 s of busy, deleting the temporary file, leaving EXE.xml as it was and naming the error", async () => {
    const h = harness();
    const bytes = fixture("real-six.xml");
    h.sims.install("Store").put("Store", bytes);
    const times: number[] = [];
    h.fs.hook("rename", h.sims.tempFile("Store"), () => {
      times.push(h.clock.now());
      throw fsError("EBUSY", "EBUSY: resource busy or locked");
    });
    const r = await on(h, ["Store"]);
    const store = outcomeOf(r, h.sims.exeFile("Store"));
    expect(store?.kind).toBe("left");
    expect(store && "why" in store ? store.why : "").toMatch(/^Windows would not replace it: EBUSY/);
    expect(times).toHaveLength(13);
    expect(times.at(-1)! - times[0]).toBe(3000);
    expect(raw(h.sims.exe("Store"))).toBe(raw(bytes));
    expect(fs.existsSync(h.sims.tempFile("Store"))).toBe(false);
    expect(h.record()).toEqual([]);
  });

  // @spec DESK-START-MSFS-042
  it("leaves no file where there was none when a new file's rename fails", async () => {
    const h = harness();
    h.sims.install("Store");
    h.fs.hook("rename", h.sims.tempFile("Store"), () => {
      throw fsError("EACCES");
    });
    const r = await on(h, ["Store"]);
    expect(outcomeOf(r, h.sims.exeFile("Store"))?.kind).toBe("left");
    expect(h.sims.folderNames("Store")).toEqual(["UserCfg.opt"]);
  });

  // @spec DESK-START-MSFS-042
  it("is not tried again for another error", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    let tries = 0;
    h.fs.hook("rename", h.sims.tempFile("Store"), () => {
      tries++;
      throw fsError("EIO", "EIO: i/o error");
    });
    const r = await on(h, ["Store"]);
    const store = outcomeOf(r, h.sims.exeFile("Store"));
    expect(tries).toBe(1);
    expect(store && "why" in store ? store.why : "").toMatch(/^Windows would not replace it: EIO/);
  });
});

describe("the record of files last written", () => {
  // @spec DESK-START-MSFS-052
  it("gains a file only once its rename has succeeded", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await on(h, ["Store"]);
    const exe = h.sims.exeFile("Store");
    const renamed = at(h.fs.calls, `rename ${h.sims.tempFile("Store")} -> ${exe}`);
    const recorded = h.fs.calls.findIndex((c) => c.startsWith("record ") && c.toLowerCase().includes(JSON.stringify(exe).slice(1, -1).toLowerCase()));
    expect(recorded).toBeGreaterThan(renamed);
    expect(h.record().map((f) => f.toLowerCase())).toEqual([exe.toLowerCase()]);
  });

  // @spec DESK-START-MSFS-052
  it("does not gain a file whose change was cut short at the rename", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    h.fs.hook("rename", h.sims.tempFile("Store"), () => {
      throw fsError("EIO");
    });
    await on(h, ["Store"]);
    expect(h.record()).toEqual([]);
  });

  // @spec DESK-START-MSFS-052
  it("loses a file before its entry is removed, so a turn-off cut short never reads as another program's removal", async () => {
    for (const cut of ["write", "rename"] as const) {
      const sims = new Sims();
      const h = harness(sims, [sims.exeFile("Store")]);
      h.sims.install("Store").put("Store", fixture("after-app.xml"));
      const events: string[] = [];
      h.fs.hook(cut, h.sims.tempFile("Store"), () => {
        events.push(`cut with record ${JSON.stringify(h.record())}`);
        throw fsError("EIO");
      });
      await off(h);
      expect(events).toEqual(["cut with record []"]);
      // The entry is still there, and the record no longer names the file.
      expect(entriesIn(h.sims.exe("Store"))).toEqual([{ on: true, same: true }]);
      expect(h.record()).toEqual([]);
    }
  });

  // @spec DESK-START-MSFS-052
  it("takes the file out of the record after its backup and before its temporary file", async () => {
    const h = harness(new Sims());
    h.ports.record.set([h.sims.exeFile("Store")]);
    h.fs.calls.length = 0;
    h.sims.install("Store").put("Store", fixture("after-app.xml"));
    await off(h);
    const backup = at(h.fs.calls, `write ${backupPath(h.sims, `EXE.xml.Store.${STAMP}`)}`);
    const recorded = at(h.fs.calls, "record []");
    const temp = at(h.fs.calls, `write ${h.sims.tempFile("Store")}`);
    expect(backup).toBeLessThan(recorded);
    expect(recorded).toBeLessThan(temp);
  });

  // @spec DESK-START-MSFS-052
  it("is empty once a turn-off is done, whatever it named", async () => {
    const h = harness(new Sims(), ["X:\\Elsewhere\\EXE.xml"]);
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    await off(h);
    expect(h.record()).toEqual([]);
  });

  // @spec DESK-START-MSFS-052
  it("keeps, once a turn-on is done, only the files holding an entry of the app's turned on", async () => {
    const sims = new Sims();
    const gone = win.join(sims.root, "Gone", "EXE.xml");
    const h = harness(sims, [gone]);
    h.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml")).put("Steam", fixture("malformed.xml"));
    await on(h, ["Store", "Steam"]);
    expect(h.record().map((f) => f.toLowerCase())).toEqual([h.sims.exeFile("Store").toLowerCase()]);
  });

  // @spec DESK-START-UNREG-007
  it("loses each file before --unregister removes its entry", async () => {
    const sims = new Sims();
    const h = harness(sims, [sims.exeFile("Store"), sims.exeFile("Steam")]);
    h.sims.install("Store").put("Store", fixture("after-app.xml")).put("Steam", fixture("twice.xml"));
    await drive(h.clock, unregisterMsfs(h.ports));
    const storeOut = at(h.fs.calls, "record ");
    expect(storeOut).toBeLessThan(at(h.fs.calls, `write ${h.sims.tempFile("Store")}`));
    expect(h.record()).toEqual([]);
    expect(entriesIn(h.sims.exe("Store"))).toEqual([]);
    expect(entriesIn(h.sims.exe("Steam"))).toEqual([]);
  });
});

describe("the sim's folders", () => {
  // @spec DESK-START-MSFS-050
  it("only ever gain or lose EXE.xml's entry: no other file is left or changed there by a turn-on and a turn-off", async () => {
    const h = harness();
    h.sims.install("Store").install("Steam").put("Store", fixture("real-six.xml"));
    fs.writeFileSync(win.join(h.sims.folders.Store, "Other.cfg"), "keep");
    const userCfg = fs.readFileSync(win.join(h.sims.folders.Store, "UserCfg.opt"));
    const store = h.sims.folderNames("Store");
    await on(h, ["Store", "Steam"]);
    await off(h);
    expect(h.sims.folderNames("Store")).toEqual(store);
    expect(h.sims.folderNames("Steam")).toEqual(["EXE.xml", "UserCfg.opt"]);
    expect(fs.readFileSync(win.join(h.sims.folders.Store, "UserCfg.opt")).equals(userCfg)).toBe(true);
    expect(fs.readFileSync(win.join(h.sims.folders.Store, "Other.cfg"), "utf8")).toBe("keep");
    // Every backup is in Electron's folder, none beside EXE.xml.
    expect(h.sims.backupNames().length).toBeGreaterThan(0);
  });
});
