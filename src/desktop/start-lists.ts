import path from "node:path";
import { EARLIER_PROGRAMS, type Programs } from "./exe-xml.ts";
import { installedProgramPath } from "./installed.ts";
import {
  editionFolders,
  lacksEntry,
  msfsItem,
  readMsfsState,
  turnMsfsOff,
  turnMsfsOn,
  type EditionFolder,
  type MsfsState,
  type PassPorts,
} from "./msfs-start.ts";
import type { Clock, EditorFs, MessageBoxes, MessageBoxOptions, StartupKeys, WindowsFacts } from "./ports.ts";
import type { SettingsStore } from "./settings.ts";
import { BACKUPS_FOLDER } from "./start-list-backups.ts";
import { turnWindowsOff, turnWindowsOn, windowsTicked, type WindowsPorts, type WindowsState } from "./windows-start.ts";

/**
 * The tray's two start-list items, Start with MSFS 2024 and Start with Windows: their state read
 * afresh as the menu opens and again at a click, the click acting on that fresh state, one change at a
 * time, and a box naming what was left as it was — unless the shell is quitting by then, when the
 * outcome only goes to desktop.log. The reads' own reports (an EXE.xml that cannot be read, an entry
 * another program removed, keys that cannot be read) go to desktop.log once each time their state starts.
 */

export interface StartListsPorts {
  clock: Clock;
  fs: EditorFs;
  keys: StartupKeys;
  facts: Pick<WindowsFacts, "msfs2024Running">;
  boxes: MessageBoxes;
  settings: SettingsStore;
  env: { LOCALAPPDATA?: string; APPDATA?: string };
  electronFolder: string;
  log(line: string): void;
}

export interface StartListItems {
  msfs: { label: string; enabled: boolean; checked: boolean };
  windows: { label: "Start with Windows"; enabled: true; checked: boolean };
}

export type OpenBox = (o: Omit<MessageBoxOptions, "signal">) => Promise<number>;

const MSFS_RUNNING = "Close MSFS to change Start with MSFS 2024.";
const MSFS_LEFT = "Start with MSFS 2024: these files were left as they were:";
const WINDOWS_LEFT = "Start with Windows could not be changed:";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class StartLists {
  private readonly p: StartListsPorts;
  private readonly programs: Programs;
  private readonly folders: EditionFolder[];
  private readonly backupsFolder: string;
  private last: StartListItems | null = null;
  private change: Promise<void> | null = null;
  /** Files (lower case) whose unreadable state, or entry removed by another program, has been logged and still holds. */
  private readonly unreadable = new Set<string>();
  private readonly removed = new Set<string>();
  private keysUnreadable = false;

  /** Reads nothing; `programs` by default the installed program under %LOCALAPPDATA% and any earlier one. */
  constructor(ports: StartListsPorts, programs?: Programs) {
    this.p = ports;
    this.programs = programs ?? { program: installedProgramPath(ports.env.LOCALAPPDATA ?? ""), earlier: EARLIER_PROGRAMS };
    this.folders = editionFolders(ports.env);
    this.backupsFolder = path.win32.join(ports.electronFolder, BACKUPS_FOLDER);
  }

  /** Both items read afresh, the reads' reports logged once per state. Never rejects. */
  // @spec DESK-START-MSFS-011, DESK-START-MSFS-053, DESK-START-MSFS-055, DESK-START-WINDOWS-004, DESK-SHELL-SET-006
  async refresh(): Promise<StartListItems> {
    const [msfs, windows] = await Promise.all([this.readMsfs(), this.readWindows()]);
    this.last = {
      msfs: msfs === null ? { label: "Start with MSFS 2024", enabled: true, checked: false } : msfsItem(msfs, this.record()),
      windows: { label: "Start with Windows", enabled: true, checked: windows !== null && windowsTicked(windows) },
    };
    return this.last;
  }

  /** The items as last read; null before the first read. */
  items(): StartListItems | null {
    return this.last;
  }

  /** A change under way, settling when it is done; null when none. */
  busy(): Promise<void> | null {
    return this.change;
  }

  /**
   * A click on either item: its state read again and acted on — on when unticked, off when ticked — a
   * click while a change runs ignored. Resolves once the change, its box and the read after it are done.
   */
  // @spec DESK-START-MSFS-012, DESK-START-MSFS-020, DESK-START-MSFS-049, DESK-START-MSFS-051, DESK-START-WINDOWS-005, DESK-SHELL-QUIT-012
  async click(which: "msfs" | "windows", quitting: () => boolean, openBox: OpenBox): Promise<void> {
    if (this.change !== null) return;
    const change = which === "msfs" ? this.clickMsfs(quitting, openBox) : this.clickWindows(quitting, openBox);
    this.change = change;
    try {
      await change;
    } finally {
      this.change = null;
    }
  }

  private async clickMsfs(quitting: () => boolean, openBox: OpenBox): Promise<void> {
    try {
      const state = await this.readMsfs();
      if (state === null) return;
      if (state.running) {
        await this.box(quitting, openBox, MSFS_RUNNING);
        return;
      }
      const ticked = msfsItem(state, this.record()).checked;
      if (!ticked && state.installed.length === 0) return;
      const ports = this.passPorts();
      const result = ticked ? await turnMsfsOff(ports) : await turnMsfsOn({ ...ports, installed: state.installed });
      const left = result.outcomes.flatMap((o) => (o.kind === "left" ? [`${o.file}: ${o.why}`] : []));
      if (left.length > 0) await this.box(quitting, openBox, [MSFS_LEFT, ...left].join("\n"));
    } catch (e) {
      this.p.log(`[start-lists] Start with MSFS 2024 could not be changed: ${message(e)}`);
    } finally {
      if (!quitting()) await this.refresh();
    }
  }

  private async clickWindows(quitting: () => boolean, openBox: OpenBox): Promise<void> {
    try {
      const state = await this.readWindows();
      const ports = this.windowsPorts();
      const outcome = state !== null && windowsTicked(state) ? await turnWindowsOff(ports) : await turnWindowsOn(ports);
      if (outcome.kind === "left") await this.box(quitting, openBox, `${WINDOWS_LEFT}\n${outcome.why}`);
    } catch (e) {
      this.p.log(`[start-lists] Start with Windows could not be changed: ${message(e)}`);
    } finally {
      if (!quitting()) await this.refresh();
    }
  }

  /** A box in answer to the click, unless the shell is quitting by then (its outcome is in desktop.log already). */
  private async box(quitting: () => boolean, openBox: OpenBox, text: string): Promise<void> {
    if (quitting()) return;
    await openBox({ type: "warning", title: "MSFS Career Map", message: text, buttons: ["OK"], defaultId: 0, cancelId: 0 }).catch(() => 0);
  }

  /** The MSFS state with its reports logged; null when it could not be read at all. */
  private async readMsfs(): Promise<MsfsState | null> {
    try {
      const state = await readMsfsState({ folders: this.folders, fs: this.p.fs, programs: this.programs, facts: this.p.facts });
      this.report(state);
      return state;
    } catch (e) {
      this.p.log(`[start-lists] the EXE.xml files could not be read: ${message(e)}`);
      return null;
    }
  }

  /** Each file's unreadable state and entry removed by another program, logged as each starts. */
  private report(state: MsfsState): void {
    const record = this.record().map((f) => f.toLowerCase());
    for (const { file, state: s } of state.files) {
      const key = file.toLowerCase();
      if (s.kind === "unreadable") {
        if (!this.unreadable.has(key)) this.p.log(`[start-lists] EXE.xml ${file} cannot be read: ${s.why}`);
        this.unreadable.add(key);
      } else this.unreadable.delete(key);
      if (record.includes(key) && lacksEntry(s)) {
        if (!this.removed.has(key)) this.p.log(`[start-lists] EXE.xml ${file} no longer holds the app's entry (removed by another program)`);
        this.removed.add(key);
      } else this.removed.delete(key);
    }
  }

  /** The keys' state; null, logged once while it lasts, when they cannot be read. */
  private async readWindows(): Promise<WindowsState | null> {
    try {
      const state = await this.p.keys.read();
      this.keysUnreadable = false;
      return state;
    } catch (e) {
      if (!this.keysUnreadable) this.p.log(`[start-lists] Windows start-up keys cannot be read: ${message(e)}`);
      this.keysUnreadable = true;
      return null;
    }
  }

  private record(): string[] {
    return [...this.p.settings.get().exeXmlFiles];
  }

  private passPorts(): PassPorts {
    const { fs, clock, settings, log } = this.p;
    return {
      fs,
      clock,
      programs: this.programs,
      folders: this.folders,
      backupsFolder: this.backupsFolder,
      record: { get: () => this.record(), set: (files) => settings.update((s) => (s.exeXmlFiles = [...files])) },
      log,
    };
  }

  private windowsPorts(): WindowsPorts {
    const { fs, clock, keys, log } = this.p;
    return { keys, fs, clock, program: this.programs.program, backupsFolder: this.backupsFolder, log };
  }
}
