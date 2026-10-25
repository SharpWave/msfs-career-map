/**
 * The stand-ins the desktop tests inject in place of everything the shell reaches outside its own
 * logic (DESK-SHELL-TEST-001; m2 contract §3, §18.3): the server's process, local HTTP, Windows'
 * facts, known folders, the opener, message boxes, the window and the tray; and for the start lists
 * (m4 contract §1) the editor's file calls and Windows' start-up keys. Plans and command lines for
 * tests, temp folders in the run's folder, and canned server answers.
 *
 * Only types come from `src/desktop/` (`import type`), so this file loads before any shell module
 * exists.
 */
import fs from "node:fs";
import path from "node:path";
import { inject } from "vitest";
import type {
  EditorFs,
  HttpAnswer,
  KnownFolders,
  LocalHttp,
  MessageBoxes,
  MessageBoxOptions,
  NoticeHandle,
  NoticeTarget,
  NotificationsPort,
  Opener,
  Registrations,
  ServerChild,
  ServerLauncher,
  ServerStartOptions,
  StreamHandle,
  StartupKeys,
  StreamHandlers,
  TrayPort,
  WindowPort,
  WindowsFacts,
} from "../../../src/desktop/ports.ts";
import type { CheckResult, UpdaterPort } from "../../../src/desktop/ports.ts";
import type { MarkFiles } from "../../../src/desktop/install-mark.ts";
import type { CommandLine } from "../../../src/desktop/cli.ts";
import type { RunPlan } from "../../../src/desktop/start.ts";
import type { SavedWindow } from "../../../src/desktop/settings.ts";
import type { ShellPorts } from "../../../src/desktop/shell.ts";
import type { TrayModel } from "../../../src/desktop/tray-model.ts";
import { FakeClock } from "./clock.ts";

const win = path.win32;

// ---------------------------------------------------------------------------------------------
// Folders, plans and command lines

/** A new folder in inject("runDir"). */
export function tempFolder(prefix = "desktop-"): string {
  return fs.mkdtempSync(path.join(inject("runDir"), prefix));
}

/** Test mode on `folder`: port 3280; data, desktop and Backups under it; the fake feed; downloads off. */
export function testPlan(folder: string, port = 3280): RunPlan {
  return {
    mode: "test",
    testFolder: folder,
    dataFolder: win.join(folder, "data"),
    electronFolder: win.join(folder, "desktop"),
    port,
    sim: "fake",
    airportDownloads: false,
    backups: { kind: "folder", folder: win.join(folder, "Backups") },
  };
}

/** The installed program with `root` standing in for the account's folders: 3380; Local and Roaming; the sim link; downloads on; Documents. */
export function installedPlan(root: string, port = 3380): RunPlan {
  return {
    mode: "installed",
    testFolder: null,
    dataFolder: win.join(root, "Local", "MSFS Career Map"),
    electronFolder: win.join(root, "Roaming", "MSFS Career Map"),
    port,
    sim: "link",
    airportDownloads: true,
    backups: { kind: "documents", path: "MSFS Career Map\\Backups" },
  };
}

/** All switches off, testData null, then `o`. */
export function command(o: Partial<CommandLine> = {}): CommandLine {
  return { testData: null, background: false, updated: false, quit: false, unregister: false, ...o };
}

// ---------------------------------------------------------------------------------------------
// The server's process

export class FakeChild implements ServerChild {
  readonly options: ServerStartOptions;
  pid: number | null = null;
  /** What post() was given, in order. */
  posted: object[] = [];
  killed = false;
  /** When true, kill() records but the process does not exit. */
  ignoreKill = false;
  exited: number | null = null;

  private readonly index: number;
  private killHeld = false;
  private spawnFns: ((pid: number) => void)[] = [];
  private stdoutFns: ((text: string) => void)[] = [];
  private stderrFns: ((text: string) => void)[] = [];
  private messageFns: ((msg: unknown) => void)[] = [];
  private exitFns: ((code: number) => void)[] = [];

  constructor(options: ServerStartOptions, index: number) {
    this.options = options;
    this.index = index;
  }

  // The ServerChild side, used by the code under test.
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
  post(msg: object): void {
    if (this.pid === null) throw new Error("FakeChild.post called before the process spawned (contract §3.1)");
    this.posted.push(msg);
  }
  /** killed = true; unless ignoreKill, exit(0) on the next microtask; before spawn(), held until it. */
  kill(): void {
    this.killed = true;
    if (this.ignoreKill || this.exited !== null) return;
    if (this.pid === null) {
      this.killHeld = true;
      return;
    }
    queueMicrotask(() => this.exit(0));
  }

  // The test's side: what the process does.
  /** The process spawned; default pid 4000 + its index among the launcher's starts. */
  spawn(pid = 4000 + this.index): void {
    if (this.pid !== null || this.exited !== null) throw new Error("FakeChild.spawn: already spawned or exited");
    this.pid = pid;
    for (const fn of this.spawnFns) fn(pid);
    if (this.killHeld && !this.ignoreKill) queueMicrotask(() => this.exit(0));
  }
  stdout(text: string): void {
    for (const fn of this.stdoutFns) fn(text);
  }
  stderr(text: string): void {
    for (const fn of this.stderrFns) fn(text);
  }
  /** As if the server posted it on the private channel. */
  message(msg: unknown): void {
    for (const fn of this.messageFns) fn(msg);
  }
  /** Once; later calls ignored. */
  exit(code: number): void {
    if (this.exited !== null) return;
    this.exited = code;
    for (const fn of this.exitFns) fn(code);
  }
}

export class FakeLauncher implements ServerLauncher {
  starts: FakeChild[] = [];
  last(): FakeChild {
    const child = this.starts.at(-1);
    if (!child) throw new Error("FakeLauncher: nothing started yet");
    return child;
  }
  start(o: ServerStartOptions): FakeChild {
    const child = new FakeChild(o, this.starts.length);
    this.starts.push(child);
    return child;
  }
}

// ---------------------------------------------------------------------------------------------
// Local HTTP

export interface HttpCall {
  port: number;
  path: string;
  timeoutMs: number;
}
export type HttpReply = HttpAnswer | null | ((call: HttpCall) => HttpAnswer | null | Promise<HttpAnswer | null>);

export class FakeStream implements StreamHandle {
  closed = false;
  ended = false;
  constructor(
    readonly port: number,
    readonly path: string,
    private readonly h: StreamHandlers,
  ) {}
  /** The server sent some bytes; nothing once closed or ended. */
  chunk(text: string): void {
    if (this.closed || this.ended) return;
    this.h.onChunk(text);
  }
  /** The stream ended (any way); once; nothing once closed. */
  end(): void {
    if (this.closed || this.ended) return;
    this.ended = true;
    this.h.onEnd();
  }
  /** The shell closed it: no call after this. */
  close(): void {
    this.closed = true;
  }
}

export class FakeHttp implements LocalHttp {
  /** Every get, in order. */
  calls: HttpCall[] = [];
  /** Every stream, in order. */
  streams: FakeStream[] = [];
  private replies = new Map<string, HttpReply>();

  /** Answers GETs to port+path from now on (replacing an earlier reply); unmatched GETs answer null. */
  on(port: number, path: string, reply: HttpReply): void {
    this.replies.set(`${port} ${path}`, reply);
  }

  get(port: number, path: string, timeoutMs: number): Promise<HttpAnswer | null> {
    const call: HttpCall = { port, path, timeoutMs };
    this.calls.push(call);
    const reply = this.replies.get(`${port} ${path}`);
    if (reply === undefined) return Promise.resolve(null);
    if (typeof reply === "function") return Promise.resolve(reply(call));
    return Promise.resolve(reply);
  }

  /** Always opens a FakeStream; the test pushes chunk()s or end()s it. */
  stream(port: number, path: string, h: StreamHandlers): FakeStream {
    const s = new FakeStream(port, path, h);
    this.streams.push(s);
    return s;
  }

  /** Neither closed nor ended. */
  openStreams(): FakeStream[] {
    return this.streams.filter((s) => !s.closed && !s.ended);
  }
}

/** A promise that never settles. */
export function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** A ready, done /api/status answer from a server of this app, with `o` over the defaults. */
export function statusAnswer(o: { pid: number } & Record<string, unknown>): HttpAnswer {
  return {
    status: 200,
    body: JSON.stringify({
      ok: true,
      app: "msfs-career-map",
      version: "0.8.0",
      dataFolder: "C:\\test\\data",
      logbookId: null,
      sim: "fake",
      startup: "done",
      airportData: { state: "done" },
      ready: true,
      airports: null,
      runways: null,
      ...o,
    }),
  };
}

/** The tracker's status as GET /api/tracker gives it, with `o` over an idle, unconnected one. */
export function trackerStatus(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connected: false,
    sim_name: null,
    sim_mode: "fake",
    sim_host: null,
    link_holder: null,
    sim_running: false,
    paused: false,
    livery_supported: true,
    sim: null,
    aircraft_id: null,
    phase: "idle",
    position: null,
    leg: null,
    pending: [],
    briefing: null,
    casual: null,
    message: null,
    message_at: null,
    ...o,
  };
}

/** 200 with the JSON of trackerStatus(o). */
export function trackerAnswer(o: Record<string, unknown> = {}): HttpAnswer {
  return { status: 200, body: JSON.stringify(trackerStatus(o)) };
}

/** One server-sent event: `event: <event>\ndata: <JSON>\n\n`. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------------------------
// Windows, folders, the opener and message boxes

export class FakeFacts implements WindowsFacts {
  msfs = false;
  /** msfs2024Running's answer (FlightSimulator2024.exe alone). */
  msfs2024 = false;
  /** programOf answers; missing → null. */
  programs = new Map<number, string | null>();
  ended: number[] = [];
  ranges = "Protocol tcp Port Exclusion Ranges\n\nStart Port    End Port\n     13508       13508";
  fixed = new Set<string>(["C"]);
  /** When set, isFixedDrive answers with this instead of `fixed`. */
  isFixedDriveReply: ((letter: string) => Promise<boolean>) | null = null;
  /** processesIn answers, by folder exactly as asked; missing → []. */
  inFolder = new Map<string, number[]>();
  /** "msfsRunning", "msfs2024Running", "programOf <pid>", "endProcess <pid>", "excludedPortRanges", "isFixedDrive <L>", "processesIn <folder>". */
  calls: string[] = [];

  msfsRunning(): Promise<boolean> {
    this.calls.push("msfsRunning");
    return Promise.resolve(this.msfs);
  }
  msfs2024Running(): Promise<boolean> {
    this.calls.push("msfs2024Running");
    return Promise.resolve(this.msfs2024);
  }
  programOf(pid: number): Promise<string | null> {
    this.calls.push(`programOf ${pid}`);
    return Promise.resolve(this.programs.get(pid) ?? null);
  }
  endProcess(pid: number): void {
    this.calls.push(`endProcess ${pid}`);
    this.ended.push(pid);
  }
  excludedPortRanges(): Promise<string> {
    this.calls.push("excludedPortRanges");
    return Promise.resolve(this.ranges);
  }
  isFixedDrive(letter: string): Promise<boolean> {
    this.calls.push(`isFixedDrive ${letter}`);
    if (this.isFixedDriveReply) return this.isFixedDriveReply(letter);
    return Promise.resolve(this.fixed.has(letter));
  }
  processesIn(folder: string): Promise<number[]> {
    this.calls.push(`processesIn ${folder}`);
    return Promise.resolve(this.inFolder.get(folder) ?? []);
  }
}

export class FakeFolders implements KnownFolders {
  documentsPath: string | null = null;
  /** documents() calls. */
  calls = 0;
  /** Resolves documentsPath as it is at the call. */
  documents(): Promise<string | null> {
    this.calls++;
    return Promise.resolve(this.documentsPath);
  }
}

export class FakeOpener implements Opener {
  folders: string[] = [];
  urls: string[] = [];
  openFolder(folder: string): void {
    this.folders.push(folder);
  }
  openExternal(url: string): void {
    this.urls.push(url);
  }
}

export interface ShownBox {
  options: MessageBoxOptions;
  aborted: boolean;
  answer(index: number): void;
}

/** Every box shown stays open until the test answers it or its signal aborts it (→ cancelId). */
export class FakeBoxes implements MessageBoxes {
  shown: ShownBox[] = [];
  show(o: MessageBoxOptions): Promise<number> {
    return new Promise<number>((resolve) => {
      let settled = false;
      const box: ShownBox = {
        options: o,
        aborted: false,
        answer(index: number) {
          if (settled) return;
          settled = true;
          resolve(index);
        },
      };
      const abort = () => {
        if (settled) return;
        box.aborted = true;
        settled = true;
        resolve(o.cancelId);
      };
      this.shown.push(box);
      if (o.signal.aborted) abort();
      else o.signal.addEventListener("abort", abort, { once: true });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The window and the tray

export class FakeWindow implements WindowPort {
  opened = false;
  openCalls = 0;
  createdCount = 0;
  /** isForeground's answer while open. */
  foreground = false;
  /** Every address loaded in an open window, in order. */
  loads: string[] = [];
  /** Every fragment set on the open window's page (setFragment), in order. */
  fragments: string[] = [];

  isForeground(): boolean {
    return this.opened && this.foreground;
  }
  /** A closed window has no page, so a fragment then is not recorded. */
  setFragment(fragment: string): void {
    if (this.opened) this.fragments.push(fragment);
  }
  /** What place() gives while open. */
  placeNow: SavedWindow = { x: 100, y: 100, width: 1280, height: 800, maximized: false };

  isOpen(): boolean {
    return this.opened;
  }
  open(): "created" | "shown" {
    this.openCalls++;
    if (this.opened) return "shown";
    this.opened = true;
    this.createdCount++;
    return "created";
  }
  /** A closed window shows nothing, so a load then is not recorded. */
  load(url: string): void {
    if (this.opened) this.loads.push(url);
  }
  place(): SavedWindow | null {
    return this.opened ? { ...this.placeNow } : null;
  }
  lastLoad(): string | undefined {
    return this.loads.at(-1);
  }
  /** The pilot closed it (the test then calls shell.windowClosed). */
  close(): void {
    this.opened = false;
    this.foreground = false;
  }
}

export interface ShownNotice {
  title: string;
  body: string;
  target: NoticeTarget;
  silent: boolean;
  closed: boolean;
}

/** Notifications recorded, never shown; `click(t)` is the pilot clicking one (or the notification centre). */
export class FakeNotifications implements NotificationsPort {
  shown: ShownNotice[] = [];
  private clickFn: ((t: NoticeTarget) => void) | null = null;

  show(n: { title: string; body: string; target: NoticeTarget; silent: boolean }): NoticeHandle {
    const notice: ShownNotice = { ...n, closed: false };
    this.shown.push(notice);
    return {
      close() {
        notice.closed = true;
      },
    };
  }
  onClick(fn: (t: NoticeTarget) => void): void {
    this.clickFn = fn;
  }
  /** As Electron's handleActivation would deliver it; throws when nothing listens. */
  click(t: NoticeTarget): void {
    if (!this.clickFn) throw new Error("FakeNotifications.click: no listener registered");
    this.clickFn(t);
  }
  titles(): string[] {
    return this.shown.map((n) => n.title);
  }
}

/** register() and remove() counted; `problems` is what each gives back. */
export class FakeRegistrations implements Registrations {
  registered = 0;
  removed = 0;
  problems: string[] = [];
  register(): Promise<string[]> {
    this.registered++;
    return Promise.resolve([...this.problems]);
  }
  remove(): Promise<string[]> {
    this.removed++;
    return Promise.resolve([...this.problems]);
  }
}

export class FakeTray implements TrayPort {
  models: TrayModel[] = [];
  show(model: TrayModel): void {
    this.models.push(model);
  }
  last(): TrayModel | undefined {
    return this.models.at(-1);
  }
}

// ---------------------------------------------------------------------------------------------
// The start lists: the editor's file calls and Windows' start-up keys (m4 contract §4.1, §5.1)

export type FsOp = "read" | "exists" | "write" | "rename" | "remove" | "list" | "mkdir";

/** An Error carrying a Node-style `code`, as node:fs throws them. */
export function fsError(code: string, message = `${code}: refused by the test`): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

interface FsHook {
  op: FsOp;
  suffix: string;
  fn: (n: number) => void;
  n: number;
}

/**
 * The editor's file calls on real files (temp folders only), each recorded as "<op> <path>" (rename:
 * "rename <from> -> <to>"). A hook runs before every call of its op whose (first) path ends with its
 * suffix, ignoring case, given the 1-based count of such calls: it may throw, failing the call, or
 * change files on disk first, as another program would.
 */
export class ScriptedFs implements EditorFs {
  calls: string[] = [];
  private hooks: FsHook[] = [];

  /** Returns a function that takes the hook away. */
  hook(op: FsOp, suffix: string, fn: (n: number) => void): () => void {
    const h: FsHook = { op, suffix: suffix.toLowerCase(), fn, n: 0 };
    this.hooks.push(h);
    return () => {
      this.hooks = this.hooks.filter((x) => x !== h);
    };
  }

  /** The recorded calls of one op. */
  callsOf(op: FsOp): string[] {
    return this.calls.filter((c) => c.startsWith(`${op} `));
  }

  read(file: string): Uint8Array | null {
    this.before("read", file, `read ${file}`);
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  exists(file: string): boolean {
    this.before("exists", file, `exists ${file}`);
    return fs.existsSync(file);
  }
  write(file: string, bytes: Uint8Array): void {
    this.before("write", file, `write ${file}`);
    fs.writeFileSync(file, bytes);
  }
  rename(from: string, to: string): void {
    this.before("rename", from, `rename ${from} -> ${to}`);
    fs.renameSync(from, to);
  }
  remove(file: string): void {
    this.before("remove", file, `remove ${file}`);
    fs.rmSync(file, { force: true });
  }
  list(folder: string): string[] {
    this.before("list", folder, `list ${folder}`);
    try {
      return fs.readdirSync(folder);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  mkdir(folder: string): void {
    this.before("mkdir", folder, `mkdir ${folder}`);
    fs.mkdirSync(folder, { recursive: true });
  }

  private before(op: FsOp, file: string, call: string): void {
    this.calls.push(call);
    const lower = file.toLowerCase();
    for (const h of [...this.hooks]) {
      if (h.op === op && lower.endsWith(h.suffix)) h.fn(++h.n);
    }
  }
}

/** StartupApproved's mark as Electron writes it enabled (02) and as Task Manager writes it disabled (03). */
export const APPROVED_ENABLED = Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const APPROVED_DISABLED = Uint8Array.from([3, 0, 0, 0, 0x8a, 0x3b, 0x1f, 0x52, 0x9c, 0x46, 0xdb, 0x01]);

/**
 * Windows' two start-up keys in memory: the value named "MSFS Career Map" in each (null when
 * absent). `others` stands for every other value in the keys, which nothing may change. A failure
 * set for a call makes it throw with that message; `gate`, while set, holds every call until it
 * settles (a never-settling one for --unregister's 15 s bound).
 */
export class FakeKeys implements StartupKeys {
  run: string | null = null;
  approved: Uint8Array | null = null;
  readonly others = { run: { OneDrive: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background' }, approved: { OneDrive: "02" } };
  /** "read", "exportTo <file>", "writeOn <program>", "remove". */
  calls: string[] = [];
  fail: Partial<Record<"read" | "exportTo" | "writeOn" | "remove", string>> = {};
  gate: Promise<void> | null = null;

  async read(): Promise<{ run: string | null; approved: Uint8Array | null }> {
    await this.enter("read");
    return { run: this.run, approved: this.approved === null ? null : Uint8Array.from(this.approved) };
  }
  /** Writes a small UTF-16LE .reg file at `file`, so the backups folder holds it as Windows' export would. */
  async exportTo(file: string): Promise<void> {
    await this.enter("exportTo", file);
    const text = `Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]\r\n"MSFS Career Map"=${JSON.stringify(this.run)}\r\n`;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
  }
  async writeOn(program: string): Promise<void> {
    await this.enter("writeOn", program);
    this.run = `"${program}" --background`;
    this.approved = Uint8Array.from(APPROVED_ENABLED);
  }
  async remove(): Promise<void> {
    await this.enter("remove");
    this.run = null;
    this.approved = null;
  }

  private async enter(name: "read" | "exportTo" | "writeOn" | "remove", arg?: string): Promise<void> {
    this.calls.push(arg === undefined ? name : `${name} ${arg}`);
    if (this.gate) await this.gate;
    const why = this.fail[name];
    if (why !== undefined) throw new Error(why);
  }
}

// ---------------------------------------------------------------------------------------------
// Updates (m5b contract §2, §6)

export interface FakeDownload {
  version: string;
  cancelled: boolean;
  finish(r?: { ok: true } | { ok: false; reason: string }): void;
}

/**
 * electron-updater in memory. A check waits until the test settles it (`answerCheck`), or answers at
 * once with `checkReply` when that is set; a download waits for `downloads.at(-1).finish()`. `install()`
 * answers `installReply`. `calls`: "check", "cancelCheck", "download <v>", "install", "discard".
 */
export class FakeUpdater implements UpdaterPort {
  calls: string[] = [];
  checkReply: CheckResult | null = null;
  installReply: { ok: true } | { ok: false; reason: string } = { ok: true };
  downloads: FakeDownload[] = [];
  private pendingChecks: ((r: CheckResult) => void)[] = [];

  check(): Promise<CheckResult> {
    this.calls.push("check");
    if (this.checkReply) return Promise.resolve(this.checkReply);
    return new Promise((resolve) => this.pendingChecks.push(resolve));
  }
  /** Settles the oldest check still waiting; throws when none waits. */
  answerCheck(r: CheckResult): void {
    const resolve = this.pendingChecks.shift();
    if (!resolve) throw new Error("FakeUpdater.answerCheck: no check waiting");
    resolve(r);
  }
  checksWaiting(): number {
    return this.pendingChecks.length;
  }
  download(version: string): { done: Promise<{ ok: true } | { ok: false; reason: string }>; cancel(): void } {
    this.calls.push(`download ${version}`);
    let settle!: (r: { ok: true } | { ok: false; reason: string }) => void;
    const done = new Promise<{ ok: true } | { ok: false; reason: string }>((r) => (settle = r));
    let settled = false;
    const d: FakeDownload = {
      version,
      cancelled: false,
      finish(r = { ok: true }) {
        if (settled) return;
        settled = true;
        settle(r);
      },
    };
    this.downloads.push(d);
    return {
      done,
      cancel() {
        d.cancelled = true;
        d.finish({ ok: false, reason: "cancelled" });
      },
    };
  }
  cancelCheck(): void {
    this.calls.push("cancelCheck");
    for (const resolve of this.pendingChecks.splice(0)) resolve({ kind: "failed", reason: "cancelled" });
  }
  install(): { ok: true } | { ok: false; reason: string } {
    this.calls.push("install");
    return this.installReply;
  }
  discard(): Promise<void> {
    this.calls.push("discard");
    return Promise.resolve();
  }
}

/** The install-under-way mark's file calls in memory, by path ignoring case. */
export class FakeMarkFiles implements MarkFiles {
  readonly files = new Map<string, Uint8Array>();
  calls: string[] = [];
  private key(file: string): string {
    return file.toLowerCase();
  }
  read(file: string): Uint8Array | null {
    this.calls.push(`read ${file}`);
    return this.files.get(this.key(file)) ?? null;
  }
  append(file: string, bytes: Uint8Array): boolean {
    this.calls.push(`append ${file}`);
    const had = this.files.get(this.key(file));
    if (!had) return false;
    const joined = new Uint8Array(had.length + bytes.length);
    joined.set(had);
    joined.set(bytes, had.length);
    this.files.set(this.key(file), joined);
    return true;
  }
  write(file: string, bytes: Uint8Array): void {
    this.calls.push(`write ${file}`);
    this.files.set(this.key(file), Uint8Array.from(bytes));
  }
  rename(from: string, to: string): void {
    this.calls.push(`rename ${from} -> ${to}`);
    const had = this.files.get(this.key(from));
    if (!had) throw fsError("ENOENT");
    this.files.delete(this.key(from));
    this.files.set(this.key(to), had);
  }
  remove(file: string): void {
    this.calls.push(`remove ${file}`);
    this.files.delete(this.key(file));
  }
  has(file: string): boolean {
    return this.files.has(this.key(file));
  }
}

export interface FakePorts extends ShellPorts {
  clock: FakeClock;
  launcher: FakeLauncher;
  http: FakeHttp;
  facts: FakeFacts;
  folders: FakeFolders;
  opener: FakeOpener;
  boxes: FakeBoxes;
  window: FakeWindow;
  tray: FakeTray;
  fs: ScriptedFs;
  keys: FakeKeys;
  notifications: FakeNotifications;
  registrations: FakeRegistrations;
  updater: FakeUpdater;
  markFiles: FakeMarkFiles;
  pid: number;
  exits: { code: number; relaunch: string[] | null }[];
}

export function makePorts(): FakePorts {
  const exits: { code: number; relaunch: string[] | null }[] = [];
  return {
    clock: new FakeClock(),
    launcher: new FakeLauncher(),
    http: new FakeHttp(),
    facts: new FakeFacts(),
    folders: new FakeFolders(),
    opener: new FakeOpener(),
    boxes: new FakeBoxes(),
    window: new FakeWindow(),
    tray: new FakeTray(),
    fs: new ScriptedFs(),
    keys: new FakeKeys(),
    notifications: new FakeNotifications(),
    registrations: new FakeRegistrations(),
    updater: new FakeUpdater(),
    markFiles: new FakeMarkFiles(),
    pid: 7300,
    exits,
    exit(code: number, relaunch: string[] | null) {
      exits.push({ code, relaunch });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Screens (the literal texts of contract §13.4)

const SCREEN_TEXTS = [
  ["failure", "MSFS Career Map could not start its server"],
  ["quitting", "Quitting MSFS Career Map…"],
  ["stopped", "The page stopped. Close this window and open it again from the tray."],
  ["start", "Starting MSFS Career Map…"],
] as const;

/** A data: URL's HTML, decoded. */
export function screenHtmlOf(url: string): string {
  if (!url.startsWith("data:")) throw new Error(`not a data: URL: ${url}`);
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error(`a data: URL without data: ${url}`);
  return decodeURIComponent(url.slice(comma + 1));
}

/** Which screen a loaded URL shows: by SCREEN_TEXT in a decoded data: URL; "page" for http://127.0.0.1:<port>/. */
export function screenOf(url: string, port: number): "start" | "failure" | "quitting" | "stopped" | "page" | "other" {
  if (url === `http://127.0.0.1:${port}/`) return "page";
  if (!url.startsWith("data:")) return "other";
  const html = screenHtmlOf(url);
  for (const [screen, text] of SCREEN_TEXTS) if (html.includes(text)) return screen;
  return "other";
}
