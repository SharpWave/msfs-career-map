/**
 * The pure parts of the real Windows facts (src/desktop/windows-facts.ts; m2 contract §3.4): the
 * commands' arguments and the readers of their output. MSFS running for this Windows account is
 * looked up by account and program name together (DESK-SHELL-AWAY-001); a process's program file
 * (DESK-SHELL-SRV-029); Windows' excluded port ranges (DESK-SHELL-SRV-034); Documents as the registry
 * names it at each look-up, as the server reads it (DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025). The
 * run functions, windowsFacts() and knownFolders(), are never called here: importing the module
 * must reach nothing (DESK-SHELL-TEST-001).
 */
import { describe, expect, it } from "vitest";
import {
  DOCUMENTS_ARGS,
  MSFS_PROGRAMS,
  NETSH_ARGS,
  driveTypeArgs,
  isFixedDriveOutput,
  knownFolders,
  parseDocumentsOutput,
  parseProcessIds,
  processPathArgs,
  processesInArgs,
  tasklistArgs,
  tasklistHas,
  windowsFacts,
  windowsUser,
} from "../../../src/desktop/windows-facts.ts";
import { takeGuardHits } from "../support/guard.ts";

describe("loading the module", () => {
  // @spec DESK-SHELL-TEST-001
  it("reaches no process, port or Electron, and exports the run functions without calling them", () => {
    expect(takeGuardHits()).toEqual([]);
    expect(typeof windowsFacts).toBe("function");
    expect(typeof knownFolders).toBe("function");
  });
});

describe("MSFS running for this Windows account", () => {
  // @spec DESK-SHELL-AWAY-001
  it("looks for MSFS 2024's and MSFS 2020's programs", () => {
    expect(MSFS_PROGRAMS).toEqual(["FlightSimulator2024.exe", "FlightSimulator.exe"]);
  });

  // @spec DESK-SHELL-AWAY-001
  it("names the account as domain\\user", () => {
    expect(windowsUser({ USERDOMAIN: "DESKTOP-PILOT", USERNAME: "pilot" })).toBe("DESKTOP-PILOT\\pilot");
  });

  // @spec DESK-SHELL-AWAY-001
  it("filters tasklist by the account and the program together, as CSV without a header", () => {
    expect(tasklistArgs("DESKTOP-PILOT\\pilot", "FlightSimulator2024.exe")).toEqual([
      "/FI",
      "USERNAME eq DESKTOP-PILOT\\pilot",
      "/FI",
      "IMAGENAME eq FlightSimulator2024.exe",
      "/FO",
      "CSV",
      "/NH",
    ]);
    expect(tasklistArgs("DESKTOP-PILOT\\pilot", "FlightSimulator.exe")).toContain("IMAGENAME eq FlightSimulator.exe");
  });

  // @spec DESK-SHELL-AWAY-001
  it("finds the program in tasklist's CSV by the first field, ignoring case", () => {
    const out = '"FlightSimulator2024.exe","23140","Console","1","4,812,336 K"\r\n';
    expect(tasklistHas(out, "FlightSimulator2024.exe")).toBe(true);
    expect(tasklistHas(out, "flightsimulator2024.EXE")).toBe(true);
    expect(tasklistHas('"flightsimulator.exe","880","Console","1","3,100,200 K"\r\n', "FlightSimulator.exe")).toBe(true);
    expect(tasklistHas(out, "FlightSimulator.exe")).toBe(false);
    const several =
      '"explorer.exe","6012","Console","1","180,224 K"\r\n' + '"FlightSimulator.exe","9120","Console","1","2,400,000 K"\r\n';
    expect(tasklistHas(several, "FlightSimulator.exe")).toBe(true);
    expect(tasklistHas(several, "FlightSimulator2024.exe")).toBe(false);
  });

  // @spec DESK-SHELL-AWAY-001
  it("finds nothing in the INFO line however it is worded, in an empty output, or in another field", () => {
    expect(tasklistHas("INFO: No tasks are running which match the specified criteria.\r\n", "FlightSimulator2024.exe")).toBe(false);
    expect(
      tasklistHas("INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n", "FlightSimulator2024.exe"),
    ).toBe(false);
    expect(tasklistHas("", "FlightSimulator2024.exe")).toBe(false);
    expect(tasklistHas('"launcher.exe","77","FlightSimulator2024.exe","1","1,000 K"\r\n', "FlightSimulator2024.exe")).toBe(false);
  });
});

describe("a process's program file", () => {
  // @spec DESK-SHELL-SRV-029
  it("asks PowerShell for the process's Path by its id", () => {
    expect(processPathArgs(12345)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Process -Id 12345 -ErrorAction SilentlyContinue).Path",
    ]);
  });
});

describe("processes running from a folder", () => {
  // @spec DESK-DIST-INST-030
  it("asks PowerShell for the ids of this user's processes whose program lies inside the folder", () => {
    expect(processesInArgs("C:\\Users\\pilot\\AppData\\Local\\msfs-career-map-updater")).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('C:\\Users\\pilot\\AppData\\Local\\msfs-career-map-updater\\', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Id }",
    ]);
  });

  // @spec DESK-DIST-INST-030
  it("doubles a quote in the folder, as a PowerShell single-quoted string needs", () => {
    expect(processesInArgs("C:\\Users\\O'Brien\\AppData\\Local\\msfs-career-map-updater")[3]).toContain(
      "StartsWith('C:\\Users\\O''Brien\\AppData\\Local\\msfs-career-map-updater\\',",
    );
  });

  // @spec DESK-DIST-INST-030
  it("reads one id per line, passing over anything else", () => {
    expect(parseProcessIds("977\r\n\r\n12040\r\nGet-Process : denied\r\n")).toEqual([977, 12040]);
    expect(parseProcessIds("")).toEqual([]);
  });
});

describe("a fixed drive", () => {
  // @spec DESK-SHELL-FIRST-002
  it("asks PowerShell for the drive's type by its letter", () => {
    expect(driveTypeArgs("D")).toEqual(["-NoProfile", "-NonInteractive", "-Command", "[System.IO.DriveInfo]::new('D').DriveType"]);
  });

  // @spec DESK-SHELL-FIRST-002
  it("is fixed only when the trimmed output is Fixed", () => {
    expect(isFixedDriveOutput("Fixed\r\n")).toBe(true);
    expect(isFixedDriveOutput("  Fixed  \n")).toBe(true);
    expect(isFixedDriveOutput("Removable\r\n")).toBe(false);
    expect(isFixedDriveOutput("Network\r\n")).toBe(false);
    expect(isFixedDriveOutput("NoRootDirectory\r\n")).toBe(false);
    expect(isFixedDriveOutput("")).toBe(false);
  });
});

describe("Windows' excluded port ranges", () => {
  // @spec DESK-SHELL-SRV-034
  it("asks netsh for the TCP ranges", () => {
    expect(NETSH_ARGS).toEqual(["int", "ipv4", "show", "excludedportrange", "protocol=tcp"]);
  });
});

describe("Documents as the registry names it", () => {
  // The shape reg.exe gives (CRLF lines, contract §20 E9).
  const regOutput = (type: string, value: string) =>
    "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n" +
    `    Personal    ${type}    ${value}\r\n\r\n`;

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
  it("reads the Personal value of the current user's shell folders", () => {
    expect(DOCUMENTS_ARGS).toEqual([
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
      "/v",
      "Personal",
    ]);
  });

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
  it("takes the value of reg.exe's real-shaped output", () => {
    expect(parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "C:\\Users\\pilot\\Documents"), {})).toBe("C:\\Users\\pilot\\Documents");
    expect(parseDocumentsOutput(regOutput("REG_SZ", "D:\\Docs"), {})).toBe("D:\\Docs");
    expect(parseDocumentsOutput(regOutput("REG_SZ", "C:\\Users\\pilot\\OneDrive - Personal\\Documents"), {})).toBe(
      "C:\\Users\\pilot\\OneDrive - Personal\\Documents",
    );
  });

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
  it("expands %NAME% from the given environment, the name matched ignoring case", () => {
    expect(parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "%USERPROFILE%\\Documents"), { USERPROFILE: "C:\\Users\\pilot" })).toBe(
      "C:\\Users\\pilot\\Documents",
    );
    expect(parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "%USERPROFILE%\\Documents"), { UserProfile: "C:\\Users\\pilot" })).toBe(
      "C:\\Users\\pilot\\Documents",
    );
    expect(parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "%userprofile%\\Documents"), { USERPROFILE: "C:\\Users\\pilot" })).toBe(
      "C:\\Users\\pilot\\Documents",
    );
    expect(
      parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "%HOMEDRIVE%%HOMEPATH%\\Documents"), { HOMEDRIVE: "C:", HOMEPATH: "\\Users\\pilot" }),
    ).toBe("C:\\Users\\pilot\\Documents");
  });

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
  it("leaves an unknown %NAME% as it is", () => {
    expect(parseDocumentsOutput(regOutput("REG_EXPAND_SZ", "%NOSUCHNAME%\\Documents"), { USERPROFILE: "C:\\Users\\pilot" })).toBe(
      "%NOSUCHNAME%\\Documents",
    );
  });

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
  it("is null when no Personal line is there", () => {
    expect(parseDocumentsOutput("ERROR: The system was unable to find the specified registry key or value.\r\n", {})).toBeNull();
    expect(parseDocumentsOutput("", {})).toBeNull();
    expect(
      parseDocumentsOutput(
        "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n" +
          "    My Music    REG_EXPAND_SZ    %USERPROFILE%\\Music\r\n\r\n",
        { USERPROFILE: "C:\\Users\\pilot" },
      ),
    ).toBeNull();
  });
});
