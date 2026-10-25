/**
 * The install folder check (build/installer-steps.nsh `${CareerMapFolderRefused}`; m3 contract §4.2):
 * the installer's `customInit` refuses a `/D=` naming any folder but `%LOCALAPPDATA%\Programs\MSFS
 * Career Map` before it writes anything, so the uninstaller, which removes the install folder whole,
 * can never reach the data, backups or Electron folders. The step compares both paths made absolute
 * (`GetFullPathNameW`) with any trailing `\` trimmed, ignoring case; no `/D=` at all is accepted. The
 * stand-in install folder plays the install folder; the step only compares, so nothing is written.
 */
import { describe, expect, it } from "vitest";
import { useStandIns } from "./support/harness.ts";
import { buildProgram, run, value } from "./support/nsis.ts";

const standIns = useStandIns();

/** Builds and runs one program checking each [given, expected] pair; returns each pair's OUT. */
async function refused(cases: [given: string, expected: string][]): Promise<string[]> {
  const s = standIns();
  const body = cases
    .map(([given, expected], i) => `  \${CareerMapFolderRefused} $0 "${given}" "${expected}"\n  \${Out} "case${i}=$0"`)
    .join("\n");
  const { out } = await run(await buildProgram(s, "folder", body), s);
  return cases.map((_, i) => value(out, `case${i}`) ?? "(no output)");
}

describe("CareerMapFolderRefused", () => {
  // @spec DESK-DIST-INST-010, DESK-DIST-INCL-001
  it("refuses another folder, a sub-folder, a parent, a sibling sharing its name and '..' tricks", async () => {
    const s = standIns();
    const given = [
      s.elsewhere,
      `${s.install}\\resources`,
      `${s.install}\\resources\\`,
      s.root,
      `${s.install}-other`,
      `${s.install}\\..\\elsewhere`,
      `${s.install}\\sub\\..\\..\\elsewhere`,
      `${s.install}\\..\\install\\..\\data`,
      `${s.install}\\..\\..`,
    ];
    const results = await refused(given.map((g) => [g, s.install]));
    expect(Object.fromEntries(given.map((g, i) => [g, results[i]]))).toEqual(
      Object.fromEntries(given.map((g) => [g, "1"])),
    );
  });

  // @spec DESK-DIST-INST-010, DESK-DIST-INCL-001
  it("accepts no /D=, and the install folder in another case, with a trailing '\\' or with '.' and '..' segments", async () => {
    const s = standIns();
    const cases: [string, string][] = [
      ["", s.install],
      [s.install, s.install],
      [s.install.toUpperCase(), s.install],
      [s.install.toLowerCase(), s.install.toUpperCase()],
      [`${s.install}\\`, s.install],
      [s.install, `${s.install}\\`],
      [`${s.install}\\.\\`, s.install],
      [`${s.install}\\.`, s.install],
      [`${s.root}\\.\\install`, s.install],
      [`${s.install}\\sub\\..`, s.install],
      [`${s.elsewhere}\\..\\install`, s.install],
    ];
    const results = await refused(cases);
    expect(Object.fromEntries(cases.map(([g, e], i) => [`${g} | ${e}`, results[i]]))).toEqual(
      Object.fromEntries(cases.map(([g, e]) => [`${g} | ${e}`, "0"])),
    );
  });
});
