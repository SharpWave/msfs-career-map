/**
 * The packaging configuration (electron-builder.json; m3 contract §2) and the names that never change
 * from one release to the next: the appId, the ToastActivatorCLSID beside it, the product name and the
 * package name, read from the configuration and package.json and failing on any change
 * (DESK-DIST-PKG-001 to DESK-DIST-PKG-006, DESK-DIST-PKG-019); the per-user NSIS installer as the only
 * target, with no folder choice and the include's hooks (DESK-DIST-PKG-005, DESK-DIST-INST-001,
 * DESK-DIST-INST-003, DESK-DIST-INST-009); electron-builder's output in `release/` (DESK-DIST-PKG-022);
 * every locale, the icons and the fuses (DESK-DIST-PKG-014, DESK-DIST-PKG-015, DESK-DIST-PKG-017,
 * DESK-DIST-PKG-018); and the npm scripts that package and test the packaged app. What the packaged
 * program then holds is checked on the build itself (tests/packaged/layout.spec.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeAppManifest } from "../../../scripts/desktop-build.ts";
import { downloadsFolder } from "../../../src/desktop/install-mark.ts";
import { installedProgramPath } from "../../../src/desktop/installed.ts";
import { tempFolder } from "../support/fakes.ts";

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = (file: string) => fs.readFileSync(path.join(REPO, file), "utf8");

// The fixed values (desktop-design, Names and folders). A change here is a change to every installed copy.
const APP_ID = "io.github.sharpwave.msfscareermap";
const TOAST_CLSID = "{69576F59-9E6C-4DE8-8C3F-10C5489AA31F}";
const PRODUCT = "MSFS Career Map";
const PACKAGE = "msfs-career-map";

interface BuilderConfig {
  appId?: string;
  productName?: string;
  extraMetadata?: Record<string, unknown>;
  directories?: { app?: string; output?: string; buildResources?: string };
  electronLanguages?: unknown;
  electronFuses?: Record<string, boolean>;
  win?: { target?: unknown; icon?: string };
  nsis?: Record<string, unknown>;
  publish?: unknown;
}

const config: BuilderConfig = JSON.parse(read("electron-builder.json"));
const pkg: {
  name: string;
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
} = JSON.parse(read("package.json"));

/** The win targets as names, whichever form the configuration uses. */
function winTargets(): string[] {
  const t = config.win?.target;
  const list = Array.isArray(t) ? t : t === undefined ? [] : [t];
  return list.map((x) => (typeof x === "string" ? x : (x as { target: string }).target));
}

/** The `!macro <name>` names the include defines (NSIS keywords ignore case; names are kept as written). */
function includeMacros(): string[] {
  return [...read("build/installer.nsh").matchAll(/^\s*!macro\s+(\S+)/gim)].map((m) => m[1]);
}

describe("the names that never change", () => {
  // @spec DESK-DIST-PKG-001, DESK-DIST-PKG-019
  it("set the appId, also the AppUserModelID", () => {
    expect(config.appId).toBe(APP_ID);
  });

  // @spec DESK-DIST-PKG-002, DESK-DIST-PKG-019
  it("keep the ToastActivatorCLSID, a GUID chosen once, beside the appId and carried into the program", () => {
    expect(config.extraMetadata?.toastActivatorClsid).toBe(TOAST_CLSID);
    expect(TOAST_CLSID).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
  });

  // @spec DESK-DIST-PKG-003, DESK-DIST-PKG-019
  it("set the product name, which names the program", () => {
    expect(config.productName).toBe(PRODUCT);
  });

  // @spec DESK-DIST-PKG-004, DESK-DIST-PKG-019
  it("name the package msfs-career-map in package.json and in the app's own manifest", () => {
    expect(pkg.name).toBe(PACKAGE);
    const out = tempFolder("manifest-");
    try {
      writeAppManifest(out, "0.8.0");
      const manifest = JSON.parse(fs.readFileSync(path.join(out, "package.json"), "utf8"));
      expect(manifest.name).toBe(PACKAGE);
      expect(manifest.productName).toBe(PRODUCT);
      expect(manifest.main).toBe("main.cjs");
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  // @spec DESK-DIST-PKG-006, DESK-DIST-INST-009
  it("put the program in %LOCALAPPDATA%\\Programs\\MSFS Career Map and updates in %LOCALAPPDATA%\\msfs-career-map-updater", () => {
    const local = "C:\\Users\\pilot\\AppData\\Local";
    expect(path.win32.dirname(installedProgramPath(local))).toBe(`${local}\\Programs\\${PRODUCT}`);
    expect(path.win32.basename(installedProgramPath(local))).toBe(`${PRODUCT}.exe`);
    // electron-updater names its folder after the package: <name>-updater.
    expect(downloadsFolder(local)).toBe(`${local}\\${PACKAGE}-updater`);
  });
});

describe("the installer", () => {
  // @spec DESK-DIST-PKG-005
  it("is electron-builder's assisted NSIS installer, per user, the only installer target", () => {
    expect(winTargets()).toEqual(["nsis"]);
    expect(config.nsis?.oneClick).toBe(false);
    expect(config.nsis?.perMachine).toBe(false);
  });

  // @spec DESK-DIST-INST-001
  it("installs for the current user only, never asking for administrator rights, with no folder choice", () => {
    expect(config.nsis?.perMachine).toBe(false);
    expect(config.nsis?.allowElevation).toBe(false);
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(false);
  });

  // @spec DESK-DIST-INST-003, DESK-DIST-INST-022
  it("uses the app's NSIS include, which skips the install-for-everyone page and checks for a running copy itself", () => {
    expect(config.nsis?.include).toBe("build/installer.nsh");
    expect(config.directories?.buildResources).toBe("build");
    const macros = includeMacros();
    // electron-builder 26.18.0 tests `customInstallmode` and inserts `customInstallMode`.
    expect(macros.some((m) => m.toLowerCase() === "custominstallmode")).toBe(true);
    for (const hook of ["customCheckAppRunning", "customInit", "customInstall", "customFinishPage", "customUnInit", "customUnInstall", "customUninstallPage"]) {
      expect(macros, hook).toContain(hook);
    }
  });

  // @spec DESK-DIST-INST-002
  it("shows a licence page only where the repository has a licence", () => {
    const licence = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"].find((f) => fs.existsSync(path.join(REPO, f)));
    if (licence) expect(config.nsis?.license).toBe(licence);
    else expect(config.nsis?.license).toBeUndefined();
  });

  // @spec DESK-DIST-INST-004, DESK-DIST-INST-006, DESK-DIST-DEV-007
  it("adds the Start-menu entry itself, leaves the desktop shortcut to the include's Finished page and starts nothing on its own", () => {
    expect(config.nsis?.createStartMenuShortcut).toBe(true);
    expect(config.nsis?.shortcutName).toBe(PRODUCT);
    expect(config.nsis?.createDesktopShortcut).toBe(false);
    expect(config.nsis?.runAfterFinish).toBe(false);
    expect(config.nsis?.menuCategory ?? false).toBe(false);
  });

  // @spec DESK-DIST-UNINST-007
  it("never deletes the app's own folders on uninstall", () => {
    expect(config.nsis?.deleteAppDataOnUninstall ?? false).toBe(false);
  });
});

describe("the build and its output", () => {
  // @spec DESK-DIST-PKG-022
  it("packages from the desktop build output into release/, never electron-builder's default dist/", () => {
    expect(config.directories?.app).toBe("build/desktop");
    expect(config.directories?.output).toBe("release");
  });

  // @spec DESK-DIST-PKG-014
  it("keeps every Chromium locale", () => {
    expect(config.electronLanguages).toBeUndefined();
  });

  // @spec DESK-DIST-PKG-015
  it("gives the program, the installer and the uninstaller career-map.ico", () => {
    expect(config.win?.icon).toBe("assets/career-map.ico");
    expect(config.nsis?.installerIcon).toBe("assets/career-map.ico");
    expect(config.nsis?.uninstallerIcon).toBe("assets/career-map.ico");
  });

  // @spec DESK-DIST-PKG-017, DESK-DIST-PKG-018
  it("turns the RunAsNode and NODE_OPTIONS fuses off and leaves the inspect fuse on", () => {
    expect(config.electronFuses?.runAsNode).toBe(false);
    expect(config.electronFuses?.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(config.electronFuses?.enableNodeCliInspectArguments).toBe(true);
  });

  // @spec DESK-DIST-REL-006
  it("names GitHub Releases of this repository, so the build writes latest.yml", () => {
    const publish = Array.isArray(config.publish) ? config.publish : [config.publish];
    expect(publish).toEqual([{ provider: "github", owner: "SharpWave", repo: "msfs-career-map" }]);
  });
});

describe("the npm scripts", () => {
  // @spec DESK-DIST-REL-004
  it("package the app after the desktop build, publishing nothing", () => {
    expect(pkg.scripts.package).toBe("npm run desktop:build && electron-builder --win --x64 --publish never");
  });

  // @spec DESK-DIST-SMOKE-001, DESK-DIST-SMOKE-012, DESK-DIST-DEV-005
  it("run the packaged smoke test through its own script, which checks the port and clears ELECTRON_RUN_AS_NODE", () => {
    expect(pkg.scripts["test:packaged"]).toBe("tsx --no-warnings=ExperimentalWarning scripts/test-packaged.ts");
  });

  // @spec DESK-DIST-INCL-001
  it("run the include's tests with their own Vitest configuration", () => {
    expect(pkg.scripts["test:installer"]).toBe("vitest run -c vitest.installer.config.ts");
  });

  // @spec DESK-DIST-TRIP-001
  it("never run the installer round trip", () => {
    for (const [name, script] of Object.entries(pkg.scripts)) expect(script, name).not.toMatch(/round-trip/);
  });
});

describe("the test tools", () => {
  // @spec DESK-DIST-PKG-007
  it("are pinned to exact versions", () => {
    for (const name of ["js-yaml", "@electron/fuses", "@electron/asar"]) {
      expect(pkg.devDependencies?.[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
