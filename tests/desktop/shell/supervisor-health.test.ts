/**
 * A server that stops answering (src/desktop/supervisor.ts; m2 contract §8.5, §2.1): from readiness
 * on, its start-up work included, `/api/status` asked every 30 s with 10 s for each answer
 * (DESK-SHELL-SRV-026); three unanswered checks in a row, with nothing on the event stream
 * meanwhile, end the server with "The server stopped responding" and count it by the restart rules
 * (SRV-027, SRV-022..024); a resume starts the readiness wait and the count of unanswered checks
 * again (SRV-039, the supervisor's half); and every wait runs on the monotonic clock, so a change
 * to the system clock moves none (SRV-037).
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
  return r;
}
type Rig = ReturnType<typeof rig>;

/** The Supervisor's own latest server answering, its start-up work at `startup`. */
function own(r: Rig, startup = "done") {
  return (): HttpAnswer => statusAnswer({ pid: r.launcher.last().pid as number, startup, dataFolder: DATA });
}

/** Answers the first ask with `first`, then `rest` for every later one. */
function once(first: () => Answer, rest: () => Answer = () => null) {
  let used = false;
  return (): Answer => {
    if (used) return rest();
    used = true;
    return first();
  };
}

/** Spawns the latest child and lets its first ask settle. */
async function spawnLast(r: Rig): Promise<FakeChild> {
  const child = r.launcher.last();
  child.spawn();
  await flush();
  return child;
}

/** Started, spawned and ready at once, its start-up work at `startup`; then `after` answers. */
async function readyNow(r: Rig, startup: string, after: () => Answer) {
  r.answer = once(own(r, startup), after);
  r.sup.start();
  const child = await spawnLast(r);
  expect(r.log).toContain(`[server] ready (pid ${child.pid})`);
  return child;
}

const checks = (r: Rig) => r.http.calls.filter((c) => c.timeoutMs === 10_000);
const failureLines = (r: Rig) => r.log.filter((l) => l.startsWith("[server] failure at start"));

// ---------------------------------------------------------------------------------------------

describe("the 30 s checks", () => {
  // @spec DESK-SHELL-SRV-026
  it("asks /api/status every 30 s from readiness, allowing 10 s, during the start-up work too", async () => {
    const r = rig();
    r.answer = own(r, "opening");
    r.sup.start();
    await spawnLast(r);
    await r.clock.advance(29_999);
    expect(checks(r)).toHaveLength(0);
    await r.clock.advance(1);
    expect(checks(r)).toEqual([{ port: PORT, path: "/api/status", timeoutMs: 10_000 }]);
    await r.clock.advance(30_000);
    expect(checks(r)).toHaveLength(2);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "opening" });

    r.answer = own(r, "done");
    await r.clock.advance(250);
    expect(r.sup.state()).toEqual({ kind: "running" });
    await r.clock.advance(29_750);
    expect(checks(r)).toHaveLength(3);
    await r.clock.advance(30_000);
    expect(checks(r)).toHaveLength(4);
  });

  // @spec DESK-SHELL-SRV-026
  it("does not check a server before it is ready", async () => {
    const r = rig();
    r.sup.start();
    await spawnLast(r);
    await r.clock.advance(59_000);
    expect(checks(r)).toHaveLength(0);
  });
});

describe("a server that stops answering", () => {
  // @spec DESK-SHELL-SRV-027, DESK-SHELL-SRV-022, DESK-SHELL-LOG-003
  it("ends a server whose start-up work hangs after three unanswered checks: a failure at start", async () => {
    const r = rig();
    const child = await readyNow(r, "opening", () => null);
    await r.clock.advance(89_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
    expect(r.log).toContain("[server] stopped responding");
    await flush();
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
  });

  // @spec DESK-SHELL-SRV-027, DESK-SHELL-SRV-026
  it("counts a check unanswered after 10 s as a miss", async () => {
    const r = rig();
    const child = await readyNow(r, "opening", () => never());
    // Checks at 30, 60 and 90 s, each missed 10 s later.
    await r.clock.advance(99_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
    expect(r.log).toContain("[server] stopped responding");
  });

  // @spec DESK-SHELL-SRV-027, DESK-SHELL-SRV-024
  it("starts a server past its start again after 1 s when it stops answering", async () => {
    const r = rig();
    const child = await readyNow(r, "done", () => null);
    expect(r.sup.state()).toEqual({ kind: "running" });
    await r.clock.advance(90_000);
    expect(child.killed).toBe(true);
    expect(r.log).toContain("[server] stopped responding");
    await flush();
    expect(failureLines(r)).toEqual([]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
  });

  // @spec DESK-SHELL-SRV-027, DESK-SHELL-SRV-035
  it("gives up with 'The server stopped responding' after three hung starts", async () => {
    const r = rig();
    await readyNow(r, "opening", () => null);
    await r.clock.advance(90_000);
    await r.clock.advance(1000);
    r.answer = once(own(r, "opening"));
    await spawnLast(r);
    await r.clock.advance(90_000);
    await r.clock.advance(5000);
    r.answer = once(own(r, "opening"));
    await spawnLast(r);
    await r.clock.advance(90_000);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "The server stopped responding" });
    expect(r.log).toContain("[server] gave up: The server stopped responding");
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-027
  it("starts the count again at any answer, whatever its status", async () => {
    const r = rig();
    const child = await readyNow(r, "done", () => null);
    const script: (HttpAnswer | null)[] = [null, null, { status: 503, body: "" }, null, null, null];
    r.answer = () => script.shift() ?? null;
    // Misses at 30 and 60 s, an answer at 90 s, misses at 120, 150 and 180 s.
    await r.clock.advance(179_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
  });

  // @spec DESK-SHELL-SRV-027
  it("starts the count again at anything on the event stream", async () => {
    const r = rig();
    const child = await readyNow(r, "done", () => null);
    await r.clock.advance(70_000); // misses at 30 and 60 s
    r.sup.activity();
    // Misses at 90, 120 and 150 s.
    await r.clock.advance(79_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
  });
});

describe("a resume from sleep", () => {
  // @spec DESK-SHELL-SRV-039
  it("starts the count of unanswered checks again", async () => {
    const r = rig();
    const child = await readyNow(r, "done", () => null);
    await r.clock.advance(70_000); // misses at 30 and 60 s
    r.sup.resume();
    await r.clock.advance(79_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
  });

  // @spec DESK-SHELL-SRV-039, DESK-SHELL-SRV-022
  it("starts the 60 s readiness wait again from the resume", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    await r.clock.advance(50_000);
    r.sup.resume();
    await r.clock.advance(59_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
    await flush();
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
  });
});

describe("the clock", () => {
  // @spec DESK-SHELL-SRV-037
  it("keeps the 60 s readiness wait whatever the system clock does", async () => {
    const r = rig();
    r.sup.start();
    const child = await spawnLast(r);
    r.clock.setWall("2026-10-25T17:00:00.000Z"); // five hours on
    await r.clock.advance(59_999);
    expect(child.killed).toBe(false);
    r.clock.setWall("2026-10-25T07:00:00.000Z"); // ten hours back
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
  });

  // @spec DESK-SHELL-SRV-037
  it("keeps the restart delays whatever the system clock does", async () => {
    const r = rig();
    r.sup.start();
    (await spawnLast(r)).exit(1);
    await flush();
    r.clock.setWall("2026-10-25T09:00:00.000Z"); // three hours back
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
    (await spawnLast(r)).exit(1);
    await flush();
    r.clock.setWall("2026-10-26T12:00:00.000Z"); // a day on
    await r.clock.advance(4999);
    expect(r.launcher.starts).toHaveLength(2);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(3);
  });

  // @spec DESK-SHELL-SRV-037
  it("keeps the 30 s checks whatever the system clock does", async () => {
    const r = rig();
    const child = await readyNow(r, "done", () => null);
    r.clock.setWall("2026-10-25T00:00:00.000Z");
    await r.clock.advance(30_000);
    expect(checks(r)).toHaveLength(1);
    r.clock.setWall("2026-10-27T00:00:00.000Z");
    await r.clock.advance(59_999);
    expect(checks(r)).toHaveLength(2);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(checks(r)).toHaveLength(3);
    expect(child.killed).toBe(true);
  });
});
