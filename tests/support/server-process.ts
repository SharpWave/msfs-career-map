/**
 * Starts the server as a process, the way the pilot's PC runs it, for the tests that need the real
 * process: its exits, its output, its lock and its private channel. Each server runs on a data
 * folder in the run's temp folder and a free port, with an environment stripped of everything that
 * would point it elsewhere, and every launch is checked first (checkTestServerArgs) so no test can
 * reach the pilot's real logbook, the sim or a port a real server may use.
 *
 * Behind that check, every launch is also kept safe from a server whose code is wrong:
 * - its environment carries decoys: a canary CAREER_DB in the run folder, SIMCONNECT_HOST and
 *   SIMCONNECT_PORT naming a closed port on 127.0.0.1, and LOCALAPPDATA, APPDATA and USERPROFILE
 *   in the run folder. A correct server reads none of them;
 * - its working folder is a new, empty folder in the run folder;
 * - server-guard.ts is loaded into it: no fetch leaves the PC, and no database opens outside the
 *   run folder;
 * - its listening line is checked as soon as it is written, and the server is killed at once when
 *   the line is not the contract's, or names a data folder outside the run folder, a reserved port
 *   or the sim link.
 * What a launch did wrong (the canary or the profile touched, a guard refusal, a file in its
 * working folder, a kill at the listening line) fails the test in killTestServers or
 * killAllServers.
 *
 * Files that launch servers call `afterEach(killTestServers)` and `afterAll(killAllServers)`.
 */
import { fork, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { inject } from "vitest";
import { allowOrigin } from "./fetch-guard.ts";
import type { ContenderResult } from "./lock-contender.ts";
import { makeDataFolder } from "./run-folder.ts";

/** The repository root. */
export const REPO = path.resolve(import.meta.dirname, "..", "..");

/** Ports a real server may be on: the app's own, the browser tests', and their neighbours. No test names one. */
export const RESERVED_PORTS: readonly number[] = [3080, 3180, 3280, 3380, 5173, 5183];

export type ServerEntry = "source" | "bundled";
export type ServerAct = "SIGINT" | "SIGBREAK" | "SIGHUP" | "SIGTERM" | "uncaught" | "rejection";

export interface LaunchOptions {
  entry: ServerEntry;
  /** Added after the defaults; a later --name=value replaces a default of that name. */
  args?: string[];
  /** Default argument names to leave out, e.g. ["--data"]. */
  omit?: string[];
  /** Default: makeDataFolder(inject("runDir")).dir (fixture lists in it, no database). Used as given, never created. */
  dataFolder?: string;
  /** Bundled default: makeProgramFolder(). */
  programFolder?: string;
  env?: Record<string, string>;
  /** Default: a new, empty folder in the run folder, which must still be empty when the test ends. */
  cwd?: string;
  /** Default true: resolve once the listening line is out. */
  waitForListening?: boolean;
  /** Default false: killTestServers() leaves a shared server alone; killAllServers() ends it. */
  shared?: boolean;
  /** Preload: emit that signal in the server's own process, or throw, once actOn's line is written. */
  act?: ServerAct;
  /** Default /\[server\] ready/. */
  actOn?: RegExp;
}

export interface LaunchedServer {
  child: ChildProcess;
  /** "http://127.0.0.1:<port>" from the listening line ("" until then). */
  base: string;
  /** Likewise, 0 until then. */
  port: number;
  dataFolder: string;
  /** Stdout and stderr together, in arrival order. */
  output(): string;
  stderr(): string;
  /** The last non-empty stderr line. */
  lastErrorLine(): string;
  /** An output line already written or still to come. */
  waitForLine(re: RegExp, ms?: number): Promise<string>;
  /** GET /api/status, JSON. */
  status(): Promise<any>;
  /** Polls every 50 ms. */
  waitForStatus(pred: (s: any) => boolean, ms?: number): Promise<any>;
  /** The private channel (bundled entry only). */
  send(msg: unknown): void;
  messages(): unknown[];
  /** The next message matching `pred` that no earlier nextMessage returned, already received or still to come. */
  nextMessage(pred: (m: any) => boolean, ms?: number): Promise<any>;
  exit(ms?: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Outright, if still running. */
  kill(): void;
}

const SOURCE_ENTRY = path.join(REPO, "src", "server", "index.ts");
const BUNDLED_ENTRY = path.join(REPO, "src", "server", "bundled.ts");
const PRELOAD_URL = pathToFileURL(path.join(import.meta.dirname, "server-preload.ts")).href;
const GUARD_URL = pathToFileURL(path.join(import.meta.dirname, "server-guard.ts")).href;
const TSX_URL = pathToFileURL(createRequire(path.join(REPO, "package.json")).resolve("tsx")).href;
/** Any line that starts as the listening line does. */
const LISTENING_START = "[server] listening on ";
/** The listening line exactly as the contract gives it. */
const LISTENING = /^\[server\] listening on (http:\/\/127\.0\.0\.1:(\d+)); data folder (.+); sim (link|fake|off); version (\S+)$/;
const TEST_PAGE = "<!doctype html><title>MSFS Career Map test page</title><p>test page</p>";
/** What server-guard.ts writes to stderr for each thing it refuses. */
const GUARD_PREFIX = "[test-guard] ";

/** Variables that would point a launched server elsewhere, or change how its Node runs. */
const STRIPPED_ENV = new Set([
  "CAREER_DB", "PORT", "TRACKER", "TRACKER_FAKE", "SIMCONNECT_HOST", "SIMCONNECT_PORT",
  "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_ENV", "TEST",
  // The preload's and the guard's own switches: only ever set by launchServer.
  "TEST_SERVER_ACT", "TEST_SERVER_ACT_ON", "TEST_SERVER_RUN_DIR", "TEST_SERVER_RESERVED_PORTS",
  // Replaced by folders in the run folder (decoys, below).
  "LOCALAPPDATA", "APPDATA", "USERPROFILE",
]);

/** The worker's environment without STRIPPED_ENV and VITEST*, compared case-insensitively as Windows does. */
function strippedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const name = k.toUpperCase();
    if (v === undefined || STRIPPED_ENV.has(name) || name.startsWith("VITEST")) continue;
    env[k] = v;
  }
  return env;
}

/** "--data=x" → "data", "--fresh-run" → "fresh-run"; anything not starting with "--" → null. */
function argName(arg: string): string | null {
  if (!arg.startsWith("--")) return null;
  const body = arg.slice(2);
  const i = body.indexOf("=");
  return i < 0 ? body : body.slice(0, i);
}

/** The value of "--name=value"; null for a bare "--name". */
function argValue(arg: string): string | null {
  const i = arg.indexOf("=");
  return i < 0 ? null : arg.slice(i + 1);
}

function isOutside(runDir: string, p: string): boolean {
  let parent = path.resolve(runDir);
  let child = path.resolve(p);
  if (process.platform === "win32") {
    parent = parent.toLowerCase();
    child = child.toLowerCase();
  }
  const rel = path.relative(parent, child);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/**
 * The launch guard (APP-RUN-021): throws unless a server started with these arguments (and, for the
 * source form, this environment) stays off the sim, the network, the reserved ports and every
 * folder outside the run folder. Leaving out an argument the bundled form requires is allowed: that
 * server exits 1 before it touches anything. An argument with no value is allowed for the same
 * reason (the server refuses it before it touches anything).
 */
// @spec APP-RUN-021
export function checkTestServerArgs(
  entry: ServerEntry,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  runDir: string,
): void {
  const fail = (reason: string): never => {
    throw new Error(`checkTestServerArgs: ${reason}`);
  };
  const named = (name: string) => args.filter((a) => argName(a) === name);
  const values = (name: string) => named(name).map(argValue).filter((v): v is string => v !== null && v !== "");
  const source = entry === "source";

  if (values("sim").some((v) => v.trim().toLowerCase() === "link")) fail("--sim=link would link to the sim");

  if (values("airport-downloads").some((v) => v.trim().toLowerCase() === "on")) {
    fail("--airport-downloads=on would download the airport lists from the internet");
  }
  if (source && named("airport-downloads").length === 0) {
    fail("the source form downloads the airport lists unless --airport-downloads=off is given");
  }

  if (named("backups-documents").length > 0) fail("--backups-documents would back up into the Documents folder");

  for (const v of values("port")) {
    if (RESERVED_PORTS.includes(Number(v.trim()))) fail(`--port=${v} is a reserved port`);
  }
  if (source && named("port").length === 0) {
    const port = env.PORT;
    if (port === undefined || port === "") fail("without --port or PORT the source form listens on 3080");
    else if (RESERVED_PORTS.includes(Number(port.trim()))) fail(`without --port the source form listens on PORT=${port}, a reserved port`);
  }

  for (const name of ["data", "backups", "offer"]) {
    for (const v of values(name)) {
      if (isOutside(runDir, v)) fail(`--${name}=${v} is outside the run folder ${runDir}`);
    }
  }
  if (source && named("data").length === 0) {
    const careerDb = env.CAREER_DB;
    if (careerDb === undefined || careerDb === "") fail("without --data or CAREER_DB the source form opens the real logbook, data/career.db");
    else if (isOutside(runDir, careerDb)) fail(`without --data the source form opens CAREER_DB=${careerDb}, outside the run folder ${runDir}`);
  }
}

/**
 * Refuses to start an older source entry. Before milestone 1b the entry read CAREER_DB, PORT and
 * TRACKER_FAKE and ignored its arguments, so with the stripped environment it would open the real
 * logbook in data/, listen on 3080 and link to the sim. The 1b entry only hands its arguments to
 * runServer("source", …).
 */
function checkSourceEntry(): void {
  const text = fs.existsSync(SOURCE_ENTRY) ? fs.readFileSync(SOURCE_ENTRY, "utf8") : "";
  if (!/\brunServer\(\s*["']source["']/.test(text)) {
    throw new Error(
      `launchServer: ${SOURCE_ENTRY} does not call runServer("source", …); refusing to start it, since an ` +
        "entry that ignores --data would open the real logbook in data/",
    );
  }
}

/** A program folder in the run folder: page/index.html and page/app.js, no seed lists. */
export function makeProgramFolder(): string {
  const dir = fs.mkdtempSync(path.join(inject("runDir"), "program-"));
  fs.mkdirSync(path.join(dir, "page"));
  fs.writeFileSync(path.join(dir, "page", "index.html"), TEST_PAGE);
  fs.writeFileSync(path.join(dir, "page", "app.js"), 'console.log("test page");');
  return dir;
}

interface Running {
  server: LaunchedServer;
  shared: boolean;
}
const running = new Set<Running>();

/** A launch whose decoys and output are checked once its test (or, when shared, its file) ends. */
interface Launched {
  server: LaunchedServer;
  shared: boolean;
  /** The canary CAREER_DB's folder, never created by a correct server; null when the test gave CAREER_DB. */
  canary: string | null;
  /** The working folder launchServer made, which must stay empty; null when the test gave `cwd`. */
  cwd: string | null;
  /** The decoy profile: USERPROFILE, with AppData\Local and AppData\Roaming empty in it. */
  profile: string;
  /** Why the listening-line check killed it, if it did. */
  killed: string[];
}
const launched = new Set<Launched>();

/** Every file and folder under `dir`, relative to it. */
const treeOf = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir, { recursive: true }).map(String).sort();
  } catch {
    return [];
  }
};
const EMPTY_PROFILE = [path.join("AppData"), path.join("AppData", "Local"), path.join("AppData", "Roaming")].sort();

/** What this launch did that no server may do. */
function wrongDoings(l: Launched): string[] {
  const found = [...l.killed];
  if (l.canary !== null && fs.existsSync(l.canary)) {
    found.push(
      `it created the canary ${l.canary}: it took its database from CAREER_DB or a copy run from source's defaults, ` +
        "not from its inputs, which outside a test is the pilot's logbook in data/",
    );
  }
  const guardLines = l.server.stderr().split(/\r?\n/).filter((line) => line.startsWith(GUARD_PREFIX));
  for (const line of guardLines) found.push(`server-guard.ts ${line.slice(GUARD_PREFIX.length)}`);
  const profile = treeOf(l.profile);
  if (JSON.stringify(profile) !== JSON.stringify(EMPTY_PROFILE)) {
    found.push(`it wrote into USERPROFILE, LOCALAPPDATA or APPDATA (${l.profile}): ${profile.filter((p) => !EMPTY_PROFILE.includes(p)).join(", ")}`);
  }
  if (l.cwd !== null && treeOf(l.cwd).length > 0) found.push(`it wrote into its working folder ${l.cwd}: ${treeOf(l.cwd).join(", ")}`);
  return found;
}

/** Throws when any of these launches did what no server may do; forgets them either way. */
function checkLaunched(which: (l: Launched) => boolean): void {
  const problems: string[] = [];
  for (const l of [...launched]) {
    if (!which(l)) continue;
    launched.delete(l);
    for (const p of wrongDoings(l)) problems.push(`server pid ${l.server.child.pid} (data folder ${l.server.dataFolder}): ${p}`);
  }
  if (problems.length > 0) throw new Error(`launchServer: ${problems.join("\n")}`);
}

/** Ends every server not launched with `shared`, then fails if one did what no server may do. For afterEach. */
export function killTestServers(): void {
  for (const r of running) if (!r.shared) r.server.kill();
  checkLaunched((l) => !l.shared);
}

/** Ends every server still running, then fails if one did what no server may do. For afterAll. */
export function killAllServers(): void {
  for (const r of running) r.server.kill();
  checkLaunched(() => true);
}

let decoyPort: Promise<number> | null = null;
/** A port on 127.0.0.1 that nothing listens on: the decoy SimConnect address. */
function closedPort(): Promise<number> {
  decoyPort ??= new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
  return decoyPort;
}

/** Whether `env` (as a server's environment) sets `name`, compared as Windows does. */
const hasVar = (env: Record<string, string>, name: string) => Object.keys(env).some((k) => k.toUpperCase() === name);

type Closed = { code: number | null; signal: NodeJS.Signals | null };

/**
 * Starts a server entry as a child process with the defaults below, then `args`:
 * - bundled: --data=<dataFolder> --program=<programFolder> --port=0 --backups=<dataFolder>/backups --sim=off --airport-downloads=off
 * - source: --data=<dataFolder> --port=0 --sim=off --airport-downloads=off
 */
export async function launchServer(o: LaunchOptions): Promise<LaunchedServer> {
  const runDir = inject("runDir");
  const dataFolder = o.dataFolder ?? makeDataFolder(runDir).dir;
  const omit = new Set((o.omit ?? []).map((n) => n.replace(/^--/, "").split("=")[0]));
  const defaults: string[] = [];
  const add = (name: string, value: () => string) => {
    if (!omit.has(name)) defaults.push(`--${name}=${value()}`);
  };
  add("data", () => dataFolder);
  if (o.entry === "bundled") add("program", () => o.programFolder ?? makeProgramFolder());
  add("port", () => "0");
  if (o.entry === "bundled") add("backups", () => path.join(dataFolder, "backups"));
  add("sim", () => "off");
  add("airport-downloads", () => "off");
  const args = o.args ?? [];
  const given = new Set(args.map(argName).filter((n): n is string => n !== null));
  const finalArgs = [...defaults.filter((d) => !given.has(argName(d)!)), ...args];

  const env: Record<string, string> = { ...strippedEnv(), ...(o.env ?? {}) };
  if (o.act) {
    env.TEST_SERVER_ACT = o.act;
    env.TEST_SERVER_ACT_ON = (o.actOn ?? /\[server\] ready/).source;
  }

  // Judged on the environment the test asked for, before the decoys below are added.
  checkTestServerArgs(o.entry, finalArgs, env, runDir);
  if (o.entry === "source") checkSourceEntry();

  // Decoys a correct server never reads. A server that takes its database from CAREER_DB or the
  // source defaults opens the canary instead of data/career.db; one that links to the sim when it
  // should not reaches a closed port; one that looks in the user's profile finds an empty one.
  const canary = hasVar(env, "CAREER_DB") ? null : path.join(runDir, `canary-${randomUUID()}`);
  if (canary !== null) env.CAREER_DB = path.join(canary, "career.db");
  if (!hasVar(env, "SIMCONNECT_HOST")) env.SIMCONNECT_HOST = "127.0.0.1";
  if (!hasVar(env, "SIMCONNECT_PORT")) env.SIMCONNECT_PORT = String(await closedPort());
  const profile = fs.mkdtempSync(path.join(runDir, "profile-"));
  fs.mkdirSync(path.join(profile, "AppData", "Local"), { recursive: true });
  fs.mkdirSync(path.join(profile, "AppData", "Roaming"), { recursive: true });
  env.USERPROFILE = profile;
  env.LOCALAPPDATA = path.join(profile, "AppData", "Local");
  env.APPDATA = path.join(profile, "AppData", "Roaming");
  // server-guard.ts: no fetch off the PC or to a reserved port, no database outside the run folder.
  env.TEST_SERVER_RUN_DIR = runDir;
  env.TEST_SERVER_RESERVED_PORTS = RESERVED_PORTS.join(",");

  const execArgv = [
    "--no-warnings=ExperimentalWarning",
    "--import", TSX_URL,
    "--import", GUARD_URL,
    ...(o.act ? ["--import", PRELOAD_URL] : []),
  ];
  const ownCwd = o.cwd === undefined ? fs.mkdtempSync(path.join(runDir, "cwd-")) : null;
  const cwd = o.cwd ?? ownCwd!;
  const child =
    o.entry === "bundled"
      ? fork(BUNDLED_ENTRY, finalArgs, { cwd, env, execArgv, stdio: ["ignore", "pipe", "pipe", "ipc"] })
      : spawn(process.execPath, [...execArgv, SOURCE_ENTRY, ...finalArgs], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

  let out = "";
  let err = "";
  const lines: string[] = [];
  const partial = { stdout: "", stderr: "" };
  const msgs: unknown[] = [];
  /** Indexes of the messages nextMessage has already returned. */
  const taken = new Set<number>();
  let closed: Closed | null = null;
  let exited = false;
  /** Set 1 s after the exit when the streams have not closed by then, so waits end anyway. */
  let closeOverdue = false;
  let disallow: (() => void) | null = null;
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const w of [...waiters]) w();
  };
  const describeEnd = () => (closed ? `code ${closed.code}, signal ${closed.signal}` : `still running, pid ${child.pid}`);
  const ended = () => closed !== null || closeOverdue;
  /** Set once the listening-line check has killed it. */
  let stopped = false;

  const server: LaunchedServer = {
    child,
    base: "",
    port: 0,
    dataFolder,
    output: () => out,
    stderr: () => err,
    lastErrorLine: () => {
      const errLines = err.split(/\r?\n/).filter((l) => l.trim() !== "");
      return errLines.length ? errLines[errLines.length - 1] : "";
    },
    waitForLine: (re, ms = 20_000) => waitFor(`a line matching ${re}`, ms, () => {
      for (const line of lines) {
        re.lastIndex = 0;
        if (re.test(line)) return { value: line };
      }
      return null;
    }),
    status: async () => {
      if (!server.base) throw new Error(`status(): the server has not written its listening line (${describeEnd()})`);
      // Its origin is no longer let through the fetch guard, which would record the request as refused.
      if (exited) throw new Error(`status(): the server has exited (${describeEnd()})`);
      const res = await fetch(`${server.base}/api/status`);
      const text = await res.text();
      if (res.status !== 200) throw new Error(`GET /api/status answered ${res.status}: ${text}`);
      return JSON.parse(text);
    },
    waitForStatus: async (pred, ms = 20_000) => {
      const deadline = Date.now() + ms;
      let last: unknown = "no answer yet";
      for (;;) {
        try {
          const s = await server.status();
          if (pred(s)) return s;
          last = s;
        } catch (e) {
          last = e instanceof Error ? e.message : e;
        }
        if (ended()) throw new Error(`the server exited (${describeEnd()}) before its status matched; last: ${JSON.stringify(last)}\noutput:\n${out}`);
        if (Date.now() >= deadline) throw new Error(`no matching status within ${ms} ms; last: ${JSON.stringify(last)}\noutput:\n${out}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    send: (msg) => {
      if (typeof child.send !== "function") throw new Error("send(): only the bundled entry has the private channel");
      child.send(msg as never);
    },
    messages: () => [...msgs],
    nextMessage: (pred, ms = 10_000) => waitFor("a matching message", ms, () => {
      for (let i = 0; i < msgs.length; i++) {
        if (!taken.has(i) && pred(msgs[i])) {
          taken.add(i);
          return { value: msgs[i] };
        }
      }
      return null;
    }, () => `messages: ${JSON.stringify(msgs)}`),
    exit: (ms = 20_000) => waitFor("the exit", ms, () => (closed ? { value: closed } : null), undefined, false),
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };

  /**
   * Resolves with what `found` finds, now or as output, messages or the close arrive; rejects once
   * the server has ended without it (unless `failOnEnd` is false) or after `ms`.
   */
  function waitFor<T>(what: string, ms: number, found: () => { value: T } | null, extra?: () => string, failOnEnd = true): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(check);
      };
      const check = () => {
        const f = found();
        if (f) {
          done();
          resolve(f.value);
        } else if (failOnEnd && ended()) {
          done();
          reject(new Error(`no ${what}: the server exited (${describeEnd()})${extra ? `; ${extra()}` : ""}\noutput:\n${out}`));
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`no ${what} within ${ms} ms (${describeEnd()})${extra ? `; ${extra()}` : ""}\noutput:\n${out}`));
      }, ms);
      waiters.add(check);
      check();
    });
  }

  const onText = (stream: "stdout" | "stderr", text: string) => {
    out += text;
    if (stream === "stderr") err += text;
    partial[stream] += text;
    const parts = partial[stream].split("\n");
    partial[stream] = parts.pop()!;
    for (const raw of parts) {
      const line = raw.replace(/\r$/, "");
      lines.push(line);
      if (stream !== "stdout" || server.base || stopped || !line.startsWith(LISTENING_START)) continue;
      // A backstop behind checkTestServerArgs, which fails closed: a server whose inputs went wrong
      // says so here, before it touches its data folder or starts tracking.
      const m = LISTENING.exec(line);
      const why =
        m === null
          ? `it wrote a listening line that is not the contract's: ${line}`
          : isOutside(runDir, m[3])
            ? `it named the data folder ${m[3]}, outside the run folder ${runDir}`
            : RESERVED_PORTS.includes(Number(m[2]))
              ? `it listens on ${m[2]}, a reserved port`
              : m[4] === "link"
                ? "it is on the sim link"
                : null;
      if (why !== null || m === null) {
        stopped = true;
        child.kill();
        record.killed.push(`killed at its listening line: ${why}`);
        const note = `\n[launchServer] killed the server at once: ${why}\n`;
        out += note;
        err += note;
        lines.push(note.trim());
        continue;
      }
      server.base = m[1];
      server.port = Number(m[2]);
      if (!exited) disallow = allowOrigin(server.base);
    }
    notify();
  };
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (t: string) => onText("stdout", t));
  child.stderr!.on("data", (t: string) => onText("stderr", t));
  child.on("message", (m) => {
    msgs.push(m);
    notify();
  });
  const entry: Running = { server, shared: o.shared ?? false };
  const record: Launched = { server, shared: o.shared ?? false, canary, cwd: ownCwd, profile, killed: [] };
  launched.add(record);
  running.add(entry);
  const onExit = () => {
    exited = true;
    disallow?.();
    disallow = null;
    setTimeout(() => {
      if (!closed) {
        closeOverdue = true;
        notify();
      }
    }, 1000).unref();
  };
  child.on("exit", onExit);
  child.on("error", (e) => {
    out += `\n[launchServer] ${e.message}\n`;
    err += `\n[launchServer] ${e.message}\n`;
    if (child.exitCode === null && child.signalCode === null && child.pid === undefined) {
      // It never started: nothing more will come.
      onExit();
      closed = { code: null, signal: null };
      running.delete(entry);
      notify();
    }
  });
  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    for (const stream of ["stdout", "stderr"] as const) {
      if (partial[stream] !== "") {
        lines.push(partial[stream].replace(/\r$/, ""));
        partial[stream] = "";
      }
    }
    if (!exited) onExit();
    closed = { code, signal };
    running.delete(entry);
    notify();
  });

  if (o.waitForListening ?? true) {
    try {
      await waitFor("listening line", 20_000, () => (server.port ? { value: true } : null));
    } catch (e) {
      server.kill();
      throw e;
    }
  }
  return server;
}

function openDb(dataFolder: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dataFolder, "career.db"));
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}

/** tracker_state row 1 as stored, or null when there is no career.db or no row. Opens the file read-write. */
export function checkpointRowAt(dataFolder: string): { json: Record<string, any>; updated_at: string } | null {
  if (!fs.existsSync(path.join(dataFolder, "career.db"))) return null;
  const db = openDb(dataFolder);
  try {
    let row: { json: string; updated_at: string } | undefined;
    try {
      row = db.prepare("SELECT json, updated_at FROM tracker_state WHERE id = 1").get() as typeof row;
    } catch (e) {
      if (/no such table/i.test(String(e))) return null;
      throw e;
    }
    return row ? { json: JSON.parse(row.json), updated_at: row.updated_at } : null;
  } finally {
    db.close();
  }
}

/** tracker_state row 1's json, parsed, or null when there is no career.db or no row. */
export function checkpointAt(dataFolder: string): Record<string, any> | null {
  return checkpointRowAt(dataFolder)?.json ?? null;
}

/** Writes tracker_state row 1, creating the folder, career.db and the table (db.ts's own statement) if needed. */
export function writeCheckpointAt(dataFolder: string, value: object): void {
  fs.mkdirSync(dataFolder, { recursive: true });
  const db = openDb(dataFolder);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS tracker_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    db.prepare(
      "INSERT INTO tracker_state (id, json, updated_at) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
    ).run(JSON.stringify(value), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** The data folder's career.db.lock, parsed, or null when it is missing or not a {pid, port} object. */
export function lockAt(dataFolder: string): { pid: number; port: number } | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dataFolder, "career.db.lock"), "utf8"));
    return v && typeof v.pid === "number" && typeof v.port === "number" ? { pid: v.pid, port: v.port } : null;
  } catch {
    return null;
  }
}

/** The pid of a `node -e ""` that has exited. */
export function deadPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["-e", ""], { stdio: "ignore", env: strippedEnv(), windowsHide: true });
    c.on("error", reject);
    c.on("exit", () => resolve(c.pid!));
  });
}

function listenLocal(onConnection: (s: net.Socket) => void): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
      s.on("error", () => {});
      onConnection(s);
    });
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      resolve({
        port,
        close: () => {
          for (const s of sockets) s.destroy();
          srv.close();
        },
      });
    });
  });
}

/** A port on 127.0.0.1 that accepts connections and never answers. */
export function silentPort(): Promise<{ port: number; close(): void }> {
  return listenLocal(() => {});
}

/** A port held on 127.0.0.1 by a plain listening socket. */
export function heldPort(): Promise<{ port: number; close(): void }> {
  return listenLocal((s) => s.destroy());
}

/**
 * A port on 127.0.0.1 that answers every request after `delayMs` with the status of another app, so
 * a lock naming a running process there is judged stale once the answer comes: it holds a server's
 * start for that long. `delayMs` stays inside the server's 2 s timeout, after which a holder that
 * accepted the connection counts as live.
 */
export function slowStalePort(delayMs = 1500): Promise<{ port: number; close(): void }> {
  return new Promise((resolve, reject) => {
    const timers = new Set<NodeJS.Timeout>();
    const srv = http.createServer((_req, res) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!res.destroyed) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, app: "some-other-app" }));
      }, delayMs);
      timers.add(timer);
    });
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      resolve({
        port,
        close: () => {
          for (const t of timers) clearTimeout(t);
          srv.closeAllConnections();
          srv.close();
        },
      });
    });
  });
}

const CONTENDER = path.join(import.meta.dirname, "lock-contender.ts");

/**
 * Two processes (lock-contender.ts) taking over the lock of each folder at the same wall-clock
 * moments: once both are ready, folder i at `firstAt + i * spacingMs`, `firstAt` a little after both
 * said so. Each answers `/api/status` as a live server on the folder it takes. Resolves with each
 * contender's results, one per folder, once both have exited. They run with server-guard.ts loaded
 * and an environment stripped as a server's is.
 */
export async function lockContenders(folders: string[], o: { spacingMs: number }): Promise<ContenderResult[][]> {
  const runDir = inject("runDir");
  const env = { ...strippedEnv(), TEST_SERVER_RUN_DIR: runDir, TEST_SERVER_RESERVED_PORTS: RESERVED_PORTS.join(",") };
  const arg = JSON.stringify({ folders, spacingMs: o.spacingMs });
  const start = () => {
    const child = spawn(
      process.execPath,
      ["--no-warnings=ExperimentalWarning", "--import", TSX_URL, "--import", GUARD_URL, CONTENDER, arg],
      { cwd: fs.mkdtempSync(path.join(runDir, "contender-")), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let out = "";
    let err = "";
    let onReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => (onReady = resolve));
    child.stdout!.on("data", (d) => {
      out += d;
      if (/^ready\r?$/m.test(out)) onReady();
    });
    child.stderr!.on("data", (d) => (err += d));
    const results = new Promise<ContenderResult[]>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        const last = out.trim().split(/\r?\n/).at(-1) ?? "";
        if (code !== 0 || !last.startsWith("[")) reject(new Error(`a lock contender exited ${code}: ${out}${err}`));
        else resolve(JSON.parse(last) as ContenderResult[]);
      });
    });
    return { child, ready: Promise.race([ready, results.then(() => {})]), results };
  };
  const both = [start(), start()];
  await Promise.all(both.map((c) => c.ready));
  const firstAt = Date.now() + 300;
  for (const c of both) c.child.stdin!.end(`${firstAt}\n`);
  return Promise.all(both.map((c) => c.results));
}

let excluded: number | null | undefined;

/** The first port of `netsh interface ipv4 show excludedportrange protocol=tcp`, else null. */
export function excludedPort(): number | null {
  if (excluded !== undefined) return excluded;
  excluded = null;
  if (process.platform !== "win32") return excluded;
  const r = spawnSync("netsh", ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return excluded;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*\*?\s*$/.exec(line);
    if (m) {
      excluded = Number(m[1]);
      break;
    }
  }
  return excluded;
}
