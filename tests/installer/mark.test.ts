/**
 * The install-under-way mark and the start after an install (build/installer-steps.nsh; m3 contract
 * §4.2, §5.1): `${CareerMapMarkInstall}` marks an install with the installer's own process — appended
 * to the mark in place when the installer runs from electron-updater's download folder, else a new
 * mark in place of any other; `${CareerMapAppendMark}` appends one UTF-16LE line to a mark in place and
 * never creates one; `${CareerMapTakeUpMark}` renames the mark aside, reads and deletes it, and gives
 * the start that shows the most — no switch (`window`), then `--updated`, then `--background` — among
 * the last `request` and every `start` line; `${CareerMapChooseStart}` puts the wizard's Launch box
 * first; `${CareerMapStartApp}` starts the program with that switch, or nothing.
 *
 * The mark's form: UTF-16LE, a BOM from whoever writes it whole, each record a line ending CR LF —
 * `process <id> <program path>`, `request <none|--updated|--background>`, `start <switches>`. The
 * stand-in download folder holds the mark; the fake app in the stand-in install folder records each
 * command line it is started with.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useStandIns } from "./support/harness.ts";
import {
  EXE_NAME,
  type StandIns,
  buildProgram,
  fakeApp,
  processesIn,
  run,
  startedWith,
  value,
  waitFor,
} from "./support/nsis.ts";

const standIns = useStandIns();
const win = path.win32;

const BOM = Buffer.from([0xff, 0xfe]);
const PID = 4242;

/** Lines as the mark's form holds them: UTF-16LE, each ending CR LF. */
function utf16Lines(lines: string[]): Buffer {
  return Buffer.from(lines.map((l) => `${l}\r\n`).join(""), "utf16le");
}

/** A mark written whole: BOM + the lines. */
function markBytes(lines: string[]): Buffer {
  return Buffer.concat([BOM, utf16Lines(lines)]);
}

/** The desktop shell's lines of a mark it wrote as it handed over for a Restart to update. */
function shellMark(s: StandIns): string[] {
  return [`process 1200 ${win.join(s.install, EXE_NAME)}`, "request --updated", "start --background"];
}

function readMark(s: StandIns): Buffer | null {
  return fs.existsSync(s.mark) ? fs.readFileSync(s.mark) : null;
}

/** The program marking an install with the installer at `$params` (run's argument). */
async function markInstallProgram(s: StandIns): Promise<string> {
  return buildProgram(s, "mark-install", `  \${CareerMapMarkInstall} "\${MARK}" "\${DOWNLOADS}" ${PID} "$params"`);
}

describe("CareerMapMarkInstall", () => {
  // @spec DESK-DIST-INST-029, DESK-DIST-INST-025, DESK-DIST-INCL-001
  it("writes a new mark naming the installer, creating the download folder, when there is none", async () => {
    const s = standIns();
    fs.rmSync(s.downloads, { recursive: true, force: true });
    const installer = win.join(s.elsewhere, "MSFS Career Map Setup 0.8.1.exe");
    await run(await markInstallProgram(s), s, [installer]);
    expect(readMark(s)).toEqual(markBytes([`process ${PID} ${installer}`]));
  });

  // @spec DESK-DIST-INST-029, DESK-DIST-INCL-001
  it("writes a new mark when the installer runs from the download folder and none is in place", async () => {
    const s = standIns();
    const installer = win.join(s.downloads, "MSFS Career Map Setup 0.8.1.exe");
    await run(await markInstallProgram(s), s, [installer]);
    expect(readMark(s)).toEqual(markBytes([`process ${PID} ${installer}`]));
  });

  // @spec DESK-DIST-INST-029, DESK-DIST-INST-025, DESK-DIST-INCL-001
  it("appends its process to the mark in place, keeping all it holds, when the installer runs from the download folder", async () => {
    const s = standIns();
    const before = markBytes(shellMark(s));
    fs.writeFileSync(s.mark, before);
    const installer = win.join(s.downloads, "pending", "MSFS Career Map Setup 0.8.1.exe");
    await run(await markInstallProgram(s), s, [installer]);
    expect(readMark(s)).toEqual(Buffer.concat([before, utf16Lines([`process ${PID} ${installer}`])]));
  });

  // @spec DESK-DIST-INST-029, DESK-DIST-INCL-001
  it("replaces the mark in place with a new one when the installer runs from anywhere else", async () => {
    const s = standIns();
    const program = await markInstallProgram(s);
    for (const installer of [
      win.join(s.elsewhere, "MSFS Career Map Setup 0.8.1.exe"),
      // a folder whose name only begins with the download folder's
      win.join(`${s.downloads}-old`, "MSFS Career Map Setup 0.8.1.exe"),
    ]) {
      fs.writeFileSync(s.mark, markBytes(shellMark(s)));
      await run(program, s, [installer]);
      expect(readMark(s), installer).toEqual(markBytes([`process ${PID} ${installer}`]));
    }
  });
});

describe("CareerMapAppendMark", () => {
  // @spec DESK-DIST-INST-025, DESK-DIST-INCL-001
  it("never creates a mark: with none in place it gives 0 and writes nothing", async () => {
    const s = standIns();
    const exe = await buildProgram(s, "append-none", `  \${CareerMapAppendMark} $0 "\${MARK}" "start --updated"\n  \${Out} "written=$0"`);
    const { out } = await run(exe, s);
    expect(value(out, "written")).toBe("0");
    expect(readMark(s)).toBeNull();
    expect(fs.readdirSync(s.downloads)).toEqual([]);
  });

  // @spec DESK-DIST-INST-025, DESK-DIST-INCL-001
  it("appends each line whole to the mark in place as UTF-16LE ending CR LF, and gives 1", async () => {
    const s = standIns();
    const before = markBytes(shellMark(s));
    fs.writeFileSync(s.mark, before);
    const program = `process 77 ${win.join(s.elsewhere, "Zoë ✈", "MSFS Career Map Setup 0.8.1.exe")}`;
    const exe = await buildProgram(
      s,
      "append",
      `  \${CareerMapAppendMark} $0 "\${MARK}" "start --updated"
  \${Out} "first=$0"
  \${CareerMapAppendMark} $0 "\${MARK}" "start "
  \${Out} "second=$0"
  \${CareerMapAppendMark} $0 "\${MARK}" "${program}"
  \${Out} "third=$0"`,
    );
    const { out } = await run(exe, s);
    expect([value(out, "first"), value(out, "second"), value(out, "third")]).toEqual(["1", "1", "1"]);
    expect(readMark(s)).toEqual(Buffer.concat([before, utf16Lines(["start --updated", "start ", program])]));
  });
});

describe("CareerMapTakeUpMark", () => {
  const rows: { records: string[] | null; start: string }[] = [
    { records: null, start: "" },
    { records: [], start: "" },
    { records: ["process 1200 C:\\Users\\pilot\\MSFS Career Map.exe", "request --updated"], start: "--updated" },
    { records: ["request --background", "request none"], start: "" },
    { records: ["request none", "start --background"], start: "--background" },
    { records: ["request --background", "start --updated"], start: "--updated" },
    { records: ["request --updated", "start "], start: "window" },
    { records: ["something a later release adds", "request --background"], start: "--background" },
  ];

  for (const { records, start } of rows) {
    const name = records === null ? "(no mark)" : records.length === 0 ? "(an empty mark)" : records.join(" + ");
    // @spec DESK-DIST-INST-026, DESK-DIST-INST-025, DESK-DIST-INCL-001
    it(`gives '${start}' for ${name}, leaving neither the mark nor the renamed file`, async () => {
      const s = standIns();
      if (records !== null) fs.writeFileSync(s.mark, markBytes(records));
      const exe = await buildProgram(s, "take-up", `  \${CareerMapTakeUpMark} $0 "\${MARK}"\n  \${Out} "start=[$0]"`);
      const { out } = await run(exe, s);
      expect(value(out, "start")).toBe(`[${start}]`);
      // Renamed aside (`install-under-way.<pid>.taken`), read, then deleted: nothing is left.
      expect(fs.readdirSync(s.downloads)).toEqual([]);
    });
  }
});

describe("CareerMapChooseStart", () => {
  // @spec DESK-DIST-INST-026, DESK-DIST-INST-019, DESK-DIST-INCL-001
  it("gives a start with no switch when Launch is ticked, else the mark's start", async () => {
    const s = standIns();
    const cases: [markStart: string, launch: string, start: string][] = [
      ["", "1", "window"],
      ["--background", "1", "window"],
      ["--updated", "1", "window"],
      ["window", "1", "window"],
      ["", "0", ""],
      ["--background", "0", "--background"],
      ["--updated", "0", "--updated"],
      ["window", "0", "window"],
    ];
    const exe = await buildProgram(
      s,
      "choose",
      cases.map(([m, l], i) => `  \${CareerMapChooseStart} $0 "${m}" "${l}"\n  \${Out} "case${i}=[$0]"`).join("\n"),
    );
    const { out } = await run(exe, s);
    expect(cases.map((_, i) => value(out, `case${i}`))).toEqual(cases.map(([, , start]) => `[${start}]`));
  });
});

describe("CareerMapStartApp", () => {
  // @spec DESK-DIST-INST-026, DESK-DIST-INST-024, DESK-DIST-INCL-001
  it("starts the program with no switch for 'window', with the switch for --updated and --background, and nothing for ''", async () => {
    const s = standIns();
    await fakeApp(s, s.install);
    const exe = await buildProgram(s, "start-app", `  \${CareerMapStartApp} "\${PROGRAM}" "$params"`);

    const steps: [start: string, line: string | null][] = [
      ["window", ""],
      ["--updated", "--updated"],
      ["--background", "--background"],
      ["", null],
    ];
    const expected: string[] = [];
    for (const [start, line] of steps) {
      await run(exe, s, start === "" ? [] : [start]);
      if (line !== null) expected.push(line);
      // Started without waiting: the program is still running (the fake app waits to be asked to quit).
      await waitFor(() => startedWith(s.install).length === expected.length, line === null ? 2000 : 30_000);
      expect(startedWith(s.install), `after '${start}'`).toEqual(expected);
      expect(await waitFor(() => processesIn(s.install).length === expected.length, 30_000, 200)).toBe(true);
    }
  });
});
