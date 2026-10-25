/**
 * Shutting the server down and the quitting state (src/desktop/supervisor.ts; m2 contract §8.1,
 * §8.2, §8.7): Shut down (`{type: "shutdown"}`) sent to any server process, spawned or not yet,
 * ready or not, and the process ended at 10 s without its exit (DESK-SHELL-SRV-019, SRV-020); Shut
 * down sent only when the app quits, never to restart a server (SRV-045); entering the quitting
 * state cancelling a scheduled restart and leaving an exit ended, with no wait left behind; the
 * private channel holding a message for a server not yet spawned; and the start never waiting for
 * the folders' look-up written to `desktop.log` (SRV-009, LOG-003).
 */
import { describe, expect, it } from "vitest";
import type { HttpAnswer } from "../../../src/desktop/ports.ts";
import { Supervisor, type SupervisorOptions } from "../../../src/desktop/supervisor.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts, FakeHttp, FakeLauncher, never, statusAnswer, type FakeChild, type HttpCall } from "../support/fakes.ts";

// ---------------------------------------------------------------------------------------------
// A Supervisor on fakes (local to this file; contract §18 gives the fakes, not this rig).

/** A stand-in port nothing listens on. */
const PORT = 3555;
const DATA = "C:\\test\\data";
const BACKUPS = "C:\\test\\Backups";
const SCRIPT = "C:\\Program Files\\MSFS Career Map\\resources\\server.mjs";
const PROGRAM = "C:\\Program Files\\MSFS Career Map\\MSFS Career Map.exe";
const ENV = { Path: "C:\\Windows\\system32", TEMP: "C:\\Temp" };
const ARGS = [`--data=${DATA}`, "--program=C:\\prog", `--port=${PORT}`, `--backups=${BACKUPS}`, "--sim=fake", "--airport-downloads=off"];
const SHUTDOWN = { type: "shutdown" };

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
    args: (freshRun) => (freshRun ? [...ARGS, "--fresh-run"] : [...ARGS]),
    dataFolder: DATA,
    programPath: PROGRAM,
    folders: () => Promise.resolve({ data: DATA, backups: BACKUPS }),
    log: (line) => r.log.push(line),
    serverLog: () => {},
    ...o,
  };
  r.sup = new Supervisor(options, { clock, launcher, http, facts });
  r.sup.onExit((e) => r.exits.push(e));
  return r;
}
type Rig = ReturnType<typeof rig>;

/** The Supervisor's own latest server answering, its start-up work at `startup`. */
function own(r: Rig, startup = "done") {
  return (): HttpAnswer => statusAnswer({ pid: r.launcher.last().pid as number, startup, dataFolder: DATA });
}

/** Spawns the latest child and lets its first ask settle. */
async function spawnLast(r: Rig): Promise<FakeChild> {
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

/** Three failures at start: given up. */
async function giveUp(r: Rig) {
  r.sup.start();
  (await spawnLast(r)).exit(1);
  await r.clock.advance(1000);
  (await spawnLast(r)).exit(1);
  await r.clock.advance(5000);
  (await spawnLast(r)).exit(1);
  await flush();
  expect(r.sup.state()).toEqual({ kind: "given-up", reason: "The server did not start within 60 s" });
}

/** Whether a promise has settled by now. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => (done = true));
  await flush();
  return done;
}

// ---------------------------------------------------------------------------------------------

describe("Shut down", () => {
  // @spec DESK-SHELL-SRV-019, DESK-SHELL-LOG-003
  it("goes to a running server, which is left to exit", async () => {
    const r = rig();
    const child = await startRunning(r);
    const done = r.sup.shutDown();
    expect(await settled(done)).toBe(false);
    expect(child.posted).toEqual([SHUTDOWN]);
    await r.clock.advance(3000);
    child.exit(0);
    expect(await settled(done)).toBe(true);
    expect(child.killed).toBe(false);
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.sup.hasProcess()).toBe(false);
    expect(r.log).toContain("[server] shut down");
    expect(r.clock.pending()).toBe(0);
    // Ended for good: nothing starts again.
    await r.clock.advance(120_000);
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-019
  it("goes to a server not yet ready", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });
    const done = r.sup.shutDown();
    await flush();
    expect(child.posted).toEqual([SHUTDOWN]);
    child.exit(0);
    expect(await settled(done)).toBe(true);
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.launcher.starts).toHaveLength(1);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-019
  it("goes to a server not yet spawned, at its spawn", async () => {
    const r = rig();
    r.sup.start();
    const child = r.launcher.last();
    const done = r.sup.shutDown();
    await flush();
    expect(child.posted).toEqual([]); // FakeChild refuses a post before the spawn
    child.spawn();
    await flush();
    expect(child.posted).toEqual([SHUTDOWN]);
    child.exit(0);
    expect(await settled(done)).toBe(true);
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.log).toContain("[server] shut down");
  });

  // @spec DESK-SHELL-SRV-020, DESK-SHELL-SRV-019
  it("ends the server 10 s after Shut down without its exit, and resolves", async () => {
    const r = rig();
    const child = await startRunning(r);
    const done = r.sup.shutDown();
    await r.clock.advance(9999);
    expect(child.killed).toBe(false);
    expect(await settled(done)).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
    expect(await settled(done)).toBe(true);
    expect(child.exited).toBe(0);
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.log).toContain("[server] shut down");
    expect(r.launcher.starts).toHaveLength(1);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-020
  it("resolves at once after the kill even when the process does not exit at it", async () => {
    const r = rig();
    const child = await startRunning(r);
    child.ignoreKill = true;
    const done = r.sup.shutDown();
    await r.clock.advance(10_000);
    expect(child.killed).toBe(true);
    expect(await settled(done)).toBe(true);
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-019
  it("returns the same promise at every call and sends Shut down once", async () => {
    const r = rig();
    const child = await startRunning(r);
    const first = r.sup.shutDown();
    const second = r.sup.shutDown();
    expect(second).toBe(first);
    await flush();
    expect(child.posted).toEqual([SHUTDOWN]);
    child.exit(0);
    expect(await settled(first)).toBe(true);
    expect(r.sup.shutDown()).toBe(first);
  });

  // @spec DESK-SHELL-SRV-019
  it("resolves at once with no process: given up stays given up, a restart delay becomes stopped", async () => {
    const given = rig();
    await giveUp(given);
    expect(await settled(given.sup.shutDown())).toBe(true);
    expect(given.sup.state()).toEqual({ kind: "given-up", reason: "The server did not start within 60 s" });
    expect(given.clock.pending()).toBe(0);

    const waiting = rig();
    waiting.sup.start();
    (await spawnLast(waiting)).exit(1);
    await flush();
    expect(waiting.sup.state()).toEqual({ kind: "restarting" });
    expect(await settled(waiting.sup.shutDown())).toBe(true);
    expect(waiting.sup.state()).toEqual({ kind: "stopped" });
    expect(waiting.clock.pending()).toBe(0);
    await waiting.clock.advance(10_000);
    expect(waiting.launcher.starts).toHaveLength(1);

    const unstarted = rig();
    expect(await settled(unstarted.sup.shutDown())).toBe(true);
    expect(unstarted.sup.state()).toEqual({ kind: "stopped" });
    expect(unstarted.launcher.starts).toHaveLength(0);
  });
});

describe("Shut down is only for quitting", () => {
  // @spec DESK-SHELL-SRV-045
  it("is never sent by a restart, a requested restart, a health kill, a readiness kill or Try again", async () => {
    const r = rig();
    r.sup.start();
    // A failure at start, restarted.
    (await spawnLast(r)).exit(1);
    await r.clock.advance(1000);
    // Done, then a requested restart.
    r.answer = own(r);
    (await spawnLast(r)).exit(12);
    await flush();
    // Done, then it stops answering: ended after three checks.
    let first = true;
    r.answer = () => {
      if (!first) return null;
      first = false;
      return own(r)();
    };
    const hung = await spawnLast(r);
    await r.clock.advance(90_000);
    expect(hung.killed).toBe(true);
    await r.clock.advance(1000);
    // Two failures at start, then one never ready, ended at 60 s: given up.
    (await spawnLast(r)).exit(1);
    await r.clock.advance(1000);
    (await spawnLast(r)).exit(1);
    await r.clock.advance(5000);
    const late = await spawnLast(r);
    await r.clock.advance(60_000);
    expect(late.killed).toBe(true);
    expect(r.sup.state().kind).toBe("given-up");
    r.sup.tryAgain();
    await spawnLast(r);
    expect(r.launcher.starts).toHaveLength(7);
    for (const child of r.launcher.starts) expect(child.posted).toEqual([]);
  });

  // @spec DESK-SHELL-SRV-045
  it("is not sent by entering the quitting state alone", async () => {
    const r = rig();
    const child = await startRunning(r);
    r.sup.enterQuitting();
    await r.clock.advance(30_000);
    expect(child.posted).toEqual([]);
    expect(child.killed).toBe(false);
  });
});

describe("the quitting state", () => {
  // @spec DESK-SHELL-SRV-019
  it("cancels a scheduled restart: stopped at once, nothing left waiting", async () => {
    const r = rig();
    r.sup.start();
    (await spawnLast(r)).exit(1);
    await flush();
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    r.sup.enterQuitting();
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(10_000);
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-019
  it("leaves a running server running until it exits, then ended: no restart, a code 12 included", async () => {
    const r = rig();
    const child = await startRunning(r);
    r.sup.enterQuitting();
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.sup.hasProcess()).toBe(true);
    child.exit(12);
    await flush();
    expect(r.exits).toEqual([{ code: 12, requested: false }]);
    expect(r.log).not.toContain("[server] restart requested (exit code 12); starting again now");
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(120_000);
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-019
  it("leaves a failing start ended", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    r.sup.enterQuitting();
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });
    child.exit(1);
    await flush();
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    expect(r.log.some((l) => l.startsWith("[server] failure at start"))).toBe(false);
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(60_000);
    expect(r.launcher.starts).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-019, DESK-SHELL-SRV-027
  it("stops the checks for a server that stops answering", async () => {
    const r = rig();
    const child = await startRunning(r);
    r.answer = () => null;
    r.sup.enterQuitting();
    const before = r.http.calls.length;
    await r.clock.advance(120_000);
    expect(r.http.calls).toHaveLength(before);
    expect(child.killed).toBe(false);
  });

  // @spec DESK-SHELL-SRV-019, DESK-SHELL-SRV-036
  it("leaves a given-up server given up, its reason kept, and Try again starts nothing", async () => {
    const r = rig();
    await giveUp(r);
    r.sup.enterQuitting();
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "The server did not start within 60 s" });
    r.sup.tryAgain();
    await flush();
    expect(r.launcher.starts).toHaveLength(3);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-019
  it("makes a Supervisor never started stopped, and start() then starts nothing", async () => {
    const r = rig();
    r.sup.enterQuitting();
    expect(r.sup.state()).toEqual({ kind: "stopped" });
    r.sup.start();
    await flush();
    expect(r.launcher.starts).toHaveLength(0);
  });
});

describe("the private channel", () => {
  // @spec DESK-SHELL-BAK-007, DESK-SHELL-BAK-008
  it("holds a message for a server not yet spawned and sends it at the spawn; with no process it sends nothing", async () => {
    const r = rig();
    expect(r.sup.post({ type: "save", id: "save-1" })).toBe(false);
    r.sup.start();
    const child = r.launcher.last();
    expect(r.sup.post({ type: "backup", id: "backup-1", kind: "daily" })).toBe(true);
    expect(child.posted).toEqual([]);
    child.spawn();
    await flush();
    expect(child.posted).toEqual([{ type: "backup", id: "backup-1", kind: "daily" }]);
    expect(r.sup.post({ type: "save", id: "save-2" })).toBe(true);
    expect(child.posted).toEqual([
      { type: "backup", id: "backup-1", kind: "daily" },
      { type: "save", id: "save-2" },
    ]);
    child.exit(1);
    await flush();
    expect(r.sup.hasProcess()).toBe(false);
    expect(r.sup.post({ type: "save", id: "save-3" })).toBe(false);
  });

  // @spec DESK-SHELL-SRV-018
  it("passes on what the server posts", async () => {
    const r = rig();
    const got: unknown[] = [];
    r.sup.onMessage((m) => got.push(m));
    const child = await startRunning(r);
    child.message({ type: "saved", id: "save-1" });
    expect(got).toEqual([{ type: "saved", id: "save-1" }]);
  });
});

describe("the folders' look-up", () => {
  // @spec DESK-SHELL-SRV-009, DESK-SHELL-LOG-003
  it("never holds up the start, and is written when it resolves", async () => {
    let resolve: (f: { data: string; backups: string }) => void = () => {};
    const r = rig({ folders: () => new Promise((res) => (resolve = res)) });
    r.answer = own(r);
    r.sup.start();
    expect(r.launcher.starts).toHaveLength(1);
    await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.log.some((l) => l.startsWith("[server] starting: "))).toBe(false);
    resolve({ data: DATA, backups: "E:\\Documents\\MSFS Career Map\\Backups" });
    await flush();
    expect(r.log).toContain(`[server] starting: data folder ${DATA}; backups folder E:\\Documents\\MSFS Career Map\\Backups`);
  });

  // @spec DESK-SHELL-SRV-009
  it("starts the server even when it never resolves", async () => {
    const r = rig({ folders: () => never() });
    r.answer = own(r);
    r.sup.start();
    expect(r.launcher.starts).toHaveLength(1);
    await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.log.some((l) => l.startsWith("[server] starting: "))).toBe(false);
  });
});
