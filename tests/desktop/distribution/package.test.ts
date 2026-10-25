/**
 * What the repository's own files hold for the desktop app (m2 contract §17): Electron, esbuild and
 * electron-builder pinned to exact versions (DESK-DIST-PKG-007, those three now), the `desktop` and `desktop:build`
 * scripts that build the page with Vite and then the desktop build output (DESK-DIST-DEV-001), and
 * the folders kept out of git — `.desktop-dev/`, `build/desktop/` and `release/` — while the NSIS
 * include `build/installer.nsh` stays in git (DESK-DIST-DEV-002).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

interface PackageJson {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock: { packages: Record<string, { version?: string }> } = JSON.parse(
  fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"),
);
const declared = (name: string) => pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];

const gitignoreLines = () =>
  fs
    .readFileSync(path.join(REPO, ".gitignore"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim());

/** A .gitignore pattern as a regular expression over a slash-separated path from the repository root. */
function patternRegex(pattern: string): RegExp {
  const anchored = pattern.includes("/");
  const p = pattern.replace(/^\//, "");
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else body += "[^/]*";
    } else if (ch === "?") body += "[^/]";
    else body += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
}

/** The lines that would ignore `file` or one of the folders holding it (negations not counted). */
function linesIgnoring(lines: string[], file: string): string[] {
  const parts = file.split("/");
  const candidates = parts.map((_, i) => ({ path: parts.slice(0, i + 1).join("/"), dir: i < parts.length - 1 }));
  return lines.filter((line) => {
    if (line === "" || line.startsWith("#") || line.startsWith("!")) return false;
    const dirOnly = line.endsWith("/");
    const re = patternRegex(dirOnly ? line.slice(0, -1) : line);
    return candidates.some((c) => (!dirOnly || c.dir) && re.test(c.path));
  });
}

describe("the pinned tools", () => {
  // @spec DESK-DIST-PKG-007
  it("pin Electron to an exact 45.x release and esbuild to an exact version, as installed", () => {
    expect(declared("electron")).toMatch(/^45\.\d+\.\d+$/);
    expect(declared("esbuild")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.packages["node_modules/electron"]?.version).toBe(declared("electron"));
    expect(lock.packages["node_modules/esbuild"]?.version).toBe(declared("esbuild"));
  });

  // @spec DESK-DIST-PKG-007
  it("pin electron-builder to 26.18.0 exactly, as installed", () => {
    expect(declared("electron-builder")).toBe("26.18.0");
    expect(lock.packages["node_modules/electron-builder"]?.version).toBe("26.18.0");
    expect(lock.packages["node_modules/app-builder-lib"]?.version).toBe("26.18.0");
  });

  // @spec DESK-DIST-PKG-007, DESK-SHELL-UPD-001
  it("pin electron-updater to 6.8.11 exactly, as installed, among the app's own dependencies", () => {
    expect(declared("electron-updater")).toBe("6.8.11");
    expect(pkg.dependencies?.["electron-updater"]).toBe("6.8.11");
    expect(lock.packages["node_modules/electron-updater"]?.version).toBe("6.8.11");
  });
});

describe("the desktop scripts", () => {
  // @spec DESK-DIST-DEV-001
  it("build the page with Vite, then the desktop build output, and for npm run desktop start Electron", () => {
    expect(pkg.scripts.desktop).toBe("vite build && tsx --no-warnings=ExperimentalWarning scripts/desktop.ts");
    expect(pkg.scripts["desktop:build"]).toBe("vite build && tsx --no-warnings=ExperimentalWarning scripts/desktop-build.ts");
  });
});

describe("the folders kept out of git", () => {
  // @spec DESK-DIST-DEV-002
  it("are .desktop-dev/, the desktop build output and electron-builder's output", () => {
    const lines = gitignoreLines();
    expect(lines).toContain("/.desktop-dev/");
    expect(lines).toContain("/build/desktop/");
    expect(lines).toContain("/release/");
    // Each ignores what lies inside it (other lines may ignore some of it too).
    expect(linesIgnoring(lines, "build/desktop/main.cjs")).toContain("/build/desktop/");
    expect(linesIgnoring(lines, ".desktop-dev/data/career.db")).toContain("/.desktop-dev/");
    expect(linesIgnoring(lines, "release/win-unpacked/MSFS Career Map.exe")).toContain("/release/");
  });

  // @spec DESK-DIST-DEV-002
  it("leave the NSIS include build/installer.nsh, and the steps it includes, in git", () => {
    expect(linesIgnoring(gitignoreLines(), "build/installer.nsh")).toEqual([]);
    expect(linesIgnoring(gitignoreLines(), "build/installer-steps.nsh")).toEqual([]);
  });

  // @spec DESK-DIST-DEV-002
  it("are judged by a check that catches each way of ignoring build/installer.nsh", () => {
    for (const line of ["/build/", "build/", "*.nsh", "/build", "build", "/build/*", "build/**", "**/installer.nsh", "installer.nsh"]) {
      expect(linesIgnoring(["/release/", line], "build/installer.nsh")).toEqual([line]);
    }
    for (const line of ["/build/desktop/", "/release/", "/.desktop-dev/", "dist/", "!build/", "# build/"]) {
      expect(linesIgnoring([line], "build/installer.nsh")).toEqual([]);
    }
  });
});
