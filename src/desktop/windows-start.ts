import path from "node:path";
import type { Clock, EditorFs, StartupKeys } from "./ports.ts";
import { namesToPrune, regBackupName } from "./start-list-backups.ts";

/**
 * Start with Windows: the value named "MSFS Career Map" in the per-user Run key and its enabled mark
 * under StartupApproved. What the two values mean for the tick, and turning the setting on or off —
 * nothing written when the keys are already as the action leaves them, else both keys exported to a
 * `.reg` file in the start-up list backups first. The keys themselves are reached only through the
 * `StartupKeys` port.
 */

export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
/** The start-list entries' name, the same in every release. */
export const VALUE_NAME = "MSFS Career Map";

export interface WindowsState {
  run: string | null;
  approved: Uint8Array | null;
}

export type WindowsOutcome = { kind: "unchanged" | "written" } | { kind: "left"; why: string };

export interface WindowsPorts {
  keys: StartupKeys;
  fs: EditorFs;
  clock: Clock;
  /** The installed program the Run value starts. */
  program: string;
  /** <Electron's own folder>\start-up list backups. */
  backupsFolder: string;
  log(line: string): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The mark disabled when its first byte is odd (Task Manager writes 03; 02 and 06 are enabled); absent = enabled. */
export function approvedEnabled(approved: Uint8Array | null): boolean {
  if (approved === null || approved.length === 0) return true;
  return approved[0] % 2 === 0;
}

/** Windows will start the app at sign-in: the value is in Run, whatever it holds, and not marked disabled. */
// @spec DESK-START-WINDOWS-007
export function windowsTicked(s: WindowsState): boolean {
  return s.run !== null && approvedEnabled(s.approved);
}

/** The Run value as Electron's login item writes it. */
export function runValue(program: string): string {
  return `"${program}" --background`;
}

/** The keys as turning the setting on leaves them: the program's value (its path ignoring case) and an enabled mark. */
function alreadyOn(s: WindowsState, program: string): boolean {
  return s.run !== null && s.run.toLowerCase() === runValue(program).toLowerCase() && approvedEnabled(s.approved);
}

/** Turning Start with Windows on: the login item written and marked enabled, overriding a Disable in Task Manager. */
// @spec DESK-START-WINDOWS-002, DESK-START-WINDOWS-003, DESK-START-WINDOWS-006, DESK-START-WINDOWS-009
export async function turnWindowsOn(o: WindowsPorts): Promise<WindowsOutcome> {
  const state = await readKeys(o);
  if ("why" in state) return left(o, state.why);
  if (alreadyOn(state, o.program)) return unchanged(o, "already starts the app");
  const exported = await exportKeys(o);
  if (exported !== null) return left(o, exported);
  try {
    await o.keys.writeOn(o.program);
  } catch (e) {
    return left(o, `the login item could not be written: ${message(e)}`);
  }
  o.log(`[start-lists] Windows start-up keys: ${VALUE_NAME} written to start ${runValue(o.program)}`);
  return { kind: "written" };
}

/** Turning it off, and --unregister: the value named "MSFS Career Map", whatever it holds, out of both keys. */
// @spec DESK-START-WINDOWS-002, DESK-START-WINDOWS-003, DESK-START-WINDOWS-008, DESK-START-WINDOWS-009, DESK-START-UNREG-002
export async function turnWindowsOff(o: WindowsPorts): Promise<WindowsOutcome> {
  const state = await readKeys(o);
  if ("why" in state) return left(o, state.why);
  if (state.run === null && state.approved === null) return unchanged(o, `neither key holds ${VALUE_NAME}`);
  const exported = await exportKeys(o);
  if (exported !== null) return left(o, exported);
  try {
    await o.keys.remove();
  } catch (e) {
    return left(o, `the value could not be removed: ${message(e)}`);
  }
  o.log(`[start-lists] Windows start-up keys: ${VALUE_NAME} removed from both keys`);
  return { kind: "written" };
}

async function readKeys(o: WindowsPorts): Promise<WindowsState | { why: string }> {
  try {
    return await o.keys.read();
  } catch (e) {
    return { why: `the keys cannot be read: ${message(e)}` };
  }
}

/** Both keys exported as Run.<stamp>.reg, then the exports beyond the five newest deleted; the reason when it could not be written. */
async function exportKeys(o: WindowsPorts): Promise<string | null> {
  let file = path.win32.join(o.backupsFolder, "Run.reg");
  try {
    o.fs.mkdir(o.backupsFolder);
    file = path.win32.join(o.backupsFolder, regBackupName(o.clock.wallNow(), o.fs.list(o.backupsFolder)));
    await o.keys.exportTo(file);
  } catch (e) {
    return `the backup ${file} could not be written: ${message(e)}`;
  }
  try {
    for (const name of namesToPrune("reg", o.fs.list(o.backupsFolder))) o.fs.remove(path.win32.join(o.backupsFolder, name));
  } catch (e) {
    o.log(`[start-lists] could not delete an older start-up list backup: ${message(e)}`);
  }
  return null;
}

function unchanged(o: WindowsPorts, why: string): WindowsOutcome {
  o.log(`[start-lists] Windows start-up keys: unchanged (${why})`);
  return { kind: "unchanged" };
}

function left(o: WindowsPorts, why: string): WindowsOutcome {
  o.log(`[start-lists] Windows start-up keys: left as they were: ${why}`);
  return { kind: "left", why };
}
