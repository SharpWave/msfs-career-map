/**
 * The install-under-way mark as a start of the app sees it (src/desktop/install-mark.ts; m3 contract
 * §5): the mark's form — UTF-16LE, one record per line, `process`, `request` and `start` records,
 * unknown lines passed over (DESK-DIST-INST-025, distribution-design's The mark's form); an install
 * counted as under way only while a process the mark names, or an installer in electron-updater's
 * download folder, runs (DESK-DIST-INST-030); and the start's own check: its command line appended to
 * the mark, never creating it, then a second look, so it either exits with its line left for the
 * installer or, the mark taken up meanwhile, starts as usual (DESK-SHELL-CLI-020).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOWNLOADS_NAME,
  MARK_NAME,
  appendRequestNone,
  checkInstallUnderWay,
  downloadsFolder,
  installUnderWay,
  leftInMarkLogLine,
  markLine,
  markPath,
  nodeMarkFiles,
  parseMark,
  startsIn,
  takeUpMark,
  writeMark,
  type MarkFiles,
  type MarkRecord,
} from "../../../src/desktop/install-mark.ts";
import { FakeFacts, FakeMarkFiles as MemoryMarkFiles, tempFolder } from "../support/fakes.ts";
import { takeGuardHits } from "../support/guard.ts";

const LOCAL = "C:\\Users\\pilot\\AppData\\Local";
const DOWNLOADS = "C:\\Users\\pilot\\AppData\\Local\\msfs-career-map-updater";
const MARK = "C:\\Users\\pilot\\AppData\\Local\\msfs-career-map-updater\\install-under-way";
const SHELL_EXE = "C:\\Users\\pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
const INSTALLER = "C:\\Users\\pilot\\AppData\\Local\\msfs-career-map-updater\\pending\\MSFS Career Map Setup 0.9.0.exe";
const HAND_INSTALLER = "C:\\Users\\pilot\\Downloads\\MSFS Career Map Setup 0.9.0.exe";

const BOM = [0xff, 0xfe];
const utf16 = (text: string): number[] => [...Buffer.from(text, "utf16le")];
/** A whole mark as its writer leaves it: a byte-order mark, then each line ending CR LF. */
const markOf = (...lines: string[]): Uint8Array => new Uint8Array([...BOM, ...utf16(lines.map((l) => `${l}\r\n`).join(""))]);

/** The mark's file in memory, with hooks that act between the start's steps. */
class FakeMarkFiles implements Pick<MarkFiles, "read" | "append"> {
  files = new Map<string, Uint8Array>();
  /** "read <file>", "append <file>" in order. */
  calls: string[] = [];
  /** Runs just before an append reaches the file (the mark taken up between the look and the append). */
  beforeAppend: (() => void) | null = null;
  /** Runs just after an append (the mark taken up after the line was added). */
  afterAppend: (() => void) | null = null;

  read(file: string): Uint8Array | null {
    this.calls.push(`read ${file}`);
    return this.files.get(file) ?? null;
  }
  append(file: string, bytes: Uint8Array): boolean {
    this.calls.push(`append ${file}`);
    this.beforeAppend?.();
    const had = this.files.get(file);
    if (!had) return false;
    this.files.set(file, new Uint8Array([...had, ...bytes]));
    this.afterAppend?.();
    return true;
  }
}

/** Facts with `processesIn` answering per folder. */
function facts(o: { programs?: [number, string | null][]; inFolder?: [string, number[]][] } = {}): FakeFacts {
  const f = new FakeFacts();
  for (const [pid, p] of o.programs ?? []) f.programs.set(pid, p);
  for (const [folder, pids] of o.inFolder ?? []) f.inFolder.set(folder, pids);
  return f;
}

describe("loading the module", () => {
  // @spec DESK-SHELL-TEST-001
  it("reaches no process, port or Electron", () => {
    expect(takeGuardHits()).toEqual([]);
  });
});

describe("where the mark lives", () => {
  // @spec DESK-DIST-INST-025
  it("is install-under-way in electron-updater's download folder, outside the install folder", () => {
    expect(MARK_NAME).toBe("install-under-way");
    expect(DOWNLOADS_NAME).toBe("msfs-career-map-updater");
    expect(downloadsFolder(LOCAL)).toBe(DOWNLOADS);
    expect(markPath(LOCAL)).toBe(MARK);
  });
});

describe("the mark's form", () => {
  // @spec DESK-DIST-INST-025
  it("reads each kind of record from UTF-16LE lines after a byte-order mark", () => {
    const mark = markOf(
      `process 4242 ${SHELL_EXE}`,
      "request --background",
      `process 977 ${INSTALLER}`,
      "start ",
      "start --updated",
      "request none",
    );
    expect(parseMark(mark)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 4242, program: SHELL_EXE },
      { kind: "request", start: "--background" },
      { kind: "process", pid: 977, program: INSTALLER },
      { kind: "start", switches: "" },
      { kind: "start", switches: "--updated" },
      { kind: "request", start: "none" },
    ]);
  });

  // @spec DESK-DIST-INST-025
  it("reads LF line ends, a mark without a byte-order mark and a last line without an end", () => {
    const text = `process 12 ${SHELL_EXE}\nrequest --updated\nstart --background`;
    expect(parseMark(new Uint8Array(utf16(text)))).toEqual<MarkRecord[]>([
      { kind: "process", pid: 12, program: SHELL_EXE },
      { kind: "request", start: "--updated" },
      { kind: "start", switches: "--background" },
    ]);
  });

  // @spec DESK-DIST-INST-025
  it("passes over lines it does not know, so a later release can add records", () => {
    const mark = markOf(
      "note from a later release",
      "process notanumber C:\\x.exe",
      "process 15",
      "request later",
      "",
      "start --quit",
      "request --updated",
    );
    expect(parseMark(mark)).toEqual<MarkRecord[]>([{ kind: "request", start: "--updated" }]);
  });

  // @spec DESK-DIST-INST-025
  it("keeps a program path with spaces and characters outside any code page whole", () => {
    const program = "C:\\Users\\Jürgen Ødegård 李\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
    expect(parseMark(markOf(`process 7 ${program}`))).toEqual<MarkRecord[]>([{ kind: "process", pid: 7, program }]);
  });

  // @spec DESK-DIST-INST-025
  it("writes one record as one UTF-16LE line ending CR LF, with no byte-order mark", () => {
    expect([...markLine({ kind: "process", pid: 42, program: "C:\\x y\\a.exe" })]).toEqual(utf16("process 42 C:\\x y\\a.exe\r\n"));
    expect([...markLine({ kind: "request", start: "none" })]).toEqual(utf16("request none\r\n"));
    expect([...markLine({ kind: "start", switches: "" })]).toEqual(utf16("start \r\n"));
    expect([...markLine({ kind: "start", switches: "--background" })]).toEqual(utf16("start --background\r\n"));
  });

  // @spec DESK-DIST-INST-025
  it("reads back what it writes, appended after a mark written whole", () => {
    const records: MarkRecord[] = [
      { kind: "start", switches: "--updated" },
      { kind: "start", switches: "" },
    ];
    const whole = markOf(`process 5 ${SHELL_EXE}`, "request --background");
    const appended = new Uint8Array([...whole, ...records.flatMap((r) => [...markLine(r)])]);
    expect(parseMark(appended)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 5, program: SHELL_EXE },
      { kind: "request", start: "--background" },
      ...records,
    ]);
  });
});

describe("an install under way", () => {
  // @spec DESK-DIST-INST-030
  it("is under way while a process the mark names runs that program, compared ignoring case", async () => {
    const records = parseMark(markOf(`process 4242 ${SHELL_EXE}`));
    const f = facts({ programs: [[4242, SHELL_EXE.toUpperCase()]] });
    expect(await installUnderWay(records, f, DOWNLOADS)).toBe(true);
  });

  // @spec DESK-DIST-INST-030
  it("is under way while an installer started from the download folder runs, named in the mark or not", async () => {
    const records = parseMark(markOf(`process 4242 ${SHELL_EXE}`));
    const f = facts({ inFolder: [[DOWNLOADS, [977]]] });
    expect(await installUnderWay(records, f, DOWNLOADS)).toBe(true);
  });

  // @spec DESK-DIST-INST-030
  it("is not under way when the named processes are gone (a mark left by an install cut off)", async () => {
    const records = parseMark(markOf(`process 4242 ${SHELL_EXE}`, `process 977 ${HAND_INSTALLER}`, "request --updated"));
    expect(await installUnderWay(records, facts(), DOWNLOADS)).toBe(false);
  });

  // @spec DESK-DIST-INST-030
  it("is not under way when a named id now runs another program", async () => {
    const records = parseMark(markOf(`process 4242 ${SHELL_EXE}`));
    const f = facts({ programs: [[4242, "C:\\Windows\\System32\\notepad.exe"]] });
    expect(await installUnderWay(records, f, DOWNLOADS)).toBe(false);
  });
});

describe("a start that finds a mark", () => {
  const files = (mark: Uint8Array | null) => {
    const m = new FakeMarkFiles();
    if (mark) m.files.set(MARK, mark);
    return m;
  };

  // @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
  it("starts as usual when there is no mark, asking Windows nothing", async () => {
    const m = files(null);
    const f = facts();
    expect(await checkInstallUnderWay({ localAppData: LOCAL, switches: "--background", files: m, facts: f })).toBe("go");
    expect(m.calls).toEqual([`read ${MARK}`]);
    expect(f.calls).toEqual([]);
  });

  // @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
  it("starts as usual, adding nothing, when the mark names nothing still running", async () => {
    const before = markOf(`process 4242 ${SHELL_EXE}`, "request --updated");
    const m = files(before);
    expect(await checkInstallUnderWay({ localAppData: LOCAL, switches: "", files: m, facts: facts() })).toBe("go");
    expect(m.calls.filter((c) => c.startsWith("append"))).toEqual([]);
    expect(m.files.get(MARK)).toEqual(before);
  });

  // @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
  it("adds its command line to the mark and, the mark still there, is left in it", async () => {
    const before = markOf(`process 977 ${INSTALLER}`);
    const m = files(before);
    const f = facts({ programs: [[977, INSTALLER]] });
    expect(await checkInstallUnderWay({ localAppData: LOCAL, switches: "--background", files: m, facts: f })).toBe("left-in-mark");
    expect(m.calls).toEqual([`read ${MARK}`, `append ${MARK}`, `read ${MARK}`]);
    expect(parseMark(m.files.get(MARK)!)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 977, program: INSTALLER },
      { kind: "start", switches: "--background" },
    ]);
  });

  // @spec DESK-SHELL-CLI-020
  it("records a start with no switch, and one with --updated, as their own command lines", async () => {
    for (const switches of ["", "--updated"] as const) {
      const m = files(markOf(`process 977 ${INSTALLER}`));
      const f = facts({ programs: [[977, INSTALLER]] });
      expect(await checkInstallUnderWay({ localAppData: LOCAL, switches, files: m, facts: f })).toBe("left-in-mark");
      expect(parseMark(m.files.get(MARK)!).at(-1)).toEqual({ kind: "start", switches });
    }
  });

  // @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
  it("starts as usual when the mark is taken up before its line could be added, creating none", async () => {
    const m = files(markOf(`process 977 ${INSTALLER}`));
    m.beforeAppend = () => m.files.delete(MARK);
    const f = facts({ programs: [[977, INSTALLER]] });
    expect(await checkInstallUnderWay({ localAppData: LOCAL, switches: "", files: m, facts: f })).toBe("go");
    expect(m.files.has(MARK)).toBe(false);
  });

  // @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
  it("starts as usual when the mark is taken up just after its line was added (its second look)", async () => {
    const m = files(markOf(`process 977 ${INSTALLER}`));
    m.afterAppend = () => m.files.delete(MARK);
    const f = facts({ inFolder: [[DOWNLOADS, [977]]] });
    expect(await checkInstallUnderWay({ localAppData: LOCAL, switches: "--updated", files: m, facts: f })).toBe("go");
  });

  // @spec DESK-SHELL-CLI-020, DESK-SHELL-LOG-003
  it("has a desktop.log line naming the start it left in the mark", () => {
    expect(leftInMarkLogLine("")).toBe("Start (no switch) left in the install-under-way mark for the installer");
    expect(leftInMarkLogLine("--background")).toBe("Start (--background) left in the install-under-way mark for the installer");
  });
});

describe("the mark's file on disk", () => {
  let folder: string | null = null;
  afterEach(() => {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  // @spec DESK-DIST-INST-030
  it("is appended to, never created, and read back whole", () => {
    folder = tempFolder("mark-");
    const file = path.join(folder, MARK_NAME);
    expect(nodeMarkFiles.read(file)).toBeNull();
    expect(nodeMarkFiles.append(file, markLine({ kind: "start", switches: "" }))).toBe(false);
    expect(fs.existsSync(file)).toBe(false);

    const whole = markOf(`process 1 ${SHELL_EXE}`);
    fs.writeFileSync(file, whole);
    expect(nodeMarkFiles.append(file, markLine({ kind: "start", switches: "--background" }))).toBe(true);
    expect(parseMark(nodeMarkFiles.read(file)!)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 1, program: SHELL_EXE },
      { kind: "start", switches: "--background" },
    ]);
  });
});

describe("the mark the desktop shell writes and takes up", () => {
  let folder: string | null = null;
  afterEach(() => {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  /** A temp folder standing in for %LOCALAPPDATA%, with no download folder yet. */
  function local(): string {
    folder = tempFolder("mark-shell-");
    return folder;
  }

  // @spec DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("writes the mark whole before the handover — a byte-order mark, its process and the start it asks for — making the download folder", () => {
    const localAppData = local();
    writeMark(nodeMarkFiles, localAppData, { pid: 7300, program: SHELL_EXE, start: "--updated" });
    const file = markPath(localAppData);
    expect(path.dirname(file)).toBe(downloadsFolder(localAppData));
    expect(new Uint8Array(fs.readFileSync(file))).toEqual(markOf(`process 7300 ${SHELL_EXE}`, "request --updated"));
    expect(parseMark(nodeMarkFiles.read(file)!)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 7300, program: SHELL_EXE },
      { kind: "request", start: "--updated" },
    ]);
  });

  // @spec DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("asks for --background after a quiet moment and for no start after a Quit, replacing a mark left before", () => {
    const localAppData = local();
    writeMark(nodeMarkFiles, localAppData, { pid: 1, program: SHELL_EXE, start: "--background" });
    expect(parseMark(nodeMarkFiles.read(markPath(localAppData))!)).toContainEqual({ kind: "request", start: "--background" });
    writeMark(nodeMarkFiles, localAppData, { pid: 2, program: SHELL_EXE, start: "none" });
    expect(parseMark(nodeMarkFiles.read(markPath(localAppData))!)).toEqual<MarkRecord[]>([
      { kind: "process", pid: 2, program: SHELL_EXE },
      { kind: "request", start: "none" },
    ]);
  });

  // @spec DESK-SHELL-UPD-031, DESK-SHELL-QUIT-011, DESK-DIST-INST-025
  it("appends a requested start of none for a Quit held after the mark was written, never creating the mark", () => {
    const localAppData = local();
    expect(appendRequestNone(nodeMarkFiles, localAppData)).toBe(false);
    expect(fs.existsSync(markPath(localAppData))).toBe(false);

    writeMark(nodeMarkFiles, localAppData, { pid: 7300, program: SHELL_EXE, start: "--background" });
    expect(appendRequestNone(nodeMarkFiles, localAppData)).toBe(true);
    expect(new Uint8Array(fs.readFileSync(markPath(localAppData)))).toEqual(
      markOf(`process 7300 ${SHELL_EXE}`, "request --background", "request none"),
    );
  });

  // @spec DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("takes the mark up by renaming it aside, reading and deleting the renamed file", () => {
    const localAppData = local();
    writeMark(nodeMarkFiles, localAppData, { pid: 7300, program: SHELL_EXE, start: "--updated" });
    nodeMarkFiles.append(markPath(localAppData), markLine({ kind: "start", switches: "--background" }));

    const records = takeUpMark(nodeMarkFiles, localAppData, 7300);
    expect(records).toEqual<MarkRecord[]>([
      { kind: "process", pid: 7300, program: SHELL_EXE },
      { kind: "request", start: "--updated" },
      { kind: "start", switches: "--background" },
    ]);
    expect(fs.readdirSync(downloadsFolder(localAppData))).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-031, DESK-DIST-INST-025
  it("renames before it reads, to <mark>.<pid>.taken, and deletes that file", () => {
    const files = new MemoryMarkFiles();
    const mark = markPath(LOCAL);
    files.write(mark, markOf(`process 7300 ${SHELL_EXE}`, "request none"));
    files.calls = [];
    takeUpMark(files, LOCAL, 7300);
    const taken = `${mark}.7300.taken`;
    expect(files.calls).toEqual([`rename ${mark} -> ${taken}`, `read ${taken}`, `remove ${taken}`]);
    expect(files.has(mark)).toBe(false);
    expect(files.has(taken)).toBe(false);
  });

  // @spec DESK-SHELL-UPD-031
  it("finds nothing to take up when there is no mark, creating nothing", () => {
    const localAppData = local();
    expect(takeUpMark(nodeMarkFiles, localAppData, 7300)).toEqual([]);
    expect(fs.existsSync(downloadsFolder(localAppData))).toBe(false);
  });

  // @spec DESK-SHELL-UPD-031, DESK-DIST-INST-030
  it("gives each start record's command line in order, the process and request records left out", () => {
    const records: MarkRecord[] = [
      { kind: "process", pid: 7300, program: SHELL_EXE },
      { kind: "request", start: "--background" },
      { kind: "start", switches: "--background" },
      { kind: "start", switches: "" },
      { kind: "request", start: "none" },
      { kind: "start", switches: "--updated" },
    ];
    expect(startsIn(records)).toEqual(["--background", "", "--updated"]);
    expect(startsIn([])).toEqual([]);
  });
});
