import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  powerMonitor,
  screen,
  session,
  shell as electronShell,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from "electron";
import { browserAddress, navigationOutcome, newWindowOutcome } from "./address.ts";
import { handedOverCommand, startSwitch, type CommandLine } from "./cli.ts";
import { realClock } from "./clock.ts";
import { installErrorHandlers } from "./errors.ts";
import { autoUpdater, CancellationToken } from "electron-updater";
import { checkInstallUnderWay, downloadsFolder, leftInMarkLogLine, nodeMarkFiles } from "./install-mark.ts";
import { localHttp } from "./local-http.ts";
import { LogFile } from "./logs.ts";
import { nodeEditorFs } from "./msfs-start.ts";
import { registrations, type ShortcutLinks } from "./registrations.ts";
import type {
  Cancel,
  Clock,
  MessageBoxes,
  NoticeTarget,
  NotificationsPort,
  Opener,
  ServerChild,
  ServerLauncher,
  TrayPort,
  WindowPort,
} from "./ports.ts";
import { Shell } from "./shell.ts";
import { decideStart, type RunPlan } from "./start.ts";
import { startupKeys } from "./startup-keys.ts";
import { launchOf, parseLaunch, toastXml } from "./toast.ts";
import type { TrayDot, TrayMenuItem } from "./tray-model.ts";
import { runUnregister } from "./unregister.ts";
import { electronUpdater, lazyUpdater } from "./updater.ts";
import { VERSION } from "./version.ts";
import {
  contextMenuItems,
  failedMainFrameLoad,
  isDevToolsKey,
  isReloadKey,
  windowOptions,
  windowUserAgent,
} from "./window-options.ts";
import { initialPlace, minContentSize } from "./window-place.ts";
import { knownFolders, windowsFacts } from "./windows-facts.ts";

/**
 * The Electron glue, the desktop bundle's entry: the start decided before Electron writes anything,
 * Electron's own folder set before the single-instance lock, then, in the copy holding the lock, the
 * Shell given the real ports (the utility process, local HTTP, Windows' facts, message boxes, the
 * window and the tray) and wired to Electron's events.
 */

/** Until the running copy's desktop.log exists, the shell's own errors go to the console. */
let writeLine: (line: string) => void = (line) => console.log(line);

// @spec DESK-SHELL-SRV-002, DESK-SHELL-SRV-040, DESK-SHELL-CLI-001, DESK-SHELL-CLI-002, DESK-SHELL-CLI-003, DESK-SHELL-CLI-007, DESK-SHELL-CLI-009, DESK-SHELL-CLI-011, DESK-SHELL-CLI-020, DESK-SHELL-LOG-008, DESK-DIST-DEV-004
function main(): void {
  installErrorHandlers(process, (line) => writeLine(line));

  const decision = decideStart(process.argv, process.env, process.execPath, process.cwd());
  if (decision.kind === "refuse") {
    console.log(decision.message);
    process.exit(1);
  }
  // Electron's own folder comes first: nothing before it may ask Electron for a folder.
  app.setPath("userData", decision.plan.electronFolder);
  if (decision.kind === "unregister") {
    // Its own work, before the lock and without handing over; the exit code tells the uninstaller what is left.
    void runUnregister({
      plan: decision.plan,
      env: process.env,
      clock: realClock(),
      fs: nodeEditorFs,
      keys: startupKeys({ loginItems: app }),
      registrations: registrations({ app, shell: shortcutLinks, appData: process.env.APPDATA ?? "" }),
    })
      .catch(() => 3 as const)
      .then((code) => process.exit(code));
    return;
  }
  if (decision.kind === "quit-only") {
    app.requestSingleInstanceLock({ commandLine: decision.command });
    app.exit(0);
    return;
  }
  const { plan, command } = decision;
  const sw = startSwitch(command);
  if (plan.mode !== "installed" || (sw !== "none" && sw !== "background" && sw !== "updated")) {
    takeLock(plan, command);
    return;
  }
  // An installed start during an install is left in the install-under-way mark, before any lock.
  const switches = sw === "none" ? "" : (`--${sw}` as const);
  void checkInstallUnderWay({ localAppData: process.env.LOCALAPPDATA ?? "", switches, files: nodeMarkFiles, facts: windowsFacts(process.env) })
    .catch(() => "go" as const)
    .then((check) => {
      if (check === "left-in-mark") {
        new LogFile({ folder: path.win32.join(plan.electronFolder, "logs"), name: "desktop", clock: realClock() }).write(leftInMarkLogLine(switches));
        app.exit(0);
        return;
      }
      takeLock(plan, command);
    });
}

/** The single-instance lock: held, this copy runs; otherwise its command line was handed over. */
function takeLock(plan: RunPlan, command: CommandLine): void {
  if (!app.requestSingleInstanceLock({ commandLine: command })) {
    app.exit(0);
    return;
  }
  runningCopy(plan, command);
}

/** The copy holding the lock: the Shell and everything it reaches. */
// @spec DESK-SHELL-TRAY-001, DESK-SHELL-WIN-017, DESK-SHELL-WIN-019, DESK-SHELL-WIN-029, DESK-SHELL-OS-001, DESK-SHELL-SRV-038, DESK-SHELL-SRV-039
function runningCopy(plan: RunPlan, command: CommandLine): void {
  const clock = realClock();
  const programFolder = app.isPackaged ? process.resourcesPath : __dirname;
  const iconFolder = path.join(programFolder, "icons");
  let tray: Tray | null = null;
  let trayDot: TrayDot | null = null;
  const trayIcon = (dot: TrayDot) => path.join(iconFolder, dot === "none" ? "tray.ico" : `tray-${dot}.ico`);

  const trayPort: TrayPort = {
    show(model) {
      if (!tray) return;
      tray.setToolTip(model.tooltip);
      if (model.dot !== trayDot) {
        trayDot = model.dot;
        tray.setImage(trayIcon(model.dot));
      }
    },
  };

  const opener: Opener = {
    openFolder(folder) {
      void electronShell.openPath(folder);
    },
    openExternal(url) {
      void electronShell.openExternal(url).catch(() => {});
    },
  };

  const window = new PageWindowPort(plan.port, iconFolder, opener, () => shell);
  const notifications = toastNotifications();

  const shell: Shell = new Shell(
    {
      plan,
      command,
      version: VERSION,
      programPath: process.execPath,
      programFolder,
      serverScript: path.join(programFolder, "server.mjs"),
      env: process.env,
    },
    {
      clock,
      launcher: utilityLauncher(clock),
      http: localHttp(),
      facts: windowsFacts(process.env),
      folders: knownFolders(process.env),
      opener,
      boxes: messageBoxes,
      window,
      tray: trayPort,
      fs: nodeEditorFs,
      keys: startupKeys({ loginItems: app }),
      notifications,
      registrations: registrations({ app, shell: shortcutLinks, appData: process.env.APPDATA ?? "" }),
      // electron-updater's autoUpdater is only made at the first call, which test mode never makes.
      updater: lazyUpdater(() =>
        electronUpdater<CancellationToken>({
          autoUpdater,
          CancellationToken,
          cacheFolder: downloadsFolder(process.env.LOCALAPPDATA ?? ""),
          log: (line) => shell.log(line),
        }),
      ),
      markFiles: nodeMarkFiles,
      pid: process.pid,
      exit(code, relaunch) {
        if (relaunch) app.relaunch({ args: app.isPackaged ? relaunch : [process.argv[1], ...relaunch] });
        // The icon leaves the notification area with the app, not at Explorer's next look.
        tray?.destroy();
        tray = null;
        app.exit(code);
      },
    },
  );
  writeLine = (line) => shell.log(line);

  app.on("second-instance", (_e, argv, cwd, data) => shell.handOver(handedOverCommand(data, argv, cwd)));
  // Closing the window leaves the app in the tray.
  app.on("window-all-closed", () => {});
  // Only electron-updater's quitAndInstall quits by app.quit(); its icon leaves with the app too.
  app.on("before-quit", () => {
    tray?.destroy();
    tray = null;
  });
  app.userAgentFallback = windowUserAgent(app.userAgentFallback, VERSION);

  void app.whenReady().then(() => {
    // Every click, whatever object it came from, a cold start by one included.
    if (plan.mode === "installed") notifications.listen();
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    tray = new Tray(trayIcon("none"));
    trayDot = "none";
    tray.on("click", () => shell.trayClicked());
    tray.on("right-click", () => {
      void shell.menuOpening().then(() => {
        tray?.popUpContextMenu(Menu.buildFromTemplate(menuTemplate(shell.trayModel().menu, shell)));
      });
    });

    // Never loaded or shown: it only hears Windows ending the session.
    const watcher = new BrowserWindow({ show: false, width: 1, height: 1, skipTaskbar: true });
    watcher.on("query-session-end", () => shell.queryEndSession());
    watcher.on("session-end", () => shell.endSession());

    powerMonitor.on("suspend", () => shell.suspend());
    powerMonitor.on("resume", () => shell.resume());
    screen.on("display-metrics-changed", () => window.fitMinimumSize());

    void shell.start();
  }).catch((e: unknown) => {
    // A copy with no tray and no server would hold the lock unseen: it ends, saying why.
    writeLine(`[shell] could not start: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    app.exit(1);
  });
}

/** The tray menu as Electron builds it, an item with `checked` as a checkbox; each item's click goes to the shell. */
function menuTemplate(menu: TrayMenuItem[], shell: Shell): MenuItemConstructorOptions[] {
  return menu.map((item): MenuItemConstructorOptions => {
    if ("separator" in item) return { type: "separator" };
    const click = () => void shell.menuChosen(item.id);
    return item.checked === undefined
      ? { label: item.label, enabled: item.enabled, click }
      : { type: "checkbox", checked: item.checked, label: item.label, enabled: item.enabled, click };
  });
}

/**
 * Windows toasts built from their XML, their click target in the toast's launch string, and every click
 * — from a toast still on screen, the notification centre, or one that started the app — taken through
 * Electron's notification activation once `listen()` is called.
 */
// @spec DESK-SHELL-NOTE-011, DESK-SHELL-NOTE-012, DESK-SHELL-NOTE-014, DESK-SHELL-AWAY-004, DESK-SHELL-CLI-021
function toastNotifications(): NotificationsPort & { listen(): void } {
  let clickFn: ((t: NoticeTarget) => void) | null = null;
  return {
    show(n) {
      const notification = new Notification({ toastXml: toastXml({ title: n.title, body: n.body, launch: launchOf(n.target), silent: n.silent }) });
      notification.show();
      return {
        close() {
          notification.close();
        },
      };
    },
    onClick(fn) {
      clickFn = fn;
    },
    listen() {
      Notification.handleActivation((details) => {
        const t = parseLaunch(details.arguments);
        if (t !== null) clickFn?.(t);
      });
    },
  };
}

/** Electron's shortcut calls; an update written over what the shortcut holds, so its target and the rest stay. */
const shortcutLinks: ShortcutLinks = {
  readShortcutLink: (file) => electronShell.readShortcutLink(file),
  writeShortcutLink: (file, operation, options) =>
    electronShell.writeShortcutLink(file, operation, { ...electronShell.readShortcutLink(file), ...options }),
};

/** A box aborted before it showed resolves with no response at once; one aborted while open gives its cancelId. */
const messageBoxes: MessageBoxes = {
  async show(o) {
    try {
      const { response } = await dialog.showMessageBox(o);
      return typeof response === "number" ? response : o.cancelId;
    } catch {
      return o.cancelId;
    }
  },
};

// -------------------------------------------------------------------------------------------------
// The server's utility process

/**
 * The server in an Electron utility process, its working folder made first (a missing one makes it
 * exit 1 unspawned). Electron ends the utility process with the main one, however that ends.
 */
// @spec DESK-SHELL-SRV-001, DESK-SHELL-SRV-003, DESK-SHELL-SRV-011, DESK-SHELL-LOG-002
function utilityLauncher(clock: Clock): ServerLauncher {
  return {
    start(o) {
      try {
        fs.mkdirSync(o.cwd, { recursive: true });
      } catch {
        // The process then exits without spawning, which the Supervisor counts.
      }
      try {
        const child = utilityProcess.fork(o.script, o.args, { stdio: "pipe", serviceName: o.serviceName, cwd: o.cwd, env: o.env });
        return new UtilityChild(child, clock);
      } catch (e) {
        return new UnstartedChild(e, clock);
      }
    },
  };
}

/** A fork that threw: its error on stderr, then exit code 1 unspawned, counted like any failure at start. */
class UnstartedChild implements ServerChild {
  readonly pid: number | null = null;
  private readonly stderrFns: ((text: string) => void)[] = [];
  private readonly exitFns: ((code: number) => void)[] = [];

  constructor(error: unknown, clock: Clock) {
    // After the Supervisor has attached its listeners.
    clock.after(0, () => {
      for (const fn of this.stderrFns) fn(`${String(error)}\n`);
      for (const fn of this.exitFns) fn(1);
    });
  }

  onSpawn(): void {}
  onStdout(): void {}
  onStderr(fn: (text: string) => void): void {
    this.stderrFns.push(fn);
  }
  onMessage(): void {}
  onExit(fn: (code: number) => void): void {
    this.exitFns.push(fn);
  }
  post(): void {}
  kill(): void {}
}

/** How long after its exit event a process's output may still arrive. */
const OUTPUT_AFTER_EXIT_MS = 1_000;

/**
 * A utility process as a ServerChild, evening out three things Electron does: a kill before the spawn
 * is held until it; the exit is reported once both pipes have ended (or 1 s after the exit event),
 * since output can arrive after it; and output is decoded whole across chunks.
 */
class UtilityChild implements ServerChild {
  pid: number | null = null;
  private killAtSpawn = false;
  private exitCode: number | null = null;
  private exitReported = false;
  private exitWait: Cancel | null = null;
  private openPipes = 2;
  private readonly spawnFns: ((pid: number) => void)[] = [];
  private readonly stdoutFns: ((text: string) => void)[] = [];
  private readonly stderrFns: ((text: string) => void)[] = [];
  private readonly messageFns: ((msg: unknown) => void)[] = [];
  private readonly exitFns: ((code: number) => void)[] = [];

  constructor(
    private readonly child: UtilityProcess,
    private readonly clock: Clock,
  ) {
    child.on("spawn", () => {
      this.pid = child.pid ?? null;
      if (this.pid !== null) for (const fn of this.spawnFns) fn(this.pid);
      if (this.killAtSpawn) child.kill();
    });
    child.on("message", (msg: unknown) => {
      for (const fn of this.messageFns) fn(msg);
    });
    child.on("exit", (code: number) => {
      this.exitCode = code;
      this.exitWait = this.clock.after(OUTPUT_AFTER_EXIT_MS, () => this.reportExit());
      if (this.openPipes <= 0) this.reportExit();
    });
    this.pipe(child.stdout, this.stdoutFns);
    this.pipe(child.stderr, this.stderrFns);
  }

  onSpawn(fn: (pid: number) => void): void {
    this.spawnFns.push(fn);
  }
  onStdout(fn: (text: string) => void): void {
    this.stdoutFns.push(fn);
  }
  onStderr(fn: (text: string) => void): void {
    this.stderrFns.push(fn);
  }
  onMessage(fn: (msg: unknown) => void): void {
    this.messageFns.push(fn);
  }
  onExit(fn: (code: number) => void): void {
    this.exitFns.push(fn);
  }

  /** Dropped once the exit event has come: Electron then holds no process to post to and throws. */
  post(msg: object): void {
    if (this.exitCode !== null) return;
    try {
      this.child.postMessage(msg);
    } catch {
      // The process ended between its exit and this post; its exit is reported as usual.
    }
  }

  kill(): void {
    if (this.exitCode !== null) return;
    if (this.pid === null) this.killAtSpawn = true;
    else this.child.kill();
  }

  private pipe(stream: NodeJS.ReadableStream | null, fns: ((text: string) => void)[]): void {
    if (!stream) {
      this.openPipes--;
      return;
    }
    const decoder = new StringDecoder("utf8");
    const emit = (text: string) => {
      if (text === "" || this.exitReported) return;
      for (const fn of fns) fn(text);
    };
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      emit(decoder.end());
      this.openPipes--;
      if (this.exitCode !== null && this.openPipes <= 0) this.reportExit();
    };
    stream.on("data", (chunk: Buffer | string) => emit(typeof chunk === "string" ? chunk : decoder.write(chunk)));
    stream.on("end", end);
    stream.on("close", end);
    stream.on("error", end);
  }

  private reportExit(): void {
    if (this.exitReported || this.exitCode === null) return;
    this.exitReported = true;
    this.exitWait?.();
    this.exitWait = null;
    for (const fn of this.exitFns) fn(this.exitCode);
  }
}

// -------------------------------------------------------------------------------------------------
// The window

/**
 * The page's window: placed from the settings, its options stated outright, and its webContents
 * held to the page's own origin (other addresses to the browser), with the reload and DevTools keys,
 * the right-click menu and the load failures handed to the shell.
 */
// @spec DESK-SHELL-WIN-005, DESK-SHELL-WIN-006, DESK-SHELL-WIN-007, DESK-SHELL-WIN-008, DESK-SHELL-WIN-009, DESK-SHELL-WIN-011, DESK-SHELL-WIN-013, DESK-SHELL-WIN-014, DESK-SHELL-WIN-015, DESK-SHELL-WIN-016, DESK-SHELL-WIN-018, DESK-SHELL-WIN-020, DESK-SHELL-WIN-022, DESK-SHELL-WIN-023, DESK-SHELL-WIN-025, DESK-SHELL-WIN-031, DESK-DIST-PKG-015, DESK-DIST-DEV-001
class PageWindowPort implements WindowPort {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly port: number,
    private readonly iconFolder: string,
    private readonly opener: Opener,
    private readonly shell: () => Shell,
  ) {}

  isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  isForeground(): boolean {
    const w = this.win;
    return w !== null && !w.isDestroyed() && !w.isMinimized() && w.isFocused();
  }

  /** Only the page's fragment changes: the page acts on it (APP-UI-032) and nothing reloads. */
  setFragment(fragment: string): void {
    const w = this.win;
    if (w && !w.isDestroyed()) void w.webContents.executeJavaScript(`location.hash = ${JSON.stringify(fragment)}`).catch(() => {});
  }

  open(): "created" | "shown" {
    const w = this.win;
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      return "shown";
    }
    this.win = this.create();
    return "created";
  }

  load(url: string): void {
    const w = this.win;
    if (w && !w.isDestroyed()) void w.loadURL(url).catch(() => {});
  }

  place(): { x: number; y: number; width: number; height: number; maximized: boolean } | null {
    const w = this.win;
    return w && !w.isDestroyed() ? { ...w.getNormalBounds(), maximized: w.isMaximized() } : null;
  }

  /** The smallest content size for the window's display, plus its frame. */
  fitMinimumSize(): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const min = minContentSize(screen.getDisplayMatching(w.getBounds()).workArea);
    const [outerWidth, outerHeight] = w.getSize();
    const [contentWidth, contentHeight] = w.getContentSize();
    w.setMinimumSize(min.width + outerWidth - contentWidth, min.height + outerHeight - contentHeight);
  }

  private create(): BrowserWindow {
    const shell = this.shell();
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
    const place = initialPlace(shell.settings().window, displays, { id: primary.id, workArea: primary.workArea });
    const w = new BrowserWindow(
      windowOptions({ bounds: place.bounds, icon: path.join(this.iconFolder, "career-map.ico"), devTools: !app.isPackaged }),
    );
    if (place.maximized) w.maximize();
    w.removeMenu();
    this.win = w;
    this.fitMinimumSize();
    w.on("moved", () => this.fitMinimumSize());
    w.on("close", () => shell.windowClosed({ ...w.getNormalBounds(), maximized: w.isMaximized() }));
    w.on("closed", () => {
      if (this.win === w) this.win = null;
    });

    const wc = w.webContents;
    const port = this.port;
    // Acted on here alone: Electron fires it for the main frame and every subframe.
    wc.on("will-frame-navigate", (e) => {
      const outcome = navigationOutcome(e.url, port);
      if (outcome === "load") return;
      e.preventDefault();
      if (outcome === "browser") this.toBrowser(e.url);
      else shell.log(`[window] refused ${e.url}`);
    });
    wc.on("will-navigate", (e) => {
      if (navigationOutcome(e.url, port) !== "load") e.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (newWindowOutcome(url, port) === "browser") this.toBrowser(url);
      else shell.log(`[window] refused ${url}`);
      return { action: "deny" };
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("did-fail-load", (_e, errorCode, _description, url, isMainFrame) => {
      if (failedMainFrameLoad({ kind: "did-fail-load", url, errorCode, isMainFrame }, port)) shell.pageLoadFailed();
    });
    wc.on("did-navigate", (_e, url, httpResponseCode) => {
      if (failedMainFrameLoad({ kind: "did-navigate", url, httpResponseCode }, port)) shell.pageLoadFailed();
    });
    wc.on("render-process-gone", (_e, details) => {
      if (details.reason !== "clean-exit") shell.rendererGone();
    });
    wc.on("before-input-event", (e, input) => {
      if (isReloadKey(input)) {
        e.preventDefault();
        wc.reload();
      } else if (!app.isPackaged && isDevToolsKey(input)) {
        e.preventDefault();
        wc.toggleDevTools();
      }
    });
    wc.on("context-menu", (_e, params) => {
      const items = contextMenuItems(params);
      if (items.length > 0) Menu.buildFromTemplate(items.map((i) => ({ role: i.role, enabled: i.enabled }))).popup({ window: w });
    });
    return w;
  }

  private toBrowser(url: string): void {
    const address = browserAddress(url);
    if (address === null) return;
    this.opener.openExternal(address);
    this.shell().log(`[window] opened in the browser: ${address}`);
  }
}

main();
