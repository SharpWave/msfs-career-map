/**
 * The server's inputs (src/desktop/server-inputs.ts; m2 contract §5): the start-up arguments in
 * app-shell's names — data folder, program folder, port, backups folder (a literal path in test
 * mode, Documents looked up by the server outside it), sim, airport downloads, the logbook to offer
 * and the fresh-run argument — with no address and no version (DESK-SHELL-SRV-004, 005, 006, 008,
 * 041, 044); the environment less the variables that steer a copy run from source
 * (DESK-SHELL-SRV-010); the backups folder the shell names; the page's address. And the shell
 * itself handing them to the launcher, with the data folder as the working folder
 * (DESK-SHELL-SRV-011).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REMOVED_ENV,
  SERVICE_NAME,
  backupsFolderFor,
  pageUrl,
  serverArgs,
  serverEnv,
} from "../../../src/desktop/server-inputs.ts";
import { Shell } from "../../../src/desktop/shell.ts";
import { flush } from "../support/clock.ts";
import { command, installedPlan, makePorts, tempFolder, testPlan } from "../support/fakes.ts";

const PROGRAM = "C:\\Program Files\\MSFS Career Map\\resources";
const DEV_PROGRAM = "C:\\repo\\build\\desktop";

describe("serverArgs in test mode", () => {
  const plan = testPlan("D:\\career-test");

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-SRV-006, DESK-SHELL-SRV-044
  it("gives the test folders, port 3280, a literal backups folder, the fake feed and downloads off, with --fresh-run on a fresh run", () => {
    expect(serverArgs(plan, DEV_PROGRAM, { offer: null, freshRun: true })).toEqual([
      "--data=D:\\career-test\\data",
      "--program=C:\\repo\\build\\desktop",
      "--port=3280",
      "--backups=D:\\career-test\\Backups",
      "--sim=fake",
      "--airport-downloads=off",
      "--fresh-run",
    ]);
  });

  // @spec DESK-SHELL-SRV-044
  it("leaves --fresh-run out of a later start", () => {
    expect(serverArgs(plan, DEV_PROGRAM, { offer: null, freshRun: false })).toEqual([
      "--data=D:\\career-test\\data",
      "--program=C:\\repo\\build\\desktop",
      "--port=3280",
      "--backups=D:\\career-test\\Backups",
      "--sim=fake",
      "--airport-downloads=off",
    ]);
  });

  // @spec DESK-SHELL-SRV-007
  it("names the plan's port, whatever it is", () => {
    expect(serverArgs(testPlan("D:\\t", 41234), DEV_PROGRAM, { offer: null, freshRun: false })).toContain("--port=41234");
  });
});

describe("serverArgs outside test mode", () => {
  const plan = installedPlan("C:\\Pilot");

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-SRV-005, DESK-SHELL-SRV-008, DESK-SHELL-SRV-041, DESK-SHELL-SRV-044
  it("gives the installed folders, port 3380, Documents' backups path, the sim link and downloads on, with --fresh-run on a fresh run", () => {
    expect(serverArgs(plan, PROGRAM, { offer: null, freshRun: true })).toEqual([
      "--data=C:\\Pilot\\Local\\MSFS Career Map",
      "--program=C:\\Program Files\\MSFS Career Map\\resources",
      "--port=3380",
      "--backups-documents=MSFS Career Map\\Backups",
      "--sim=link",
      "--airport-downloads=on",
      "--fresh-run",
    ]);
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-004
  it("adds --offer=<folder> after the sim and downloads, before --fresh-run", () => {
    expect(serverArgs(plan, PROGRAM, { offer: "D:\\src\\msfs\\data", freshRun: true })).toEqual([
      "--data=C:\\Pilot\\Local\\MSFS Career Map",
      "--program=C:\\Program Files\\MSFS Career Map\\resources",
      "--port=3380",
      "--backups-documents=MSFS Career Map\\Backups",
      "--sim=link",
      "--airport-downloads=on",
      "--offer=D:\\src\\msfs\\data",
      "--fresh-run",
    ]);
    expect(serverArgs(plan, PROGRAM, { offer: "D:\\src\\msfs\\data", freshRun: false })).toEqual([
      "--data=C:\\Pilot\\Local\\MSFS Career Map",
      "--program=C:\\Program Files\\MSFS Career Map\\resources",
      "--port=3380",
      "--backups-documents=MSFS Career Map\\Backups",
      "--sim=link",
      "--airport-downloads=on",
      "--offer=D:\\src\\msfs\\data",
    ]);
  });

  // @spec DESK-SHELL-SRV-008
  it("never gives the backups folder as a path fixed at the start", () => {
    const args = serverArgs(plan, PROGRAM, { offer: null, freshRun: false });
    expect(args.filter((a: string) => a.startsWith("--backups"))).toEqual(["--backups-documents=MSFS Career Map\\Backups"]);
    expect(args.some((a: string) => a.startsWith("--backups="))).toBe(false);
  });
});

describe("serverArgs in either mode", () => {
  // @spec DESK-SHELL-SRV-004
  it("names no address and no version", () => {
    for (const args of [
      serverArgs(testPlan("D:\\t"), DEV_PROGRAM, { offer: null, freshRun: true }),
      serverArgs(installedPlan("C:\\Pilot"), PROGRAM, { offer: "D:\\src", freshRun: true }),
    ]) {
      for (const a of args) {
        expect(a).not.toMatch(/^--(host|address|listen|version)\b/);
        expect(a).not.toContain("127.0.0.1");
      }
    }
  });
});

describe("serverEnv", () => {
  // @spec DESK-SHELL-SRV-010
  it("names the eight variables it removes", () => {
    expect([...REMOVED_ENV]).toEqual([
      "PORT",
      "CAREER_DB",
      "TRACKER",
      "TRACKER_FAKE",
      "SIMCONNECT_HOST",
      "SIMCONNECT_PORT",
      "NODE_OPTIONS",
      "ELECTRON_RUN_AS_NODE",
    ]);
  });

  // @spec DESK-SHELL-SRV-010
  it("drops the eight in any case and keeps Windows' environment", () => {
    const env = {
      Path: "C:\\Windows\\system32;C:\\Windows",
      TEMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
      TMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
      USERPROFILE: "C:\\Users\\pilot",
      LOCALAPPDATA: "C:\\Users\\pilot\\AppData\\Local",
      SystemRoot: "C:\\Windows",
      PORT: "3080",
      career_db: "C:\\x\\career.db",
      Tracker: "sim",
      TRACKER_FAKE: "1",
      SimConnect_Host: "192.168.1.5",
      SIMCONNECT_PORT: "500",
      node_options: "--inspect",
      Electron_Run_As_Node: "1",
      PORT_X: "kept",
      MY_PORT: "kept too",
    };
    expect(serverEnv(env)).toEqual({
      Path: "C:\\Windows\\system32;C:\\Windows",
      TEMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
      TMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
      USERPROFILE: "C:\\Users\\pilot",
      LOCALAPPDATA: "C:\\Users\\pilot\\AppData\\Local",
      SystemRoot: "C:\\Windows",
      PORT_X: "kept",
      MY_PORT: "kept too",
    });
  });

  // @spec DESK-SHELL-SRV-010
  it("drops undefined values and leaves its input as it was", () => {
    const env: Record<string, string | undefined> = { Path: "C:\\Windows", EMPTY: undefined, NODE_OPTIONS: "--x" };
    const out = serverEnv(env);
    expect(out).toEqual({ Path: "C:\\Windows" });
    expect("EMPTY" in out).toBe(false);
    expect(env).toEqual({ Path: "C:\\Windows", EMPTY: undefined, NODE_OPTIONS: "--x" });
    out.Path = "changed";
    expect(env.Path).toBe("C:\\Windows");
  });
});

describe("backupsFolderFor", () => {
  // @spec DESK-SHELL-SRV-006
  it("gives test mode's literal <folder>\\Backups, with or without Documents", () => {
    const plan = testPlan("D:\\career-test");
    expect(backupsFolderFor(plan, null)).toBe("D:\\career-test\\Backups");
    expect(backupsFolderFor(plan, "C:\\Users\\pilot\\Documents")).toBe("D:\\career-test\\Backups");
  });

  // @spec DESK-SHELL-SRV-005, DESK-SHELL-SRV-008
  it("gives MSFS Career Map\\Backups under the Documents folder named, or null when there is none", () => {
    const plan = installedPlan("C:\\Pilot");
    expect(backupsFolderFor(plan, "C:\\Users\\pilot\\OneDrive\\Documents")).toBe(
      "C:\\Users\\pilot\\OneDrive\\Documents\\MSFS Career Map\\Backups",
    );
    expect(backupsFolderFor(plan, "E:\\Docs")).toBe("E:\\Docs\\MSFS Career Map\\Backups");
    expect(backupsFolderFor(plan, null)).toBeNull();
  });
});

describe("pageUrl and the service name", () => {
  // @spec DESK-SHELL-SRV-004
  it("gives the page on 127.0.0.1 and the port", () => {
    expect(pageUrl(3280)).toBe("http://127.0.0.1:3280/");
    expect(pageUrl(3380)).toBe("http://127.0.0.1:3380/");
    expect(pageUrl(41234)).toBe("http://127.0.0.1:41234/");
  });

  // @spec DESK-SHELL-SRV-004
  it("names the server's process", () => {
    expect(SERVICE_NAME).toBe("MSFS Career Map server");
  });
});

describe("the shell starting the server", () => {
  const ENV = {
    Path: "C:\\Windows\\system32",
    TEMP: "C:\\Temp",
    USERPROFILE: "C:\\Users\\pilot",
    PORT: "3080",
    CAREER_DB: "C:\\x\\career.db",
    TRACKER: "sim",
    NODE_OPTIONS: "--inspect",
    ELECTRON_RUN_AS_NODE: "1",
  };

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-SRV-006, DESK-SHELL-SRV-010, DESK-SHELL-SRV-011, DESK-SHELL-SRV-044, DESK-SHELL-FIRST-005
  it("in test mode, starts it at once with the test arguments, the cleaned environment and the data folder as its working folder", async () => {
    const plan = testPlan(tempFolder());
    const ports = makePorts();
    const programFolder = DEV_PROGRAM;
    const serverScript = path.win32.join(programFolder, "server.mjs");
    const shell = new Shell(
      { plan, command: command({ testData: plan.testFolder }), version: "0.8.0", programPath: "C:\\repo\\electron.exe", programFolder, serverScript, env: ENV },
      ports,
    );
    await shell.start();
    await flush();

    expect(ports.launcher.starts).toHaveLength(1);
    expect(ports.launcher.last().options).toEqual({
      script: "C:\\repo\\build\\desktop\\server.mjs",
      args: serverArgs(plan, programFolder, { offer: null, freshRun: true }),
      env: { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\pilot" },
      cwd: plan.dataFolder,
      serviceName: "MSFS Career Map server",
    });
    // No look for a copy run from source in test mode.
    expect(ports.http.calls.filter((c) => c.port === 3080)).toEqual([]);
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-SRV-005, DESK-SHELL-SRV-010, DESK-SHELL-SRV-011
  it("outside test mode, starts it with the installed arguments, the cleaned environment and the data folder as its working folder", async () => {
    const plan = installedPlan(tempFolder());
    const ports = makePorts();
    const programFolder = PROGRAM;
    const serverScript = path.win32.join(programFolder, "server.mjs");
    const shell = new Shell(
      { plan, command: command(), version: "0.8.0", programPath: "C:\\Program Files\\MSFS Career Map\\MSFS Career Map.exe", programFolder, serverScript, env: ENV },
      ports,
    );
    // Nothing answers on 3080 and nothing is remembered: the look settles at once (and is over
    // within 500 ms whatever happens).
    const started = shell.start();
    await ports.clock.advance(500);
    await started;

    expect(ports.launcher.starts).toHaveLength(1);
    expect(ports.launcher.last().options).toEqual({
      script: "C:\\Program Files\\MSFS Career Map\\resources\\server.mjs",
      args: serverArgs(plan, programFolder, { offer: null, freshRun: true }),
      env: { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\pilot" },
      cwd: plan.dataFolder,
      serviceName: "MSFS Career Map server",
    });
  });
});
