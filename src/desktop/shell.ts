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
  EditorFs,
  KnownFolders,
  LocalHttp,
  MessageBoxes,
  MessageBoxOptions,
  NoticeTarget,
  NotificationsPort,
  Opener,
  Registrations,
  ServerLauncher,
  StartupKeys,
  TrayPort,
  UpdaterPort,
  WindowPort,
  WindowsFacts,
} from "./ports.ts";
import { appendRequestNone, startsIn, takeUpMark, writeMark, type MarkFiles, type MarkStart, type StartSwitches } from "./install-mark.ts";
import { backupsFolderFor, serverArgs, serverEnv } from "./server-inputs.ts";
import { SettingsStore, type DesktopSettings, type SavedWindow } from "./settings.ts";
import { Notifier } from "./notifications.ts";
import { MsfsWatch, simInUse } from "./sim-in-use.ts";
import type { RunPlan } from "./start.ts";
import { StartLists } from "./start-lists.ts";
import { fragmentOf } from "./toast.ts";
import { Supervisor } from "./supervisor.ts";
import { TIMING } from "./timing.ts";
import { TrackerFeed } from "./tracker-feed.ts";
import { trayModel, type TrayItemId, type TrayModel, type TrayUpdate } from "./tray-model.ts";
import { QuietMoment, Updates, versionLine, type UpdateState } from "./updates.ts";

/**
 * The running copy's shell: its logs and settings, the server it supervises, the tracker it follows
 * for the tray, the daily backup, the window and the tray with its start-list items, the notifications
 * and their clicks, the updates and the three ways one installs, the starts handed over to it, and the
 * ways it quits. Everything outside its own logic goes through the ports `main.ts` builds.
 */

/** restart: Restart to update (with or without a backup); quiet: a quiet-moment install. */
export type QuitKind = "quit" | "quit-switch" | "session-end" | "restart" | "quiet";

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
  /** The start lists' file calls and Windows' start-up keys (outside test mode only). */
  fs: EditorFs;
  keys: StartupKeys;
  /** The notifications shown and their clicks; the registrations that route clicks (outside test mode only). */
  notifications: NotificationsPort;
  registrations: Registrations;
  /** electron-updater and the install-under-way mark's file (outside test mode only); this process's id for the mark. */
  updater: UpdaterPort;
  markFiles: MarkFiles;
  pid: number;
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
const AFTER_SIM = "Restart to update (after the sim closes)";
const HOUR = 3_600_000;

/** A start kept during Quit, by how much it shows: the one that shows the most is relaunched. */
const SHOWS = ["background", "updated", "none"] as const;
type KeptStart = (typeof SHOWS)[number];
const KEPT_OF: Record<StartSwitches, KeptStart> = { "": "none", "--updated": "updated", "--background": "background" };

/** A Restart to update or a quiet-moment install under way, and what it holds (DESK-SHELL-QUIT-007, QUIT-011). */
interface Install {
  kind: "restart" | "quiet";
  /** Starts handed over during a Restart to update, acted on if it goes no further. */
  starts: CommandLine[];
  quit: boolean;
  quitSwitch: boolean;
  /** The install-under-way mark is written: taken up if the install goes no further. */
  marked: boolean;
  /** install() answered ok: the updater quits the app. */
  handedOver: boolean;
}

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
  private readonly notifier: Notifier;
  /** The tray's start-list items; null in test mode, which reaches neither start list. */
  private readonly startLists: StartLists | null;
  /** The checks, downloads and the quiet moment; null in test mode, which never reaches the updater. */
  private readonly updates: Updates | null;
  private readonly quiet: QuietMoment | null;
  /** A version recorded as handed to the installer and still above this one (DESK-SHELL-UPD-020). */
  private readonly failedAtStart: string | null;
  private install: Install | null = null;
  /** A quiet moment looked at again once the hour after a failed backup before an update is over. */
  private afterFailedBackup: (() => void) | null = null;
  private page: PageWindow | null = null;
  private started = false;
  /** Starts handed over before start(), acted on there in order. */
  private readonly early: CommandLine[] = [];
  /** Notification clicks before start(), acted on there in order. */
  private readonly earlyClicks: NoticeTarget[] = [];
  /** The server was given up on at the last state seen: a giving up notified once. */
  private givenUp = false;
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
      onStatus: (s) => {
        this.notifier.pendingListed(s.pending.map((p) => p.id));
        this.simMayHaveChanged();
      },
      onActivity: () => this.supervisor.activity(),
      onSubscribed: (s) => this.notifier.subscribed(s.pending),
      onEvent: (name: "pending" | "hop", data: unknown) => {
        if (name === "pending") this.notifier.pendingEvent(data as Parameters<Notifier["pendingEvent"]>[0]);
        else this.notifier.hopEvent(data as { id: number; message: string });
      },
      onStream: () => this.quiet?.recheck(),
      log,
    });
    this.backups = new BackupRequests({ clock, supervisor: this.supervisor, log, changed: () => this.quiet?.recheck() });
    this.daily = new DailyBackups({
      clock,
      settings: this.store,
      backups: this.backups,
      changed: () => {
        this.showTray();
        void this.backupsFailing();
      },
    });
    this.msfs = new MsfsWatch(clock, ports.facts, () => this.simMayHaveChanged());
    this.notifier = new Notifier({
      mode: plan.mode,
      port: ports.notifications,
      settings: this.store,
      simInUse: () => this.simInUse(),
      windowForeground: () => ports.window.isForeground(),
      log,
    });
    ports.notifications.onClick((t) => this.notificationClicked(t));
    this.startLists =
      plan.mode === "installed"
        ? new StartLists({
            clock,
            fs: ports.fs,
            keys: ports.keys,
            facts: ports.facts,
            boxes: ports.boxes,
            settings: this.store,
            env: { LOCALAPPDATA: o.env.LOCALAPPDATA, APPDATA: o.env.APPDATA },
            electronFolder: plan.electronFolder,
            log,
          })
        : null;

    const recorded = this.store.get().installingVersion;
    this.failedAtStart = recorded !== null && versionBelow(o.version, recorded) ? recorded : null;
    const initial: UpdateState = this.failedAtStart === null ? { kind: "idle" } : { kind: "failed-at-start", version: this.failedAtStart };
    this.updates =
      plan.mode === "installed"
        ? new Updates({
            clock,
            updater: ports.updater,
            version: o.version,
            initial,
            simInUse: () => this.simInUse(),
            quitting: () => this.quitKind !== null,
            changed: () => {
              this.showTray();
              this.quiet?.recheck();
            },
            becameReady: (version) => this.notifier.updateReady(version),
            log,
          })
        : null;
    this.quiet =
      plan.mode === "installed"
        ? new QuietMoment({ clock, conditions: () => this.quietMoment(true), fire: () => void this.quietInstall() })
        : null;

    this.supervisor.onState(() => this.changed());
    this.supervisor.onStartupDone((e) => this.startupDone(e));
  }

  /** Writes one line to desktop.log. */
  log(line: string): void {
    this.desktopLog.write(line);
  }

  /**
   * The start, in order: the folders written to desktop.log, the tray, the window when this start
   * opens one, the starts and notification clicks handed over before, the notification registrations
   * and the look for a copy run from source (installed only, the look bounded by 500 ms), then the
   * server, the watch on MSFS and the update checks. A version recorded as handed to the installer is
   * cleared first, said in desktop.log when this one is still below it.
   */
  // @spec DESK-SHELL-UPD-020, DESK-SHELL-UPD-001, DESK-SHELL-UPD-005, DESK-SHELL-TRAY-001, DESK-SHELL-CLI-004, DESK-SHELL-CLI-005, DESK-SHELL-CLI-006, DESK-SHELL-CLI-013, DESK-SHELL-CLI-014, DESK-SHELL-SRV-004, DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004, DESK-SHELL-FIRST-005, DESK-SHELL-LOG-003, DESK-SHELL-NOTE-013, DESK-SHELL-NOTE-015, DESK-SHELL-NOTE-016, DESK-SHELL-CLI-021
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
    if (this.store.get().installingVersion !== null) this.store.update((s) => (s.installingVersion = null));
    if (this.failedAtStart !== null) this.log(`[update] ${this.failedAtStart} could not be installed`);
    this.showTray();
    void this.lookUpBackupsFolder();

    const own = startSwitch(this.o.command);
    if (own === "none") this.openWindow();
    else if (own === "updated") this.openUnlessMsfs();

    for (const c of this.early.splice(0)) this.handOver(c);
    for (const t of this.earlyClicks.splice(0)) this.notificationClicked(t);

    if (plan.mode === "installed") {
      const problems = await this.ports.registrations.register().catch((e: unknown) => [String(e)]);
      for (const p of problems) this.log(`[notifications] ${p}`);
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
    this.updates?.start();
  }

  /**
   * A start handed over by a second copy; queued until start(). While quitting: kept for Quit's last
   * look, held by a Restart to update, calling a quiet-moment install off (but `--background`), or
   * dropped; a `--quit` held by either install.
   */
  // @spec DESK-SHELL-CLI-016, DESK-SHELL-CLI-017, DESK-SHELL-CLI-018, DESK-SHELL-CLI-008, DESK-SHELL-QUIT-003, DESK-SHELL-QUIT-006, DESK-SHELL-QUIT-007, DESK-SHELL-QUIT-008, DESK-SHELL-QUIT-011, DESK-SHELL-UPD-029, DESK-SHELL-UPD-032
  handOver(c: CommandLine): void {
    if (!this.started) {
      this.early.push(c);
      return;
    }
    const sw = startSwitch(c);
    const install = this.install;
    if (install !== null && !install.handedOver) {
      if (sw === "quit") install.quitSwitch = true;
      else if (!isShowing(sw)) return;
      else if (install.kind === "restart") install.starts.push(c);
      else if (sw === "background") this.log(`[cli] dropped a start handed over during an update: ${SWITCH_WORDS[sw]}`);
      else {
        this.leaveQuitting();
        this.handOver(c);
      }
      return;
    }
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
    this.pilotOpens();
  }

  /** The tray menu is about to open: the backups folder looked up again and the start lists read. Never rejects. */
  // @spec DESK-SHELL-TRAY-018, DESK-START-MSFS-011, DESK-START-WINDOWS-004
  async menuOpening(): Promise<void> {
    await Promise.all([this.lookUpBackupsFolder(), this.startLists?.refresh()]);
  }

  /** Returns once the item's effect has begun (for Quit, once the quit has run its course or stopped). */
  // @spec DESK-SHELL-TRAY-014, DESK-SHELL-TRAY-019, DESK-SHELL-TRAY-024, DESK-SHELL-TRAY-025, DESK-SHELL-LOG-009, DESK-SHELL-QUIT-003, DESK-START-MSFS-012, DESK-START-WINDOWS-005
  async menuChosen(id: TrayItemId): Promise<void> {
    if (id === "open") return this.pilotOpens();
    if (id === "show-log") return this.ports.opener.openFolder(this.logsFolder);
    if (this.quitKind !== null) {
      if (id === "quit") this.holdQuit();
      return;
    }
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
      case "start-msfs":
      case "start-windows": {
        const change = this.startLists?.click(
          id === "start-msfs" ? "msfs" : "windows",
          () => this.quitKind !== null,
          (b) => this.showBox(b),
        );
        this.quiet?.recheck();
        await change;
        this.quiet?.recheck();
        return;
      }
      case "restart-update":
      case "restart-update-no-backup":
        return this.restartToUpdate(id === "restart-update");
      case "check-updates":
        this.updates?.checkNow();
        return;
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
      startLists: this.startLists?.items() ?? null,
      update: this.trayUpdate(),
    });
  }

  /** The pilot closed the window: its place kept, nothing else stopped; the one-time notice at the first such close. */
  // @spec DESK-SHELL-WIN-025, DESK-SHELL-WIN-029, DESK-SHELL-TRAY-023
  windowClosed(place: SavedWindow): void {
    this.store.update((s) => (s.window = { ...place }));
    this.page = null;
    if (this.quitKind === null && this.supervisor.state().kind !== "given-up" && !this.store.get().trayNoticeShown) {
      this.notifier.firstClose();
    }
    this.quiet?.recheck();
  }

  /**
   * A notification clicked, whatever object it came from: the window opened or brought forward, on the
   * hop or pending leg it names; before start() kept for it; while quitting, a start with no switch
   * handed over, its hop or pending leg left out — but a quiet-moment install is called off and the
   * click acted on with them.
   */
  // @spec DESK-SHELL-NOTE-012, DESK-SHELL-NOTE-014, DESK-SHELL-CLI-021, DESK-SHELL-CLI-022, DESK-SHELL-UPD-029
  notificationClicked(t: NoticeTarget): void {
    if (!this.started) {
      this.earlyClicks.push(t);
      return;
    }
    if (this.install?.kind === "quiet" && !this.install.handedOver) this.leaveQuitting();
    if (this.quitKind !== null) {
      const plan = this.o.plan;
      this.handOver({ testData: plan.testFolder, background: false, updated: false, quit: false, unregister: false });
      return;
    }
    this.openWindow(fragmentOf(t));
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

  /** The PC woke: the server's checks and the event stream start again at once, and an update check that fell due runs. */
  // @spec DESK-SHELL-SRV-039
  resume(): void {
    this.supervisor.resume();
    this.feed.resume();
    this.updates?.resume();
  }

  /** Windows asks to end the session: the server saves the tracker's state. */
  // @spec DESK-SHELL-OS-002
  queryEndSession(): void {
    this.save();
  }

  /** The Windows session ends: whatever quit was under way becomes this one, and Shut down goes at once. */
  // @spec DESK-SHELL-OS-003, DESK-SHELL-QUIT-005, DESK-SHELL-UPD-014
  endSession(): void {
    if (this.quitKind === null) this.enterQuitting("session-end");
    else {
      this.quitKind = "session-end";
      this.abortBoxes();
    }
    this.backups.abandon();
    this.kept = [];
    this.install = null;
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

  /** Opens the window, or brings it forward; a window just created gets a fresh PageWindow; `fragment` points its page at a hop or pending leg. */
  // @spec DESK-SHELL-AWAY-002, DESK-SHELL-NOTE-012
  private openWindow(fragment: string | null = null): void {
    if (this.ports.window.open() !== "created") {
      if (fragment !== null) this.page?.pointAt(fragment);
      return;
    }
    const { clock } = this.ports;
    // A closed window's PageWindow (its 1 s page retry among it) loads nothing into a later window.
    let page: PageWindow | null = null;
    const load = (url: string) => {
      if (page === null || this.page === page) this.ports.window.load(url);
    };
    const setFragment = (f: string) => {
      if (this.page === page) this.ports.window.setFragment(f);
    };
    page = new PageWindow({ port: this.o.plan.port, clock, load, setFragment, log: (line) => this.log(line), fragment }, this.view());
    this.page = page;
    this.quiet?.recheck();
  }

  /** The pilot's Open MSFS Career Map, from the tray: a quiet-moment install called off first. */
  // @spec DESK-SHELL-UPD-029
  private pilotOpens(): void {
    if (this.install?.kind === "quiet" && !this.install.handedOver) this.leaveQuitting();
    this.openWindow();
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

  /** Something the tray or the window follows has changed; a giving up notified once. */
  // @spec DESK-SHELL-NOTE-004
  private changed(): void {
    const s = this.supervisor.state();
    const givenUp = s.kind === "given-up";
    if (givenUp && !this.givenUp) this.notifier.gaveUp(s.reason);
    this.givenUp = givenUp;
    this.showTray();
    this.page?.shellChanged(this.view());
    this.quiet?.recheck();
  }

  /** A status or a look at MSFS: the notices and a found update's download that wait for the sim, the tray, the quiet moment. */
  private simMayHaveChanged(): void {
    this.showTray();
    this.notifier.recheck();
    this.updates?.recheck();
    this.quiet?.recheck();
  }

  /** The version line and the update items; null in test mode. */
  // @spec DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-017, DESK-SHELL-TRAY-027
  private trayUpdate(): TrayUpdate | null {
    if (this.updates === null) return null;
    const s = this.updates.state();
    const line = versionLine(this.o.version, s);
    if (s.kind !== "ready") return { line, restart: null, restartNoBackup: null };
    const enabled = this.restartClickable();
    return {
      line,
      restart: { label: this.simInUse() ? AFTER_SIM : "Restart to update", enabled },
      restartNoBackup: s.backupFailed === null ? null : { enabled },
    };
  }

  /** Restart to update can be clicked: an update ready, the server neither starting nor restarting, the sim not in use. */
  private restartClickable(): boolean {
    const kind = this.supervisor.state().kind;
    return this.updates?.ready() != null && kind !== "starting" && kind !== "restarting" && !this.simInUse();
  }

  /** DESK-SHELL-AWAY-001 now: MSFS running, or this server's tracker linked or another copy holding the link. */
  // @spec DESK-SHELL-AWAY-004
  private simInUse(): boolean {
    return simInUse({ serverRunning: this.supervisor.hasProcess(), tracker: this.feed.last(), msfsRunning: this.msfs.running() });
  }

  /** From the third daily backup failed in a row, its notice once for that run of failures (waiting for the sim). */
  // @spec DESK-SHELL-NOTE-019
  private async backupsFailing(): Promise<void> {
    const short = this.daily.failing();
    if (short === null || this.store.get().dailyBackupFailures.notified) return;
    const folder = (await this.backupsFolder().catch(() => null)) ?? NO_DOCUMENTS;
    if (this.daily.failing() === null || this.store.get().dailyBackupFailures.notified) return;
    this.notifier.backupsFailing(folder, short);
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

  /**
   * Quit: the tracker read (2 s allowed), a question only about a leg in the air, then the quitting
   * state, the backup before a ready update, Shut down, and the exit — installing that update on the
   * way out when its backup was done or there was no server to ask.
   */
  // @spec DESK-SHELL-TRAY-021, DESK-SHELL-TRAY-022, DESK-SHELL-QUIT-001, DESK-SHELL-QUIT-006, DESK-SHELL-QUIT-012, DESK-SHELL-AWAY-003, DESK-SHELL-UPD-011, DESK-SHELL-UPD-015, DESK-SHELL-UPD-016, DESK-SHELL-UPD-017, DESK-SHELL-BAK-005
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
    await this.startListChange();
    const version = this.updates?.ready() ?? null;
    const installable = version !== null && this.quitKind === "quit" && (await this.updateBackup(version));
    await this.supervisor.shutDown();
    if (installable && this.quitKind === "quit") return this.installAtQuit(version);
    this.finish();
  }

  /**
   * The end of a Quit with an update ready: the version recorded and the mark written, then the last
   * look — a start kept installs nothing and is relaunched — then the installer; one that cannot be
   * started leaves the app to exit as Quit.
   */
  // @spec DESK-SHELL-UPD-011, DESK-SHELL-UPD-018, DESK-SHELL-UPD-019, DESK-SHELL-UPD-031, DESK-SHELL-QUIT-006, DESK-DIST-INST-025
  private async installAtQuit(version: string): Promise<void> {
    this.record(version);
    this.writeMark("none");
    if (this.kept.length === 0) {
      if (this.tryInstall(version)) return;
      await this.updates?.installFailed(version);
    }
    this.record(null);
    for (const sw of startsIn(this.takeUpMark())) this.kept.push(KEPT_OF[sw]);
    this.finish();
  }

  /** Quit's one question, closed as cancelled if the quitting state begins while it is open. */
  private ask(): Promise<number> {
    return this.showBox({
      type: "warning",
      title: "MSFS Career Map",
      message: QUIT_QUESTION,
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
  }

  /** A box in answer to the pilot's click, closed as cancelled if the quitting state begins while it is open. */
  private async showBox(o: Omit<MessageBoxOptions, "signal">): Promise<number> {
    const controller = new AbortController();
    this.openBoxes.add(controller);
    this.quiet?.recheck();
    try {
      return await this.ports.boxes.show({ ...o, signal: controller.signal });
    } catch {
      return o.cancelId;
    } finally {
      this.openBoxes.delete(controller);
      this.quiet?.recheck();
    }
  }

  /** A Quit while a Restart to update or a quiet-moment install is under way: held, a mark already written asking for no start. */
  // @spec DESK-SHELL-QUIT-011, DESK-SHELL-UPD-031
  private holdQuit(): void {
    const install = this.install;
    if (install === null || install.handedOver || install.quit) return;
    install.quit = true;
    if (install.kind === "quiet" && install.marked) this.appendRequestNone();
  }

  /** A start-list change under way finished, within its own bounds, before the server shuts down (never at a session end). */
  // @spec DESK-SHELL-QUIT-012
  private async startListChange(): Promise<void> {
    await this.startLists?.busy()?.catch(() => {});
  }

  /** `--quit` handed over: a quit backup (whatever it gives), Shut down, the exit. */
  // @spec DESK-SHELL-CLI-008, DESK-SHELL-BAK-005, DESK-SHELL-QUIT-012, DESK-SHELL-UPD-014
  private async quitSwitch(): Promise<void> {
    this.enterQuitting("quit-switch");
    await Promise.all([this.backups.request("quit"), this.startListChange()]);
    await this.supervisor.shutDown();
    this.finish();
  }

  /** One quitting state, whatever the kind: boxes closed, an update check or download cancelled, the window's place kept, nothing more started or checked. */
  // @spec DESK-SHELL-QUIT-001, DESK-SHELL-QUIT-002, DESK-SHELL-QUIT-004, DESK-SHELL-WIN-025
  private enterQuitting(kind: QuitKind): void {
    this.quitKind = kind;
    this.abortBoxes();
    this.saveWindowPlace();
    this.supervisor.enterQuitting();
    this.daily.stop();
    this.feed.stop();
    this.msfs.stop();
    this.quiet?.stop();
    this.updates?.enterQuitting();
    this.changed();
  }

  // ---------------------------------------------------------------------------------------------
  // Installing an update: Restart to update and a quiet moment

  /**
   * Restart to update, with or without its backup: the quitting state, the start-list wait, the
   * backup, the sim looked at after it and again just before the shutdown, then the installer, asked
   * to start the app with --updated. Any step that fails leaves the quitting state.
   */
  // @spec DESK-SHELL-UPD-012, DESK-SHELL-UPD-013, DESK-SHELL-UPD-015, DESK-SHELL-UPD-016, DESK-SHELL-UPD-017, DESK-SHELL-UPD-030, DESK-SHELL-BAK-005
  private async restartToUpdate(withBackup: boolean): Promise<void> {
    const s = this.updates?.state();
    if (s?.kind !== "ready" || !this.restartClickable() || (!withBackup && s.backupFailed === null)) return;
    const install = this.beginInstall("restart");
    await this.startListChange();
    if (!this.current(install)) return;
    if (withBackup) {
      const done = await this.updateBackup(s.version);
      if (!this.current(install)) return;
      if (!done) return this.leaveQuitting();
    }
    for (let look = 0; look < 2; look++) {
      const inUse = await this.simLook();
      if (!this.current(install)) return;
      if (inUse) return this.leaveQuitting();
    }
    await this.supervisor.shutDown();
    if (!this.current(install)) return;
    await this.handToInstaller(install, s.version, "--updated");
  }

  /**
   * A quiet moment: the quitting state, the backup, the conditions again after it and just before the
   * shutdown (but their 5 minutes), those not needing the server again just before the handover, then
   * the installer, asked to start the app with --background, or with nothing once a Quit is held.
   */
  // @spec DESK-SHELL-UPD-028, DESK-SHELL-UPD-029, DESK-SHELL-UPD-015, DESK-SHELL-UPD-016, DESK-SHELL-UPD-017, DESK-SHELL-QUIT-011
  private async quietInstall(): Promise<void> {
    const version = this.updates?.ready() ?? null;
    if (version === null || this.quitKind !== null) return;
    const install = this.beginInstall("quiet");
    const done = await this.updateBackup(version);
    if (!this.current(install)) return;
    if (!done) return this.leaveQuitting();
    for (const server of [true, true]) {
      const holds = await this.quietStillHolds(server);
      if (!this.current(install)) return;
      if (!holds) return this.leaveQuitting();
    }
    await this.supervisor.shutDown();
    if (!this.current(install)) return;
    const holds = await this.quietStillHolds(false);
    if (!this.current(install)) return;
    if (!holds) return this.leaveQuitting();
    await this.handToInstaller(install, version, install.quit ? "none" : "--background");
  }

  /**
   * The quiet moment's conditions (DESK-SHELL-UPD-028), read now; `server`: also those that need the
   * server — its start-up work done, the event stream open, no leg or casual mode, no backup running.
   */
  private quietMoment(server: boolean): boolean {
    if (this.quitKind !== null || this.updates?.ready() == null) return false;
    return this.quietHolds(server, true);
  }

  /** The conditions read during the install: a fresh look at MSFS, the stream left out (the quitting state closed it). */
  private async quietStillHolds(server: boolean): Promise<boolean> {
    await this.msfs.checkNow();
    return this.quietHolds(server, false);
  }

  private quietHolds(server: boolean, stream: boolean): boolean {
    if (this.simInUse() || this.ports.window.isOpen() || this.openBoxes.size > 0) return false;
    if (this.startLists?.busy() != null || this.updates?.backupFailedWithinHour()) return false;
    if (!server) return true;
    const t = this.feed.last();
    return (
      this.supervisor.state().kind === "running" &&
      (!stream || this.feed.subscribed()) &&
      t !== null &&
      t.phase !== "airborne" &&
      t.phase !== "landed" &&
      t.leg === null &&
      t.casual === null &&
      !this.backups.busy()
    );
  }

  /** The sim looked at afresh: MSFS now, with the last tracker status. */
  private async simLook(): Promise<boolean> {
    await this.msfs.checkNow();
    return this.simInUse();
  }

  private beginInstall(kind: "restart" | "quiet"): Install {
    this.enterQuitting(kind);
    const install: Install = { kind, starts: [], quit: false, quitSwitch: false, marked: false, handedOver: false };
    this.install = install;
    return install;
  }

  /** Still the install under way: not called off, and no session end meanwhile. */
  private current(install: Install): boolean {
    return this.install === install && this.quitKind === install.kind;
  }

  /**
   * The backup before installing `version`: true to go on (done, or no server to ask, none taken);
   * false once it failed or ran out of time, the update then waiting with the short reason.
   */
  // @spec DESK-SHELL-UPD-015, DESK-SHELL-UPD-016, DESK-SHELL-UPD-017, DESK-SHELL-BAK-005
  private async updateBackup(version: string): Promise<boolean> {
    const outcome = await this.backups.request({ update: version });
    if (outcome.ok) {
      this.updates?.backupDone();
      return true;
    }
    if (outcome.why === "no-server") return true;
    this.updates?.backupFailed(version, outcome.why === "failed" ? outcome.short : "the server stopped");
    this.afterFailedBackup?.();
    this.afterFailedBackup = this.ports.clock.after(HOUR, () => {
      this.afterFailedBackup = null;
      this.quiet?.recheck();
    });
    return false;
  }

  /** The version recorded and the mark written, then the installer; one that cannot be started leaves the quitting state. */
  // @spec DESK-SHELL-UPD-018, DESK-SHELL-UPD-019, DESK-SHELL-UPD-031, DESK-DIST-INST-025
  private async handToInstaller(install: Install, version: string, start: MarkStart): Promise<void> {
    this.record(version);
    install.marked = true;
    this.writeMark(start);
    if (!this.current(install)) return;
    if (this.tryInstall(version)) {
      install.handedOver = true;
      return;
    }
    await this.updates?.installFailed(version);
    if (this.current(install)) this.leaveQuitting();
  }

  /** quitAndInstall: true when the installer is being started and the updater quits the app. */
  // @spec DESK-SHELL-UPD-010, DESK-SHELL-UPD-019
  private tryInstall(version: string): boolean {
    this.saveWindowPlace();
    let r: { ok: true } | { ok: false; reason: string };
    try {
      r = this.ports.updater.install();
    } catch (e) {
      r = { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok) {
      this.exited = true;
      this.log(`[update] installing ${version}`);
      return true;
    }
    this.log(`[update] ${version} could not be installed: ${r.reason}`);
    return false;
  }

  /**
   * An update that went no further: the mark taken up and the record cleared, the server, the stream,
   * the daily backup, the watch on MSFS and the update timers taken up again, then what was held — a
   * `--quit` (a Quit beside it dropped), else a Quit, asked afresh — and the starts held and those left
   * in the mark, each as a start handed over now.
   */
  // @spec DESK-SHELL-QUIT-009, DESK-SHELL-QUIT-010, DESK-SHELL-QUIT-007, DESK-SHELL-QUIT-011, DESK-SHELL-UPD-031, DESK-SHELL-WIN-032
  private leaveQuitting(): void {
    const install = this.install;
    if (install === null) return;
    const marked = install.marked ? startsIn(this.takeUpMark()) : [];
    this.record(null);
    this.install = null;
    this.quitKind = null;
    this.supervisor.leaveQuitting();
    if (this.supervisor.state().kind === "running") this.feed.subscribe();
    this.daily.resume();
    this.msfs.start();
    this.updates?.leaveQuitting();
    this.changed();
    if (install.quitSwitch) void this.quitSwitch();
    else if (install.quit) void this.quit();
    for (const c of install.starts) this.handOver(c);
    for (const sw of marked) this.handOver(this.commandOf(sw));
  }

  /** installingVersion set, or cleared with null. */
  private record(version: string | null): void {
    if (this.store.get().installingVersion !== version) this.store.update((s) => (s.installingVersion = version));
  }

  private writeMark(start: MarkStart): void {
    const local = this.o.env.LOCALAPPDATA;
    if (local === undefined) return;
    try {
      writeMark(this.ports.markFiles, local, { pid: this.ports.pid, program: this.o.programPath, start });
    } catch (e) {
      this.log(`[update] could not write the install-under-way mark: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private appendRequestNone(): void {
    const local = this.o.env.LOCALAPPDATA;
    if (local !== undefined && !appendRequestNone(this.ports.markFiles, local)) {
      this.log("[update] could not add request none to the install-under-way mark");
    }
  }

  private takeUpMark() {
    const local = this.o.env.LOCALAPPDATA;
    if (local === undefined) return [];
    try {
      return takeUpMark(this.ports.markFiles, local, this.ports.pid);
    } catch (e) {
      this.log(`[update] could not take up the install-under-way mark: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  /** A start the mark holds, as the command line it was. */
  private commandOf(sw: StartSwitches): CommandLine {
    return { testData: this.o.plan.testFolder, background: sw === "--background", updated: sw === "--updated", quit: false, unregister: false };
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

/** a below b, by their major.minor.patch numbers, a prerelease below its release; false for either unreadable. */
function versionBelow(a: string, b: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(v.trim());
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d < 0;
  }
  return x[4] !== undefined && y[4] === undefined;
}
