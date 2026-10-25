import fs from "node:fs";
import path from "node:path";
import { BackupRequests } from "./backups.ts";
import { relaunchSwitches, startSwitch, type CommandLine, type StartSwitch } from "./cli.ts";
import { DailyBackups } from "./daily-backups.ts";
import { lookForSourceCopy } from "./first-run.ts";
import { LogFile } from "./logs.ts";
import { PageWindow, type ShellView } from "./page-window.ts";
import type {
  Clock,
  KnownFolders,
  LocalHttp,
  MessageBoxes,
  Opener,
  ServerLauncher,
  TrayPort,
  WindowPort,
  WindowsFacts,
} from "./ports.ts";
import { backupsFolderFor, serverArgs, serverEnv } from "./server-inputs.ts";
import { SettingsStore, type DesktopSettings, type SavedWindow } from "./settings.ts";
import { MsfsWatch } from "./sim-in-use.ts";
import type { RunPlan } from "./start.ts";
import { Supervisor } from "./supervisor.ts";
import { TIMING } from "./timing.ts";
import { TrackerFeed } from "./tracker-feed.ts";
import { trayModel, type TrayItemId, type TrayModel } from "./tray-model.ts";

/**
 * The running copy's shell: its logs and settings, the server it supervises, the tracker it follows
 * for the tray, the daily backup, the window and the tray, the starts handed over to it, and the
 * ways it quits. Everything outside its own logic goes through the ports `main.ts` builds.
 */

export type QuitKind = "quit" | "quit-switch" | "session-end";

export interface ShellPorts {
  clock: Clock;
  launcher: ServerLauncher;
  http: LocalHttp;
  facts: WindowsFacts;
  folders: KnownFolders;
  opener: Opener;
  boxes: MessageBoxes;
  window: WindowPort;
  tray: TrayPort;
  /** The app exits with code; relaunch: the switches to start it again with once it has exited, or null. */
  exit(code: number, relaunch: string[] | null): void;
}

export interface ShellOptions {
  plan: RunPlan;
  command: CommandLine;
  version: string;
  programPath: string;
  programFolder: string;
  serverScript: string;
  env: Readonly<Record<string, string | undefined>>;
}

const QUIT_QUESTION = "A leg is in the air. Quit anyway? Nothing is recorded until MSFS Career Map starts again.";
const NO_DOCUMENTS = "MSFS Career Map\\Backups in Documents (Documents could not be found)";
const SWITCH_WORDS: Record<string, string> = { none: "no switch", background: "--background", updated: "--updated" };

/** A start kept during Quit, by how much it shows: the one that shows the most is relaunched. */
const SHOWS = ["background", "updated", "none"] as const;
type KeptStart = (typeof SHOWS)[number];

export class Shell {
  private readonly o: ShellOptions;
  private readonly ports: ShellPorts;
  private readonly logsFolder: string;
  private readonly desktopLog: LogFile;
  private readonly serverLog: LogFile;
  private readonly store: SettingsStore;
  private readonly supervisor: Supervisor;
  private readonly feed: TrackerFeed;
  private readonly backups: BackupRequests;
  private readonly daily: DailyBackups;
  private readonly msfs: MsfsWatch;
  private page: PageWindow | null = null;
  private started = false;
  /** Starts handed over before start(), acted on there in order. */
  private readonly early: CommandLine[] = [];
  /** Starts handed over during Quit, for the last look. */
  private kept: KeptStart[] = [];
  private quitKind: QuitKind | null = null;
  /** A Quit is at its first step: reading the tracker or asking about a leg in the air. */
  private quitAsking = false;
  private exited = false;
  private readonly openBoxes = new Set<AbortController>();
  /** The folder offered to the server at every start (installed only). */
  private offer: string | null = null;
  private backupsFolderExists = false;
  private saves = 0;

  /** Loads the settings and opens the logs; writes nothing else; starts nothing. */
  constructor(o: ShellOptions, ports: ShellPorts) {
    this.o = o;
    this.ports = ports;
    const { plan } = o;
    const { clock } = ports;
    this.logsFolder = path.win32.join(plan.electronFolder, "logs");
    this.desktopLog = new LogFile({ folder: this.logsFolder, name: "desktop", clock });
    this.serverLog = new LogFile({ folder: this.logsFolder, name: "server", clock });
    const log = (line: string) => this.log(line);
    this.store = new SettingsStore(plan.electronFolder, log);
    this.store.load();

    this.supervisor = new Supervisor(
      {
        port: plan.port,
        script: o.serverScript,
        cwd: plan.dataFolder,
        env: serverEnv(o.env),
        args: (freshRun) => serverArgs(plan, o.programFolder, { offer: this.offer, freshRun }),
        dataFolder: plan.dataFolder,
        programPath: o.programPath,
        folders: async () => ({ data: plan.dataFolder, backups: (await this.backupsFolder()) ?? NO_DOCUMENTS }),
        log,
        serverLog: (line) => this.serverLog.write(line),
      },
      { clock, launcher: ports.launcher, http: ports.http, facts: ports.facts },
    );
    this.feed = new TrackerFeed({
      port: plan.port,
      clock,
      http: ports.http,
      serverRunning: () => this.supervisor.hasProcess(),
      onStatus: () => this.showTray(),
      onActivity: () => this.supervisor.activity(),
      log,
    });
    this.backups = new BackupRequests({ clock, supervisor: this.supervisor, log });
    this.daily = new DailyBackups({ clock, settings: this.store, backups: this.backups, changed: () => this.showTray() });
    this.msfs = new MsfsWatch(clock, ports.facts);

    this.supervisor.onState(() => this.changed());
    this.supervisor.onStartupDone((e) => this.startupDone(e));
  }

  /** Writes one line to desktop.log. */
  log(line: string): void {
    this.desktopLog.write(line);
  }

  /**
   * The start, in order: the folders written to desktop.log, the tray, the window when this start
   * opens one, the starts handed over before, the look for a copy run from source (installed only,
   * bounded by 500 ms), then the server and the watch on MSFS.
   */
  // @spec DESK-SHELL-TRAY-001, DESK-SHELL-CLI-004, DESK-SHELL-CLI-005, DESK-SHELL-CLI-006, DESK-SHELL-CLI-013, DESK-SHELL-CLI-014, DESK-SHELL-SRV-004, DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004, DESK-SHELL-FIRST-005, DESK-SHELL-LOG-003
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { plan, programFolder, version } = this.o;
    const e = plan.electronFolder;
    const folders = `data folder ${plan.dataFolder}; Electron folder ${e}; logs folder ${this.logsFolder}; program folder ${programFolder}`;
    this.log(
      plan.mode === "test"
        ? `[shell] MSFS Career Map ${version} in test mode on ${plan.testFolder}: ${folders}`
        : `[shell] MSFS Career Map ${version}: ${folders}`,
    );
    this.showTray();
    void this.lookUpBackupsFolder();

    const own = startSwitch(this.o.command);
    if (own === "none") this.openWindow();
    else if (own === "updated") this.openUnlessMsfs();

    for (const c of this.early.splice(0)) this.handOver(c);

    if (plan.mode === "installed") {
      const look = await lookForSourceCopy({
        http: this.ports.http,
        clock: this.ports.clock,
        remembered: this.store.get().sourceFolder,
        isFixedDrive: (letter) => this.ports.facts.isFixedDrive(letter),
      });
      if (look.sourceFolder !== this.store.get().sourceFolder) this.store.update((s) => (s.sourceFolder = look.sourceFolder));
      this.offer = look.offer;
    }
    if (this.quitKind !== null) return;
    this.supervisor.start();
    this.msfs.start();
  }

  /** A start handed over by a second copy; queued until start(). */
  // @spec DESK-SHELL-CLI-016, DESK-SHELL-CLI-017, DESK-SHELL-CLI-018, DESK-SHELL-CLI-008, DESK-SHELL-QUIT-003, DESK-SHELL-QUIT-006, DESK-SHELL-QUIT-008
  handOver(c: CommandLine): void {
    if (!this.started) {
      this.early.push(c);
      return;
    }
    const sw = startSwitch(c);
    if (this.quitKind !== null) {
      if (!isShowing(sw)) return;
      if (this.quitKind === "quit") this.kept.push(sw);
      else this.log(`[cli] dropped a start handed over while quitting: ${SWITCH_WORDS[sw]}`);
      return;
    }
    if (sw === "none") this.openWindow();
    else if (sw === "updated") this.openUnlessMsfs();
    else if (sw === "quit") void this.quitSwitch();
  }

  /** A left-click on the tray icon. */
  // @spec DESK-SHELL-TRAY-014
  trayClicked(): void {
    this.openWindow();
  }

  /** The tray menu is about to open: the backups folder looked up again. Never rejects. */
  // @spec DESK-SHELL-TRAY-018
  async menuOpening(): Promise<void> {
    await this.lookUpBackupsFolder();
  }

  /** Returns once the item's effect has begun (for Quit, once the quit has run its course or stopped). */
  // @spec DESK-SHELL-TRAY-014, DESK-SHELL-TRAY-019, DESK-SHELL-TRAY-024, DESK-SHELL-TRAY-025, DESK-SHELL-LOG-009, DESK-SHELL-QUIT-003
  async menuChosen(id: TrayItemId): Promise<void> {
    if (id === "open") return this.openWindow();
    if (id === "show-log") return this.ports.opener.openFolder(this.logsFolder);
    if (this.quitKind !== null) return;
    switch (id) {
      case "open-data":
        this.ports.opener.openFolder(this.o.plan.dataFolder);
        return;
      case "open-backups": {
        const folder = await this.backupsFolder();
        const exists = folder !== null && fs.existsSync(folder);
        this.setBackupsFolderExists(exists);
        if (folder !== null && exists) this.ports.opener.openFolder(folder);
        return;
      }
      case "try-again":
        if (this.supervisor.state().kind === "given-up") this.supervisor.tryAgain();
        return;
      case "quit":
        return this.quit();
    }
  }

  trayModel(): TrayModel {
    return trayModel({
      quitting: this.quitKind !== null,
      server: this.supervisor.state(),
      tracker: this.feed.last(),
      backupsFailing: this.daily.failing(),
      version: this.o.version,
      backupsFolderExists: this.backupsFolderExists,
    });
  }

  /** The pilot closed the window: its place kept, nothing else stopped. */
  // @spec DESK-SHELL-WIN-025, DESK-SHELL-WIN-029
  windowClosed(place: SavedWindow): void {
    this.store.update((s) => (s.window = { ...place }));
    this.page = null;
  }

  pageLoadFailed(): void {
    this.page?.pageFailed();
  }

  rendererGone(): void {
    this.page?.rendererGone();
  }

  /** The PC is going to sleep: the server saves the tracker's state. */
  // @spec DESK-SHELL-SRV-038
  suspend(): void {
    this.save();
  }

  /** The PC woke: the server's checks and the event stream start again at once. */
  // @spec DESK-SHELL-SRV-039
  resume(): void {
    this.supervisor.resume();
    this.feed.resume();
  }

  /** Windows asks to end the session: the server saves the tracker's state. */
  // @spec DESK-SHELL-OS-002
  queryEndSession(): void {
    this.save();
  }

  /** The Windows session ends: whatever quit was under way becomes this one, and Shut down goes at once. */
  // @spec DESK-SHELL-OS-003, DESK-SHELL-QUIT-005
  endSession(): void {
    if (this.quitKind === null) this.enterQuitting("session-end");
    else {
      this.quitKind = "session-end";
      this.abortBoxes();
    }
    this.backups.abandon();
    this.kept = [];
    void this.supervisor.shutDown().then(() => this.finish());
  }

  quitting(): QuitKind | null {
    return this.quitKind;
  }

  settings(): DesktopSettings {
    return this.store.get();
  }

  // ---------------------------------------------------------------------------------------------
  // The window and the tray

  /** Opens the window, or brings it forward; a window just created gets a fresh PageWindow. */
  // @spec DESK-SHELL-AWAY-002
  private openWindow(): void {
    if (this.ports.window.open() !== "created") return;
    const { clock } = this.ports;
    // A closed window's PageWindow (its 1 s page retry among it) loads nothing into a later window.
    let page: PageWindow | null = null;
    const load = (url: string) => {
      if (page === null || this.page === page) this.ports.window.load(url);
    };
    page = new PageWindow({ port: this.o.plan.port, clock, load, log: (line) => this.log(line) }, this.view());
    this.page = page;
  }

  /** The window opened unless MSFS runs for this account (--updated). */
  private openUnlessMsfs(): void {
    void this.ports.facts
      .msfsRunning()
      .catch(() => false)
      .then((running) => {
        if (!running && this.quitKind === null) this.openWindow();
      });
  }

  private view(): ShellView {
    const s = this.supervisor.state();
    return { quitting: this.quitKind !== null, serverDone: s.kind === "running", givenUp: s.kind === "given-up" ? s.reason : null };
  }

  private showTray(): void {
    this.ports.tray.show(this.trayModel());
  }

  /** Something the tray or the window follows has changed. */
  private changed(): void {
    this.showTray();
    this.page?.shellChanged(this.view());
  }

  /** The tracker read and followed, the daily backup checked, and the page loaded again after a requested restart. */
  // @spec DESK-SHELL-SRV-016, DESK-SHELL-SRV-043
  private startupDone(e: { requested: boolean }): void {
    this.feed.subscribe();
    this.daily.startupDone(e);
    if (e.requested) this.page?.reload();
  }

  /** The backups folder as it is now: test mode's literal folder, else in Documents looked up afresh. */
  private async backupsFolder(): Promise<string | null> {
    const { plan } = this.o;
    if (plan.backups.kind === "folder") return plan.backups.folder;
    const documents = await this.ports.folders.documents().catch(() => null);
    return backupsFolderFor(plan, documents);
  }

  private async lookUpBackupsFolder(): Promise<void> {
    try {
      const folder = await this.backupsFolder();
      this.setBackupsFolderExists(folder !== null && fs.existsSync(folder));
    } catch {
      this.setBackupsFolderExists(false);
    }
  }

  private setBackupsFolderExists(exists: boolean): void {
    if (exists === this.backupsFolderExists) return;
    this.backupsFolderExists = exists;
    this.showTray();
  }

  private save(): void {
    this.supervisor.post({ type: "save", id: `save-${++this.saves}` });
  }

  // ---------------------------------------------------------------------------------------------
  // Quitting

  /** Quit: the tracker read (2 s allowed), a question only about a leg in the air, then the quitting state, Shut down and the exit. */
  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-TRAY-022, DESK-SHELL-QUIT-001, DESK-SHELL-QUIT-006, DESK-SHELL-AWAY-003
  private async quit(): Promise<void> {
    if (this.quitKind !== null || this.quitAsking) return;
    this.quitAsking = true;
    try {
      const status = (await this.feed.readNow(TIMING.quitTrackerReadMs)) ?? this.feed.last();
      if (this.quitKind !== null) return;
      if (status?.phase === "airborne" && (await this.ask()) !== 0) return;
    } finally {
      this.quitAsking = false;
    }
    if (this.quitKind !== null) return;
    this.enterQuitting("quit");
    await this.supervisor.shutDown();
    this.finish();
  }

  /** Quit's one question, closed as cancelled if the quitting state begins while it is open. */
  private async ask(): Promise<number> {
    const controller = new AbortController();
    this.openBoxes.add(controller);
    try {
      return await this.ports.boxes.show({
        type: "warning",
        title: "MSFS Career Map",
        message: QUIT_QUESTION,
        buttons: ["Quit", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        signal: controller.signal,
      });
    } catch {
      return 1;
    } finally {
      this.openBoxes.delete(controller);
    }
  }

  /** `--quit` handed over: a quit backup (whatever it gives), Shut down, the exit. */
  // @spec DESK-SHELL-CLI-008, DESK-SHELL-BAK-005
  private async quitSwitch(): Promise<void> {
    this.enterQuitting("quit-switch");
    await this.backups.request("quit");
    await this.supervisor.shutDown();
    this.finish();
  }

  /** One quitting state, whatever the kind: boxes closed, the window's place kept, nothing more started or checked. */
  // @spec DESK-SHELL-QUIT-001, DESK-SHELL-QUIT-002, DESK-SHELL-QUIT-004, DESK-SHELL-WIN-025
  private enterQuitting(kind: QuitKind): void {
    this.quitKind = kind;
    this.abortBoxes();
    this.saveWindowPlace();
    this.supervisor.enterQuitting();
    this.daily.stop();
    this.feed.stop();
    this.msfs.stop();
    this.changed();
  }

  private abortBoxes(): void {
    for (const controller of this.openBoxes) controller.abort();
  }

  private saveWindowPlace(): void {
    if (!this.ports.window.isOpen()) return;
    const place = this.ports.window.place();
    if (place) this.store.update((s) => (s.window = place));
  }

  /** The exit, once per run: the window's place saved just before, and Quit's kept start relaunched. */
  private finish(): void {
    if (this.exited) return;
    this.exited = true;
    const shown = this.quitKind === "quit" ? [...SHOWS].reverse().find((k) => this.kept.includes(k)) : undefined;
    const relaunch = shown === undefined ? null : relaunchSwitches(shown, this.o.plan);
    this.saveWindowPlace();
    this.ports.exit(0, relaunch);
  }
}

function isShowing(sw: StartSwitch): sw is KeptStart {
  return sw === "none" || sw === "background" || sw === "updated";
}
