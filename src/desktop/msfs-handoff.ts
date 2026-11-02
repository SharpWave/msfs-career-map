import path from "node:path";
import { installedProgramPath } from "./installed.ts";
import { MSFS_PROGRAMS } from "./windows-facts.ts";

/**
 * An installed `--background` start: an ordinary one, or one by MSFS, which never becomes the running
 * copy. MSFS's own platform (Gaming Services, Steam) counts the game as running while a process it started
 * lives, so a copy MSFS started that outlived it would leave MSFS unable to start again; such a start has
 * Windows' shell start the app instead (desktop-design, Started by MSFS; shell-design, A start by MSFS).
 */

/** The shortcut, in Electron's own folder, that Explorer opens to start the app in the tray. */
export const SHORTCUT_NAME = "Start in the tray.lnk";

export interface HandoffPorts {
  /** The program a process runs (`FlightSimulator2024.exe`); null when gone or the look fails. */
  programNameOf(pid: number): Promise<string | null>;
  /** Electron's single-instance lock, asked for with this start's command line; false when another copy holds it. */
  takeLock(): boolean;
  releaseLock(): void;
  /** Writes (or replaces) a shortcut starting `target` with `args`; throws when it cannot. */
  writeShortcut(file: string, target: string, args: string): void;
  /** Runs `explorer.exe` on the file; whether it started, and why not. */
  openInExplorer(file: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** A line in desktop.log. */
  log(line: string): void;
}

/** What the start goes on to do: exit, having handed over or handed the start to Windows' shell, or run as the copy holding the lock. */
export type BackgroundOutcome = "handed-over" | "handed-to-shell" | "run";

const startedByMsfs = (program: string | null) =>
  program !== null && MSFS_PROGRAMS.some((p) => p.toLowerCase() === program.toLowerCase());

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// @spec DESK-SHELL-CLI-023, DESK-SHELL-CLI-024, DESK-SHELL-CLI-025, DESK-SHELL-CLI-005, DESK-SHELL-CLI-013
export async function backgroundStart(o: { parentPid: number; electronFolder: string; localAppData: string; ports: HandoffPorts }): Promise<BackgroundOutcome> {
  const p = o.ports;
  const parent = await p.programNameOf(o.parentPid).catch(() => null);
  if (!p.takeLock()) return "handed-over";
  if (!startedByMsfs(parent)) return "run";

  const shortcut = path.win32.join(o.electronFolder, SHORTCUT_NAME);
  try {
    p.writeShortcut(shortcut, installedProgramPath(o.localAppData), "--background");
  } catch (e) {
    p.log(`[cli] started by MSFS (${parent}), but ${shortcut} could not be written: ${reasonOf(e)}; running as this copy`);
    return "run";
  }
  // Written while the lock is still held: no other copy writes desktop.log at the same moment.
  p.log(`[cli] started by MSFS (${parent}): handing the start to Windows' shell, so MSFS can start again once it quits`);
  p.releaseLock();
  const opened = await p.openInExplorer(shortcut).catch((e: unknown) => ({ ok: false as const, reason: reasonOf(e) }));
  if (opened.ok) return "handed-to-shell";
  if (!p.takeLock()) return "handed-over";
  p.log(`[cli] explorer.exe could not be started: ${opened.reason}; running as this copy`);
  return "run";
}
