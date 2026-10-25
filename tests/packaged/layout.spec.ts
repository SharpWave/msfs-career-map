/**
 * The packaged program's layout (m3 contract §2, §6.2), read in place in electron-builder's output
 * (`release/win-unpacked`) without starting it: the program's name, the app archive holding only the
 * shell, the page and seed lists and server bundles beside it in the resources, node-simconnect and its
 * own dependencies as separate files with their licences, every Chromium locale, the icons, and the
 * fuses.
 */
import fs from "node:fs";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { expect, test } from "@playwright/test";
import { PROGRAM, RELEASE, REPO, UNPACKED } from "./support/app.ts";

const RESOURCES = path.join(UNPACKED, "resources");
const ASAR = path.join(RESOURCES, "app.asar");

const REPO_PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { name: string; version: string };
const TOAST_CLSID = "{69576F59-9E6C-4DE8-8C3F-10C5489AA31F}";

/** @electron/fuses' fuse states: '0' and '1' as bytes. */
const FUSE_DISABLE = 48;
const FUSE_ENABLE = 49;

/** The packages tsx, Vite and the page bring, none of which may ship (express is bundled into server.mjs). */
const DEV_AND_PAGE_PACKAGES = ["tsx", "vite", "esbuild", "react", "react-dom", "react-leaflet", "leaflet", "express", "electron", "@fontsource"];

/** The archive's entries as forward-slash paths without a leading slash. */
function asarEntries(): string[] {
  return listPackage(ASAR, { isPack: false }).map((e) => e.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

/** The licence file in a package folder: LICENSE, LICENCE, license.md and the like, any case. */
function licenceFile(dir: string): string | null {
  const name = fs.readdirSync(dir).find((n) => /^licen[cs]e(\.[a-z]+)?$/i.test(n));
  return name ? path.join(dir, name) : null;
}

/** The sizes of an .ico's images, 0 in the directory meaning 256 (width × height). */
function icoSizes(file: string): string[] {
  const ico = fs.readFileSync(file);
  expect(ico.readUInt16LE(0), `${file}: reserved`).toBe(0);
  expect(ico.readUInt16LE(2), `${file}: type icon`).toBe(1);
  const n = ico.readUInt16LE(4);
  const sizes: string[] = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    const w = ico[o] === 0 ? 256 : ico[o];
    const h = ico[o + 1] === 0 ? 256 : ico[o + 1];
    sizes.push(`${w}x${h}`);
  }
  return sizes;
}

/** Each package's name in a node_modules folder, scoped ones as @scope/name. */
function packagesIn(nodeModules: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(nodeModules)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) for (const sub of fs.readdirSync(path.join(nodeModules, name))) out.push(`${name}/${sub}`);
    else out.push(name);
  }
  return out.sort();
}

/** node-simconnect and its production dependencies, walked through the packaged package.json files. */
function dependencyClosure(nodeModules: string, root: string): string[] {
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const manifest = path.join(nodeModules, name, "package.json");
    if (!exists(manifest)) return;
    const deps = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {};
    for (const d of Object.keys(deps)) walk(d);
  };
  walk(root);
  return [...seen].sort();
}

test.beforeAll(() => {
  if (!exists(PROGRAM)) throw new Error(`The unpacked packaged build is missing (${PROGRAM}). Run npm run package first.`);
});

test.describe("the packaged program in release/win-unpacked", () => {
  // @spec DESK-DIST-PKG-003, DESK-DIST-DEV-007
  test("is MSFS Career Map.exe, named by the product name", () => {
    expect(exists(PROGRAM)).toBe(true);
    expect(fs.statSync(PROGRAM).isFile()).toBe(true);
    const exes = fs.readdirSync(UNPACKED).filter((n) => n.toLowerCase().endsWith(".exe"));
    expect(exes).toContain("MSFS Career Map.exe");
    expect(exes).not.toContain("electron.exe");
  });

  // @spec DESK-DIST-PKG-013, DESK-DIST-PKG-008, DESK-DIST-PKG-010
  test("holds in its app archive the shell's main.cjs and package.json and nothing else of the app", () => {
    expect(exists(ASAR)).toBe(true);
    const entries = asarEntries();
    const topLevel = [...new Set(entries.map((e) => e.split("/")[0]))].sort();
    expect(topLevel).toEqual(["main.cjs", "package.json"]);
    const devOrPage = entries.filter((e) => DEV_AND_PAGE_PACKAGES.some((p) => e.includes(`node_modules/${p}/`) || e.endsWith(`node_modules/${p}`)));
    expect(devOrPage).toEqual([]);
    // Nothing the server or page reads sits in the archive: they are plain files beside it.
    expect(entries.filter((e) => /(^|\/)(page|server\.mjs|startup-worker\.mjs|airports\.csv|runways\.csv|node-simconnect)(\/|$)/.test(e))).toEqual([]);
    // No unpacked twin of the archive.
    expect(exists(path.join(RESOURCES, "app"))).toBe(false);
  });

  // @spec DESK-DIST-PKG-002, DESK-DIST-PKG-004
  test("its packaged package.json runs main.cjs under the package name and carries the ToastActivatorCLSID", () => {
    const manifest = JSON.parse(extractFile(ASAR, "package.json").toString("utf8")) as Record<string, unknown>;
    expect(manifest.name).toBe("msfs-career-map");
    expect(manifest.main).toBe("main.cjs");
    expect(manifest.version).toBe(REPO_PACKAGE.version);
    expect(manifest.toastActivatorClsid).toBe(TOAST_CLSID);
  });

  // @spec DESK-DIST-PKG-008
  test("holds the page build as page/ in its resources, beside the seed lists with their download times and the server bundles", () => {
    expect(fs.statSync(path.join(RESOURCES, "page")).isDirectory()).toBe(true);
    expect(exists(path.join(RESOURCES, "page", "index.html"))).toBe(true);
    const assets = path.join(RESOURCES, "page", "assets");
    expect(exists(assets) && fs.readdirSync(assets).length > 0).toBe(true);
    for (const list of ["airports.csv", "runways.csv"]) {
      const file = path.join(RESOURCES, list);
      expect(exists(file), list).toBe(true);
      expect(fs.statSync(file).size, list).toBeGreaterThan(0);
      const downloaded = fs.readFileSync(`${file}.downloaded`, "utf8").trim();
      expect(downloaded, `${list}.downloaded`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    }
    expect(exists(path.join(RESOURCES, "server.mjs"))).toBe(true);
    expect(exists(path.join(RESOURCES, "startup-worker.mjs"))).toBe(true);
  });

  // @spec DESK-DIST-PKG-010, DESK-DIST-PKG-013
  test("ships node-simconnect and only its own dependencies as files outside the archive, each with its licence, LGPL-3.0 for node-simconnect", () => {
    const nodeModules = path.join(RESOURCES, "node_modules");
    expect(fs.statSync(nodeModules).isDirectory()).toBe(true);
    const shipped = packagesIn(nodeModules);
    expect(shipped).toContain("node-simconnect");
    expect(shipped).toEqual(dependencyClosure(nodeModules, "node-simconnect"));
    // The repository's node-simconnect names the same dependencies the packaged one does.
    const repoDeps = Object.keys(
      (JSON.parse(fs.readFileSync(path.join(REPO, "node_modules", "node-simconnect", "package.json"), "utf8")) as { dependencies?: Record<string, string> })
        .dependencies ?? {},
    );
    for (const d of repoDeps) expect(shipped).toContain(d);
    for (const p of DEV_AND_PAGE_PACKAGES) expect(shipped.filter((s) => s === p || s.startsWith(`${p}/`))).toEqual([]);

    for (const name of shipped) {
      const dir = path.join(nodeModules, name);
      expect(exists(path.join(dir, "package.json")), `${name}/package.json`).toBe(true);
      expect(licenceFile(dir), `${name}'s licence file`).not.toBeNull();
    }

    const simconnect = path.join(nodeModules, "node-simconnect");
    const licence = fs.readFileSync(licenceFile(simconnect)!, "utf8");
    expect(licence).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(licence).toContain("Version 3");
    const manifest = JSON.parse(fs.readFileSync(path.join(simconnect, "package.json"), "utf8")) as { main?: string };
    expect(fs.statSync(path.join(simconnect, "dist")).isDirectory()).toBe(true);
    expect(exists(path.join(simconnect, manifest.main ?? "index.js"))).toBe(true);
    expect(exists(path.join(simconnect, "samples"))).toBe(false);
  });

  // @spec DESK-DIST-PKG-010
  test("loads node-simconnect from those files: the server bundle holds none of its code", () => {
    const server = fs.readFileSync(path.join(RESOURCES, "server.mjs"), "utf8");
    expect(server).not.toMatch(/class SimConnectConnection\b/);
    expect(server).toMatch(/from\s*["']node-simconnect["']|import\(\s*["']node-simconnect["']\s*\)|require\(\s*["']node-simconnect["']\s*\)/);
  });

  // @spec DESK-DIST-PKG-014
  test("holds every Chromium locale", () => {
    const locales = fs.readdirSync(path.join(UNPACKED, "locales")).filter((n) => n.endsWith(".pak"));
    expect(locales.length).toBeGreaterThan(50);
    for (const l of ["en-US.pak", "de.pak", "fr.pak", "ja.pak", "pt-BR.pak", "zh-CN.pak"]) expect(locales).toContain(l);
  });

  // @spec DESK-DIST-PKG-015, DESK-DIST-PKG-016
  test("holds career-map.ico with a 256 px image, and the tray icons with 16, 20, 24 and 32 px images", () => {
    const icons = path.join(RESOURCES, "icons");
    expect(icoSizes(path.join(icons, "career-map.ico"))).toContain("256x256");
    for (const name of ["tray", "tray-red", "tray-blue", "tray-violet", "tray-amber", "tray-green"]) {
      const sizes = icoSizes(path.join(icons, `${name}.ico`));
      for (const px of [16, 20, 24, 32]) expect(sizes, `${name}.ico`).toContain(`${px}x${px}`);
    }
  });

  // @spec DESK-DIST-PKG-017, DESK-DIST-PKG-018
  test("is built with the RunAsNode and NODE_OPTIONS fuses off and the inspect fuse on", async () => {
    const wire = await getCurrentFuseWire(PROGRAM);
    expect(wire[FuseV1Options.RunAsNode], "RunAsNode").toBe(FUSE_DISABLE);
    expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable], "EnableNodeOptionsEnvironmentVariable").toBe(FUSE_DISABLE);
    expect(wire[FuseV1Options.EnableNodeCliInspectArguments], "EnableNodeCliInspectArguments").toBe(FUSE_ENABLE);
  });
});

test.describe("electron-builder's output in release/", () => {
  // @spec DESK-DIST-PKG-005, DESK-DIST-PKG-022
  test("holds the installer, its blockmap and latest.yml beside the unpacked build, and app-update.yml in the program's resources", () => {
    const installer = path.join(RELEASE, `MSFS Career Map Setup ${REPO_PACKAGE.version}.exe`);
    expect(exists(installer)).toBe(true);
    expect(exists(`${installer}.blockmap`)).toBe(true);
    const latest = fs.readFileSync(path.join(RELEASE, "latest.yml"), "utf8");
    expect(latest).toContain(`version: ${REPO_PACKAGE.version}`);
    expect(latest).toContain("sha512:");
    const update = fs.readFileSync(path.join(RESOURCES, "app-update.yml"), "utf8");
    expect(update).toContain("provider: github");
    expect(update).toContain("owner: SharpWave");
    expect(update).toContain("repo: msfs-career-map");
  });
});
