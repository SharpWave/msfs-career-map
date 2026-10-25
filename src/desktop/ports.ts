import type { SavedWindow } from "./settings.ts";
import type { TrayModel } from "./tray-model.ts";

/**
 * Everything the shell reaches outside its own logic: the clock, the server's process, local HTTP,
 * Windows' facts, known folders, the opener, message boxes, the window and the tray. `main.ts` builds
 * the real ones; the tests inject stand-ins.
 */
// @spec DESK-SHELL-TEST-001

/** Cancels a timer; a no-op once it has fired. */
export type Cancel = () => void;

export interface Clock {
  /** Monotonic milliseconds; only differences mean anything. */
  now(): number;
  /** The system clock: for times kept in settings and log stamps only. */
  wallNow(): Date;
  /** One timer on the monotonic clock; the returned function cancels it (a no-op once fired). */
  after(ms: number, fn: () => void): Cancel;
}

// The server's process

export interface ServerStartOptions {
  script: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  serviceName: string;
}

export interface ServerLauncher {
  start(o: ServerStartOptions): ServerChild;
}

export interface ServerChild {
  /** null until the process has spawned. */
  readonly pid: number | null;
  onSpawn(fn: (pid: number) => void): void;
  /** Output decoded as UTF-8 (a StringDecoder per stream, so a character split across chunks stays whole). */
  onStdout(fn: (text: string) => void): void;
  onStderr(fn: (text: string) => void): void;
  /** A message the server posted on the private channel. */
  onMessage(fn: (msg: unknown) => void): void;
  /** Fires once, with the exit code, after the output that came before it; also when the process never spawned. */
  onExit(fn: (code: number) => void): void;
  /** Posts on the private channel; only called once spawned. */
  post(msg: object): void;
  /** Ends the process outright; before the spawn, ends it at the spawn. */
  kill(): void;
}

// Local HTTP

export interface HttpAnswer {
  status: number;
  body: string;
}

/** GET http://127.0.0.1:<port><path>. An answer of any status, or null for none (refused, reset, timed out). Never rejects. */
export interface LocalHttp {
  get(port: number, path: string, timeoutMs: number): Promise<HttpAnswer | null>;
  /** The raw bytes of a GET as text. After close(), nothing more is called. */
  stream(port: number, path: string, h: StreamHandlers): StreamHandle;
}

export interface StreamHandlers {
  onChunk(text: string): void;
  /** Once, for any end (also a non-200 answer). */
  onEnd(): void;
}

export interface StreamHandle {
  close(): void;
}

// Windows, folders, dialogs, the window and the tray

export interface WindowsFacts {
  /** FlightSimulator2024.exe or FlightSimulator.exe running for this Windows account; false when the look fails. */
  msfsRunning(): Promise<boolean>;
  /** FlightSimulator2024.exe alone running for this Windows account (Start with MSFS 2024); false when the look fails. */
  msfs2024Running(): Promise<boolean>;
  /** The program file a process runs; null when gone or unreadable. */
  programOf(pid: number): Promise<string | null>;
  /** Ends a process outright. */
  endProcess(pid: number): void;
  /** `netsh int ipv4 show excludedportrange protocol=tcp`'s output, or the error's message. */
  excludedPortRanges(): Promise<string>;
  /** Whether Windows reports this drive letter ("C") as a fixed drive; false when the look fails. */
  isFixedDrive(letter: string): Promise<boolean>;
  /** The ids of this Windows user's processes whose program lies inside `folder` (ignoring case); [] when the look fails. */
  processesIn(folder: string): Promise<number[]>;
}

export interface KnownFolders {
  /** Windows' Documents known folder as it resolves now (looked up afresh at every call); null when Windows cannot say. Never rejects. */
  documents(): Promise<string | null>;
}

export interface Opener {
  openFolder(folder: string): void;
  /** Only called with browserAddress()'s result. */
  openExternal(url: string): void;
}

export interface MessageBoxOptions {
  type: "warning";
  title: string;
  message: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  signal: AbortSignal;
}

/** Resolves the chosen button's index; cancelId when the signal aborts it, also when it was aborted before show. */
export interface MessageBoxes {
  show(o: MessageBoxOptions): Promise<number>;
}

export interface WindowPort {
  isOpen(): boolean;
  /** Closed: creates the window and shows it, "created". Open: restores it if minimized and brings it forward, "shown". */
  open(): "created" | "shown";
  /** Loads an address in the open window. */
  load(url: string): void;
  /** The open window's place now (its normal bounds and whether maximized); null when closed. */
  place(): SavedWindow | null;
  /** Open, not minimized, and the foreground window. */
  isForeground(): boolean;
  /** The open window's page: only its address's fragment changed (`#hop=12`), nothing reloaded. */
  setFragment(fragment: string): void;
}

export interface TrayPort {
  show(model: TrayModel): void;
}

// Notifications

/** What a notification click opens. */
export type NoticeTarget =
  | { kind: "window" }
  | { kind: "failure" }
  | { kind: "hop"; id: number }
  | { kind: "pending"; id: string };

export interface NoticeHandle {
  /** Removes it from the notification centre if it is still there. */
  close(): void;
}

export interface NotificationsPort {
  show(n: { title: string; body: string; target: NoticeTarget; silent: boolean }): NoticeHandle;
  /** Every click (Electron's handleActivation), one listener. */
  onClick(fn: (t: NoticeTarget) => void): void;
}

/** The notification registrations under HKCU and on the Start-menu shortcut. */
export interface Registrations {
  /** The AppUserModelID and ToastActivatorCLSID for this process, the CLSID onto the Start-menu shortcut when it lacks it (never creating it). Never rejects; the problems, or []. */
  register(): Promise<string[]>;
  /** The CLSID's and the AppUserModelId's keys under HKCU\Software\Classes removed, the app's notifications cleared. Never rejects; the problems, or []. */
  remove(): Promise<string[]>;
}

// The start lists

/**
 * The file calls the `EXE.xml` editor makes; `nodeEditorFs` (msfs-start.ts) is node:fs. Tests wrap it
 * to make a call fail or to change a file between two calls. Every path is absolute.
 */
export interface EditorFs {
  /** The bytes, or null when the file does not exist; throws for any other failure. */
  read(file: string): Uint8Array | null;
  exists(file: string): boolean;
  /** Creates or truncates. */
  write(file: string, bytes: Uint8Array): void;
  /** Replaces `to`; throws with the Windows code (EBUSY, EPERM, EACCES …). */
  rename(from: string, to: string): void;
  /** A missing file is fine. */
  remove(file: string): void;
  /** Names; [] when the folder is missing. */
  list(folder: string): string[];
  /** Recursive. */
  mkdir(folder: string): void;
}

/** Windows' two per-user start-up keys, as far as the app's value named "MSFS Career Map" goes. */
export interface StartupKeys {
  /** The value in each key (Run's text, StartupApproved's bytes), null where absent; throws when a key cannot be read. */
  read(): Promise<{ run: string | null; approved: Uint8Array | null }>;
  /** Both keys' values as one .reg file (UTF-16LE with BOM, "Windows Registry Editor Version 5.00"); throws with the reason. */
  exportTo(file: string): Promise<void>;
  /** Electron's login item: the Run value `"<program>" --background`, enabled under StartupApproved. */
  writeOn(program: string): Promise<void>;
  /** The value deleted from both keys; one absent is fine; throws when one stays. */
  remove(): Promise<void>;
}
