import fs from "node:fs";
import path from "node:path";
import type { WindowsFacts } from "./ports.ts";

/**
 * The install-under-way mark as a start of the app sees it: a file in electron-updater's download
 * folder, UTF-16LE, one record per line, written whole by whoever hands over to the installer and from
 * then on only appended to (distribution-design, An install under way and The mark's form).
 */

export const MARK_NAME = "install-under-way";
export const DOWNLOADS_NAME = "msfs-career-map-updater";

/** <localAppData>\msfs-career-map-updater, electron-updater's own folder, outside the install folder. */
export function downloadsFolder(localAppData: string): string {
  return path.win32.join(localAppData, DOWNLOADS_NAME);
}

/** <localAppData>\msfs-career-map-updater\install-under-way */
export function markPath(localAppData: string): string {
  return path.win32.join(downloadsFolder(localAppData), MARK_NAME);
}

export type MarkStart = "none" | "--updated" | "--background";
export type StartSwitches = "" | "--updated" | "--background";

export type MarkRecord =
  | { kind: "process"; pid: number; program: string }
  | { kind: "request"; start: MarkStart }
  | { kind: "start"; switches: StartSwitches };

const STARTS: readonly string[] = ["none", "--updated", "--background"];
const SWITCHES: readonly string[] = ["", "--updated", "--background"];

/** One line's record, or null for a line this release does not know. */
function parseLine(line: string): MarkRecord | null {
  let m = /^process (\d+) (.+)$/.exec(line);
  if (m) return { kind: "process", pid: Number(m[1]), program: m[2] };
  m = /^request (\S+)$/.exec(line);
  if (m && STARTS.includes(m[1])) return { kind: "request", start: m[1] as MarkStart };
  m = /^start (.*)$/.exec(line);
  if (m && SWITCHES.includes(m[1])) return { kind: "start", switches: m[1] as StartSwitches };
  return null;
}

/** The mark's records: UTF-16LE, a leading byte-order mark skipped, CR LF or LF lines; unknown lines passed over. */
// @spec DESK-DIST-INST-025
export function parseMark(bytes: Uint8Array): MarkRecord[] {
  let text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf16le");
  if (text.startsWith("﻿")) text = text.slice(1);
  return text.split(/\r?\n/).flatMap((line) => parseLine(line) ?? []);
}

/** One record as one line: UTF-16LE, no byte-order mark, ending CR LF. */
// @spec DESK-DIST-INST-025
export function markLine(record: MarkRecord): Uint8Array {
  const text =
    record.kind === "process"
      ? `process ${record.pid} ${record.program}`
      : record.kind === "request"
        ? `request ${record.start}`
        : `start ${record.switches}`;
  return new Uint8Array(Buffer.from(`${text}\r\n`, "utf16le"));
}

/** The mark's file. */
export interface MarkFiles {
  /** The mark's bytes, or null when it does not exist. */
  read(file: string): Uint8Array | null;
  /** Appends in one write to a file opened for appending only, never creating it; false when missing. */
  append(file: string, bytes: Uint8Array): boolean;
}

export const nodeMarkFiles: MarkFiles = {
  read(file) {
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch {
      return null;
    }
  },
  append(file, bytes) {
    let fd: number;
    try {
      // No O_CREAT: a mark taken up meanwhile is never made again by a start.
      fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND);
    } catch {
      return false;
    }
    try {
      fs.writeSync(fd, bytes);
      return true;
    } catch {
      return false;
    } finally {
      fs.closeSync(fd);
    }
  },
};

type MarkFacts = Pick<WindowsFacts, "programOf" | "processesIn">;

/**
 * Whether the install the mark records is still under way: a process it names runs that program
 * (compared ignoring case), or a program inside electron-updater's download folder — its installer —
 * runs for this Windows user. A mark with neither, left by an install cut off, counts for nothing.
 */
// @spec DESK-DIST-INST-030
export async function installUnderWay(records: MarkRecord[], facts: MarkFacts, downloads: string): Promise<boolean> {
  for (const r of records) {
    if (r.kind !== "process") continue;
    const program = await facts.programOf(r.pid);
    if (program !== null && program.toLowerCase() === r.program.toLowerCase()) return true;
  }
  return (await facts.processesIn(downloads)).length > 0;
}

export type InstallCheck = "go" | "left-in-mark";

/**
 * A start outside test mode with no switch, `--background` or `--updated`: with an install under way,
 * its command line is added to the mark (never creating it) and the mark looked for again — still there,
 * the start is left in it for the installer; gone, taken up meanwhile, the start goes ahead as usual.
 */
// @spec DESK-SHELL-CLI-020, DESK-DIST-INST-030
export async function checkInstallUnderWay(o: {
  localAppData: string;
  switches: StartSwitches;
  files: MarkFiles;
  facts: MarkFacts;
}): Promise<InstallCheck> {
  const mark = markPath(o.localAppData);
  const bytes = o.files.read(mark);
  if (bytes === null) return "go";
  if (!(await installUnderWay(parseMark(bytes), o.facts, downloadsFolder(o.localAppData)))) return "go";
  if (!o.files.append(mark, markLine({ kind: "start", switches: o.switches }))) return "go";
  return o.files.read(mark) === null ? "go" : "left-in-mark";
}

/** desktop.log's line for a start left in the mark. */
export function leftInMarkLogLine(switches: StartSwitches): string {
  return `Start (${switches === "" ? "no switch" : switches}) left in the install-under-way mark for the installer`;
}
