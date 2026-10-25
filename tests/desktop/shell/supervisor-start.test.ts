/**
 * The supervisor's starts (src/desktop/supervisor.ts; m2 contract §8.1–8.3, §8.8): the server run in
 * a utility process with its script, the data folder as working folder, its service name, the
 * environment and the start-up arguments (DESK-SHELL-SRV-001, SRV-011); the folders written to
 * `desktop.log` as they resolve at each start (SRV-009); `/api/status` asked every 250 ms from the
 * spawn (SRV-013), ready only on an answer naming this app and its own process (SRV-012), any other
 * answer meanwhile a held port (SRV-014), done only on `startup: "done"` (SRV-015); the fresh-run
 * argument until a server has done its start-up work (SRV-044); the server's output split into
 * lines for `server.log` (LOG-002, LOG-005); and the Supervisor's `desktop.log` lines (LOG-003).
 */
import { describe, expect, it } from "vitest";
import type { HttpAnswer } from "../../../src/desktop/ports.ts";
import { Supervisor, type SupervisorOptions } from "../../../src/desktop/supervisor.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts, FakeHttp, FakeLauncher, never, statusAnswer, type HttpCall } from "../support/fakes.ts";

// ---------------------------------------------------------------------------------------------
// A Supervisor on fakes (local to this file; contract §18 gives the fakes, not this rig).

/** A stand-in port nothing listens on. */
const PORT = 3555;
const DATA = "C:\\test\\data";
const BACKUPS = "C:\\test\\Backups";
const SCRIPT = "C:\\Program Files\\MSFS Career Map\\resources\\server.mjs";
const PROGRAM = "C:\\Program Files\\MSFS Career Map\\MSFS Career Map.exe";
const ENV = { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\pilot" };
const ARGS = [`--data=${DATA}`, "--program=C:\\prog", `--port=${PORT}`, `--backups=${BACKUPS}`, "--sim=fake", "--airport-downloads=off"];

type Answer = HttpAnswer | null | Promise<HttpAnswer | null>;

function rig(o: Partial<SupervisorOptions> = {}) {
  const clock = new FakeClock();
  const launcher = new FakeLauncher();
  const http = new FakeHttp();
  const facts = new FakeFacts();
  const r = {
    clock,
    launcher,
    http,
    facts,
    log: [] as string[],
    serverLog: [] as string[],
    /** Both logs in the order written, each line prefixed `desktop: ` or `server: `. */
    all: [] as string[],
    fresh: [] as boolean[],
    dones: [] as { requested: boolean }[],
    exits: [] as { code: number; requested: boolean }[],
    /** What `/api/status` on PORT answers now; nothing by default. */
    answer: ((_call: HttpCall): Answer => null) as (call: HttpCall) => Answer,
    sup: undefined as unknown as Supervisor,
  };
  http.on(PORT, "/api/status", (call) => r.answer(call));
  const options: SupervisorOptions = {
    port: PORT,
    script: SCRIPT,
    cwd: DATA,
    env: { ...ENV },
    args: (freshRun) => {
      r.fresh.push(freshRun);
      return freshRun ? [...ARGS, "--fresh-run"] : [...ARGS];
    },
    dataFolder: DATA,
    programPath: PROGRAM,
    folders: () => Promise.resolve({ data: DATA, backups: BACKUPS }),
    log: (line) => {
      r.log.push(line);
      r.all.push(`desktop: ${line}`);
    },
    serverLog: (line) => {
      r.serverLog.push(line);
      r.all.push(`server: ${line}`);
    },
    ...o,
  };
  r.sup = new Supervisor(options, { clock, launcher, http, facts });
  r.sup.onStartupDone((e) => r.dones.push(e));
  r.sup.onExit((e) => r.exits.push(e));
  return r;
}
type Rig = ReturnType<typeof rig>;

/** The Supervisor's own latest server answering, its start-up work at `startup` (null: no `startup` field at all). */
function own(r: Rig, startup: string | null = "done", extra: Record<string, unknown> = {}) {
  return (): HttpAnswer =>
    statusAnswer({ pid: r.launcher.last().pid as number, startup: startup ?? undefined, dataFolder: DATA, ...extra });
}

/** Spawns the latest child and lets its first ask settle. */
async function spawnLast(r: Rig) {
  const child = r.launcher.last();
  child.spawn();
  await flush();
  return child;
}

/** Started, spawned and done at once. */
async function startRunning(r: Rig) {
  r.answer = own(r);
  r.sup.start();
  const child = await spawnLast(r);
  expect(r.sup.state()).toEqual({ kind: "running" });
  return child;
}

const asks = (r: Rig) => r.http.calls.filter((c) => c.timeoutMs === 1000);
const heldAsks = (r: Rig) => r.http.calls.filter((c) => c.timeoutMs === 2000);

// ---------------------------------------------------------------------------------------------

describe("starting the server", () => {
  // @spec DESK-SHELL-SRV-001, DESK-SHELL-SRV-011
  it("starts the process with the script, the data folder as working folder, its service name, the environment and the arguments", () => {
    const r = rig();
    expect(r.sup.state()).toEqual({ kind: "not-started" });
    expect(r.sup.hasProcess()).toBe(false);
    expect(r.launcher.starts).toHaveLength(0);

    r.sup.start();
    expect(r.launcher.starts).toHaveLength(1);
    expect(r.launcher.last().options).toEqual({
      script: SCRIPT,
      args: [...ARGS, "--fresh-run"],
      env: ENV,
      cwd: DATA,
      serviceName: "MSFS Career Map server",
    });
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });
    // Spawning counts as a process (what Back up needs).
    expect(r.sup.hasProcess()).toBe(true);
  });

  // @spec DESK-SHELL-SRV-001
  it("acts on start() only once, while not started", async () => {
    const r = rig();
    r.sup.start();
    r.sup.start();
    expect(r.launcher.starts).toHaveLength(1);
    await spawnLast(r);
    r.sup.start();
    await flush();
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-009, DESK-SHELL-LOG-003
  it("writes the data and backups folders to desktop.log as they resolve at each start", async () => {
    let backups = "C:\\Users\\pilot\\Documents\\MSFS Career Map\\Backups";
    let looks = 0;
    const r = rig({
      folders: () => {
        looks++;
        return Promise.resolve({ data: DATA, backups });
      },
    });
    r.sup.start();
    await flush();
    expect(looks).toBe(1);
    expect(r.log).toContain(`[server] starting: data folder ${DATA}; backups folder C:\\Users\\pilot\\Documents\\MSFS Career Map\\Backups`);

    // Documents moved meanwhile: the next start looks it up again.
    backups = "D:\\OneDrive\\Documents\\MSFS Career Map\\Backups";
    const child = await spawnLast(r);
    child.exit(1);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);
    await flush();
    expect(looks).toBe(2);
    expect(r.log).toContain(`[server] starting: data folder ${DATA}; backups folder D:\\OneDrive\\Documents\\MSFS Career Map\\Backups`);
    expect(r.log.filter((l) => l.startsWith("[server] starting: "))).toHaveLength(2);
  });
});

describe("the readiness asks", () => {
  // @spec DESK-SHELL-SRV-013
  it("asks /api/status every 250 ms from the spawn, a tick at the spawn itself, allowing 1 s for each", async () => {
    const r = rig();
    r.sup.start();
    await r.clock.advance(1000);
    expect(asks(r)).toHaveLength(0); // nothing before the spawn

    await spawnLast(r);
    expect(r.http.calls).toEqual([{ port: PORT, path: "/api/status", timeoutMs: 1000 }]);
    await r.clock.advance(249);
    expect(asks(r)).toHaveLength(1);
    await r.clock.advance(1);
    expect(asks(r)).toHaveLength(2);
    await r.clock.advance(1000);
    expect(asks(r)).toHaveLength(6);
    expect(r.http.calls.every((c) => c.port === PORT && c.path === "/api/status")).toBe(true);
    expect(r.launcher.last().killed).toBe(false);
  });

  // @spec DESK-SHELL-SRV-013
  it("skips a tick while the last ask is still outstanding", async () => {
    const r = rig();
    r.answer = () => never();
    r.sup.start();
    await spawnLast(r);
    expect(asks(r)).toHaveLength(1);
    await r.clock.advance(900);
    expect(asks(r)).toHaveLength(1);
    // The first ask ran out at 1 s; by 1.25 s exactly one more has gone out.
    await r.clock.advance(350);
    expect(asks(r)).toHaveLength(2);
  });

  // @spec DESK-SHELL-SRV-012, DESK-SHELL-LOG-003
  it("counts the server ready only on an answer naming this app and its own process id", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    expect(child.pid).toBe(4000);
    // Connection refused (no answer) is nothing.
    await r.clock.advance(1000);
    expect(r.log.some((l) => l.startsWith("[server] ready"))).toBe(false);
    expect(child.killed).toBe(false);

    r.answer = own(r, "opening");
    await r.clock.advance(250);
    expect(r.log).toContain("[server] ready (pid 4000)");
    expect(r.sup.state()).toEqual({ kind: "starting", step: "opening" });
    await r.clock.advance(1000);
    expect(r.log.filter((l) => l.startsWith("[server] ready"))).toEqual(["[server] ready (pid 4000)"]);
    expect(child.killed).toBe(false);
  });

  const foreign: [string, (r: Rig) => () => HttpAnswer][] = [
    ["this app with another pid", () => () => statusAnswer({ pid: 9999, dataFolder: "D:\\elsewhere" })],
    ["another app with the own pid", (r) => () => ({ status: 200, body: JSON.stringify({ app: "something-else", pid: r.launcher.last().pid }) })],
    ["a 500 naming the own pid", (r) => () => ({ ...statusAnswer({ pid: r.launcher.last().pid as number }), status: 500 })],
    ["a body that is not JSON", () => () => ({ status: 200, body: "<!doctype html><title>other</title>" })],
  ];
  // @spec DESK-SHELL-SRV-014, DESK-SHELL-SRV-012
  it.each(foreign)("takes %s during readiness as a held port, never as readiness", async (_name, answer) => {
    const r = rig();
    r.sup.start();
    const child = r.launcher.last();
    r.answer = answer(r);
    child.spawn();
    await flush();
    expect(r.log.some((l) => l.startsWith("[server] ready"))).toBe(false);
    expect(r.dones).toEqual([]);
    expect(r.sup.state().kind).not.toBe("running");
    expect(child.killed).toBe(true); // its own server ended
    expect(heldAsks(r)).toEqual([{ port: PORT, path: "/api/status", timeoutMs: 2000 }]); // who holds it
  });

  // @spec DESK-SHELL-SRV-015, DESK-SHELL-LOG-003
  it("shows each start-up step and counts the work done only when the status says so", async () => {
    const r = rig();
    r.sup.start();
    r.answer = own(r, "opening");
    await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "opening" });

    for (const step of ["backing-up", "upgrading", "bringing-in"] as const) {
      r.answer = own(r, step);
      await r.clock.advance(250);
      expect(r.sup.state()).toEqual({ kind: "starting", step });
    }
    // A value that is no step leaves the step as it is; it is not done either.
    r.answer = own(r, "warming-up");
    await r.clock.advance(250);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "bringing-in" });
    // A status naming no step at all is never done.
    r.answer = own(r, null);
    await r.clock.advance(1000);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "bringing-in" });
    expect(r.dones).toEqual([]);
    expect(r.log).not.toContain("[server] start-up done");

    r.answer = own(r, "done");
    await r.clock.advance(250);
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.log).toContain("[server] start-up done");
    expect(r.dones).toEqual([{ requested: false }]);
  });

  // @spec DESK-SHELL-SRV-015, DESK-SHELL-SRV-025
  it("never counts a ready status that names no step as done, however long it answers so", async () => {
    const r = rig();
    r.sup.start();
    r.answer = own(r, null);
    const child = await spawnLast(r);
    expect(r.log).toContain("[server] ready (pid 4000)");
    await r.clock.advance(120_000);
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });
    expect(r.dones).toEqual([]);
    expect(child.killed).toBe(false);
  });

  // @spec DESK-SHELL-SRV-013
  it("stops its 250 ms asks once the start-up work is done", async () => {
    const r = rig();
    await startRunning(r);
    const before = asks(r).length;
    await r.clock.advance(5000);
    expect(asks(r)).toHaveLength(before);
  });

  // @spec DESK-SHELL-SRV-013, DESK-SHELL-SRV-014
  it("ignores a slow, missing or foreign answer after readiness, judging nothing by it", async () => {
    const r = rig();
    r.sup.start();
    r.answer = own(r, "opening");
    const child = await spawnLast(r);
    expect(r.log).toContain("[server] ready (pid 4000)");

    const after: (() => Answer)[] = [
      () => statusAnswer({ pid: 9999, dataFolder: "D:\\elsewhere" }),
      () => ({ status: 200, body: JSON.stringify({ app: "something-else", pid: 4000 }) }),
      () => ({ status: 503, body: "" }),
      () => null,
      () => never(),
    ];
    for (const answer of after) {
      r.answer = answer;
      await r.clock.advance(1500);
    }
    expect(child.killed).toBe(false);
    expect(heldAsks(r)).toEqual([]);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "opening" });

    r.answer = own(r, "done");
    await r.clock.advance(1250);
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.dones).toEqual([{ requested: false }]);
  });
});

describe("the fresh-run argument", () => {
  // @spec DESK-SHELL-SRV-044
  it("goes with every start until a server has done its start-up work, a retried first start included, and with none after", async () => {
    const r = rig();
    r.sup.start();
    // The first start fails at start: its retry still carries the argument.
    (await spawnLast(r)).exit(1);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);
    expect(r.fresh).toEqual([true, true]);
    expect(r.launcher.starts[1].options.args).toContain("--fresh-run");

    // This one does its start-up work.
    r.answer = own(r);
    let child = await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "running" });
    // A failure after its start, restarted after 1 s: no fresh run.
    await r.clock.advance(61_000);
    child.exit(1);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(3);
    expect(r.launcher.starts[2].options.args).not.toContain("--fresh-run");

    // A requested restart: no fresh run either.
    child = await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "running" });
    child.exit(12);
    await flush();
    expect(r.launcher.starts).toHaveLength(4);
    expect(r.fresh).toEqual([true, true, false, false]);
    expect(r.launcher.starts[3].options.args).toEqual(ARGS);
  });
});

describe("the server's output", () => {
  // @spec DESK-SHELL-LOG-002, DESK-SHELL-LOG-005
  it("writes each line of the output to server.log as it is and each error line as [stderr] <line>", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    child.stdout("[server] listening on http://127.0.0.1:3555\n[data] imp");
    child.stdout("orting airports ...\r\n");
    child.stderr("a warning\r\nsecond ");
    child.stderr("part\n");
    child.stdout("é ünïcödé ✈\n");
    expect(r.serverLog).toEqual([
      "[server] listening on http://127.0.0.1:3555",
      "[data] importing airports ...",
      "[stderr] a warning",
      "[stderr] second part",
      "é ünïcödé ✈",
    ]);
  });

  // @spec DESK-SHELL-LOG-005, DESK-SHELL-LOG-003
  it("lets a partial line out when the process exits, before the exit is handled", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    child.stdout("held without a line break");
    child.stderr("Error: the last words");
    expect(r.serverLog).toEqual([]);
    child.exit(1);
    await flush();
    expect(r.serverLog).toEqual(["held without a line break", "[stderr] Error: the last words"]);
    const exited = r.all.indexOf("desktop: [server] exited with code 1");
    expect(exited).toBeGreaterThan(r.all.indexOf("server: held without a line break"));
    expect(exited).toBeGreaterThan(r.all.indexOf("server: [stderr] Error: the last words"));
  });

  // @spec DESK-SHELL-LOG-005
  it("gives each server process lines of its own", async () => {
    const r = rig();
    r.sup.start();
    const first = await spawnLast(r);
    first.stdout("abc");
    first.exit(1);
    await r.clock.advance(1000);
    const second = await spawnLast(r);
    second.stdout("def\n");
    expect(r.serverLog).toEqual(["abc", "def"]);
  });
});
