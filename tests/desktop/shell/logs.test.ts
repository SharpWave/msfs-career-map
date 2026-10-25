/**
 * The desktop shell's logs (src/desktop/logs.ts; m2 contract §6): `server.log` and `desktop.log`
 * with each line time-stamped (DESK-SHELL-LOG-001); renamed `<name>.old.log` once the running size
 * passes 5 MB (LOG-004); the server's output split at line breaks with a partial line held to the
 * next chunk or the exit (LOG-005), a line over 16 KB cut and ended with "…" (LOG-006); lines that
 * cannot be written dropped, counted and reported once writing works again (LOG-007).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_LIMIT, LOG_LIMIT_BYTES, LineSplitter, LogFile, type LogFs } from "../../../src/desktop/logs.ts";
import { FakeClock } from "../support/clock.ts";
import { tempFolder } from "../support/fakes.ts";

const LIMIT = 5 * 1024 * 1024;
const STAMP = "2026-10-25T12:00:00.000Z";
/** A stamped line's bytes beyond its text: the stamp, a space and the line break. */
const OVERHEAD = STAMP.length + 2;

const sizeOf = (file: string) => (fs.existsSync(file) ? fs.statSync(file).size : 0);

function splitter(): { lines: string[]; s: LineSplitter } {
  const lines: string[] = [];
  return { lines, s: new LineSplitter((line) => lines.push(line)) };
}

describe("writing a log", () => {
  // @spec DESK-SHELL-LOG-001
  it("stamps each line with the system clock's ISO time", async () => {
    const folder = path.join(tempFolder(), "logs");
    const clock = new FakeClock();
    const log = new LogFile({ folder, name: "desktop", clock });
    log.write("[shell] hello");
    await clock.advance(1500);
    log.write("second");
    clock.setWall("2026-11-01T08:30:00.000Z");
    log.write("third");
    expect(fs.readFileSync(path.join(folder, "desktop.log"), "utf8")).toBe(
      `${STAMP} [shell] hello\n2026-10-25T12:00:01.500Z second\n2026-11-01T08:30:00.000Z third\n`,
    );
  });

  // @spec DESK-SHELL-LOG-001
  it("writes a text with line breaks as one stamped line per line, to <name>.log", () => {
    const folder = tempFolder();
    const log = new LogFile({ folder, name: "server", clock: new FakeClock() });
    log.write("[server] Windows' excluded port ranges:\nStart Port    End Port\n     13508       13508");
    expect(fs.readFileSync(path.join(folder, "server.log"), "utf8")).toBe(
      `${STAMP} [server] Windows' excluded port ranges:\n${STAMP} Start Port    End Port\n${STAMP}      13508       13508\n`,
    );
    expect(fs.existsSync(path.join(folder, "desktop.log"))).toBe(false);
  });

  // @spec DESK-SHELL-LOG-004, DESK-SHELL-LOG-006
  it("names its limits: 5 MB a log, 16 KB a line", () => {
    expect(LOG_LIMIT_BYTES).toBe(5 * 1024 * 1024);
    expect(LINE_LIMIT).toBe(16 * 1024);
  });
});

describe("rotation", () => {
  // @spec DESK-SHELL-LOG-004
  it("starts from the file's size and renames it <name>.old.log once a write leaves it above 5 MB", () => {
    const folder = tempFolder();
    const file = path.join(folder, "server.log");
    const old = path.join(folder, "server.old.log");
    fs.writeFileSync(file, "x".repeat(LIMIT - 100));
    const log = new LogFile({ folder, name: "server", clock: new FakeClock() });

    log.write("a".repeat(100 - OVERHEAD)); // exactly 5 MB: not above
    expect(sizeOf(file)).toBe(LIMIT);
    expect(fs.existsSync(old)).toBe(false);

    log.write("b"); // above: renamed with this line in it
    expect(sizeOf(old)).toBe(LIMIT + OVERHEAD + 1);
    expect(fs.readFileSync(old, "utf8").endsWith(`${STAMP} b\n`)).toBe(true);
    expect(sizeOf(file)).toBe(0);

    log.write("c"); // the count started again at 0
    expect(fs.readFileSync(file, "utf8")).toBe(`${STAMP} c\n`);
    expect(sizeOf(old)).toBe(LIMIT + OVERHEAD + 1);
  });

  // @spec DESK-SHELL-LOG-004
  it("goes by its running count, not by re-reading the file", () => {
    const folder = tempFolder();
    const file = path.join(folder, "desktop.log");
    const old = path.join(folder, "desktop.old.log");
    fs.writeFileSync(file, "x".repeat(LIMIT - 100));
    const log = new LogFile({ folder, name: "desktop", clock: new FakeClock() });
    log.write("a".repeat(50 - OVERHEAD)); // the running count: 5 MB less 50 bytes
    fs.writeFileSync(file, ""); // emptied behind its back
    log.write("z".repeat(30)); // the running count passes 5 MB
    expect(fs.readFileSync(old, "utf8")).toBe(`${STAMP} ${"z".repeat(30)}\n`);
    expect(sizeOf(file)).toBe(0);
  });

  // @spec DESK-SHELL-LOG-004
  it("counts each line's UTF-8 bytes, not its characters", () => {
    const folder = tempFolder();
    const file = path.join(folder, "server.log");
    const old = path.join(folder, "server.old.log");
    fs.writeFileSync(file, "x".repeat(LIMIT - 100));
    const log = new LogFile({ folder, name: "server", clock: new FakeClock() });
    log.write("é".repeat(40)); // 40 characters but 80 bytes: 106 bytes in all, above 5 MB
    expect(sizeOf(old)).toBe(LIMIT + 6);
    expect(sizeOf(file)).toBe(0);
  });

  // @spec DESK-SHELL-LOG-004
  it("replaces the previous .old.log at the next rotation", () => {
    const folder = tempFolder();
    const file = path.join(folder, "server.log");
    const old = path.join(folder, "server.old.log");
    fs.writeFileSync(file, "x".repeat(LIMIT - 10));
    const first = new LogFile({ folder, name: "server", clock: new FakeClock() });
    first.write("first rotation");
    const firstOld = fs.readFileSync(old, "utf8");
    expect(firstOld.startsWith("xxxx")).toBe(true);
    expect(firstOld.endsWith(`${STAMP} first rotation\n`)).toBe(true);

    // The next run finds a log just under the limit again and rotates it over the first .old.log.
    fs.writeFileSync(file, "w".repeat(LIMIT - 10));
    const second = new LogFile({ folder, name: "server", clock: new FakeClock() });
    second.write("second rotation");
    const secondOld = fs.readFileSync(old, "utf8");
    expect(secondOld).toBe(`${"w".repeat(LIMIT - 10)}${STAMP} second rotation\n`);
    expect(sizeOf(file)).toBe(0);
  });
});

describe("splitting the server's output", () => {
  // @spec DESK-SHELL-LOG-005
  it("ends lines at \\n across chunks, holding a partial line to the next chunk", () => {
    const { lines, s } = splitter();
    s.push("abc");
    expect(lines).toEqual([]);
    s.push("def\nghi");
    expect(lines).toEqual(["abcdef"]);
    s.push("\nlast one\nand ");
    expect(lines).toEqual(["abcdef", "ghi", "last one"]);
  });

  // @spec DESK-SHELL-LOG-005
  it("removes the \\r of a \\r\\n, also when the two arrive in different chunks", () => {
    const { lines, s } = splitter();
    s.push("one\r\ntwo\r");
    s.push("\nthree\r\n");
    expect(lines).toEqual(["one", "two", "three"]);
  });

  // @spec DESK-SHELL-LOG-005
  it("ends lines at \\n alone: a \\r not before a \\n stays in the line", () => {
    const { lines, s } = splitter();
    s.push("50%\r100%\n");
    expect(lines).toEqual(["50%\r100%"]);
  });

  // @spec DESK-SHELL-LOG-005
  it("sends a held partial line out only at end(), when the process exited", () => {
    const { lines, s } = splitter();
    s.push("[server] listening\n[server] stopping on");
    s.push(" an error");
    expect(lines).toEqual(["[server] listening"]);
    s.end();
    expect(lines).toEqual(["[server] listening", "[server] stopping on an error"]);
  });

  // @spec DESK-SHELL-LOG-005
  it("sends nothing at end() when no partial line is held", () => {
    const { lines, s } = splitter();
    s.push("whole\n");
    s.end();
    expect(lines).toEqual(["whole"]);
  });

  // @spec DESK-SHELL-LOG-006
  it("cuts a 20 000-character line to 16384 bytes and …, dropping the rest up to its line break", () => {
    const { lines, s } = splitter();
    s.push(`${"a".repeat(20_000)}\nnext\n`);
    expect(lines).toEqual([`${"a".repeat(16_384)}…`, "next"]);
  });

  // @spec DESK-SHELL-LOG-006
  it("drops a long line's tail across chunks, and cuts a long partial line at end() too", () => {
    const { lines, s } = splitter();
    s.push("a".repeat(10_000));
    s.push("a".repeat(10_000));
    s.push("bbbb\nnext\n");
    s.push("c".repeat(20_000));
    s.end();
    expect(lines).toEqual([`${"a".repeat(16_384)}…`, "next", `${"c".repeat(16_384)}…`]);
  });

  // @spec DESK-SHELL-LOG-006
  it("counts UTF-8 bytes: 10 000 é give 8192 é and …", () => {
    const { lines, s } = splitter();
    s.push(`${"é".repeat(10_000)}\n`);
    expect(lines).toEqual([`${"é".repeat(8192)}…`]);
  });

  // @spec DESK-SHELL-LOG-006
  it("never splits a character: one that would cross 16384 bytes is left out", () => {
    const { lines, s } = splitter();
    s.push(`${"a".repeat(16_382)}😀tail\n`);
    expect(lines).toEqual([`${"a".repeat(16_382)}…`]);
  });

  // @spec DESK-SHELL-LOG-006
  it("sends a line of exactly 16384 bytes out whole", () => {
    const { lines, s } = splitter();
    s.push(`${"a".repeat(16_384)}\r\n${"é".repeat(8192)}\n`);
    expect(lines).toEqual(["a".repeat(16_384), "é".repeat(8192)]);
  });
});

/** A LogFs in memory whose writes, renames and folder creation can be made to fail. */
class MemoryFs implements LogFs {
  files = new Map<string, string>();
  events: string[] = [];
  appended: string[] = [];
  failAppend = false;
  failRename = false;
  failMkdir = false;

  appendFileSync(file: string, text: string): void {
    if (this.failAppend) {
      this.events.push("append failed");
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    }
    this.files.set(file, (this.files.get(file) ?? "") + text);
    this.appended.push(text);
    this.events.push("append");
  }
  renameSync(from: string, to: string): void {
    if (this.failRename) {
      this.events.push("rename failed");
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: "EBUSY" });
    }
    this.files.set(to, this.files.get(from) ?? "");
    this.files.delete(from);
    this.events.push("rename");
  }
  statSync(file: string): { size: number } {
    const text = this.files.get(file);
    if (text === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${file}'`), { code: "ENOENT" });
    return { size: Buffer.byteLength(text) };
  }
  mkdirSync(dir: string, _o: { recursive: true }): unknown {
    this.events.push(`mkdir ${dir}`);
    if (this.failMkdir) throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${dir}'`), { code: "EPERM" });
    return undefined;
  }
}

describe("lines that cannot be written", () => {
  const FOLDER = "C:\\stand-in\\desktop\\logs";

  // @spec DESK-SHELL-LOG-007
  it("drops and counts them, then reports the count before the next line that is written", () => {
    const mem = new MemoryFs();
    const log = new LogFile({ folder: FOLDER, name: "desktop", clock: new FakeClock(), fs: mem });
    log.write("before");
    mem.failAppend = true;
    mem.failMkdir = true;
    expect(() => log.write("one")).not.toThrow();
    expect(() => log.write("two")).not.toThrow();
    mem.failAppend = false;
    mem.failMkdir = false;
    log.write("three");
    log.write("four");
    expect(mem.appended.join("")).toBe(
      `${STAMP} before\n${STAMP} [log] 2 lines could not be written\n${STAMP} three\n${STAMP} four\n`,
    );
    expect(mem.files.get(path.win32.join(FOLDER, "desktop.log"))).toBe(mem.appended.join(""));
  });

  // @spec DESK-SHELL-LOG-007
  it("makes its folder at the first write, and tries again after a failure", () => {
    const mem = new MemoryFs();
    const log = new LogFile({ folder: FOLDER, name: "server", clock: new FakeClock(), fs: mem });
    log.write("first");
    expect(mem.events).toEqual([`mkdir ${FOLDER}`, "append"]);
    mem.failAppend = true;
    log.write("lost");
    mem.failAppend = false;
    const failedAt = mem.events.lastIndexOf("append failed");
    log.write("back");
    const recovered = mem.events.indexOf("append", failedAt);
    expect(mem.events.slice(failedAt, recovered)).toContain(`mkdir ${FOLDER}`);
    expect(mem.appended.join("")).toBe(`${STAMP} first\n${STAMP} [log] 1 lines could not be written\n${STAMP} back\n`);
  });

  // @spec DESK-SHELL-LOG-007
  it("counts a rotation that cannot rename the same way", () => {
    const mem = new MemoryFs();
    const file = path.win32.join(FOLDER, "desktop.log");
    mem.files.set(file, "x".repeat(LIMIT - 10));
    const log = new LogFile({ folder: FOLDER, name: "desktop", clock: new FakeClock(), fs: mem });
    mem.failRename = true;
    expect(() => log.write("over the limit")).not.toThrow();
    expect(mem.events).toContain("rename failed");
    mem.failRename = false;
    log.write("next");
    expect(mem.appended.join("").endsWith(`${STAMP} [log] 1 lines could not be written\n${STAMP} next\n`)).toBe(true);
  });

  // @spec DESK-SHELL-LOG-007
  it("on the real disk: a logs folder that became a file drops lines, and writing resumes once it is gone", () => {
    const folder = path.join(tempFolder(), "logs");
    const file = path.join(folder, "desktop.log");
    const log = new LogFile({ folder, name: "desktop", clock: new FakeClock() });
    log.write("first");
    fs.rmSync(folder, { recursive: true });
    fs.writeFileSync(folder, "not a folder");
    expect(() => log.write("lost one")).not.toThrow();
    expect(() => log.write("lost two")).not.toThrow();
    fs.rmSync(folder);
    log.write("back");
    expect(fs.readFileSync(file, "utf8")).toBe(`${STAMP} [log] 2 lines could not be written\n${STAMP} back\n`);
  });
});
