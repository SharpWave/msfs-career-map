/**
 * `--unregister` (src/desktop/unregister.ts; m4 contract §7): every entry of the app's taken out of every
 * `EXE.xml` present, its edition installed or not, whether MSFS runs or not (DESK-START-UNREG-001), the
 * value named "MSFS Career Map" out of both of Windows' start-up keys (UNREG-002), a file it cannot
 * change left as it is and counted (UNREG-003), its outcomes in `desktop.log` and never a box
 * (UNREG-004), the record of files last written taken out file by file and nothing else in the settings
 * changed (UNREG-007), its exit code 0 to 3 (UNREG-006), its 15 s bound (UNREG-005), and in test mode
 * nothing but one line in the test folder's `desktop.log` and 0 at once (UNREG-008, TEST-002).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installedProgramPath } from "../../../src/desktop/installed.ts";
import type { DesktopSettings } from "../../../src/desktop/settings.ts";
import { runUnregister, UNREGISTER_LIMIT_MS } from "../../../src/desktop/unregister.ts";
import { runValue } from "../../../src/desktop/windows-start.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { APPROVED_ENABLED, FakeKeys, FakeRegistrations, ScriptedFs, installedPlan, never, tempFolder, testPlan } from "../support/fakes.ts";
import { Sims, TEST_PROGRAM, fixture, text, type Edition } from "./support/sims.ts";

const win = path.win32;
const STAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (.*)$/;
const STAMP = "20261025T120000Z";
const PROGRAMS = { program: TEST_PROGRAM, earlier: [] as string[] };

/** Settings with every field away from its default, so a change to any of them shows. */
const SETTINGS: Omit<DesktopSettings, "exeXmlFiles"> = {
  lastDailyBackup: "2026-10-25T03:00:00.000Z",
  dailyBackupFailures: { count: 2, lastAttempt: "2026-10-24T03:00:00.000Z", short: "disk full", notified: true },
  window: { x: 10, y: 20, width: 1300, height: 820, maximized: true },
  trayNoticeShown: true,
  updateNoticesShown: ["0.9.0"],
  installingVersion: null,
  sourceFolder: "D:\\src\\msfs-career-map\\data",
};

function logLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const m = STAMPED.exec(l);
      if (!m) throw new Error(`an unstamped log line: ${l}`);
      return m[2];
    });
}

/** Every file under `root` with its bytes, by its path relative to `root`. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(root, p)] = fs.readFileSync(p).toString("base64");
    }
  };
  walk(root);
  return out;
}

interface Harness {
  sims: Sims;
  keys: FakeKeys;
  fs: ScriptedFs;
  clock: FakeClock;
  settingsFile: string;
  log(): string[];
  writeSettings(exeXmlFiles: string[]): void;
  settings(): DesktopSettings;
  run(): Promise<0 | 1 | 2 | 3>;
}

/** Installed, on a Sims root (installedPlan's Local and Roaming are the Sims' own). */
function harness(o: { programs?: typeof PROGRAMS | null } = {}): Harness {
  const sims = new Sims();
  const plan = installedPlan(sims.root);
  const keys = new FakeKeys();
  const sfs = new ScriptedFs();
  const clock = new FakeClock();
  const settingsFile = win.join(plan.electronFolder, "settings.json");
  return {
    sims,
    keys,
    fs: sfs,
    clock,
    settingsFile,
    log: () => logLines(win.join(plan.electronFolder, "logs", "desktop.log")),
    writeSettings(exeXmlFiles) {
      fs.mkdirSync(plan.electronFolder, { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify({ ...SETTINGS, exeXmlFiles }, null, 2));
    },
    settings: () => JSON.parse(fs.readFileSync(settingsFile, "utf8")) as DesktopSettings,
    run: () =>
      runUnregister({
        plan,
        env: sims.env,
        clock,
        fs: sfs,
        keys,
        registrations: new FakeRegistrations(),
        ...(o.programs === null ? {} : { programs: o.programs ?? PROGRAMS }),
      }),
  };
}

const holdsApp = (bytes: Uint8Array | null) => bytes !== null && text(bytes).includes("MSFS Career Map");

describe("--unregister outside test mode", () => {
  // @spec DESK-START-UNREG-006
  it("exits 0 with nothing of the app's in either list, writing nothing and taking no backup", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    const before = h.sims.exe("Store");
    expect(await h.run()).toBe(0);
    expect(h.sims.exe("Store")).toEqual(before);
    expect(h.sims.backupNames()).toEqual([]);
    expect(h.keys.calls.filter((c) => !c.startsWith("read"))).toEqual([]);
  });

  // @spec DESK-START-UNREG-001, DESK-START-UNREG-002, DESK-START-UNREG-006
  it("removes the app's entries from every EXE.xml present, its edition installed or not, and the value from both keys", async () => {
    const h = harness();
    // Store installed; Steam uninstalled with its folder left behind, still holding the entry.
    h.sims.install("Store").put("Store", fixture("after-app.xml")).put("Steam", fixture("twice.xml"));
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.approved = Uint8Array.from(APPROVED_ENABLED);
    expect(await h.run()).toBe(0);
    for (const e of ["Store", "Steam"] as Edition[]) {
      expect(holdsApp(h.sims.exe(e))).toBe(false);
      expect(h.sims.folderNames(e)).not.toContain("EXE.xml.msfs-career-map-tmp");
    }
    expect(text(h.sims.exe("Steam"))).toContain("FSUIPC7");
    expect(h.keys.run).toBeNull();
    expect(h.keys.approved).toBeNull();
    expect(h.sims.backupNames()).toEqual([`EXE.xml.Steam.${STAMP}`, `EXE.xml.Store.${STAMP}`, `Run.${STAMP}.reg`].sort());
  });

  // @spec DESK-START-UNREG-001
  it("asks nothing about MSFS: it takes the entries out while MSFS runs too", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml"));
    // runUnregister is given no process look at all (UnregisterPorts has none).
    expect(await h.run()).toBe(0);
    expect(holdsApp(h.sims.exe("Store"))).toBe(false);
  });

  // @spec DESK-START-UNREG-001, DESK-START-MSFS-022
  it("finds the app's entry by the installed program under %LOCALAPPDATA% when given no programs", async () => {
    const h = harness({ programs: null });
    const program = installedProgramPath(h.sims.local);
    h.sims.install("Store").put("Store", fixture("after-app.xml", { program }));
    expect(await h.run()).toBe(0);
    expect(holdsApp(h.sims.exe("Store"))).toBe(false);
  });

  // @spec DESK-START-UNREG-003, DESK-START-UNREG-006
  it("leaves an EXE.xml it cannot change or check as it is, and exits 1", async () => {
    for (const bad of [fixture("wrong-root.xml"), fixture("malformed.xml"), fixture("real-six.xml", { encoding: "utf-16le", bom: true })]) {
      const h = harness();
      h.sims.install("Store").put("Store", bad).put("Steam", fixture("after-app.xml"));
      expect(await h.run()).toBe(1);
      expect(h.sims.exe("Store")).toEqual(bad);
      expect(holdsApp(h.sims.exe("Steam"))).toBe(false);
      expect(h.log().some((l) => l.startsWith(`[start-lists] EXE.xml ${h.sims.exeFile("Store")} left as it was: `))).toBe(true);
    }
  });

  // @spec DESK-START-UNREG-003, DESK-START-MSFS-027
  it("counts a windows-1252 file that cannot hold the program's path as not checked, entry or none", async () => {
    const program = "C:\\Users\\Пилот\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
    const h = harness({ programs: { program, earlier: [] } });
    const file = fixture("real-six-1252.xml", { encoding: "windows-1252" });
    h.sims.install("Store").put("Store", file);
    expect(await h.run()).toBe(1);
    expect(h.sims.exe("Store")).toEqual(file);
  });

  // @spec DESK-START-UNREG-003, DESK-START-MSFS-041, DESK-START-MSFS-042
  it("counts a file that stays busy as still holding the entry", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml"));
    const before = h.sims.exe("Store");
    h.fs.hook("rename", "EXE.xml.msfs-career-map-tmp", () => {
      const e = new Error("EBUSY: resource busy or locked") as NodeJS.ErrnoException;
      e.code = "EBUSY";
      throw e;
    });
    const code = h.run();
    await h.clock.advance(3_000);
    expect(await code).toBe(1);
    expect(h.sims.exe("Store")).toEqual(before);
    expect(h.sims.folderNames("Store")).not.toContain("EXE.xml.msfs-career-map-tmp");
  });

  // @spec DESK-START-UNREG-006
  it("exits 2 when Windows' start-up keys still hold the value or cannot be checked", async () => {
    const stays = harness();
    stays.keys.run = runValue(TEST_PROGRAM);
    stays.keys.fail.remove = "reg.exe: access is denied";
    expect(await stays.run()).toBe(2);

    const unread = harness();
    unread.keys.fail.read = "reg.exe: the keys could not be read";
    expect(await unread.run()).toBe(2);

    const noExport = harness();
    noExport.keys.run = runValue(TEST_PROGRAM);
    noExport.keys.fail.exportTo = "access denied";
    expect(await noExport.run()).toBe(2);
    expect(noExport.keys.run).toBe(runValue(TEST_PROGRAM));
  });

  // @spec DESK-START-UNREG-006
  it("exits 3 when both lists still hold the app's entry or could not be checked", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("wrong-root.xml"));
    h.keys.run = runValue(TEST_PROGRAM);
    h.keys.fail.remove = "reg.exe: access is denied";
    expect(await h.run()).toBe(3);
  });

  // @spec DESK-START-UNREG-007, DESK-SHELL-CLI-012
  it("takes each file out of the record just before removing its entry, file by file, changing nothing else in the settings", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml")).install("Steam").put("Steam", fixture("after-app.xml"));
    const store = h.sims.exeFile("Store");
    const steam = h.sims.exeFile("Steam");
    h.writeSettings([store, steam]);
    const atWrite: Record<string, string[]> = {};
    for (const e of ["Store", "Steam"] as Edition[]) {
      h.fs.hook("write", h.sims.tempFile(e), () => {
        atWrite[e] = h.settings().exeXmlFiles;
      });
    }
    expect(await h.run()).toBe(0);
    expect(atWrite.Store.map((f) => f.toLowerCase())).toEqual([steam.toLowerCase()]);
    expect(atWrite.Steam).toEqual([]);
    const after = h.settings();
    expect(after.exeXmlFiles).toEqual([]);
    const { exeXmlFiles: _gone, ...rest } = after;
    expect(rest).toEqual(SETTINGS);
  });

  // @spec DESK-START-UNREG-004
  it("writes each EXE.xml's and the start-up value's outcome to desktop.log", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml")).put("Steam", fixture("wrong-root.xml"));
    h.keys.run = runValue(TEST_PROGRAM);
    expect(await h.run()).toBe(1);
    const lines = h.log();
    expect(lines).toContain(`[start-lists] EXE.xml ${h.sims.exeFile("Store")}: entry removed`);
    expect(lines.some((l) => l.startsWith(`[start-lists] EXE.xml ${h.sims.exeFile("Steam")} left as it was: `))).toBe(true);
    expect(lines.some((l) => l.startsWith("[start-lists] Windows start-up keys: "))).toBe(true);
  });

  // @spec DESK-START-UNREG-005, DESK-START-UNREG-006
  it("exits within 15 s, a list not done by then counting as still holding the entry", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("after-app.xml"));
    h.keys.gate = never();
    expect(UNREGISTER_LIMIT_MS).toBe(15_000);
    let code: number | null = null;
    void h.run().then((c) => (code = c));
    await h.clock.advance(14_999);
    expect(code).toBeNull();
    await h.clock.advance(1);
    await flush();
    expect(code).toBe(2);
    expect(holdsApp(h.sims.exe("Store"))).toBe(false);
  });

  // @spec DESK-START-MSFS-043
  it("deletes a temporary file a change cut short left, even with no entry to remove", async () => {
    const h = harness();
    h.sims.install("Store").put("Store", fixture("real-six.xml"));
    fs.writeFileSync(h.sims.tempFile("Store"), "half written");
    fs.mkdirSync(h.sims.folders.Steam, { recursive: true });
    fs.writeFileSync(h.sims.tempFile("Steam"), "half written");
    expect(await h.run()).toBe(0);
    expect(h.sims.folderNames("Store")).toEqual(["EXE.xml", "UserCfg.opt"]);
    expect(h.sims.folderNames("Steam")).toEqual([]);
  });
});

describe("--unregister in test mode", () => {
  // @spec DESK-START-UNREG-008, DESK-START-TEST-002
  it("touches neither start list, writes one line to the test folder's desktop.log and exits 0 at once", async () => {
    const sims = new Sims();
    sims.install("Store").put("Store", fixture("after-app.xml")).put("Steam", fixture("twice.xml"));
    const keys = new FakeKeys();
    keys.run = runValue(TEST_PROGRAM);
    const sfs = new ScriptedFs();
    const folder = tempFolder("unregister-test-");
    const simsBefore = tree(sims.root);
    const code = await runUnregister({ plan: testPlan(folder), env: sims.env, clock: new FakeClock(), fs: sfs, keys, registrations: new FakeRegistrations(), programs: PROGRAMS });
    expect(code).toBe(0);
    expect(tree(sims.root)).toEqual(simsBefore);
    expect(Object.keys(tree(folder))).toEqual([win.join("desktop", "logs", "desktop.log")]);
    expect(logLines(win.join(folder, "desktop", "logs", "desktop.log"))).toHaveLength(1);
    expect(keys.calls).toEqual([]);
    expect(keys.run).toBe(runValue(TEST_PROGRAM));
    expect(sfs.calls).toEqual([]);
  });
});
