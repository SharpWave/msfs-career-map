import nodeFs from "node:fs";
import path from "node:path";
import type { Clock } from "./ports.ts";

/** A log is renamed `<name>.old.log` once its running size passes this. */
export const LOG_LIMIT_BYTES = 5 * 1024 * 1024;
/** A server line longer than this many UTF-8 bytes is cut and ended with "…". */
export const LINE_LIMIT = 16 * 1024;

/** The few file calls a log makes; node:fs by default. */
export interface LogFs {
  appendFileSync(file: string, text: string): void;
  renameSync(from: string, to: string): void;
  statSync(file: string): { size: number };
  mkdirSync(dir: string, o: { recursive: true }): unknown;
}

/**
 * One of the shell's logs, `<folder>\<name>.log`: each line stamped with the system clock, the file
 * renamed `<name>.old.log` once its running size passes 5 MB, and lines that cannot be written
 * dropped and counted, the count reported before the next line that can be.
 */
// @spec DESK-SHELL-LOG-001, DESK-SHELL-LOG-004, DESK-SHELL-LOG-007
export class LogFile {
  private readonly folder: string;
  private readonly file: string;
  private readonly old: string;
  private readonly clock: Pick<Clock, "wallNow">;
  private readonly fs: LogFs;
  private size: number;
  private dropped = 0;
  private needFolder = true;

  /** The running size starts from the file's size (0 when absent). */
  constructor(o: { folder: string; name: "server" | "desktop"; clock: Pick<Clock, "wallNow">; fs?: LogFs }) {
    this.folder = o.folder;
    this.file = path.win32.join(o.folder, `${o.name}.log`);
    this.old = path.win32.join(o.folder, `${o.name}.old.log`);
    this.clock = o.clock;
    this.fs = o.fs ?? nodeFs;
    try {
      this.size = this.fs.statSync(this.file).size;
    } catch {
      this.size = 0;
    }
  }

  /** Never throws. A text with line breaks is written as one stamped line per line. */
  write(text: string): void {
    for (const line of text.split(/\r?\n/)) this.writeLine(line);
  }

  private writeLine(line: string): void {
    try {
      if (this.needFolder) {
        this.fs.mkdirSync(this.folder, { recursive: true });
        this.needFolder = false;
      }
      if (this.dropped > 0) {
        const n = this.dropped;
        this.dropped = 0;
        try {
          this.append(`[log] ${n} lines could not be written`);
        } catch (e) {
          this.dropped += n;
          throw e;
        }
      }
      this.append(line);
    } catch {
      this.dropped++;
      this.needFolder = true;
    }
  }

  private append(line: string): void {
    const stamped = `${this.clock.wallNow().toISOString()} ${line}\n`;
    this.fs.appendFileSync(this.file, stamped);
    this.size += Buffer.byteLength(stamped);
    if (this.size <= LOG_LIMIT_BYTES) return;
    try {
      this.fs.renameSync(this.file, this.old);
      this.size = 0;
    } catch {
      // Tried again after the next line written.
      this.dropped++;
    }
  }
}

/**
 * Splits the server's output into lines: each ends at `\n` (a `\r` before it removed), a partial
 * line is held to the next chunk or `end()`, and a line over 16 KB goes out as its longest prefix of
 * whole characters within 16 KB and "…", the rest up to its line break dropped.
 */
// @spec DESK-SHELL-LOG-005, DESK-SHELL-LOG-006
export class LineSplitter {
  private held = "";
  /** The held line passed the limit: it is already cut and the rest of it is dropped. */
  private cut = false;

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf("\n", start);
      if (nl < 0) {
        this.hold(chunk.slice(start));
        return;
      }
      this.hold(chunk.slice(start, nl));
      this.finish();
      start = nl + 1;
    }
  }

  /** The process exited: a held partial line goes out. */
  end(): void {
    if (this.held !== "" || this.cut) this.finish();
  }

  private hold(text: string): void {
    if (this.cut || text === "") return;
    this.held += text;
    // One byte of slack for a `\r` that a following `\n` would remove.
    if (Buffer.byteLength(this.held) > LINE_LIMIT + 1) {
      this.held = withinLimit(this.held);
      this.cut = true;
    }
  }

  private finish(): void {
    let line = this.held;
    if (this.cut) line += "…";
    else {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (Buffer.byteLength(line) > LINE_LIMIT) line = `${withinLimit(line)}…`;
    }
    this.held = "";
    this.cut = false;
    this.onLine(line);
  }
}

/** The longest prefix of whole characters within LINE_LIMIT bytes. */
function withinLimit(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= LINE_LIMIT) return line;
  let end = LINE_LIMIT;
  // Back off a character the limit falls inside of (its continuation bytes are 10xxxxxx).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}
