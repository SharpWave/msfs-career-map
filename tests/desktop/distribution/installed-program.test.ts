/**
 * Only the installed program runs outside test mode (src/desktop/installed.ts; m2 contract §4.3;
 * DESK-DIST-DEV-004): the shell's own program path, fully resolved — junctions and `..` included —
 * and compared without regard to case, must be `MSFS Career Map.exe` in
 * `%LOCALAPPDATA%\Programs\MSFS Career Map`; an unpackaged `electron.exe`, the unpacked build in
 * `release\win-unpacked`, a copy anywhere else, or a start with `%LOCALAPPDATA%` unset is not, and
 * `decideStart` refuses it with the console text before setting any folder. The install folder here
 * is a temp folder standing in for `%LOCALAPPDATA%`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MODE_ONLY, installedProgramPath, isInstalledProgram } from "../../../src/desktop/installed.ts";
import { decideStart } from "../../../src/desktop/start.ts";
import { tempFolder } from "../support/fakes.ts";

const EXE_NAME = "MSFS Career Map.exe";

/** An empty file at `p`, its folders made. */
function touch(p: string): string {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
  return p;
}

/** A temp stand-in for %LOCALAPPDATA% with the program installed in it. */
function installedLocal(): { root: string; local: string; exe: string } {
  const root = tempFolder("installed-");
  const local = path.join(root, "Local");
  const exe = touch(path.join(local, "Programs", "MSFS Career Map", EXE_NAME));
  return { root, local, exe };
}

describe("installedProgramPath", () => {
  // @spec DESK-DIST-DEV-004
  it("is MSFS Career Map.exe in <LOCALAPPDATA>\\Programs\\MSFS Career Map", () => {
    expect(installedProgramPath("C:\\Users\\pilot\\AppData\\Local")).toBe(
      "C:\\Users\\pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe",
    );
  });
});

describe("isInstalledProgram", () => {
  // @spec DESK-DIST-DEV-004
  it("is true for the installed program", () => {
    const { local, exe } = installedLocal();
    expect(isInstalledProgram(exe, local)).toBe(true);
    expect(isInstalledProgram(installedProgramPath(local), local)).toBe(true);
  });

  // @spec DESK-DIST-DEV-004
  it("compares without regard to case", () => {
    const { local, exe } = installedLocal();
    expect(isInstalledProgram(exe.toUpperCase(), local)).toBe(true);
    expect(isInstalledProgram(exe.toLowerCase(), local.toUpperCase())).toBe(true);
  });

  // @spec DESK-DIST-DEV-004
  it("resolves '..' in either path first", () => {
    const { local, exe } = installedLocal();
    expect(isInstalledProgram(`${local}\\Programs\\..\\Programs\\MSFS Career Map\\${EXE_NAME}`, local)).toBe(true);
    expect(isInstalledProgram(exe, `${local}\\Programs\\..`)).toBe(true);
  });

  // @spec DESK-DIST-DEV-004
  it("resolves a junction in either path first", () => {
    const root = tempFolder("junction-");
    const realLocal = path.join(root, "RealLocal");
    const exe = touch(path.join(realLocal, "Programs", "MSFS Career Map", EXE_NAME));
    const linkLocal = path.join(root, "Local");
    fs.symlinkSync(realLocal, linkLocal, "junction");
    const exeThroughLink = path.join(linkLocal, "Programs", "MSFS Career Map", EXE_NAME);

    // %LOCALAPPDATA% is the junction, the program path the real one.
    expect(isInstalledProgram(exe, linkLocal)).toBe(true);
    // %LOCALAPPDATA% is the real folder, the program path runs through the junction.
    expect(isInstalledProgram(exeThroughLink, realLocal)).toBe(true);
    // A program elsewhere is still not the installed one through a junction.
    const elsewhere = touch(path.join(root, "Elsewhere", "MSFS Career Map", EXE_NAME));
    expect(isInstalledProgram(elsewhere, linkLocal)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("is false for an unpackaged electron.exe", () => {
    const { root, local } = installedLocal();
    const electron = touch(path.join(root, "repo", "node_modules", "electron", "dist", "electron.exe"));
    expect(isInstalledProgram(electron, local)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("is false for the packaged build in release\\win-unpacked", () => {
    const { root, local } = installedLocal();
    const unpacked = touch(path.join(root, "repo", "release", "win-unpacked", EXE_NAME));
    expect(isInstalledProgram(unpacked, local)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("is false for a copy anywhere else, under %LOCALAPPDATA% or not", () => {
    const { root, local } = installedLocal();
    expect(isInstalledProgram(touch(path.join(root, "Copy", "MSFS Career Map", EXE_NAME)), local)).toBe(false);
    expect(isInstalledProgram(touch(path.join(local, "Programs", "Other", EXE_NAME)), local)).toBe(false);
    expect(isInstalledProgram(touch(path.join(local, "Programs", "MSFS Career Map", "Old", EXE_NAME)), local)).toBe(false);
    expect(isInstalledProgram(touch(path.join(local, "Programs", "MSFS Career Map", "electron.exe")), local)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("is false when %LOCALAPPDATA% is not set", () => {
    const { exe } = installedLocal();
    expect(isInstalledProgram(exe, undefined)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("takes a path its realpath cannot resolve as the path resolved", () => {
    const cannot = (p: string): string => {
      throw new Error(`ENOENT: ${p}`);
    };
    expect(
      isInstalledProgram("c:\\pilot\\local\\programs\\msfs career map\\MSFS CAREER MAP.EXE", "C:\\Pilot\\Local", cannot),
    ).toBe(true);
    expect(isInstalledProgram("C:\\Pilot\\Local\\Programs\\x\\..\\MSFS Career Map\\MSFS Career Map.exe", "C:\\Pilot\\Local", cannot)).toBe(
      true,
    );
    expect(isInstalledProgram("C:\\Pilot\\Other\\MSFS Career Map.exe", "C:\\Pilot\\Local", cannot)).toBe(false);
  });

  // @spec DESK-DIST-DEV-004
  it("uses the realpath it is given for both paths", () => {
    const seen: string[] = [];
    // A stand-in that maps the junction X:\Link to the real Y:\Real.
    const realpath = (p: string): string => {
      seen.push(p);
      return p.replace(/^X:\\Link/i, "Y:\\Real");
    };
    expect(isInstalledProgram("Y:\\Real\\Programs\\MSFS Career Map\\MSFS Career Map.exe", "X:\\Link", realpath)).toBe(true);
    // Each side went through it: the program path and the install path under X:\Link.
    expect(seen.some((p) => /^Y:\\Real/i.test(p))).toBe(true);
    expect(seen.some((p) => /^X:\\Link/i.test(p))).toBe(true);
    // Without the junction resolved, the same paths differ.
    expect(isInstalledProgram("Y:\\Real\\Programs\\MSFS Career Map\\MSFS Career Map.exe", "X:\\Link", (p: string) => p)).toBe(false);
  });
});

describe("the refusal outside the install folder", () => {
  // @spec DESK-DIST-DEV-004
  it("runs the installed program, and refuses the same program copied elsewhere, before any folder is set", () => {
    const { root, local, exe } = installedLocal();
    const env = { LOCALAPPDATA: local, APPDATA: path.join(root, "Roaming") };

    const copy = touch(path.join(root, "release", "win-unpacked", EXE_NAME));
    expect(decideStart([copy], env, copy, root)).toEqual({ kind: "refuse", message: TEST_MODE_ONLY, code: 1 });
    expect(decideStart([copy, "--quit"], env, copy, root)).toEqual({ kind: "refuse", message: TEST_MODE_ONLY, code: 1 });
    expect(decideStart([copy, "--unregister"], env, copy, root)).toEqual({ kind: "refuse", message: TEST_MODE_ONLY, code: 1 });
    expect(decideStart([exe], { APPDATA: env.APPDATA }, exe, root)).toEqual({ kind: "refuse", message: TEST_MODE_ONLY, code: 1 });
    // A refusal sets neither folder: no data folder, no Electron folder.
    expect(fs.existsSync(path.join(local, "MSFS Career Map"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Roaming"))).toBe(false);

    const run = decideStart([exe], env, exe, root);
    expect(run.kind).toBe("run");
  });
});
