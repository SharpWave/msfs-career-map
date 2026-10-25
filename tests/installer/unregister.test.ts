/**
 * The uninstaller's `--unregister` and its last page (build/installer-steps.nsh
 * `${CareerMapRunUnregister}`, `${CareerMapUnregisterText}`; m3 contract §4.2, §4.4): a real uninstall
 * runs the installed program with `--unregister`, waits a bounded time for it (30 s in the include) and
 * goes ahead regardless, keeping its exit code — or `timeout`, or `error` when it cannot start — for the
 * last page. The page always names the three folders it kept, then by the code: 0 nothing more; 1 or 3
 * MSFS's start list (both editions' EXE.xml folders); 2 or 3 Windows' start-up list (the Run key only,
 * never StartupApproved); anything else that the start lists could not be checked, naming all of them.
 *
 * The fake app in the stand-in install folder plays the installed program: it exits with the code in
 * `unregister-code`, or hangs when that holds `hang`. Waits here are a few seconds, not 30.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useStandIns } from "./support/harness.ts";
import { buildProgram, block, fakeApp, processesIn, run, startedWith, value } from "./support/nsis.ts";

const standIns = useStandIns();
const win = path.win32;

/** A program running `$params` with --unregister, waiting `waitMs`, and timing it. */
function runUnregisterBody(waitMs: number): string {
  return `  \${Ticks} $8
  \${CareerMapRunUnregister} $0 "$params" ${waitMs}
  \${Ticks} $9
  IntOp $9 $9 - $8
  \${Out} "result=$0"
  \${Out} "ms=$9"`;
}

describe("CareerMapRunUnregister", () => {
  // @spec DESK-DIST-UNINST-002, DESK-DIST-INCL-001
  it("runs the program with --unregister and gives its exit code", async () => {
    const s = standIns();
    const program = await fakeApp(s, s.install);
    const exe = await buildProgram(s, "unregister", runUnregisterBody(60_000));
    const results: Record<string, string | undefined> = {};
    for (const code of ["0", "1", "2", "3", "7"]) {
      fs.writeFileSync(win.join(s.install, "unregister-code"), code);
      results[code] = value((await run(exe, s, [program])).out, "result");
    }
    expect(results).toEqual({ "0": "0", "1": "1", "2": "2", "3": "3", "7": "7" });
    expect(startedWith(s.install)).toEqual(Array(5).fill("--unregister"));
    expect(processesIn(s.install)).toEqual([]);
  });

  // @spec DESK-DIST-UNINST-002, DESK-DIST-INCL-001
  it("gives 'timeout' once the wait is over, leaving the program running", async () => {
    const s = standIns();
    const program = await fakeApp(s, s.install);
    fs.writeFileSync(win.join(s.install, "unregister-code"), "hang");
    const { out } = await run(await buildProgram(s, "unregister-hang", runUnregisterBody(3000)), s, [program]);
    expect(value(out, "result")).toBe("timeout");
    const ms = Number(value(out, "ms"));
    expect(ms, "waited the whole wait").toBeGreaterThanOrEqual(2900);
    expect(ms, "and went ahead").toBeLessThan(13_000);
    expect(startedWith(s.install)).toEqual(["--unregister"]);
    expect(processesIn(s.install)).toHaveLength(1);
  });

  // @spec DESK-DIST-UNINST-002, DESK-DIST-INCL-001
  it("gives 'error' when the program cannot be started", async () => {
    const s = standIns();
    const { out } = await run(await buildProgram(s, "unregister-missing", runUnregisterBody(3000)), s, [
      win.join(s.install, "MSFS Career Map.exe"),
    ]);
    expect(value(out, "result")).toBe("error");
    expect(fs.readdirSync(s.install)).toEqual([]);
  });
});

describe("CareerMapUnregisterText", () => {
  const RESULTS = ["0", "1", "2", "3", "7", "timeout", "error"];

  /** The last page's text for each result. */
  async function texts(): Promise<Record<string, string>> {
    const s = standIns();
    const exe = await buildProgram(
      s,
      "unregister-text",
      RESULTS.map((r) => `  \${CareerMapUnregisterText} $0 "${r}"\n  \${Out} "BEGIN ${r}"\n  \${Out} "$0"\n  \${Out} "END"`).join(
        "\n",
      ),
    );
    const { out } = await run(exe, s);
    return Object.fromEntries(RESULTS.map((r) => [r, block(out, `BEGIN ${r}`)]));
  }

  const KEPT = [
    "MSFS Career Map has been uninstalled.",
    "were kept and can be deleted by hand",
    "%LOCALAPPDATA%\\MSFS Career Map",
    "MSFS Career Map\\Backups in Documents",
    "%APPDATA%\\MSFS Career Map",
  ];
  const EXE_XML = [
    "still holds MSFS Career Map's entry",
    "Microsoft.Limitless_8wekyb3d8bbwe\\LocalCache",
    "Microsoft Flight Simulator 2024",
  ];
  const RUN_KEY = ["Windows' start-up list still holds MSFS Career Map", "CurrentVersion\\Run"];
  const UNCHECKED = [
    "The start lists could not be checked",
    "Microsoft.Limitless_8wekyb3d8bbwe\\LocalCache",
    "Microsoft Flight Simulator 2024",
    "CurrentVersion\\Run",
  ];

  // @spec DESK-DIST-UNINST-008, DESK-DIST-INCL-001
  it("always names the three folders kept, and never StartupApproved", async () => {
    const t = await texts();
    for (const r of RESULTS) {
      for (const phrase of KEPT) expect(t[r], `result ${r}`).toContain(phrase);
      expect(t[r], `result ${r}`).not.toContain("StartupApproved");
    }
    expect(t["0"]).toContain("Electron's own folder");
  });

  // @spec DESK-DIST-UNINST-008, DESK-DIST-UNINST-009, DESK-DIST-INCL-001
  it("says nothing more for 0", async () => {
    const t = (await texts())["0"];
    for (const phrase of ["still holds", "could not be checked", "EXE.xml", "CurrentVersion\\Run", "Limitless"]) {
      expect(t).not.toContain(phrase);
    }
  });

  // @spec DESK-DIST-UNINST-009, DESK-DIST-INCL-001
  it("names both MSFS editions' EXE.xml folders for 1, the Run key for 2, and both for 3", async () => {
    const t = await texts();
    for (const phrase of EXE_XML) expect(t["1"]).toContain(phrase);
    expect(t["1"]).not.toContain("CurrentVersion\\Run");
    expect(t["1"]).not.toContain("Windows' start-up list");

    for (const phrase of RUN_KEY) expect(t["2"]).toContain(phrase);
    expect(t["2"]).not.toContain("EXE.xml");
    expect(t["2"]).not.toContain("Limitless");

    for (const phrase of [...EXE_XML, ...RUN_KEY]) expect(t["3"]).toContain(phrase);

    for (const r of ["1", "2", "3"]) {
      expect(t[r], `result ${r}`).toContain("could not be checked");
      expect(t[r], `result ${r}`).not.toContain("The start lists could not be checked");
    }
  });

  // @spec DESK-DIST-UNINST-010, DESK-DIST-INCL-001
  it("says the start lists could not be checked, naming every place, for a timeout, an error or an unknown code", async () => {
    const t = await texts();
    for (const r of ["7", "timeout", "error"]) {
      for (const phrase of UNCHECKED) expect(t[r], `result ${r}`).toContain(phrase);
      expect(t[r], `result ${r}`).not.toContain("still holds");
    }
  });
});
