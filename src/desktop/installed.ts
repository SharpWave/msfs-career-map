import fs from "node:fs";
import path from "node:path";

export const TEST_MODE_ONLY =
  "MSFS Career Map runs only in test mode here: start it with --test-data=<folder>. Only the installed program, %LOCALAPPDATA%\\Programs\\MSFS Career Map\\MSFS Career Map.exe, runs outside test mode.";

/** <localAppData>\Programs\MSFS Career Map\MSFS Career Map.exe */
export function installedProgramPath(localAppData: string): string {
  return path.win32.join(localAppData, "Programs", "MSFS Career Map", "MSFS Career Map.exe");
}

/** `p` with `..` taken out and junctions followed; as resolved alone when `realpath` cannot. */
function fullyResolved(p: string, realpath: (p: string) => string): string {
  const resolved = path.win32.resolve(p);
  try {
    return realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Whether the program running is the installed one: both paths fully resolved and equal ignoring
 * case. Never so while `%LOCALAPPDATA%` is unset.
 */
// @spec DESK-DIST-DEV-004
export function isInstalledProgram(
  programPath: string,
  localAppData: string | undefined,
  realpath: (p: string) => string = fs.realpathSync.native,
): boolean {
  if (!localAppData) return false;
  const running = fullyResolved(programPath, realpath);
  const installed = fullyResolved(installedProgramPath(localAppData), realpath);
  return running.toLowerCase() === installed.toLowerCase();
}
