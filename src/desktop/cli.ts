import path from "node:path";
import type { RunPlan } from "./start.ts";

/** The switches the app reads from its command line; every other argument is ignored. */
export interface CommandLine {
  /** Test mode's folder, absolute; null outside test mode. */
  testData: string | null;
  background: boolean;
  updated: boolean;
  quit: boolean;
  unregister: boolean;
}

export type StartSwitch = "unregister" | "quit" | "updated" | "background" | "none";

const TEST_DATA = "--test-data";
const NEEDS_FOLDER = "--test-data needs a folder: --test-data=<folder>";

/**
 * The command line from the whole `process.argv`. Only exact `--background`, `--updated`, `--quit`,
 * `--unregister` and `--test-data=<folder>` count; the folder is resolved against `cwd` with
 * Windows' rules, the last one winning, and one given no folder is refused.
 */
// @spec DESK-SHELL-CLI-010, DESK-SHELL-CLI-015, DESK-SHELL-CLI-019
export function parseCommandLine(argv: readonly string[], cwd: string): CommandLine | { error: string } {
  const c: CommandLine = { testData: null, background: false, updated: false, quit: false, unregister: false };
  for (const arg of argv) {
    if (arg === "--background") c.background = true;
    else if (arg === "--updated") c.updated = true;
    else if (arg === "--quit") c.quit = true;
    else if (arg === "--unregister") c.unregister = true;
    else if (arg === TEST_DATA) return { error: NEEDS_FOLDER };
    else if (arg.startsWith(`${TEST_DATA}=`)) {
      const value = arg.slice(TEST_DATA.length + 1);
      if (value === "") return { error: NEEDS_FOLDER };
      c.testData = path.win32.resolve(cwd, value);
    }
  }
  return c;
}

/** The switch acted on: the first of --unregister, --quit, --updated, --background; else "none". */
// @spec DESK-SHELL-CLI-015
export function startSwitch(c: CommandLine): StartSwitch {
  if (c.unregister) return "unregister";
  if (c.quit) return "quit";
  if (c.updated) return "updated";
  if (c.background) return "background";
  return "none";
}

function isCommandLine(v: unknown): v is CommandLine {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.testData === null || typeof c.testData === "string") &&
    typeof c.background === "boolean" &&
    typeof c.updated === "boolean" &&
    typeof c.quit === "boolean" &&
    typeof c.unregister === "boolean"
  );
}

/**
 * A command line handed over to the running copy: the starting copy's own, carried as the lock's
 * `additionalData.commandLine` (Chromium reorders the argv the running copy hears and adds switches
 * of its own); else the argv parsed, a command line that cannot be parsed giving every switch off.
 */
// @spec DESK-SHELL-CLI-003
export function handedOverCommand(additionalData: unknown, argv: readonly string[], cwd: string): CommandLine {
  const handed = typeof additionalData === "object" && additionalData !== null
    ? (additionalData as { commandLine?: unknown }).commandLine
    : undefined;
  if (isCommandLine(handed)) {
    const { testData, background, updated, quit, unregister } = handed;
    return { testData, background, updated, quit, unregister };
  }
  const parsed = parseCommandLine(argv, cwd);
  if ("error" in parsed) return { testData: null, background: false, updated: false, quit: false, unregister: false };
  return parsed;
}

/** The switches to start the app again with after a Quit; test mode adds its folder last. */
// @spec DESK-SHELL-QUIT-006
export function relaunchSwitches(kind: "none" | "updated" | "background", plan: RunPlan): string[] {
  const switches = kind === "none" ? [] : [`--${kind}`];
  if (plan.mode === "test" && plan.testFolder !== null) switches.push(`${TEST_DATA}=${plan.testFolder}`);
  return switches;
}
