/**
 * A held or refused port (src/desktop/supervisor.ts; m2 contract §8.4, §8.6): never another port
 * (DESK-SHELL-SRV-007); exit code 10, or another answer during the readiness wait, ends the own
 * server and asks the port's `/api/status` who holds it (SRV-014, SRV-028); a leftover server of
 * this data folder waited for up to 20 s and ended only when it runs the shell's own program
 * (SRV-029), then a failure at start with its reason (SRV-030); this app on another data folder
 * (SRV-031) or another program (SRV-032) given up on at once; nothing answering a failure at start
 * like any other (SRV-033); exit code 11 given up on at once with Windows' excluded port ranges in
 * `desktop.log` (SRV-034); and each holder's line in `desktop.log` (LOG-003).
 */
import { describe, expect, it } from "vitest";
import type { HttpAnswer } from "../../../src/desktop/ports.ts";
import { Supervisor, type SupervisorOptions } from "../../../src/desktop/supervisor.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts, FakeHttp, FakeLauncher, never, statusAnswer, type FakeChild, type HttpCall } from "../support/fakes.ts";

// ---------------------------------------------------------------------------------------------
// A Supervisor on fakes (local to this file; contract §18 gives the fakes, not this rig).

/** A stand-in port nothing listens on; every held-port reason must name it. */
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

/** Spawns the latest child and lets its first ask settle. */
async function spawnLast(r: Rig): Promise<FakeChild> {
  const child = r.launcher.last();
  child.spawn();
  await flush();
  return child;
}

/** The latest child spawns (nothing answering its asks) and exits with `code` while `holder` answers. */
async function exitWithHolder(r: Rig, code: number, holder: (call: HttpCall) => Answer) {
  r.answer = () => null;
  const child = await spawnLast(r);
  r.answer = holder;
  child.exit(code);
  await flush();
  return child;
}

const failureLines = (r: Rig) => r.log.filter((l) => l.startsWith("[server] failure at start"));
const heldAsks = (r: Rig) => r.http.calls.filter((c) => c.timeoutMs === 2000);

const LEFTOVER_PID = 7777;
const LEFTOVER_REASON =
  "An earlier MSFS Career Map server is still running: quit MSFS Career Map, end any MSFS Career Map still listed in Task Manager, and start it again";
const ANOTHER_PROGRAM = `Port ${PORT} is in use by another program`;
const ANOTHER_FOLDER = `Port ${PORT} is in use by MSFS Career Map in another Windows account, a test copy or a copy run from source`;

/** This app's server on the same data folder, of another version, spelled differently. */
const leftover = (): HttpAnswer =>
  statusAnswer({ pid: LEFTOVER_PID, version: "0.7.0", dataFolder: "c:\\TEST\\Data\\", startup: "done" });

// ---------------------------------------------------------------------------------------------

describe("a port held by another program", () => {
  const holders: [string, HttpAnswer][] = [
    ["a web page", { status: 200, body: "<!doctype html><title>Other</title>" }],
    ["a 404", { status: 404, body: "Not Found" }],
    ["JSON from another app", { status: 200, body: JSON.stringify({ app: "something-else", pid: LEFTOVER_PID, dataFolder: DATA }) }],
    ["this app's JSON with a 500", { ...statusAnswer({ pid: LEFTOVER_PID, dataFolder: DATA }), status: 500 }],
  ];
  // @spec DESK-SHELL-SRV-028, DESK-SHELL-SRV-032, DESK-SHELL-SRV-035, DESK-SHELL-LOG-003
  it.each(holders)("gives up at once on exit code 10 with %s answering", async (_name, answer) => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, () => answer);
    expect(r.log).toContain("[server] exited with code 10");
    expect(heldAsks(r)).toEqual([{ port: PORT, path: "/api/status", timeoutMs: 2000 }]);
    expect(r.log).toContain(`[server] port ${PORT} held by another program`);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: ANOTHER_PROGRAM });
    expect(r.log).toContain(`[server] gave up: ${ANOTHER_PROGRAM}`);
    expect(failureLines(r)).toEqual([]);
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(120_000);
    expect(r.launcher.starts).toHaveLength(1);
  });
});

describe("a port held by this app on another data folder", () => {
  const holders: [string, () => HttpAnswer][] = [
    ["another data folder", () => statusAnswer({ pid: LEFTOVER_PID, dataFolder: "D:\\MSFS Career Map test\\data" })],
    ["no data folder named", () => statusAnswer({ pid: LEFTOVER_PID, dataFolder: undefined })],
  ];
  // @spec DESK-SHELL-SRV-031, DESK-SHELL-SRV-028, DESK-SHELL-LOG-003
  it.each(holders)("gives up at once on exit code 10 with %s", async (_name, answer) => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, answer);
    expect(r.log).toContain(`[server] port ${PORT} held by MSFS Career Map on another data folder`);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: ANOTHER_FOLDER });
    expect(r.log).toContain(`[server] gave up: ${ANOTHER_FOLDER}`);
    expect(r.clock.pending()).toBe(0);
    expect(r.facts.calls).toEqual([]);
  });
});

describe("a port held with nothing answering", () => {
  // @spec DESK-SHELL-SRV-033, DESK-SHELL-SRV-023, DESK-SHELL-SRV-035, DESK-SHELL-LOG-003
  it("counts a failure at start like any other, giving up after the third with the port's reason", async () => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, () => null);
    expect(r.log).toContain(`[server] port ${PORT} held, nothing answering`);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    await r.clock.advance(1000);
    await exitWithHolder(r, 10, () => null);
    expect(failureLines(r).at(-1)).toBe("[server] failure at start 2 of 3; starting again in 5 s");
    await r.clock.advance(5000);
    await exitWithHolder(r, 10, () => null);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: ANOTHER_PROGRAM });
    expect(r.log).toContain(`[server] gave up: ${ANOTHER_PROGRAM}`);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-033, DESK-SHELL-SRV-037
  it("allows the holder 2 s to answer", async () => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, () => never());
    expect(heldAsks(r)).toHaveLength(1);
    await r.clock.advance(1999);
    expect(failureLines(r)).toEqual([]);
    await r.clock.advance(1);
    expect(r.log).toContain(`[server] port ${PORT} held, nothing answering`);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
  });
});

describe("a leftover server of this data folder", () => {
  // @spec DESK-SHELL-SRV-029, DESK-SHELL-SRV-030, DESK-SHELL-LOG-003
  it("waits for one that stops answering, then counts a failure at start and starts again after the usual delay", async () => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, leftover);
    expect(r.log).toContain(`[server] port ${PORT} held by an earlier server of this data folder (pid ${LEFTOVER_PID})`);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    await r.clock.advance(4500);
    // The asks after the one that found the holder: every 1 s (the first at 0 s or at 1 s), so 4 or 5 by 4.5 s.
    const found = r.http.calls.findIndex((c) => c.timeoutMs === 2000);
    expect(found).toBeGreaterThanOrEqual(0);
    const waitAsks = r.http.calls.slice(found + 1);
    expect(waitAsks.length).toBeGreaterThanOrEqual(4);
    expect(waitAsks.length).toBeLessThanOrEqual(5);
    expect(waitAsks.every((c) => c.port === PORT && c.path === "/api/status")).toBe(true);
    expect(failureLines(r)).toEqual([]);

    r.answer = () => null; // it has gone
    await r.clock.advance(500);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
    expect(r.facts.calls).toEqual([]); // nothing to look up or end
  });

  // @spec DESK-SHELL-SRV-029, DESK-SHELL-SRV-030, DESK-SHELL-LOG-003
  it("ends one still answering at 20 s when it runs the shell's own program, then counts a failure at start", async () => {
    const r = rig();
    r.facts.programs.set(LEFTOVER_PID, PROGRAM.toUpperCase());
    r.sup.start();
    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(19_999);
    expect(r.facts.ended).toEqual([]);
    expect(failureLines(r)).toEqual([]);
    await r.clock.advance(1);
    expect(r.facts.calls).toContain(`programOf ${LEFTOVER_PID}`);
    expect(r.facts.ended).toEqual([LEFTOVER_PID]);
    expect(r.log).toContain(`[server] ended the earlier server ${LEFTOVER_PID}`);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    // The usual delay, following the 20 s wait.
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
  });

  // @spec DESK-SHELL-SRV-029, DESK-SHELL-SRV-032
  it("gives up at once when the process id it reported runs another program, ending nothing", async () => {
    const r = rig();
    r.facts.programs.set(LEFTOVER_PID, "C:\\Tools\\other-server.exe");
    r.sup.start();
    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(20_000);
    expect(r.facts.calls).toContain(`programOf ${LEFTOVER_PID}`);
    expect(r.facts.ended).toEqual([]);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: ANOTHER_PROGRAM });
    expect(r.log).toContain(`[server] gave up: ${ANOTHER_PROGRAM}`);
    expect(failureLines(r)).toEqual([]);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-029, DESK-SHELL-SRV-030, DESK-SHELL-SRV-023, DESK-SHELL-SRV-035
  it("ends nothing when its process has gone, and gives up after the third with the leftover's reason", async () => {
    const r = rig(); // facts.programs knows no pid: programOf answers null
    r.sup.start();
    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(20_000);
    expect(r.facts.ended).toEqual([]);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);

    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(20_000);
    expect(failureLines(r).at(-1)).toBe("[server] failure at start 2 of 3; starting again in 5 s");
    await r.clock.advance(4999);
    expect(r.launcher.starts).toHaveLength(2);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(3);

    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(20_000);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: LEFTOVER_REASON });
    expect(r.log).toContain(`[server] gave up: ${LEFTOVER_REASON}`);
    expect(r.facts.ended).toEqual([]);
    expect(r.clock.pending()).toBe(0);
  });
});

describe("another answer during the readiness wait", () => {
  // @spec DESK-SHELL-SRV-014, DESK-SHELL-SRV-028, DESK-SHELL-SRV-031
  it("ends the own server, ignores its exit, and asks who holds the port", async () => {
    const r = rig();
    r.sup.start();
    const child = r.launcher.last();
    r.answer = () => statusAnswer({ pid: LEFTOVER_PID, dataFolder: "D:\\elsewhere\\data" });
    child.spawn();
    await flush();
    expect(child.killed).toBe(true);
    expect(child.exited).toBe(0);
    expect(heldAsks(r)).toHaveLength(1);
    expect(r.log).toContain(`[server] port ${PORT} held by MSFS Career Map on another data folder`);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: ANOTHER_FOLDER });
    expect(failureLines(r)).toEqual([]); // the kill's exit is not a failure of its own
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-014, DESK-SHELL-SRV-029
  it("takes this app's server of another version on the same data folder for a leftover", async () => {
    const r = rig();
    r.sup.start();
    const child = r.launcher.last();
    r.answer = leftover;
    child.spawn();
    await flush();
    expect(child.killed).toBe(true);
    expect(r.log).toContain(`[server] port ${PORT} held by an earlier server of this data folder (pid ${LEFTOVER_PID})`);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    expect(failureLines(r)).toEqual([]);
    await r.clock.advance(20_000);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
  });

  // @spec DESK-SHELL-SRV-014, DESK-SHELL-SRV-033
  it("counts a failure at start when nothing answers the question who holds it", async () => {
    const r = rig();
    r.sup.start();
    const child = r.launcher.last();
    let answered = false;
    r.answer = () => {
      if (answered) return null;
      answered = true;
      return { status: 200, body: "<!doctype html>" };
    };
    child.spawn();
    await flush();
    expect(child.killed).toBe(true);
    expect(r.log).toContain(`[server] port ${PORT} held, nothing answering`);
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);
  });
});

describe("a port Windows refuses (exit code 11)", () => {
  // @spec DESK-SHELL-SRV-034, DESK-SHELL-SRV-035, DESK-SHELL-LOG-003
  it("gives up at once naming the port, and writes Windows' excluded port ranges to desktop.log", async () => {
    const r = rig();
    r.facts.ranges = "Protocol tcp Port Exclusion Ranges\n\nStart Port    End Port\n----------    --------\n      3501        3600";
    r.sup.start();
    await exitWithHolder(r, 11, () => null);
    const reason = `Windows reserves port ${PORT} (an excluded port range); restarting Windows may free it`;
    expect(r.sup.state()).toEqual({ kind: "given-up", reason });
    expect(r.log).toContain(`[server] gave up: ${reason}`);
    expect(r.facts.calls).toContain("excludedPortRanges");
    expect(r.log.join("\n")).toContain(`[server] Windows' excluded port ranges:\n${r.facts.ranges}`);
    expect(failureLines(r)).toEqual([]);
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(120_000);
    expect(r.launcher.starts).toHaveLength(1);
  });
});

describe("the port", () => {
  // @spec DESK-SHELL-SRV-007
  it("is never changed, whatever holds it", async () => {
    const r = rig();
    r.sup.start();
    await exitWithHolder(r, 10, () => null);
    await r.clock.advance(1000);
    await exitWithHolder(r, 10, leftover);
    await r.clock.advance(20_000);
    await r.clock.advance(5000);
    expect(r.launcher.starts).toHaveLength(3);
    for (const start of r.launcher.starts) {
      expect(start.options.args).toEqual(r.launcher.starts[0].options.args);
      expect(start.options.args).toContain(`--port=${PORT}`);
    }
    expect(r.http.calls.length).toBeGreaterThan(0);
    expect(r.http.calls.every((c) => c.port === PORT)).toBe(true);
  });
});
