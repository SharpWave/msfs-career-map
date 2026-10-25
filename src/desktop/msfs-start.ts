import nodeFs from "node:fs";
import path from "node:path";
import { addEntry, newExeXml, readExeXml, refusalText, removeEntries, type AppEntry, type Programs } from "./exe-xml.ts";
import type { Clock, EditorFs, WindowsFacts } from "./ports.ts";
import { exeXmlBackupName, namesToPrune, type Edition } from "./start-list-backups.ts";

/**
 * Start with MSFS 2024's work on the sim's folders: where each MSFS 2024 edition keeps its
 * `EXE.xml`, the item's state as read from them, and the passes that turn the setting on and off and
 * take the app's entries out at `--unregister`. Each change backs the file up into Electron's folder,
 * writes the result to a temporary file, reads `EXE.xml` again just before renaming it into place,
 * and keeps the record of files last written in an order a change cut short can never turn into a
 * false "removed by another program". The editing itself is `exe-xml.ts`'s.
 */

const win = path.win32;

export interface EditionFolder {
  edition: Edition;
  folder: string;
}

export const TEMP_NAME = "EXE.xml.msfs-career-map-tmp";
const EXE_NAME = "EXE.xml";
const USER_CFG = "UserCfg.opt";

/** Windows' answers while a rename is refused for a moment: another program holds the file. */
const BUSY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const RENAME_RETRY_MS = 250;
const RENAME_LIMIT_MS = 3_000;
/** Re-reads finding the file changed, in one file's change, before it is given up. */
const CHANGED_READS = 3;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Store <LOCALAPPDATA>\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache; Steam <APPDATA>\Microsoft Flight Simulator 2024. */
// @spec DESK-START-MSFS-002
export function editionFolders(env: { LOCALAPPDATA?: string; APPDATA?: string }): EditionFolder[] {
  const folders: EditionFolder[] = [];
  if (env.LOCALAPPDATA) {
    folders.push({ edition: "Store", folder: win.join(env.LOCALAPPDATA, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache") });
  }
  if (env.APPDATA) folders.push({ edition: "Steam", folder: win.join(env.APPDATA, "Microsoft Flight Simulator 2024") });
  return folders;
}

/** The editor's file calls on node:fs. */
// @spec DESK-START-MSFS-038
export const nodeEditorFs: EditorFs = {
  read(file) {
    try {
      return new Uint8Array(nodeFs.readFileSync(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  exists(file) {
    return nodeFs.existsSync(file);
  },
  write(file, bytes) {
    nodeFs.writeFileSync(file, bytes);
  },
  rename(from, to) {
    nodeFs.renameSync(from, to);
  },
  remove(file) {
    nodeFs.rmSync(file, { force: true });
  },
  list(folder) {
    try {
      return nodeFs.readdirSync(folder);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  },
  mkdir(folder) {
    nodeFs.mkdirSync(folder, { recursive: true });
  },
};

// -------------------------------------------------------------------------------------------------
// The item's state

export type FileState =
  | { kind: "absent" }
  | { kind: "unreadable"; why: string }
  | { kind: "read"; blank: boolean; entries: AppEntry[] };

export interface MsfsState {
  /** The editions whose folder holds UserCfg.opt. */
  installed: Edition[];
  /** One per edition's folder, absent included. */
  files: { edition: Edition; file: string; state: FileState }[];
  /** FlightSimulator2024.exe running for this Windows account. */
  running: boolean;
}

function fileState(fs: EditorFs, file: string, programs: Programs): FileState {
  let bytes: Uint8Array | null;
  try {
    bytes = fs.read(file);
  } catch (e) {
    return { kind: "unreadable", why: `it cannot be opened: ${message(e)}` };
  }
  if (bytes === null) return { kind: "absent" };
  const r = readExeXml(bytes, programs);
  if (r.kind === "blank") return { kind: "read", blank: true, entries: [] };
  if (r.kind === "refused") return { kind: "unreadable", why: refusalText(r.refusal) };
  return { kind: "read", blank: false, entries: r.entries };
}

/** The editions installed, every edition folder's EXE.xml as it is now, and whether MSFS 2024 runs. Never rejects. */
// @spec DESK-START-MSFS-003, DESK-START-MSFS-004, DESK-START-MSFS-011
export async function readMsfsState(o: {
  folders: EditionFolder[];
  fs: EditorFs;
  programs: Programs;
  facts: Pick<WindowsFacts, "msfs2024Running">;
}): Promise<MsfsState> {
  const installed = o.folders.filter((f) => isInstalled(o.fs, f.folder)).map((f) => f.edition);
  const files = o.folders.map((f) => {
    const file = win.join(f.folder, EXE_NAME);
    return { edition: f.edition, file, state: fileState(o.fs, file, o.programs) };
  });
  const running = await o.facts.msfs2024Running().catch(() => false);
  return { installed, files, running };
}

function isInstalled(fs: EditorFs, folder: string): boolean {
  try {
    return fs.exists(win.join(folder, USER_CFG));
  } catch {
    return false;
  }
}

const holdsOn = (s: FileState) => s.kind === "read" && s.entries.some((e) => e.on);

/** Some EXE.xml present holds an entry of the app's turned on. */
// @spec DESK-START-MSFS-006
export function msfsTicked(s: MsfsState): boolean {
  return s.files.some((f) => holdsOn(f.state));
}

const LABEL = "Start with MSFS 2024";

/** The item's words by the first that applies, whether it can be clicked, and its tick; `record` is the settings' exeXmlFiles. */
// @spec DESK-START-MSFS-013, DESK-START-MSFS-014, DESK-START-MSFS-015, DESK-START-MSFS-016, DESK-START-MSFS-017, DESK-START-MSFS-018, DESK-START-MSFS-019
export function msfsItem(s: MsfsState, record: readonly string[]): { label: string; enabled: boolean; checked: boolean } {
  const checked = msfsTicked(s);
  if (!checked && s.installed.length === 0) return { label: `${LABEL} (MSFS 2024 not found)`, enabled: false, checked };
  if (s.running) return { label: `${LABEL} (close MSFS to change)`, enabled: false, checked };
  if (!checked) {
    if (s.files.some((f) => f.state.kind === "unreadable")) return { label: `${LABEL} (EXE.xml can't be read; see log)`, enabled: true, checked };
    if (s.files.some((f) => record.some((r) => sameFile(r, f.file)) && lacksEntry(f.state))) {
      return { label: `${LABEL} (removed by another program; click to add again)`, enabled: true, checked };
    }
    if (s.files.some((f) => f.state.kind === "read" && f.state.entries.length > 0)) {
      return { label: `${LABEL} (turned off in EXE.xml)`, enabled: true, checked };
    }
  }
  return { label: LABEL, enabled: true, checked };
}

/** No entry of the app's: no file, a blank one, or one read without it (an unreadable file is not known to lack it). */
export function lacksEntry(s: FileState): boolean {
  return s.kind === "absent" || (s.kind === "read" && s.entries.length === 0);
}

// -------------------------------------------------------------------------------------------------
// The passes

export interface PassPorts {
  fs: EditorFs;
  clock: Clock;
  programs: Programs;
  folders: EditionFolder[];
  /** <Electron folder>\start-up list backups */
  backupsFolder: string;
  /** The record of files last written with the app's entry, in the settings. */
  record: { get(): string[]; set(files: string[]): void };
  log(line: string): void;
}

export type FileOutcome = { file: string; kind: "unchanged" | "written" } | { file: string; kind: "left"; why: string };

export interface PassResult {
  outcomes: FileOutcome[];
}

type Mode = "on" | "off" | "unregister";

/** Writes the app's entry to the EXE.xml of every edition installed; the caller has found MSFS 2024 not running. */
// @spec DESK-START-MSFS-007, DESK-START-MSFS-025, DESK-START-MSFS-026, DESK-START-MSFS-028, DESK-START-MSFS-029, DESK-START-MSFS-030, DESK-START-MSFS-031, DESK-START-MSFS-038, DESK-START-MSFS-039, DESK-START-MSFS-040, DESK-START-MSFS-041, DESK-START-MSFS-042, DESK-START-MSFS-043, DESK-START-MSFS-049, DESK-START-MSFS-050, DESK-START-MSFS-052
export async function turnMsfsOn(o: PassPorts & { installed: Edition[] }): Promise<PassResult> {
  const result = await pass(o, "on", o.folders.filter((f) => o.installed.includes(f.edition)));
  // Only files holding an entry of the app's turned on stay in the record.
  const record = o.record.get();
  const keep = record.filter((file) => holdsOn(fileState(o.fs, file, o.programs)));
  if (keep.length !== record.length) o.record.set(keep);
  return result;
}

/** Removes the app's entries from every EXE.xml present, then empties the record. */
// @spec DESK-START-MSFS-008, DESK-START-MSFS-044, DESK-START-MSFS-046, DESK-START-MSFS-047, DESK-START-MSFS-048, DESK-START-MSFS-052
export async function turnMsfsOff(o: PassPorts): Promise<PassResult> {
  const result = await pass(o, "off", o.folders);
  o.record.set([]);
  return result;
}

/** As turning it off, taking each file out of the record just before its entry is removed, and nothing more of the record. */
// @spec DESK-START-UNREG-001, DESK-START-UNREG-007
export async function unregisterMsfs(o: PassPorts): Promise<PassResult> {
  return pass(o, "unregister", o.folders);
}

/** Temporary files a change cut short left deleted from every folder first, then each file's change, Store then Steam. */
async function pass(o: PassPorts, mode: Mode, targets: EditionFolder[]): Promise<PassResult> {
  for (const f of o.folders) removeLeftTemp(o, f.folder);
  const outcomes: FileOutcome[] = [];
  for (const f of targets) outcomes.push(await changeFile(o, mode, f));
  return { outcomes };
}

function removeLeftTemp(o: PassPorts, folder: string): void {
  const temp = win.join(folder, TEMP_NAME);
  try {
    if (!o.fs.exists(temp)) return;
    o.fs.remove(temp);
    o.log(`[start-lists] deleted ${temp}, left by a change cut short`);
  } catch (e) {
    o.log(`[start-lists] could not delete ${temp}: ${message(e)}`);
  }
}

/** One file's change, started again from its first step while the re-read finds the file changed, up to three times. */
async function changeFile(o: PassPorts, mode: Mode, f: EditionFolder): Promise<FileOutcome> {
  const file = win.join(f.folder, EXE_NAME);
  const temp = win.join(f.folder, TEMP_NAME);
  const left = (why: string): FileOutcome => {
    o.log(`[start-lists] EXE.xml ${file} left as it was: ${why}`);
    return { file, kind: "left", why };
  };
  const unchanged: FileOutcome = { file, kind: "unchanged" };

  for (let changedReads = 0; ; ) {
    let before: Uint8Array | null;
    try {
      before = o.fs.read(file);
    } catch (e) {
      return left(`it cannot be opened: ${message(e)}`);
    }

    let result: Uint8Array;
    let done: string;
    const read = before === null ? null : readExeXml(before, o.programs);
    if (read === null || read.kind === "blank") {
      if (mode !== "on") return unchanged;
      result = newExeXml(o.programs.program);
      done = "written new";
    } else if (read.kind === "refused") {
      return left(refusalText(read.refusal));
    } else {
      const edit = mode === "on" ? addEntry(before!, o.programs) : removeEntries(before!, o.programs);
      if (edit.kind === "refused") return left(refusalText(edit.refusal));
      if (edit.kind === "unchanged") {
        if (mode === "on") addToRecord(o, file);
        return unchanged;
      }
      result = edit.bytes;
      done = mode === "on" ? "entry added" : "entry removed";
    }

    if (before !== null) {
      const failed = backUp(o, f.edition, before);
      if (failed !== null) return left(failed);
    }
    if (mode !== "on") takeOutOfRecord(o, file);

    try {
      o.fs.write(temp, result);
    } catch (e) {
      removeQuietly(o, temp);
      return left(message(e));
    }

    let now: Uint8Array | null | undefined;
    try {
      now = o.fs.read(file);
    } catch {
      now = undefined;
    }
    if (now === undefined || !sameBytes(before, now)) {
      removeQuietly(o, temp);
      if (++changedReads >= CHANGED_READS) return left("another program is changing the file");
      continue;
    }

    const refused = await renameIntoPlace(o, temp, file);
    if (refused !== null) {
      removeQuietly(o, temp);
      const code = (refused as NodeJS.ErrnoException).code ?? "";
      const text = message(refused);
      return left(`Windows would not replace it: ${code === "" || text.startsWith(code) ? text : `${code} ${text}`}`);
    }
    if (mode === "on") addToRecord(o, file);
    o.log(`[start-lists] EXE.xml ${file}: ${done}`);
    return { file, kind: "written" };
  }
}

/** The bytes copied into the backups folder under the next free name, older backups of the edition pruned; the reason when the copy fails. */
function backUp(o: PassPorts, edition: Edition, bytes: Uint8Array): string | null {
  let taken: string[];
  try {
    taken = o.fs.list(o.backupsFolder);
  } catch {
    taken = [];
  }
  const name = exeXmlBackupName(edition, o.clock.wallNow(), taken);
  const backup = win.join(o.backupsFolder, name);
  try {
    o.fs.mkdir(o.backupsFolder);
    o.fs.write(backup, bytes);
  } catch (e) {
    return `the backup ${backup} could not be written: ${message(e)}`;
  }
  for (const old of namesToPrune(edition, [...taken, name])) {
    try {
      o.fs.remove(win.join(o.backupsFolder, old));
    } catch (e) {
      o.log(`[start-lists] could not delete the old backup ${old}: ${message(e)}`);
    }
  }
  return null;
}

/** Renames, again every 250 ms for up to 3 s while Windows reports the file busy; null when done, else the last error. */
async function renameIntoPlace(o: PassPorts, temp: string, file: string): Promise<unknown> {
  const start = o.clock.now();
  for (;;) {
    try {
      o.fs.rename(temp, file);
      return null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!BUSY_CODES.has(code) || o.clock.now() - start >= RENAME_LIMIT_MS) return e;
      await new Promise<void>((resolve) => o.clock.after(RENAME_RETRY_MS, resolve));
    }
  }
}

function removeQuietly(o: PassPorts, file: string): void {
  try {
    o.fs.remove(file);
  } catch (e) {
    o.log(`[start-lists] could not delete ${file}: ${message(e)}`);
  }
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  return Buffer.from(a).equals(Buffer.from(b));
}

function addToRecord(o: PassPorts, file: string): void {
  const record = o.record.get();
  if (!record.some((r) => sameFile(r, file))) o.record.set([...record, file]);
}

function takeOutOfRecord(o: PassPorts, file: string): void {
  const record = o.record.get();
  if (record.some((r) => sameFile(r, file))) o.record.set(record.filter((r) => !sameFile(r, file)));
}
