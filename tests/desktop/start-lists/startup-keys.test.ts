/**
 * Windows' start-up keys as plain functions (m4 contract §5.2, §5.3): reg.exe's arguments and the
 * reader of `reg query`'s output (src/desktop/startup-keys.ts), the two exports joined into one `.reg`
 * file, and what the Run value and its StartupApproved mark mean for the tick
 * (src/desktop/windows-start.ts). The code that runs reg.exe and Electron's login item is seen only by
 * hand.
 */
import { describe, expect, it } from "vitest";
import {
  joinRegExports,
  parseRegQuery,
  regDeleteArgs,
  regExportArgs,
  regQueryArgs,
} from "../../../src/desktop/startup-keys.ts";
import {
  APPROVED_KEY,
  RUN_KEY,
  VALUE_NAME,
  approvedEnabled,
  runValue,
  windowsTicked,
} from "../../../src/desktop/windows-start.ts";
import { APPROVED_DISABLED, APPROVED_ENABLED } from "../support/fakes.ts";
import { TEST_PROGRAM } from "./support/sims.ts";

const RUN_TEXT = `"${TEST_PROGRAM}" --background`;
const HEADER = "Windows Registry Editor Version 5.00";

/** reg.exe's output for a key holding these value lines (name, type, data). */
function queryOutput(key: string, values: [string, string, string][], subkeys: string[] = []): string {
  const lines = ["", key, ...values.map(([n, t, d]) => `    ${n}    ${t}    ${d}`), ""];
  for (const sub of subkeys) lines.push(`${key}\\${sub}`);
  return `${lines.join("\r\n")}\r\n`;
}

/** A .reg file as reg.exe writes it: UTF-16LE with a byte-order mark. */
function regFile(text: string): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
}

describe("the keys and the value's name", () => {
  // @spec DESK-START-WINDOWS-004, DESK-START-WINDOWS-006
  it("are the per-user Run and StartupApproved\\Run keys and the app's name", () => {
    expect(RUN_KEY).toBe("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(APPROVED_KEY).toBe("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");
    expect(VALUE_NAME).toBe("MSFS Career Map");
  });

  // @spec DESK-START-WINDOWS-006
  it("hold the quoted installed program followed by --background", () => {
    expect(runValue(TEST_PROGRAM)).toBe(RUN_TEXT);
  });
});

describe("reg.exe's arguments", () => {
  // @spec DESK-START-WINDOWS-004
  it("query a whole key", () => {
    expect(regQueryArgs(RUN_KEY)).toEqual(["query", RUN_KEY]);
  });

  // @spec DESK-START-WINDOWS-008
  it("delete the value named MSFS Career Map alone, without asking", () => {
    expect(regDeleteArgs(APPROVED_KEY)).toEqual(["delete", APPROVED_KEY, "/v", "MSFS Career Map", "/f"]);
  });

  // @spec DESK-START-WINDOWS-002
  it("export a key to a file, overwriting it", () => {
    expect(regExportArgs(RUN_KEY, "C:\\x\\run.reg")).toEqual(["export", RUN_KEY, "C:\\x\\run.reg", "/y"]);
  });
});

describe("reading reg query's output", () => {
  const RUN = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const APPROVED = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

  // @spec DESK-START-WINDOWS-004
  it("finds the REG_SZ value among others, whatever program it holds", () => {
    const out = queryOutput(RUN, [
      ["OneDrive", "REG_SZ", '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background'],
      ["MSFS Career Map", "REG_SZ", RUN_TEXT],
      ["Discord", "REG_SZ", '"C:\\Users\\Pilot\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe'],
    ]);
    expect(parseRegQuery(out, VALUE_NAME)).toBe(RUN_TEXT);
    const other = queryOutput(RUN, [["MSFS Career Map", "REG_SZ", '"D:\\Elsewhere\\other.exe"']]);
    expect(parseRegQuery(other, VALUE_NAME)).toBe('"D:\\Elsewhere\\other.exe"');
  });

  // @spec DESK-START-WINDOWS-004
  it("reads a REG_EXPAND_SZ value as written, unexpanded", () => {
    const out = queryOutput(RUN, [["MSFS Career Map", "REG_EXPAND_SZ", '"%LOCALAPPDATA%\\Programs\\MSFS Career Map\\MSFS Career Map.exe" --background']]);
    expect(parseRegQuery(out, VALUE_NAME)).toBe('"%LOCALAPPDATA%\\Programs\\MSFS Career Map\\MSFS Career Map.exe" --background');
  });

  // @spec DESK-START-WINDOWS-004
  it("reads a REG_BINARY mark as bytes", () => {
    const out = queryOutput(APPROVED, [
      ["OneDrive", "REG_BINARY", "020000000000000000000000"],
      ["MSFS Career Map", "REG_BINARY", "030000008A3B1F529C46DB01"],
    ]);
    expect(parseRegQuery(out, VALUE_NAME)).toEqual(APPROVED_DISABLED);
  });

  // @spec DESK-START-WINDOWS-004
  it("gives null when no value has that name: none at all, a longer name, or the app's path only in another value's data", () => {
    expect(parseRegQuery(queryOutput(RUN, []), VALUE_NAME)).toBeNull();
    expect(
      parseRegQuery(
        queryOutput(RUN, [
          ["MSFS Career Map Helper", "REG_SZ", '"C:\\x.exe"'],
          ["Launcher", "REG_SZ", '"C:\\Users\\Pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe"'],
        ]),
        VALUE_NAME,
      ),
    ).toBeNull();
  });

  // @spec DESK-START-WINDOWS-004
  it("compares the value's name ignoring case, as the registry does", () => {
    expect(parseRegQuery(queryOutput(RUN, [["msfs career map", "REG_SZ", RUN_TEXT]]), VALUE_NAME)).toBe(RUN_TEXT);
  });

  // @spec DESK-START-WINDOWS-004
  it("reads only the key's own values, not a subkey's listing", () => {
    const out = queryOutput(RUN, [["OneDrive", "REG_SZ", '"C:\\OneDrive.exe"']], ["MSFS Career Map"]);
    expect(parseRegQuery(out, VALUE_NAME)).toBeNull();
  });
});

describe("joining the two exports", () => {
  const runPart = `${HEADER}\r\n\r\n[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]\r\n"OneDrive"="\\"C:\\\\OneDrive.exe\\" /background"\r\n"MSFS Career Map"="\\"C:\\\\x.exe\\" --background"\r\n\r\n`;
  const approvedPart = `${HEADER}\r\n\r\n[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]\r\n"MSFS Career Map"=hex:02,00,00,00,00,00,00,00,00,00,00,00\r\n\r\n`;

  // @spec DESK-START-WINDOWS-002
  it("gives one UTF-16LE file with one byte-order mark and one header, both keys' sections in order", () => {
    const joined = joinRegExports([regFile(runPart), regFile(approvedPart)]);
    expect([...joined.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const text = Buffer.from(joined.subarray(2)).toString("utf16le");
    expect(text.startsWith(`${HEADER}\r\n`)).toBe(true);
    expect(text.split(HEADER)).toHaveLength(2);
    expect(text).not.toContain("\ufeff");
    const run = text.indexOf("[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]");
    const approved = text.indexOf("[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run]");
    expect(run).toBeGreaterThan(0);
    expect(approved).toBeGreaterThan(run);
    expect(text).toContain('"OneDrive"="\\"C:\\\\OneDrive.exe\\" /background"');
    expect(text).toContain('"MSFS Career Map"=hex:02,00,00,00,00,00,00,00,00,00,00,00');
  });

  // @spec DESK-START-WINDOWS-002
  it("gives a file with the header alone when given one export", () => {
    const joined = joinRegExports([regFile(runPart)]);
    const text = Buffer.from(joined.subarray(2)).toString("utf16le");
    expect(text.split(HEADER)).toHaveLength(2);
    expect(text).toContain("CurrentVersion\\Run]");
  });
});

describe("the tick", () => {
  // @spec DESK-START-WINDOWS-007
  it("counts the mark disabled when its first byte is odd, enabled when even or absent", () => {
    expect(approvedEnabled(null)).toBe(true);
    expect(approvedEnabled(APPROVED_ENABLED)).toBe(true);
    expect(approvedEnabled(Uint8Array.from([6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(approvedEnabled(APPROVED_DISABLED)).toBe(false);
    expect(approvedEnabled(Uint8Array.from([7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  // @spec DESK-START-WINDOWS-007
  it("ticks while the Run value is there, whatever it holds, and its mark is not disabled", () => {
    expect(windowsTicked({ run: null, approved: null })).toBe(false);
    expect(windowsTicked({ run: null, approved: APPROVED_ENABLED })).toBe(false);
    expect(windowsTicked({ run: RUN_TEXT, approved: null })).toBe(true);
    expect(windowsTicked({ run: RUN_TEXT, approved: APPROVED_ENABLED })).toBe(true);
    expect(windowsTicked({ run: '"D:\\Other\\other.exe"', approved: null })).toBe(true);
    expect(windowsTicked({ run: RUN_TEXT, approved: APPROVED_DISABLED })).toBe(false);
  });
});
