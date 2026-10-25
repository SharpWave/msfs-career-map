/**
 * The command line (src/desktop/cli.ts; m2 contract §4.1): only `--background`, `--updated`,
 * `--quit`, `--unregister` and `--test-data=<folder>` count, every other argument — Chromium's and
 * Electron's own switches, the script path — is ignored (DESK-SHELL-CLI-015); `--test-data=<folder>`
 * chooses test mode on a folder resolved against the working folder (DESK-SHELL-CLI-010) and only
 * that, the other switches beside it acting as they would alone (DESK-SHELL-CLI-019). The switch
 * acted on, a command line handed over to the running copy (DESK-SHELL-CLI-003; Chromium reorders
 * the argv the running copy hears, so the starting copy's parsed command line travels as the lock's
 * additional data), and the switches the app starts again with after a Quit (DESK-SHELL-QUIT-006).
 */
import { describe, expect, it } from "vitest";
import {
  handedOverCommand,
  parseCommandLine,
  relaunchSwitches,
  startSwitch,
  type CommandLine,
} from "../../../src/desktop/cli.ts";
import { command, installedPlan, testPlan } from "../support/fakes.ts";

const EXE = "C:\\Pilot\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
const ELECTRON = "C:\\repo\\node_modules\\electron\\dist\\electron.exe";
const APP_FOLDER = "C:\\repo\\build\\desktop";
const CWD = "C:\\work\\here";
const NEEDS_FOLDER = { error: "--test-data needs a folder: --test-data=<folder>" };

/** The argv of a packaged start: the program, then the arguments. */
function packaged(...args: string[]): string[] {
  return [EXE, ...args];
}
/** The argv of an unpackaged start: electron.exe, the app folder, then the arguments. */
function unpackaged(...args: string[]): string[] {
  return [ELECTRON, APP_FOLDER, ...args];
}

describe("parseCommandLine", () => {
  // @spec DESK-SHELL-CLI-015
  it("gives all switches off and no test folder for a command line with none", () => {
    expect(parseCommandLine(packaged(), CWD)).toEqual(command());
    expect(parseCommandLine(unpackaged(), CWD)).toEqual(command());
    expect(parseCommandLine([], CWD)).toEqual(command());
  });

  // @spec DESK-SHELL-CLI-015
  it("reads each of the four switches alone", () => {
    expect(parseCommandLine(packaged("--background"), CWD)).toEqual(command({ background: true }));
    expect(parseCommandLine(packaged("--updated"), CWD)).toEqual(command({ updated: true }));
    expect(parseCommandLine(packaged("--quit"), CWD)).toEqual(command({ quit: true }));
    expect(parseCommandLine(packaged("--unregister"), CWD)).toEqual(command({ unregister: true }));
  });

  // @spec DESK-SHELL-CLI-015
  it("reads several switches together, in any order", () => {
    expect(parseCommandLine(packaged("--quit", "--background", "--unregister", "--updated"), CWD)).toEqual(
      command({ background: true, updated: true, quit: true, unregister: true }),
    );
  });

  // @spec DESK-SHELL-CLI-015
  it("ignores Chromium's and Electron's switches and every other argument", () => {
    const argv = unpackaged(
      "--allow-file-access-from-files",
      "--inspect=9229",
      "--inspect-brk",
      "--remote-debugging-port=9222",
      "--no-sandbox",
      "--enable-logging",
      "--squirrel-firstrun",
      "KBOS",
      "C:\\some\\file.txt",
    );
    expect(parseCommandLine(argv, CWD)).toEqual(command());
  });

  // @spec DESK-SHELL-CLI-015
  it("takes only exact matches: look-alikes of the switches are ignored", () => {
    const argv = packaged(
      "--backgrounds",
      "--background=yes",
      "-background",
      "/background",
      "--updated=1",
      "--quit-now",
      "--quitx",
      "-quit",
      "--unregister-all",
      "--test-database=C:\\x",
      "--test-data-x=C:\\y",
    );
    expect(parseCommandLine(argv, CWD)).toEqual(command());
  });

  // @spec DESK-SHELL-CLI-010
  it("takes an absolute --test-data folder as it is", () => {
    expect(parseCommandLine(packaged("--test-data=D:\\career-test"), CWD)).toEqual(command({ testData: "D:\\career-test" }));
  });

  // @spec DESK-SHELL-CLI-010
  it("resolves a relative --test-data folder against the working folder, with Windows' rules", () => {
    expect(parseCommandLine(unpackaged("--test-data=.desktop-dev"), "C:\\repo")).toEqual(
      command({ testData: "C:\\repo\\.desktop-dev" }),
    );
    expect(parseCommandLine(unpackaged("--test-data=..\\other\\t"), "C:\\work\\here")).toEqual(
      command({ testData: "C:\\work\\other\\t" }),
    );
    expect(parseCommandLine(unpackaged("--test-data=sub/dir"), "C:\\work")).toEqual(command({ testData: "C:\\work\\sub\\dir" }));
  });

  // @spec DESK-SHELL-CLI-010
  it("keeps everything after the first '=' as the folder", () => {
    expect(parseCommandLine(packaged("--test-data=C:\\a=b"), CWD)).toEqual(command({ testData: "C:\\a=b" }));
  });

  // @spec DESK-SHELL-CLI-010
  it("lets the last --test-data win", () => {
    expect(parseCommandLine(packaged("--test-data=C:\\first", "--background", "--test-data=C:\\second"), CWD)).toEqual(
      command({ testData: "C:\\second", background: true }),
    );
  });

  // @spec DESK-SHELL-CLI-010
  it("refuses --test-data= with no folder, with the exact text", () => {
    expect(parseCommandLine(packaged("--test-data="), CWD)).toEqual(NEEDS_FOLDER);
    expect(parseCommandLine(packaged("--background", "--test-data="), CWD)).toEqual(NEEDS_FOLDER);
  });

  // @spec DESK-SHELL-CLI-010
  it("refuses a bare --test-data, with the exact text", () => {
    expect(parseCommandLine(packaged("--test-data"), CWD)).toEqual(NEEDS_FOLDER);
    expect(parseCommandLine(unpackaged("--quit", "--test-data"), CWD)).toEqual(NEEDS_FOLDER);
  });

  // @spec DESK-SHELL-CLI-019
  it("reads the other switches beside --test-data as it reads them alone", () => {
    for (const s of ["background", "updated", "quit", "unregister"] as const) {
      expect(parseCommandLine(unpackaged(`--test-data=C:\\t`, `--${s}`), CWD)).toEqual(command({ testData: "C:\\t", [s]: true }));
      expect(parseCommandLine(unpackaged(`--${s}`, `--test-data=C:\\t`), CWD)).toEqual(command({ testData: "C:\\t", [s]: true }));
    }
  });
});

describe("startSwitch", () => {
  // @spec DESK-SHELL-CLI-015, DESK-SHELL-CLI-019
  it("names the switch acted on: --unregister, then --quit, then --updated, then --background, else none", () => {
    expect(startSwitch(command())).toBe("none");
    expect(startSwitch(command({ testData: "C:\\t" }))).toBe("none");
    expect(startSwitch(command({ background: true }))).toBe("background");
    expect(startSwitch(command({ updated: true }))).toBe("updated");
    expect(startSwitch(command({ quit: true }))).toBe("quit");
    expect(startSwitch(command({ unregister: true }))).toBe("unregister");

    expect(startSwitch(command({ background: true, updated: true }))).toBe("updated");
    expect(startSwitch(command({ background: true, updated: true, quit: true }))).toBe("quit");
    expect(startSwitch(command({ background: true, updated: true, quit: true, unregister: true }))).toBe("unregister");
    expect(startSwitch(command({ quit: true, unregister: true }))).toBe("unregister");
    expect(startSwitch(command({ background: true, quit: true }))).toBe("quit");
    expect(startSwitch(command({ testData: "C:\\t", background: true }))).toBe("background");
  });
});

describe("handedOverCommand", () => {
  /** The argv the running copy's second-instance event gets (§20 E2): switches first, Chromium's added, the script path last. */
  const REORDERED = [ELECTRON, "--background", "--test-data=C:\\t", "--allow-file-access-from-files", APP_FOLDER];

  // @spec DESK-SHELL-CLI-003
  it("uses the command line the starting copy handed over as additional data", () => {
    const handed: CommandLine = { testData: "C:\\t", background: false, updated: true, quit: false, unregister: false };
    // The argv says something else: the additional data wins.
    expect(handedOverCommand({ commandLine: handed }, REORDERED, CWD)).toEqual(handed);
    expect(handedOverCommand({ commandLine: command({ quit: true }) }, [ELECTRON, APP_FOLDER], CWD)).toEqual(command({ quit: true }));
  });

  // @spec DESK-SHELL-CLI-003, DESK-SHELL-CLI-015
  it("parses the argv when the additional data does not have a command line's shape, ignoring Chromium's reordering and additions", () => {
    const garbage: unknown[] = [
      undefined,
      null,
      "x",
      42,
      {},
      { commandLine: null },
      { commandLine: "--quit" },
      { commandLine: { background: "yes" } },
      { commandLine: { testData: 7, background: false, updated: false, quit: false, unregister: false } },
      { commandLine: { testData: null, background: false, updated: false, quit: 1, unregister: false } },
      { commandLine: { testData: null, background: false, updated: false, quit: false } },
    ];
    for (const data of garbage) {
      expect(handedOverCommand(data, REORDERED, CWD)).toEqual(command({ testData: "C:\\t", background: true }));
    }
  });

  // @spec DESK-SHELL-CLI-010
  it("resolves a relative --test-data in the argv against the cwd it is given", () => {
    expect(handedOverCommand(null, [ELECTRON, "--test-data=.desktop-dev", APP_FOLDER], "C:\\repo")).toEqual(
      command({ testData: "C:\\repo\\.desktop-dev" }),
    );
  });

  // @spec DESK-SHELL-CLI-003
  it("gives all switches off and no test folder when the argv cannot be parsed either", () => {
    expect(handedOverCommand({}, [ELECTRON, "--quit", "--test-data=", APP_FOLDER], CWD)).toEqual(command());
    expect(handedOverCommand(null, [ELECTRON, "--background", "--test-data"], CWD)).toEqual(command());
  });
});

describe("relaunchSwitches", () => {
  // @spec DESK-SHELL-QUIT-006
  it("starts the installed app again with no switch, --updated or --background", () => {
    const plan = installedPlan("C:\\Pilot");
    expect(relaunchSwitches("none", plan)).toEqual([]);
    expect(relaunchSwitches("updated", plan)).toEqual(["--updated"]);
    expect(relaunchSwitches("background", plan)).toEqual(["--background"]);
  });

  // @spec DESK-SHELL-QUIT-006, DESK-SHELL-CLI-019
  it("adds --test-data=<folder> last in test mode, so the app starts again on the same folder", () => {
    const plan = testPlan("C:\\tests\\t1");
    expect(relaunchSwitches("none", plan)).toEqual(["--test-data=C:\\tests\\t1"]);
    expect(relaunchSwitches("updated", plan)).toEqual(["--updated", "--test-data=C:\\tests\\t1"]);
    expect(relaunchSwitches("background", plan)).toEqual(["--background", "--test-data=C:\\tests\\t1"]);
  });
});
