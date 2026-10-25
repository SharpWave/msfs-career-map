import path from "node:path";
import { parseCommandLine, startSwitch, type CommandLine } from "./cli.ts";
import { TEST_MODE_ONLY, isInstalledProgram } from "./installed.ts";

export const INSTALLED_PORT = 3380;
export const TEST_PORT = 3280;

const FOLDER_NAME = "MSFS Career Map";

/** Where a run keeps its files and how its server runs: installed, or test mode on one folder. */
export interface RunPlan {
  mode: "installed" | "test";
  /** Test mode's folder, absolute; null when installed. */
  testFolder: string | null;
  /** Installed: <LOCALAPPDATA>\MSFS Career Map; test: <folder>\data. */
  dataFolder: string;
  /** Installed: <APPDATA>\MSFS Career Map; test: <folder>\desktop. */
  electronFolder: string;
  port: number;
  sim: "link" | "fake";
  airportDownloads: boolean;
  backups: { kind: "documents"; path: "MSFS Career Map\\Backups" } | { kind: "folder"; folder: string };
}

/**
 * The plan for test mode on `testData`, else for the installed app from `%LOCALAPPDATA%` and
 * `%APPDATA%` (both must be set). Literal folders, the same in every release.
 */
// @spec DESK-SHELL-CLI-002, DESK-SHELL-SRV-005, DESK-SHELL-SRV-006, DESK-SHELL-SRV-041
export function runPlan(testData: string | null, env: { LOCALAPPDATA?: string; APPDATA?: string }): RunPlan {
  if (testData !== null) {
    return {
      mode: "test",
      testFolder: testData,
      dataFolder: path.win32.join(testData, "data"),
      electronFolder: path.win32.join(testData, "desktop"),
      port: TEST_PORT,
      sim: "fake",
      airportDownloads: false,
      backups: { kind: "folder", folder: path.win32.join(testData, "Backups") },
    };
  }
  if (!env.LOCALAPPDATA || !env.APPDATA) throw new Error("The installed app needs %LOCALAPPDATA% and %APPDATA%");
  return {
    mode: "installed",
    testFolder: null,
    dataFolder: path.win32.join(env.LOCALAPPDATA, FOLDER_NAME),
    electronFolder: path.win32.join(env.APPDATA, FOLDER_NAME),
    port: INSTALLED_PORT,
    sim: "link",
    airportDownloads: true,
    backups: { kind: "documents", path: "MSFS Career Map\\Backups" },
  };
}

export type StartDecision =
  | { kind: "refuse"; message: string; code: 1 }
  | { kind: "unregister"; plan: RunPlan }
  | { kind: "quit-only"; plan: RunPlan; command: CommandLine }
  | { kind: "run"; plan: RunPlan; command: CommandLine };

/**
 * What a start does, decided before any folder is set or the lock asked: refuse a bad command line,
 * or a program other than the installed one outside test mode; else `--unregister`'s own work,
 * `--quit` only to hand over, or a run.
 */
// @spec DESK-SHELL-CLI-001, DESK-SHELL-CLI-003, DESK-SHELL-CLI-007, DESK-SHELL-CLI-009, DESK-SHELL-CLI-011, DESK-SHELL-CLI-012, DESK-DIST-DEV-004
export function decideStart(
  argv: readonly string[],
  env: { LOCALAPPDATA?: string; APPDATA?: string },
  programPath: string,
  cwd: string,
  realpath?: (p: string) => string,
): StartDecision {
  const command = parseCommandLine(argv, cwd);
  if ("error" in command) return { kind: "refuse", message: command.error, code: 1 };
  if (command.testData === null) {
    if (!isInstalledProgram(programPath, env.LOCALAPPDATA, realpath)) return { kind: "refuse", message: TEST_MODE_ONLY, code: 1 };
    if (!env.APPDATA) return { kind: "refuse", message: "Cannot start: %APPDATA% is not set", code: 1 };
  }
  const plan = runPlan(command.testData, env);
  switch (startSwitch(command)) {
    case "unregister":
      return { kind: "unregister", plan };
    case "quit":
      return { kind: "quit-only", plan, command };
    default:
      return { kind: "run", plan, command };
  }
}
