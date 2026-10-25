/**
 * The desktop shell's settings (src/desktop/settings.ts; m2 contract §7.1): one file,
 * `settings.json`, in Electron's own folder holding every field DESK-SHELL-SET-001 names, never in
 * the data folder (SET-002); written to a temporary file and renamed into place (SET-003); a file
 * that cannot be read set aside as `settings.json.bad`, logged, and defaults used (SET-004); a
 * write that fails leaves the shell running on the settings in memory (SET-005).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_FILE, SettingsStore, defaultSettings, type DesktopSettings } from "../../../src/desktop/settings.ts";
import { tempFolder, testPlan } from "../support/fakes.ts";

const DEFAULTS: DesktopSettings = {
  lastDailyBackup: null,
  dailyBackupFailures: { count: 0, lastAttempt: null, short: null, notified: false },
  window: null,
  trayNoticeShown: false,
  updateNoticesShown: [],
  installingVersion: null,
  sourceFolder: null,
  exeXmlFiles: [],
};

/** An empty Electron folder and a store on it, with the lines it logs. */
function store(folder = tempFolder()): { folder: string; file: string; lines: string[]; s: SettingsStore } {
  fs.mkdirSync(folder, { recursive: true });
  const lines: string[] = [];
  return { folder, file: path.join(folder, "settings.json"), lines, s: new SettingsStore(folder, (l) => lines.push(l)) };
}

const READ_ERROR = /^\[settings\] could not read settings\.json: .+; set aside as settings\.json\.bad$/;
const WRITE_ERROR = /^\[settings\] could not write settings\.json: .+$/;

describe("the settings file", () => {
  // @spec DESK-SHELL-SET-001
  it("is settings.json, and its defaults are nulls, zero, false and empty lists", () => {
    expect(SETTINGS_FILE).toBe("settings.json");
    expect(defaultSettings()).toEqual(DEFAULTS);
    const a = defaultSettings();
    a.updateNoticesShown.push("0.9.0");
    a.dailyBackupFailures.count = 5;
    expect(defaultSettings()).toEqual(DEFAULTS);
  });

  // @spec DESK-SHELL-SET-001
  it("gives the defaults when no file exists, and writes nothing", () => {
    const { folder, lines, s } = store();
    expect(s.load()).toEqual(DEFAULTS);
    expect(s.get()).toEqual(DEFAULTS);
    expect(fs.readdirSync(folder)).toEqual([]);
    expect(lines).toEqual([]);
  });

  // @spec DESK-SHELL-SET-001, DESK-SHELL-SET-002
  it("keeps every field across a write and a fresh read, in Electron's folder, never the data folder", () => {
    const plan = testPlan(tempFolder());
    fs.mkdirSync(plan.dataFolder, { recursive: true });
    const { file, s } = store(plan.electronFolder);
    s.load();
    const wanted: DesktopSettings = {
      lastDailyBackup: "2026-10-24T09:15:00.000Z",
      dailyBackupFailures: { count: 2, lastAttempt: "2026-10-25T08:00:00.000Z", short: "disk full", notified: true },
      window: { x: -1200, y: 40, width: 1024, height: 700, maximized: true },
      trayNoticeShown: true,
      updateNoticesShown: ["0.9.0", "0.9.1"],
      installingVersion: "0.9.1",
      sourceFolder: "C:\\Users\\pilot\\msfs-career-map\\data",
      exeXmlFiles: ["C:\\Users\\pilot\\AppData\\Roaming\\Microsoft Flight Simulator 2024\\EXE.xml"],
    };
    s.update((x) => Object.assign(x, structuredClone(wanted)));
    expect(s.get()).toEqual(wanted);
    expect(file).toBe(path.join(plan.electronFolder, "settings.json"));
    // JSON.stringify(s, null, 2): two-space JSON, whatever order the fields come in.
    const text = fs.readFileSync(file, "utf8");
    expect(JSON.parse(text)).toEqual(wanted);
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(fs.readdirSync(plan.dataFolder)).toEqual([]);

    const again = store(plan.electronFolder);
    expect(again.s.load()).toEqual(wanted);
    expect(again.lines).toEqual([]);
  });

  // @spec DESK-SHELL-SET-003
  it("writes through settings.json.tmp, leaving none behind", () => {
    const { folder, file, s } = store();
    s.load();
    s.update((x) => {
      x.trayNoticeShown = true;
    });
    expect(fs.readdirSync(folder)).toEqual(["settings.json"]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).trayNoticeShown).toBe(true);
  });

  // @spec DESK-SHELL-SET-003, DESK-SHELL-SET-005
  it("never writes settings.json in place: when the temporary file cannot be made, the old file stays whole", () => {
    const { folder, file, lines, s } = store();
    s.load();
    s.update((x) => {
      x.sourceFolder = "C:\\first";
    });
    const before = fs.readFileSync(file, "utf8");
    fs.mkdirSync(path.join(folder, "settings.json.tmp")); // a folder where the temporary file goes
    expect(() =>
      s.update((x) => {
        x.sourceFolder = "C:\\second";
      }),
    ).not.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(s.get().sourceFolder).toBe("C:\\second");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(WRITE_ERROR);
  });
});

describe("a file that cannot be read", () => {
  // @spec DESK-SHELL-SET-004
  it("is set aside as settings.json.bad, logged, and the defaults used", () => {
    const { folder, file, lines, s } = store();
    fs.writeFileSync(file, '{"lastDailyBackup": "2026-10');
    expect(s.load()).toEqual(DEFAULTS);
    expect(s.get()).toEqual(DEFAULTS);
    // Renamed away; whether the defaults are then written back is the implementer's choice.
    if (fs.existsSync(file)) expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(DEFAULTS);
    expect(fs.readFileSync(path.join(folder, "settings.json.bad"), "utf8")).toBe('{"lastDailyBackup": "2026-10');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(READ_ERROR);
  });

  // @spec DESK-SHELL-SET-004
  it("replaces an older settings.json.bad", () => {
    const { folder, file, lines, s } = store();
    fs.writeFileSync(path.join(folder, "settings.json.bad"), "older");
    fs.writeFileSync(file, "not json at all");
    expect(s.load()).toEqual(DEFAULTS);
    expect(fs.readFileSync(path.join(folder, "settings.json.bad"), "utf8")).toBe("not json at all");
    expect(lines[0]).toMatch(READ_ERROR);
  });

  // @spec DESK-SHELL-SET-004
  it("counts JSON whose top level is not an object as unreadable", () => {
    for (const text of ["42", "null", '"settings"']) {
      const { folder, file, lines, s } = store();
      fs.writeFileSync(file, text);
      expect(s.load()).toEqual(DEFAULTS);
      expect(fs.readFileSync(path.join(folder, "settings.json.bad"), "utf8")).toBe(text);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(READ_ERROR);
    }
  });

  // @spec DESK-SHELL-SET-004
  it("defaults a field missing or of the wrong type alone, drops unknown fields, and sets nothing aside", () => {
    const { folder, file, lines, s } = store();
    fs.writeFileSync(
      file,
      JSON.stringify({
        lastDailyBackup: 1729850000000,
        dailyBackupFailures: { count: 1, lastAttempt: "2026-10-25T08:00:00.000Z", short: "disk full", notified: false },
        window: { x: 10, y: 20, width: 900, height: 650, maximized: false },
        trayNoticeShown: "yes",
        updateNoticesShown: "0.9.0",
        installingVersion: null,
        sourceFolder: "D:\\career\\data",
        somethingNew: { a: 1 },
      }),
    );
    const loaded = s.load();
    expect(loaded).toStrictEqual({
      lastDailyBackup: null,
      dailyBackupFailures: { count: 1, lastAttempt: "2026-10-25T08:00:00.000Z", short: "disk full", notified: false },
      window: { x: 10, y: 20, width: 900, height: 650, maximized: false },
      trayNoticeShown: false,
      updateNoticesShown: [],
      installingVersion: null,
      sourceFolder: "D:\\career\\data",
      exeXmlFiles: [],
    });
    expect(fs.existsSync(path.join(folder, "settings.json.bad"))).toBe(false);
    expect(lines).toEqual([]);

    s.update(() => {});
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).not.toHaveProperty("somethingNew");
  });
});

describe("a write that fails", () => {
  // @spec DESK-SHELL-SET-005
  it("throws nothing, logs the line, and goes on with the settings in memory", () => {
    const parent = tempFolder();
    const { folder, lines, s } = store(path.join(parent, "desktop"));
    s.load();
    fs.rmSync(folder, { recursive: true });
    fs.writeFileSync(folder, "a file where the folder should be");
    expect(() =>
      s.update((x) => {
        x.window = { x: 0, y: 0, width: 800, height: 600, maximized: false };
      }),
    ).not.toThrow();
    expect(s.get().window).toEqual({ x: 0, y: 0, width: 800, height: 600, maximized: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(WRITE_ERROR);

    expect(() =>
      s.update((x) => {
        x.trayNoticeShown = true;
      }),
    ).not.toThrow();
    expect(s.get()).toMatchObject({ trayNoticeShown: true, window: { width: 800 } });
    expect(lines).toHaveLength(2);
  });
});
