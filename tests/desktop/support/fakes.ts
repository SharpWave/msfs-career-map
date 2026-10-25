/**
 * The stand-ins the desktop tests inject in place of everything the shell reaches outside its own
 * logic (DESK-SHELL-TEST-001; m2 contract §3, §18.3): the server's process, local HTTP, Windows'
 * facts, known folders, the opener, message boxes, the window and the tray. Plans and command lines
 * for tests, temp folders in the run's folder, and canned server answers.
 *
 * Only types come from `src/desktop/` (`import type`), so this file loads before any shell module
 * exists.
 */
import fs from "node:fs";
import path from "node:path";
import { inject } from "vitest";
import type {
  HttpAnswer,
  KnownFolders,
  LocalHttp,
  MessageBoxes,
  MessageBoxOptions,
  Opener,
  ServerChild,
  ServerLauncher,
  ServerStartOptions,
  StreamHandle,
  StreamHandlers,
  TrayPort,
  WindowPort,
  WindowsFacts,
} from "../../../src/desktop/ports.ts";
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
  /** programOf answers; missing → null. */
  programs = new Map<number, string | null>();
  ended: number[] = [];
  ranges = "Protocol tcp Port Exclusion Ranges\n\nStart Port    End Port\n     13508       13508";
  fixed = new Set<string>(["C"]);
  /** When set, isFixedDrive answers with this instead of `fixed`. */
  isFixedDriveReply: ((letter: string) => Promise<boolean>) | null = null;
  /** "msfsRunning", "programOf <pid>", "endProcess <pid>", "excludedPortRanges", "isFixedDrive <L>". */
  calls: string[] = [];

  msfsRunning(): Promise<boolean> {
    this.calls.push("msfsRunning");
    return Promise.resolve(this.msfs);
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
  /** Every address loaded in an open window, in order. */
  loads: string[] = [];
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
