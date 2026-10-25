/**
 * The include and the desktop shell agree on the install-under-way mark's form (m3 contract §5.1;
 * distribution-design, The mark's form): what the include's steps write, `parseMark`
 * (src/desktop/install-mark.ts) reads, and what `markLine` makes, the include's `${CareerMapAppendMark}`
 * writes byte for byte and its `${CareerMapTakeUpMark}` reads. UTF-16LE, a BOM from whoever writes the
 * mark whole, one record per line ending CR LF; a program path with spaces and characters outside the
 * system code page survives both ways.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_NAME, type MarkRecord, markLine, parseMark } from "../../src/desktop/install-mark.ts";
import { useStandIns } from "./support/harness.ts";
import { buildProgram, run, value } from "./support/nsis.ts";

const standIns = useStandIns();
const win = path.win32;

const BOM = Uint8Array.from([0xff, 0xfe]);

/** A mark written whole the way the desktop shell writes it: BOM + markLine of each record. */
function shellMark(records: MarkRecord[]): Buffer {
  return Buffer.concat([BOM, ...records.map(markLine)]);
}

describe("the mark's form, between the include and the desktop shell", () => {
  // @spec DESK-DIST-INST-025, DESK-DIST-INST-029, DESK-DIST-INCL-001
  it("names the mark as the stand-ins do", () => {
    expect(path.basename(standIns().mark)).toBe(MARK_NAME);
  });

  // @spec DESK-DIST-INST-025, DESK-DIST-INST-029, DESK-DIST-INCL-001
  it("parses a mark the include wrote whole and appended to", async () => {
    const s = standIns();
    const installer = win.join(s.elsewhere, "Zoë ✈ downloads", "MSFS Career Map Setup 0.8.1.exe");
    const exe = await buildProgram(
      s,
      "write-mark",
      `  \${CareerMapMarkInstall} "\${MARK}" "\${DOWNLOADS}" 4242 "${installer}"
  \${CareerMapAppendMark} $0 "\${MARK}" "request --background"
  \${CareerMapAppendMark} $0 "\${MARK}" "start "
  \${CareerMapAppendMark} $0 "\${MARK}" "start --updated"`,
    );
    await run(exe, s);
    expect(parseMark(new Uint8Array(fs.readFileSync(s.mark)))).toEqual([
      { kind: "process", pid: 4242, program: installer },
      { kind: "request", start: "--background" },
      { kind: "start", switches: "" },
      { kind: "start", switches: "--updated" },
    ]);
  });

  // @spec DESK-DIST-INST-025, DESK-DIST-INCL-001
  it("appends the same bytes markLine makes for the same record", async () => {
    const s = standIns();
    const program = win.join(s.install, "Zoë ✈", "MSFS Career Map.exe");
    const first: MarkRecord = { kind: "process", pid: 1200, program };
    fs.writeFileSync(s.mark, shellMark([first]));
    const exe = await buildProgram(
      s,
      "append-lines",
      `  \${CareerMapAppendMark} $0 "\${MARK}" "request none"
  \${CareerMapAppendMark} $0 "\${MARK}" "start "
  \${CareerMapAppendMark} $0 "\${MARK}" "start --background"
  \${CareerMapAppendMark} $0 "\${MARK}" "process 77 ${program}"`,
    );
    await run(exe, s);
    expect(fs.readFileSync(s.mark)).toEqual(
      shellMark([
        first,
        { kind: "request", start: "none" },
        { kind: "start", switches: "" },
        { kind: "start", switches: "--background" },
        { kind: "process", pid: 77, program },
      ]),
    );
  });

  // @spec DESK-DIST-INST-025, DESK-DIST-INST-026, DESK-DIST-INCL-001
  it("takes up a mark the desktop shell wrote with markLine", async () => {
    const s = standIns();
    const exe = await buildProgram(s, "take-up", `  \${CareerMapTakeUpMark} $0 "\${MARK}"\n  \${Out} "start=[$0]"`);
    const shell: MarkRecord = { kind: "process", pid: 1200, program: win.join(s.install, "Zoë ✈", "MSFS Career Map.exe") };
    const cases: [MarkRecord[], string][] = [
      [[shell, { kind: "request", start: "--updated" }, { kind: "start", switches: "--background" }], "--updated"],
      [[shell, { kind: "request", start: "none" }, { kind: "start", switches: "" }], "window"],
      [[shell, { kind: "request", start: "none" }, { kind: "request", start: "--background" }], "--background"],
      [[shell, { kind: "request", start: "--background" }, { kind: "request", start: "none" }], ""],
    ];
    for (const [records, start] of cases) {
      fs.writeFileSync(s.mark, shellMark(records));
      const { out } = await run(exe, s);
      expect(value(out, "start"), JSON.stringify(records.slice(1))).toBe(`[${start}]`);
      expect(fs.readdirSync(s.downloads)).toEqual([]);
    }
  });
});
