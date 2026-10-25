import fs from "node:fs";
import path from "node:path";

export const SETTINGS_FILE = "settings.json";

/** The window's normal bounds and whether it was maximized. */
export interface SavedWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface DesktopSettings {
  /** ISO UTC. */
  lastDailyBackup: string | null;
  dailyBackupFailures: { count: number; lastAttempt: string | null; short: string | null; notified: boolean };
  window: SavedWindow | null;
  trayNoticeShown: boolean;
  updateNoticesShown: string[];
  installingVersion: string | null;
  sourceFolder: string | null;
  exeXmlFiles: string[];
}

/** Nulls, zero, false and empty lists; a new object at each call. */
export function defaultSettings(): DesktopSettings {
  return {
    lastDailyBackup: null,
    dailyBackupFailures: { count: 0, lastAttempt: null, short: null, notified: false },
    window: null,
    trayNoticeShown: false,
    updateNoticesShown: [],
    installingVersion: null,
    sourceFolder: null,
    exeXmlFiles: [],
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const stringOrNull = (v: unknown, d: string | null) => (typeof v === "string" || v === null ? v : d);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function savedWindow(v: unknown): SavedWindow | null {
  if (!isObject(v)) return null;
  const { x, y, width, height, maximized } = v;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || typeof maximized !== "boolean") return null;
  return { x, y, width, height, maximized };
}

/** The settings a parsed file holds: each field missing or of the wrong type defaulted alone, unknown ones dropped. */
function fromFile(raw: Record<string, unknown>): DesktopSettings {
  const d = defaultSettings();
  const f = isObject(raw.dailyBackupFailures) ? raw.dailyBackupFailures : {};
  const count = f.count;
  return {
    lastDailyBackup: stringOrNull(raw.lastDailyBackup, d.lastDailyBackup),
    dailyBackupFailures: {
      count: typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0,
      lastAttempt: stringOrNull(f.lastAttempt, null),
      short: stringOrNull(f.short, null),
      notified: typeof f.notified === "boolean" ? f.notified : false,
    },
    window: savedWindow(raw.window),
    trayNoticeShown: typeof raw.trayNoticeShown === "boolean" ? raw.trayNoticeShown : d.trayNoticeShown,
    updateNoticesShown: strings(raw.updateNoticesShown),
    installingVersion: stringOrNull(raw.installingVersion, d.installingVersion),
    sourceFolder: stringOrNull(raw.sourceFolder, d.sourceFolder),
    exeXmlFiles: strings(raw.exeXmlFiles),
  };
}

/**
 * The shell's settings, `<folder>\settings.json` in Electron's own folder: written through
 * `settings.json.tmp` renamed into place; a file that cannot be read set aside as
 * `settings.json.bad`. A failure to write is logged and the shell goes on with the settings in memory.
 */
// @spec DESK-SHELL-SET-001, DESK-SHELL-SET-002, DESK-SHELL-SET-003, DESK-SHELL-SET-004, DESK-SHELL-SET-005
export class SettingsStore {
  private readonly file: string;
  private current = defaultSettings();

  constructor(
    private readonly folder: string,
    private readonly log: (line: string) => void,
  ) {
    this.file = path.win32.join(folder, SETTINGS_FILE);
  }

  /** Reads the file (absent → defaults, nothing written). */
  load(): DesktopSettings {
    this.current = this.read();
    return this.current;
  }

  get(): DesktopSettings {
    return this.current;
  }

  /** Applies fn to the settings and writes them. Never throws. */
  update(fn: (s: DesktopSettings) => void): void {
    fn(this.current);
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(this.folder, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log(`[settings] could not write ${SETTINGS_FILE}: ${message(e)}`);
    }
  }

  private read(): DesktopSettings {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!isObject(raw)) throw new Error("its top level is not an object");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings();
      this.setAside(message(e));
      return defaultSettings();
    }
    return fromFile(raw);
  }

  private setAside(why: string): void {
    try {
      fs.renameSync(this.file, `${this.file}.bad`);
    } catch (e) {
      this.log(`[settings] could not read ${SETTINGS_FILE}: ${why}; could not set it aside: ${message(e)}`);
      return;
    }
    this.log(`[settings] could not read ${SETTINGS_FILE}: ${why}; set aside as ${SETTINGS_FILE}.bad`);
  }
}
