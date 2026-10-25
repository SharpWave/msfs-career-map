/**
 * The start (src/desktop/start.ts; m2 contract §4.2, §4.4): the run's plan — the data folder,
 * Electron's own folder (where the single-instance lock lives), the port, the sim, airport downloads
 * and the backups folder — as literal paths from `--test-data=<folder>` or from `%LOCALAPPDATA%` and
 * `%APPDATA%`, the same in every release (DESK-SHELL-CLI-002, DESK-SHELL-SRV-005, DESK-SHELL-SRV-006,
 * DESK-SHELL-SRV-041); and the decision `main.ts` acts on: refuse (a bad `--test-data`, a program
 * other than the installed one outside test mode, DESK-DIST-DEV-004), `--unregister`'s own work,
 * `--quit` only to hand over, or a run that asks for the lock (DESK-SHELL-CLI-001, 003, 007, 009,
 * 010, 011, 012, 019).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MODE_ONLY } from "../../../src/desktop/installed.ts";
import { INSTALLED_PORT, TEST_PORT, decideStart, runPlan, type RunPlan } from "../../../src/desktop/start.ts";
import { command } from "../support/fakes.ts";

const LOCAL = "C:\\Users\\pilot\\AppData\\Local";
const ROAMING = "C:\\Users\\pilot\\AppData\\Roaming";
const ENV = { LOCALAPPDATA: LOCAL, APPDATA: ROAMING };
const INSTALLED_EXE = "C:\\Users\\pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
const ELECTRON = "C:\\repo\\node_modules\\electron\\dist\\electron.exe";
const UNPACKED = "C:\\repo\\release\\win-unpacked\\MSFS Career Map.exe";
const APP_FOLDER = "C:\\repo\\build\\desktop";
const CWD = "C:\\repo";
/** None of these paths exist: each resolves to itself (the default would fall back to the same). */
const realpath = (p: string) => path.win32.resolve(p);

const INSTALLED_PLAN: RunPlan = {
  mode: "installed",
  testFolder: null,
  dataFolder: "C:\\Users\\pilot\\AppData\\Local\\MSFS Career Map",
  electronFolder: "C:\\Users\\pilot\\AppData\\Roaming\\MSFS Career Map",
  port: 3380,
  sim: "link",
  airportDownloads: true,
  backups: { kind: "documents", path: "MSFS Career Map\\Backups" },
};

function testModePlan(folder: string): RunPlan {
  return {
    mode: "test",
    testFolder: folder,
    dataFolder: `${folder}\\data`,
    electronFolder: `${folder}\\desktop`,
    port: 3280,
    sim: "fake",
    airportDownloads: false,
    backups: { kind: "folder", folder: `${folder}\\Backups` },
  };
}

/** The installed program started with these arguments. */
function installed(...args: string[]) {
  return decideStart([INSTALLED_EXE, ...args], ENV, INSTALLED_EXE, CWD, realpath);
}
/** An unpackaged start (`electron <app folder>`) with these arguments. */
function unpackaged(...args: string[]) {
  return decideStart([ELECTRON, APP_FOLDER, ...args], ENV, ELECTRON, CWD, realpath);
}

describe("runPlan", () => {
  // @spec DESK-SHELL-CLI-002, DESK-SHELL-SRV-005, DESK-SHELL-SRV-041
  it("gives the installed app its literal folders under %LOCALAPPDATA% and %APPDATA%, port 3380, the sim link and downloads on", () => {
    expect(runPlan(null, ENV)).toEqual(INSTALLED_PLAN);
    expect(INSTALLED_PORT).toBe(3380);
  });

  // @spec DESK-SHELL-CLI-002, DESK-SHELL-CLI-010, DESK-SHELL-SRV-006
  it("gives test mode <folder>\\data, <folder>\\desktop and <folder>\\Backups, port 3280, the fake feed and downloads off", () => {
    expect(runPlan("D:\\career-test", {})).toEqual(testModePlan("D:\\career-test"));
    expect(TEST_PORT).toBe(3280);
  });

  // @spec DESK-SHELL-CLI-002, DESK-SHELL-CLI-010
  it("takes nothing from the environment in test mode", () => {
    expect(runPlan("D:\\career-test", ENV)).toEqual(testModePlan("D:\\career-test"));
  });

  // @spec DESK-SHELL-CLI-001, DESK-SHELL-CLI-010
  it("gives each test folder an Electron folder of its own, apart from the installed app's, so each holds its own lock", () => {
    const a = runPlan("D:\\t1", ENV);
    const b = runPlan("D:\\t2", ENV);
    const i = runPlan(null, ENV);
    expect(new Set([a.electronFolder, b.electronFolder, i.electronFolder]).size).toBe(3);
    expect(new Set([a.dataFolder, b.dataFolder, i.dataFolder]).size).toBe(3);
  });
});

describe("decideStart outside test mode", () => {
  // @spec DESK-DIST-DEV-004
  it("states the refusal's text exactly", () => {
    expect(TEST_MODE_ONLY).toBe(
      "MSFS Career Map runs only in test mode here: start it with --test-data=<folder>. Only the installed program, %LOCALAPPDATA%\\Programs\\MSFS Career Map\\MSFS Career Map.exe, runs outside test mode.",
    );
  });

  // @spec DESK-DIST-DEV-004, DESK-SHELL-CLI-002
  it("refuses an unpackaged start without --test-data whatever its switches, before any folder is set", () => {
    const refusal = { kind: "refuse", message: TEST_MODE_ONLY, code: 1 };
    for (const args of [[], ["--background"], ["--updated"], ["--quit"], ["--unregister"], ["--quit", "--unregister"]]) {
      expect(unpackaged(...args)).toEqual(refusal);
    }
  });

  // @spec DESK-DIST-DEV-004
  it("refuses a packaged build run from anywhere but the install folder", () => {
    const refusal = { kind: "refuse", message: TEST_MODE_ONLY, code: 1 };
    expect(decideStart([UNPACKED], ENV, UNPACKED, CWD, realpath)).toEqual(refusal);
    expect(decideStart([UNPACKED, "--quit"], ENV, UNPACKED, CWD, realpath)).toEqual(refusal);
    expect(decideStart([UNPACKED, "--unregister"], ENV, UNPACKED, CWD, realpath)).toEqual(refusal);
  });

  // @spec DESK-DIST-DEV-004
  it("refuses the installed program's path when %LOCALAPPDATA% is not set", () => {
    expect(decideStart([INSTALLED_EXE], { APPDATA: ROAMING }, INSTALLED_EXE, CWD, realpath)).toEqual({
      kind: "refuse",
      message: TEST_MODE_ONLY,
      code: 1,
    });
  });

  // @spec DESK-SHELL-CLI-002
  it("refuses the installed program when %APPDATA% is not set", () => {
    expect(decideStart([INSTALLED_EXE], { LOCALAPPDATA: LOCAL }, INSTALLED_EXE, CWD, realpath)).toEqual({
      kind: "refuse",
      message: "Cannot start: %APPDATA% is not set",
      code: 1,
    });
  });

  // @spec DESK-SHELL-CLI-001, DESK-SHELL-CLI-003, DESK-SHELL-CLI-011
  it("runs the installed program with no switch, asking for the lock on the installed plan", () => {
    expect(installed()).toEqual({ kind: "run", plan: INSTALLED_PLAN, command: command() });
  });

  // @spec DESK-SHELL-CLI-003, DESK-SHELL-CLI-011
  it("runs the installed program with --background or --updated, its command line kept for the start or the hand-over", () => {
    expect(installed("--background")).toEqual({ kind: "run", plan: INSTALLED_PLAN, command: command({ background: true }) });
    expect(installed("--updated")).toEqual({ kind: "run", plan: INSTALLED_PLAN, command: command({ updated: true }) });
  });

  // @spec DESK-SHELL-CLI-007, DESK-SHELL-CLI-012
  it("takes --quit only to hand over", () => {
    expect(installed("--quit")).toEqual({ kind: "quit-only", plan: INSTALLED_PLAN, command: command({ quit: true }) });
    expect(installed("--background", "--quit")).toEqual({
      kind: "quit-only",
      plan: INSTALLED_PLAN,
      command: command({ quit: true, background: true }),
    });
  });

  // @spec DESK-SHELL-CLI-009, DESK-SHELL-CLI-012
  it("takes --unregister as its own work, before --quit and the rest", () => {
    expect(installed("--unregister")).toEqual({ kind: "unregister", plan: INSTALLED_PLAN });
    expect(installed("--quit", "--unregister", "--background")).toEqual({ kind: "unregister", plan: INSTALLED_PLAN });
  });

  // @spec DESK-SHELL-CLI-015
  it("ignores Chromium's switches beside the installed program's", () => {
    expect(installed("--allow-file-access-from-files", "--inspect=9229", "--background")).toEqual({
      kind: "run",
      plan: INSTALLED_PLAN,
      command: command({ background: true }),
    });
  });

  // @spec DESK-SHELL-CLI-010
  it("refuses a --test-data with no folder first, with its own text", () => {
    const needsFolder = { kind: "refuse", message: "--test-data needs a folder: --test-data=<folder>", code: 1 };
    expect(installed("--test-data=")).toEqual(needsFolder);
    expect(unpackaged("--test-data")).toEqual(needsFolder);
  });
});

describe("decideStart in test mode", () => {
  const T = "D:\\career-test";

  // @spec DESK-SHELL-CLI-010, DESK-SHELL-CLI-019
  it("runs any program on --test-data=<folder> alone, needing neither %LOCALAPPDATA% nor %APPDATA%", () => {
    const expected = { kind: "run", plan: testModePlan(T), command: command({ testData: T }) };
    expect(decideStart([ELECTRON, APP_FOLDER, `--test-data=${T}`], {}, ELECTRON, CWD, realpath)).toEqual(expected);
    expect(decideStart([UNPACKED, `--test-data=${T}`], ENV, UNPACKED, CWD, realpath)).toEqual(expected);
    expect(decideStart([INSTALLED_EXE, `--test-data=${T}`], ENV, INSTALLED_EXE, CWD, realpath)).toEqual(expected);
  });

  // @spec DESK-SHELL-CLI-010
  it("resolves a relative --test-data against the working folder", () => {
    expect(decideStart([ELECTRON, APP_FOLDER, "--test-data=.desktop-dev"], {}, ELECTRON, "C:\\repo", realpath)).toEqual({
      kind: "run",
      plan: testModePlan("C:\\repo\\.desktop-dev"),
      command: command({ testData: "C:\\repo\\.desktop-dev" }),
    });
  });

  // @spec DESK-SHELL-CLI-019, DESK-SHELL-CLI-003, DESK-SHELL-CLI-011
  it("acts on --background and --updated beside --test-data as it would alone, for that folder's copy", () => {
    expect(unpackaged(`--test-data=${T}`, "--background")).toEqual({
      kind: "run",
      plan: testModePlan(T),
      command: command({ testData: T, background: true }),
    });
    expect(unpackaged("--updated", `--test-data=${T}`)).toEqual({
      kind: "run",
      plan: testModePlan(T),
      command: command({ testData: T, updated: true }),
    });
  });

  // @spec DESK-SHELL-CLI-019, DESK-SHELL-CLI-007, DESK-SHELL-CLI-012
  it("takes --quit beside --test-data only to hand over to that folder's copy", () => {
    expect(unpackaged(`--test-data=${T}`, "--quit")).toEqual({
      kind: "quit-only",
      plan: testModePlan(T),
      command: command({ testData: T, quit: true }),
    });
  });

  // @spec DESK-SHELL-CLI-009, DESK-SHELL-CLI-012, DESK-SHELL-CLI-019
  it("takes --unregister beside --test-data as test mode's own work, reaching nothing past its folders", () => {
    expect(unpackaged(`--test-data=${T}`, "--unregister")).toEqual({ kind: "unregister", plan: testModePlan(T) });
    expect(unpackaged("--quit", "--unregister", `--test-data=${T}`)).toEqual({ kind: "unregister", plan: testModePlan(T) });
  });

  // @spec DESK-SHELL-CLI-010
  it("lets the last --test-data choose the folder", () => {
    expect(unpackaged("--test-data=D:\\a", "--test-data=D:\\b")).toEqual({
      kind: "run",
      plan: testModePlan("D:\\b"),
      command: command({ testData: "D:\\b" }),
    });
  });
});
