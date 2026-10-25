import path from "node:path";
import { LineSplitter } from "./logs.ts";
import type { Cancel, Clock, HttpAnswer, LocalHttp, ServerChild, ServerLauncher, WindowsFacts } from "./ports.ts";
import { SERVICE_NAME } from "./server-inputs.ts";
import { TIMING } from "./timing.ts";
import { APP_NAME } from "./version.ts";

/**
 * The server's utility process, from its start to its end: the readiness wait and the start-up
 * work, the checks for a server that stops answering, failures and restarts, a held or refused port,
 * and shutting it down when the app quits. Every wait runs on the injected monotonic clock.
 */

export type StartupStep = "opening" | "backing-up" | "upgrading" | "bringing-in";

export type ServerState =
  | { kind: "not-started" }
  /** A process started, its start-up work not done; step from a ready server's status. */
  | { kind: "starting"; step: StartupStep | null }
  /** Start-up work done. */
  | { kind: "running" }
  /** Waiting out a restart delay or a leftover's 20 s; no process. */
  | { kind: "restarting" }
  /** Also while quitting: entering the quitting state leaves it as it is. */
  | { kind: "given-up"; reason: string }
  /** Quitting, not given up, and no process left. */
  | { kind: "stopped" };

export interface SupervisorOptions {
  port: number;
  script: string;
  /** The data folder. */
  cwd: string;
  /** serverEnv(process.env). */
  env: Record<string, string>;
  args(freshRun: boolean): string[];
  /** Compared with a holder's dataFolder. */
  dataFolder: string;
  /** process.execPath: the program a leftover must run to be ended. */
  programPath: string;
  /** Looked up at each start, written to desktop.log when it resolves. */
  folders(): Promise<{ data: string; backups: string }>;
  /** desktop.log. */
  log(line: string): void;
  /** server.log; stderr lines already "[stderr] "-prefixed. */
  serverLog(line: string): void;
}

export interface SupervisorPorts {
  clock: Clock;
  launcher: ServerLauncher;
  http: LocalHttp;
  facts: Pick<WindowsFacts, "programOf" | "endProcess" | "excludedPortRanges">;
}

const STEPS: readonly string[] = ["opening", "backing-up", "upgrading", "bringing-in"] satisfies StartupStep[];
const EXIT_RESTART = 12;
const EXIT_PORT_HELD = 10;
const EXIT_PORT_REFUSED = 11;
const DID_NOT_START = "The server did not start within 60 s";
const STOPPED_RESPONDING = "The server stopped responding";
const LEFTOVER_REASON =
  "An earlier MSFS Career Map server is still running: quit MSFS Career Map, end any MSFS Career Map still listed in Task Manager, and start it again";

/**
 * Timers and outside answers that end together: `clear()` cancels every timer and drops every
 * answer still outstanding, so nothing waited for here acts after it.
 */
class Waits {
  private cancels = new Set<Cancel>();
  private gen = 0;

  constructor(private readonly clock: Clock) {}

  after(ms: number, fn: () => void): Cancel {
    const cancel = this.clock.after(ms, () => {
      this.cancels.delete(cancel);
      fn();
    });
    this.cancels.add(cancel);
    return () => {
      if (this.cancels.delete(cancel)) cancel();
    };
  }

  /** `p`'s answer, or null when `ms` pass first; its timer cancelled as soon as it settles. */
  race<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
    const raced = new Promise<T | null>((resolve) => {
      const stop = this.after(ms, () => resolve(null));
      p.then(
        (v) => {
          stop();
          resolve(v);
        },
        () => {
          stop();
          resolve(null);
        },
      );
    });
    return this.settle(raced, null);
  }

  /** `p`'s value (`fallback` when it rejects), never settling once cleared meanwhile. */
  settle<T>(p: Promise<T>, fallback: T): Promise<T> {
    const gen = this.gen;
    return new Promise<T>((resolve) => {
      p.then(
        (v) => gen === this.gen && resolve(v),
        () => gen === this.gen && resolve(fallback),
      );
    });
  }

  clear(): void {
    this.gen++;
    for (const cancel of this.cancels) cancel();
    this.cancels.clear();
  }
}

/** One server process and everything that waits on it. */
class Attempt {
  pid: number | null = null;
  exited = false;
  ready = false;
  done = false;
  asking = false;
  misses = 0;
  /** Posted before the spawn, sent at it. */
  held: object[] = [];
  /** The last stderr line that can be a give-up reason. */
  lastError: string | null = null;
  readyBound: Cancel = () => {};
  tick: Cancel = () => {};
  readonly waits: Waits;
  readonly stdout: LineSplitter;
  readonly stderr: LineSplitter;

  constructor(
    readonly child: ServerChild,
    readonly startedAt: number,
    clock: Clock,
    serverLog: (line: string) => void,
  ) {
    this.waits = new Waits(clock);
    this.stdout = new LineSplitter(serverLog);
    this.stderr = new LineSplitter((line) => {
      serverLog(`[stderr] ${line}`);
      if (isErrorLine(line)) this.lastError = line;
    });
  }
}

/** Not blank, not indented, and none of Node's framing lines (a lone bracket, the `Node.js v…` trailer). */
function isErrorLine(line: string): boolean {
  if (line.trim() === "" || /^\s/.test(line)) return false;
  const trimmed = line.trim();
  return !["{", "}", "[", "]", "(", ")"].includes(trimmed) && !/^Node\.js v\d/.test(line);
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Equal as Windows paths: resolved, ignoring case. */
function samePath(a: string, b: string): boolean {
  return path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();
}

/**
 * Calls every listener; one that throws cannot cut a state change short. Its error is thrown again
 * on its own, for the process's handler to log.
 */
function notify<T>(fns: readonly ((e: T) => void)[], e: T): void {
  for (const fn of fns) {
    try {
      fn(e);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
}

export class Supervisor {
  private current: ServerState = { kind: "not-started" };
  private attempt: Attempt | null = null;
  /** The latest process, for its last error line. */
  private lastAttempt: Attempt | null = null;
  private quitting = false;
  private failures = 0;
  /** The shell's own reason for the last failure. */
  private ownReason: string | null = null;
  /** A server of this Supervisor has done its start-up work. */
  private everDone = false;
  /** The next done follows an exit 12. */
  private requestedDone = false;
  /** Restart delays, the held-port questions and the leftover wait. */
  private readonly flow: Waits;
  private shutdown: Promise<void> | null = null;
  private shutdownEnded: (() => void) | null = null;
  private shutdownKill: Cancel | null = null;
  private readonly stateFns: ((s: ServerState) => void)[] = [];
  private readonly doneFns: ((e: { requested: boolean }) => void)[] = [];
  private readonly exitFns: ((e: { code: number; requested: boolean }) => void)[] = [];
  private readonly messageFns: ((msg: unknown) => void)[] = [];

  constructor(
    private readonly o: SupervisorOptions,
    private readonly ports: SupervisorPorts,
  ) {
    this.flow = new Waits(ports.clock);
  }

  /** The run's first start; ignored unless not started. */
  start(): void {
    if (this.current.kind !== "not-started" || this.quitting) return;
    this.launch();
  }

  /** Only while given up: a fresh count. */
  // @spec DESK-SHELL-SRV-036
  tryAgain(): void {
    if (this.current.kind !== "given-up" || this.quitting) return;
    this.failures = 0;
    this.ownReason = null;
    this.launch();
  }

  state(): ServerState {
    return this.current;
  }

  onState(fn: (s: ServerState) => void): void {
    this.stateFns.push(fn);
  }

  /** requested: the first done after an exit 12. */
  onStartupDone(fn: (e: { requested: boolean }) => void): void {
    this.doneFns.push(fn);
  }

  /** Every exit; requested: code 12 while not quitting. */
  onExit(fn: (e: { code: number; requested: boolean }) => void): void {
    this.exitFns.push(fn);
  }

  /** The private channel. */
  onMessage(fn: (msg: unknown) => void): void {
    this.messageFns.push(fn);
  }

  /** A server process exists (spawned or spawning). */
  hasProcess(): boolean {
    return this.attempt !== null && !this.attempt.exited;
  }

  /** Sends on the private channel; false when no process exists; before its spawn, held and sent at it. */
  post(msg: object): boolean {
    const a = this.attempt;
    if (!a || a.exited) return false;
    if (a.pid === null) a.held.push(msg);
    else a.child.post(msg);
    return true;
  }

  /** Something arrived on the event stream. */
  activity(): void {
    if (this.attempt) this.attempt.misses = 0;
  }

  /** The PC resumed: the misses and, while not yet ready, the readiness bound start again. */
  // @spec DESK-SHELL-SRV-039
  resume(): void {
    const a = this.attempt;
    if (!a || this.quitting) return;
    a.misses = 0;
    if (!a.ready) this.armReadyBound(a);
  }

  /** No start from now on; a scheduled restart cancelled; checks stopped; an exit leaves it ended. */
  // @spec DESK-SHELL-SRV-019
  enterQuitting(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.flow.clear();
    this.attempt?.waits.clear();
    const kind = this.current.kind;
    if (kind === "not-started" || kind === "restarting") this.setState({ kind: "stopped" });
  }

  /** Enters the quitting state and sends Shut down to any process, ending it at 10 s. Every call returns the same promise. */
  // @spec DESK-SHELL-SRV-019, DESK-SHELL-SRV-020, DESK-SHELL-SRV-045
  shutDown(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.enterQuitting();
    const a = this.attempt;
    if (!a || a.exited) {
      this.shutdown = Promise.resolve();
      return this.shutdown;
    }
    this.shutdown = new Promise<void>((resolve) => {
      this.shutdownEnded = resolve;
    });
    this.post({ type: "shutdown" });
    this.shutdownKill = this.ports.clock.after(TIMING.shutdownWaitMs, () => {
      this.shutdownKill = null;
      a.child.kill();
      this.shutdownEnded?.();
    });
    return this.shutdown;
  }

  // ---------------------------------------------------------------------------------------------
  // Starting and the readiness wait

  /** Starts a server process at once; the folders are written when they resolve, never waited for. */
  // @spec DESK-SHELL-SRV-001, DESK-SHELL-SRV-009, DESK-SHELL-SRV-011, DESK-SHELL-SRV-044, DESK-SHELL-LOG-002
  private launch(): void {
    this.flow.clear();
    const { clock, launcher } = this.ports;
    const child = launcher.start({
      script: this.o.script,
      args: this.o.args(!this.everDone),
      env: this.o.env,
      cwd: this.o.cwd,
      serviceName: SERVICE_NAME,
    });
    const a = new Attempt(child, clock.now(), clock, (line) => this.o.serverLog(line));
    this.attempt = a;
    this.lastAttempt = a;
    this.setState({ kind: "starting", step: null });

    child.onSpawn((pid) => this.spawned(a, pid));
    child.onStdout((text) => a.stdout.push(text));
    child.onStderr((text) => a.stderr.push(text));
    child.onMessage((msg) => notify(this.messageFns, msg));
    child.onExit((code) => this.exited(a, code));
    this.armReadyBound(a);

    try {
      this.o.folders().then(
        (f) => this.o.log(`[server] starting: data folder ${f.data}; backups folder ${f.backups}`),
        () => {},
      );
    } catch {
      // A look-up that throws writes nothing; the start goes on.
    }
  }

  /** Not ready 60 s after the start (or a resume): ended and counted, with no reason of its own. */
  // @spec DESK-SHELL-SRV-022, DESK-SHELL-SRV-037
  private armReadyBound(a: Attempt): void {
    a.readyBound();
    a.readyBound = a.waits.after(TIMING.readyWithinMs, () => {
      this.endOwn(a);
      this.failedAtStart(null);
    });
  }

  private spawned(a: Attempt, pid: number): void {
    a.pid = pid;
    for (const msg of a.held.splice(0)) a.child.post(msg);
    if (this.attempt !== a || this.quitting) return;
    const tick = () => {
      if (a.done) return;
      a.tick = a.waits.after(TIMING.readinessAskEveryMs, tick);
      void this.askReady(a);
    };
    tick();
  }

  /** One readiness ask, unless the last is still outstanding. */
  // @spec DESK-SHELL-SRV-012, DESK-SHELL-SRV-013, DESK-SHELL-SRV-014, DESK-SHELL-SRV-015, DESK-SHELL-SRV-025
  private async askReady(a: Attempt): Promise<void> {
    if (a.asking) return;
    a.asking = true;
    const answer = await a.waits.race(this.status(TIMING.readinessAskTimeoutMs), TIMING.readinessAskTimeoutMs);
    a.asking = false;
    if (this.attempt !== a || a.done || !answer) return;
    const json = parseJson(answer.body);
    const ours = answer.status === 200 && json !== null && json.app === APP_NAME && json.pid === a.pid;
    if (!ours) {
      // Before readiness, any other answer is a held port; after it, only the 30 s checks judge.
      if (!a.ready) {
        this.endOwn(a);
        void this.heldPort();
      }
      return;
    }
    if (!a.ready) {
      a.ready = true;
      a.readyBound();
      this.o.log(`[server] ready (pid ${a.pid})`);
      this.armHealth(a);
    }
    const startup = json?.startup;
    if (startup === "done") this.startupDone(a);
    else if (typeof startup === "string" && STEPS.includes(startup)) this.setState({ kind: "starting", step: startup as StartupStep });
  }

  private startupDone(a: Attempt): void {
    a.done = true;
    a.tick();
    this.everDone = true;
    const requested = this.requestedDone;
    this.requestedDone = false;
    this.setState({ kind: "running" });
    this.o.log("[server] start-up done");
    notify(this.doneFns, { requested });
  }

  // ---------------------------------------------------------------------------------------------
  // A server that stops answering

  // @spec DESK-SHELL-SRV-026, DESK-SHELL-SRV-027
  private armHealth(a: Attempt): void {
    a.waits.after(TIMING.healthEveryMs, () => {
      this.armHealth(a);
      void this.checkHealth(a);
    });
  }

  private async checkHealth(a: Attempt): Promise<void> {
    const answer = await a.waits.race(this.status(TIMING.healthTimeoutMs), TIMING.healthTimeoutMs);
    if (this.attempt !== a) return;
    if (answer) {
      a.misses = 0;
      return;
    }
    if (++a.misses < TIMING.healthMissesToFail) return;
    this.o.log("[server] stopped responding");
    const atStart = this.atStart(a);
    this.endOwn(a);
    if (atStart) this.failedAtStart(STOPPED_RESPONDING);
    else this.stoppedAfterStart();
  }

  // ---------------------------------------------------------------------------------------------
  // Exits, failures and restarts

  /** The process ended: its output let out first, then counted by the restart rules. */
  // @spec DESK-SHELL-SRV-021, DESK-SHELL-SRV-022, DESK-SHELL-SRV-024, DESK-SHELL-SRV-034, DESK-SHELL-SRV-043, DESK-SHELL-AWAY-005, DESK-SHELL-LOG-005
  private exited(a: Attempt, code: number): void {
    if (a.exited) return;
    a.exited = true;
    a.stdout.end();
    a.stderr.end();
    a.waits.clear();
    const current = this.attempt === a;
    if (current) this.attempt = null;
    this.o.log(`[server] exited with code ${code}`);
    const requested = code === EXIT_RESTART && !this.quitting;
    notify(this.exitFns, { code, requested });

    if (this.quitting) {
      if (!current) return;
      if (this.current.kind !== "given-up") this.setState({ kind: "stopped" });
      this.shutdownKill?.();
      this.shutdownKill = null;
      if (this.shutdownEnded) {
        this.o.log("[server] shut down");
        this.shutdownEnded();
      }
      return;
    }
    // A process this Supervisor ended itself was counted when it did.
    if (!current) return;

    if (code === EXIT_RESTART) {
      this.failures = 0;
      this.ownReason = null;
      this.requestedDone = true;
      this.o.log("[server] restart requested (exit code 12); starting again now");
      this.launch();
    } else if (code === EXIT_PORT_HELD) {
      void this.heldPort();
    } else if (code === EXIT_PORT_REFUSED) {
      void this.portRefused();
    } else if (this.atStart(a)) {
      this.failedAtStart(null);
    } else {
      this.stoppedAfterStart();
    }
  }

  /** Before its start-up work is done, or within 60 s of its start. */
  private atStart(a: Attempt): boolean {
    return !a.done || this.ports.clock.now() - a.startedAt < TIMING.failureAtStartWithinMs;
  }

  /** Ends the Supervisor's own process; its exit is then ignored, this being counted by the caller. */
  private endOwn(a: Attempt): void {
    a.waits.clear();
    if (this.attempt === a) this.attempt = null;
    a.child.kill();
  }

  // @spec DESK-SHELL-SRV-023, DESK-SHELL-SRV-035
  private failedAtStart(reason: string | null): void {
    this.failures++;
    this.ownReason = reason;
    if (this.failures >= TIMING.failuresToGiveUp) {
      this.giveUp(this.ownReason ?? this.lastAttempt?.lastError ?? DID_NOT_START);
      return;
    }
    const delay = TIMING.restartDelaysMs[this.failures - 1];
    this.setState({ kind: "restarting" });
    this.o.log(`[server] failure at start ${this.failures} of ${TIMING.failuresToGiveUp}; starting again in ${delay / 1000} s`);
    this.flow.after(delay, () => this.launch());
  }

  private stoppedAfterStart(): void {
    this.failures = 0;
    this.ownReason = null;
    this.setState({ kind: "restarting" });
    this.o.log("[server] stopped after its start; starting again in 1 s");
    this.flow.after(TIMING.restartAfterRunMs, () => this.launch());
  }

  private giveUp(reason: string): void {
    this.flow.clear();
    this.setState({ kind: "given-up", reason });
    this.o.log(`[server] gave up: ${reason}`);
  }

  // ---------------------------------------------------------------------------------------------
  // A held or refused port

  /** Asks the port who holds it; never another port. */
  // @spec DESK-SHELL-SRV-007, DESK-SHELL-SRV-028, DESK-SHELL-SRV-031, DESK-SHELL-SRV-032, DESK-SHELL-SRV-033
  private async heldPort(): Promise<void> {
    const port = this.o.port;
    const anotherProgram = `Port ${port} is in use by another program`;
    this.flow.clear();
    this.setState({ kind: "restarting" });
    const answer = await this.flow.race(this.status(TIMING.heldPortAskTimeoutMs), TIMING.heldPortAskTimeoutMs);
    if (!answer) {
      this.o.log(`[server] port ${port} held, nothing answering`);
      this.failedAtStart(anotherProgram);
      return;
    }
    const json = parseJson(answer.body);
    if (answer.status !== 200 || json === null || json.app !== APP_NAME) {
      this.o.log(`[server] port ${port} held by another program`);
      this.giveUp(anotherProgram);
      return;
    }
    if (typeof json.dataFolder === "string" && samePath(json.dataFolder, this.o.dataFolder)) {
      this.leftover(typeof json.pid === "number" ? json.pid : null);
      return;
    }
    this.o.log(`[server] port ${port} held by MSFS Career Map on another data folder`);
    this.giveUp(`Port ${port} is in use by MSFS Career Map in another Windows account, a test copy or a copy run from source`);
  }

  /**
   * An earlier server of this data folder: waited for up to 20 s, asked every second, and ended only
   * when it runs the shell's own program; a failure at start either way, unless it runs another.
   */
  // @spec DESK-SHELL-SRV-029, DESK-SHELL-SRV-030
  private leftover(pid: number | null): void {
    this.o.log(`[server] port ${this.o.port} held by an earlier server of this data folder (pid ${pid})`);
    let over = false;
    let poll: Cancel = () => {};
    const ask = () => {
      poll = this.flow.after(TIMING.leftoverPollMs, async () => {
        const answer = await this.flow.race(this.status(TIMING.leftoverPollMs), TIMING.leftoverPollMs);
        if (over) return;
        if (answer) return ask();
        over = true;
        stopWaiting();
        this.failedAtStart(LEFTOVER_REASON);
      });
    };
    const stopWaiting = this.flow.after(TIMING.leftoverWaitMs, () => {
      over = true;
      poll();
      void this.endLeftover(pid);
    });
    ask();
  }

  private async endLeftover(pid: number | null): Promise<void> {
    const { facts } = this.ports;
    const program = pid === null ? null : await this.flow.settle(facts.programOf(pid), null);
    if (program !== null && !samePath(program, this.o.programPath)) {
      this.giveUp(`Port ${this.o.port} is in use by another program`);
      return;
    }
    if (program !== null && pid !== null) {
      facts.endProcess(pid);
      this.o.log(`[server] ended the earlier server ${pid}`);
    }
    this.failedAtStart(LEFTOVER_REASON);
  }

  /** Exit code 11: given up at once, Windows' excluded port ranges written after. */
  private async portRefused(): Promise<void> {
    this.giveUp(`Windows reserves port ${this.o.port} (an excluded port range); restarting Windows may free it`);
    const ranges = await this.flow.settle(this.ports.facts.excludedPortRanges(), "");
    this.o.log("[server] Windows' excluded port ranges:");
    this.o.log(ranges);
  }

  // ---------------------------------------------------------------------------------------------

  /** GET /api/status on the server's port; null for no answer, never rejecting. */
  private status(timeoutMs: number): Promise<HttpAnswer | null> {
    try {
      return this.ports.http.get(this.o.port, "/api/status", timeoutMs);
    } catch {
      return Promise.resolve(null);
    }
  }

  private setState(s: ServerState): void {
    if (JSON.stringify(s) === JSON.stringify(this.current)) return;
    this.current = s;
    notify(this.stateFns, s);
  }
}
