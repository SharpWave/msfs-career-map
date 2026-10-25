/**
 * The supervisor's failures and restarts (src/desktop/supervisor.ts; m2 contract §8.4): every exit
 * not asked for is a failure (DESK-SHELL-SRV-021); one within 60 s of its start or before its
 * start-up work is done, or a server not ready within 60 s, is a failure at start (SRV-022),
 * started again after 1 s, then 5 s, and given up on at the third (SRV-023, SRV-035); a server that
 * ran past both is started again after 1 s with the count cleared, however often (SRV-024); a server
 * still answering is never ended for long start-up work (SRV-025); the give-up reason, the
 * shell's own first, then the server's last error line, then "The server did not start within
 * 60 s" (SRV-035); Try again with a fresh count (SRV-036); exit code 12 started again at once,
 * counting nothing (SRV-043); restarts made whatever the sim is doing (AWAY-005); and the
 * Supervisor's lines for these in `desktop.log` (LOG-003).
 */
import { describe, expect, it } from "vitest";
import type { HttpAnswer } from "../../../src/desktop/ports.ts";
import { Supervisor, type ServerState, type SupervisorOptions } from "../../../src/desktop/supervisor.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts, FakeHttp, FakeLauncher, statusAnswer, type FakeChild, type HttpCall } from "../support/fakes.ts";

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
    serverLog: [] as string[],
    states: [] as ServerState[],
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
    args: (freshRun) => (freshRun ? [...ARGS, "--fresh-run"] : [...ARGS]),
    dataFolder: DATA,
    programPath: PROGRAM,
    folders: () => Promise.resolve({ data: DATA, backups: BACKUPS }),
    log: (line) => r.log.push(line),
    serverLog: (line) => r.serverLog.push(line),
    ...o,
  };
  r.sup = new Supervisor(options, { clock, launcher, http, facts });
  r.sup.onState((s) => r.states.push(s));
  r.sup.onStartupDone((e) => r.dones.push(e));
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

const failureLines = (r: Rig) => r.log.filter((l) => l.startsWith("[server] failure at start"));
const DID_NOT_START = "The server did not start within 60 s";

/** The latest child spawns, writes `stderr` (if any) and exits with `code`. */
async function failLast(r: Rig, code = 1, stderr: string[] = []) {
  const child = await spawnLast(r);
  for (const chunk of stderr) child.stderr(chunk);
  child.exit(code);
  await flush();
  return child;
}

/** Three failures at start in a row from a not-started Supervisor, the last child's stderr given. */
async function giveUpByExits(r: Rig, lastStderr: string[] = [], earlierStderr: string[] = []) {
  r.sup.start();
  await failLast(r, 1, earlierStderr);
  await r.clock.advance(1000);
  await failLast(r, 1, earlierStderr);
  await r.clock.advance(5000);
  await failLast(r, 1, lastStderr);
}

// The three real stderr texts of contract §8.4 / §20 E8 (the probes' own, paths shortened).
const SQLITE_TEXT =
  "[server] stopping on an error outside the request handlers: Error: database is locked\n" +
  "    at file:///C:/x/crash.mjs:2:11\n" +
  "    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)\n" +
  "    at async node:internal/modules/esm/loader:647:26\n" +
  "    at async node:internal/electron/js2c/utility_init:3:16323\n" +
  "    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {\n" +
  "  code: 'ERR_SQLITE_ERROR',\n" +
  "  errcode: 5,\n" +
  "  errstr: 'database is locked'\n" +
  "}\n";
const EACCES_TEXT =
  "file:///C:/x/crash2.mjs:2\r\n" +
  "const e = new Error(\"EACCES: permission denied, open 'x'\");\r\n" +
  "          ^\r\n" +
  "\r\n" +
  "Error: EACCES: permission denied, open 'x'\r\n" +
  "    at file:///C:/x/crash2.mjs:2:11\r\n" +
  "    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)\r\n" +
  "    at async node:internal/modules/esm/loader:647:26\r\n" +
  "    at async node:internal/electron/js2c/utility_init:3:16323\r\n" +
  "    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {\r\n" +
  "  code: 'EACCES',\r\n" +
  "  errno: -4092\r\n" +
  "}\r\n" +
  "\r\n" +
  "Node.js v24.22.0\r\n";
const NOLIB_TEXT =
  "node:internal/modules/package_json_reader:331\r\n" +
  "  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);\r\n" +
  "        ^\r\n" +
  "\r\n" +
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'node-simconnect' imported from C:\\x\\server.mjs\r\n" +
  "    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:331:9)\r\n" +
  "    at packageResolve (node:internal/modules/esm/resolve:797:25)\r\n" +
  "    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33) {\r\n" +
  "  code: 'ERR_MODULE_NOT_FOUND'\r\n" +
  "}\r\n" +
  "\r\n" +
  "Node.js v24.22.0\r\n";

/** A text cut into chunks at awkward places (mid-line, between CR and LF). */
function chunks(text: string): string[] {
  const cuts = [7, Math.floor(text.length / 3), text.indexOf("\r") + 1 || 40, Math.floor((2 * text.length) / 3)]
    .filter((n) => n > 0 && n < text.length)
    .sort((a, b) => a - b);
  const out: string[] = [];
  let at = 0;
  for (const cut of cuts) {
    if (cut > at) out.push(text.slice(at, cut));
    at = Math.max(at, cut);
  }
  out.push(text.slice(at));
  return out;
}

// ---------------------------------------------------------------------------------------------

describe("failures at start", () => {
  // @spec DESK-SHELL-SRV-022, DESK-SHELL-SRV-023, DESK-SHELL-SRV-035, DESK-SHELL-LOG-003
  it("starts again 1 s after the first, 5 s after the second, and gives up at the third", async () => {
    const r = rig();
    r.sup.start();
    await failLast(r);
    expect(r.log).toContain("[server] exited with code 1");
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    expect(r.sup.hasProcess()).toBe(false);
    await r.clock.advance(999);
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(2);
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });

    await failLast(r);
    expect(failureLines(r)).toEqual([
      "[server] failure at start 1 of 3; starting again in 1 s",
      "[server] failure at start 2 of 3; starting again in 5 s",
    ]);
    await r.clock.advance(4999);
    expect(r.launcher.starts).toHaveLength(2);
    await r.clock.advance(1);
    expect(r.launcher.starts).toHaveLength(3);

    await failLast(r);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: DID_NOT_START });
    expect(r.log).toContain(`[server] gave up: ${DID_NOT_START}`);
    expect(failureLines(r)).toHaveLength(2);
    expect(r.states.at(-1)).toEqual({ kind: "given-up", reason: DID_NOT_START });
    expect(r.clock.pending()).toBe(0);
    await r.clock.advance(600_000);
    expect(r.launcher.starts).toHaveLength(3);
  });

  // @spec DESK-SHELL-SRV-022
  it("counts an exit within 60 s of the start as a failure at start, even after the start-up work is done", async () => {
    const r = rig();
    r.answer = own(r);
    r.sup.start();
    const child = await spawnLast(r);
    expect(r.sup.state()).toEqual({ kind: "running" });
    await r.clock.advance(30_000);
    child.exit(1);
    await flush();
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.log).not.toContain("[server] stopped after its start; starting again in 1 s");
  });

  // @spec DESK-SHELL-SRV-022
  it("counts an exit before the start-up work is done as a failure at start, however long that work took", async () => {
    const r = rig();
    r.answer = own(r, "upgrading");
    r.sup.start();
    const child = await spawnLast(r);
    await r.clock.advance(120_000);
    expect(child.killed).toBe(false);
    child.exit(1);
    await flush();
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.sup.state()).toEqual({ kind: "restarting" });
  });

  // @spec DESK-SHELL-SRV-021
  it("counts an exit with code 0 that it did not ask for as a failure", async () => {
    const r = rig();
    r.sup.start();
    await failLast(r, 0);
    expect(r.log).toContain("[server] exited with code 0");
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.exits).toEqual([{ code: 0, requested: false }]);
  });

  // @spec DESK-SHELL-SRV-022, DESK-SHELL-SRV-035
  it("ends a server not ready 60 s after it was started, counts one failure, and takes its exit for nothing more", async () => {
    const r = rig();
    r.sup.start();
    await r.clock.advance(10_000);
    const child = await spawnLast(r); // a late spawn: the 60 s run from the start
    await r.clock.advance(49_999);
    expect(child.killed).toBe(false);
    await r.clock.advance(1);
    expect(child.killed).toBe(true);
    await flush();
    expect(child.exited).toBe(0); // a kill exits with code 0, as Electron's does
    expect(failureLines(r)).toEqual(["[server] failure at start 1 of 3; starting again in 1 s"]);
    expect(r.log).not.toContain("[server] stopped after its start; starting again in 1 s");
    expect(r.sup.state()).toEqual({ kind: "restarting" });
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);

    // Twice more: given up, with nothing written to go on.
    await spawnLast(r);
    await r.clock.advance(60_000);
    await r.clock.advance(5000);
    expect(r.launcher.starts).toHaveLength(3);
    await spawnLast(r);
    await r.clock.advance(60_000);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: DID_NOT_START });
    expect(failureLines(r)).toHaveLength(2);
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-025, DESK-SHELL-SRV-013
  it("never ends a server that answers while its start-up work runs past 60 s", async () => {
    const r = rig();
    r.answer = own(r, "bringing-in");
    r.sup.start();
    const child = await spawnLast(r);
    await r.clock.advance(61_000);
    expect(child.killed).toBe(false);
    expect(r.sup.state()).toEqual({ kind: "starting", step: "bringing-in" });
    await r.clock.advance(300_000);
    expect(child.killed).toBe(false);
    r.answer = own(r, "done");
    await r.clock.advance(250);
    expect(r.sup.state()).toEqual({ kind: "running" });
    expect(r.dones).toEqual([{ requested: false }]);
    expect(failureLines(r)).toEqual([]);
  });
});

describe("failures after the start", () => {
  // @spec DESK-SHELL-SRV-024, DESK-SHELL-SRV-021, DESK-SHELL-LOG-003
  it("starts a server that ran past 60 s with its start-up work done again after 1 s, however often", async () => {
    const r = rig();
    r.answer = own(r);
    r.sup.start();
    for (let i = 0; i < 6; i++) {
      const child = await spawnLast(r);
      expect(r.sup.state()).toEqual({ kind: "running" });
      await r.clock.advance(61_000);
      child.exit(i % 2 === 0 ? 1 : 0);
      await flush();
      expect(r.sup.state()).toEqual({ kind: "restarting" });
      await r.clock.advance(999);
      expect(r.launcher.starts).toHaveLength(i + 1);
      await r.clock.advance(1);
      expect(r.launcher.starts).toHaveLength(i + 2);
    }
    expect(r.log.filter((l) => l === "[server] stopped after its start; starting again in 1 s")).toHaveLength(6);
    expect(failureLines(r)).toEqual([]);
    expect(r.log.some((l) => l.startsWith("[server] gave up"))).toBe(false);
  });

  // @spec DESK-SHELL-SRV-024
  it("clears the count of failures at start when a server runs past its start", async () => {
    const r = rig();
    r.sup.start();
    await failLast(r);
    await r.clock.advance(1000);
    await failLast(r);
    await r.clock.advance(5000);
    r.answer = own(r);
    const child = await spawnLast(r);
    await r.clock.advance(61_000);
    child.exit(1);
    await r.clock.advance(1000);
    expect(r.log).toContain("[server] stopped after its start; starting again in 1 s");
    r.answer = () => null;
    await failLast(r);
    expect(failureLines(r).at(-1)).toBe("[server] failure at start 1 of 3; starting again in 1 s");
    expect(r.sup.state()).toEqual({ kind: "restarting" });
  });
});

describe("the reason for giving up", () => {
  const texts: [string, string, string][] = [
    ["the server's own handler on a node:sqlite error", SQLITE_TEXT, "[server] stopping on an error outside the request handlers: Error: database is locked"],
    ["an uncaught error at load", EACCES_TEXT, "Error: EACCES: permission denied, open 'x'"],
    ["a bundle without node-simconnect", NOLIB_TEXT, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'node-simconnect' imported from C:\\x\\server.mjs"],
  ];
  // @spec DESK-SHELL-SRV-035, DESK-SHELL-LOG-002
  it.each(texts)("is the server's last error line: %s", async (_name, text, reason) => {
    const r = rig();
    await giveUpByExits(r, chunks(text), chunks(text));
    expect(r.sup.state()).toEqual({ kind: "given-up", reason });
    expect(r.log).toContain(`[server] gave up: ${reason}`);
    expect(r.serverLog).toContain(`[stderr] ${reason}`);
    expect(r.serverLog.some((l) => l.includes("\r"))).toBe(false);
  });

  // @spec DESK-SHELL-SRV-035
  it("takes the error line from the last server process alone", async () => {
    const r = rig();
    await giveUpByExits(r, [], chunks(EACCES_TEXT));
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: DID_NOT_START });
  });

  // @spec DESK-SHELL-SRV-035, DESK-SHELL-SRV-027
  it("puts its own reason before the server's last error line", async () => {
    const r = rig();
    r.sup.start();
    await failLast(r, 1, ["Error: first\n"]);
    await r.clock.advance(1000);
    await failLast(r, 1, ["Error: second\n"]);
    await r.clock.advance(5000);
    // The third becomes ready, writes an error line, then stops answering.
    let first = true;
    r.answer = (): Answer => {
      if (!first) return null;
      first = false;
      return own(r, "opening")();
    };
    const child = await spawnLast(r);
    child.stderr("Error: third\n");
    await r.clock.advance(90_000);
    expect(child.killed).toBe(true);
    await flush();
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "The server stopped responding" });
    expect(r.log).toContain("[server] gave up: The server stopped responding");
  });

  // @spec DESK-SHELL-SRV-035
  it("skips blank, indented and framing lines when taking the last error line", async () => {
    const r = rig();
    const text = "Error: the real one\r\n{\r\n[\r\n]\r\n(\r\n)\r\n}  \r\n   \r\n\tat somewhere\r\n\r\nNode.js v24.22.0\r\n";
    await giveUpByExits(r, chunks(text));
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "Error: the real one" });
  });

  // @spec DESK-SHELL-SRV-035, DESK-SHELL-LOG-005
  it("takes a last error line written without a line break, held until the exit", async () => {
    const r = rig();
    await giveUpByExits(r, ["Error: an earlier line\nError: cut off at the ex", "it"]);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "Error: cut off at the exit" });
  });

  // @spec DESK-SHELL-SRV-035
  it("is 'The server did not start within 60 s' when nothing else applies", async () => {
    const r = rig();
    await giveUpByExits(r);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: "The server did not start within 60 s" });
  });
});

describe("Try again", () => {
  // @spec DESK-SHELL-SRV-036, DESK-SHELL-SRV-044
  it("starts the server at once with a fresh count and the earlier reasons cleared", async () => {
    const r = rig();
    // Given up for a held port with nothing answering: the shell's own reason.
    r.sup.start();
    await failLast(r, 10);
    await r.clock.advance(1000);
    await failLast(r, 10);
    await r.clock.advance(5000);
    await failLast(r, 10);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: `Port ${PORT} is in use by another program` });
    expect(r.launcher.starts).toHaveLength(3);

    r.sup.tryAgain();
    expect(r.launcher.starts).toHaveLength(4);
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });
    // No server has done its start-up work yet in this run: still a fresh run.
    expect(r.launcher.starts[3].options.args).toEqual([...ARGS, "--fresh-run"]);
    await failLast(r);
    expect(failureLines(r).at(-1)).toBe("[server] failure at start 1 of 3; starting again in 1 s");
    await r.clock.advance(1000);
    await failLast(r);
    await r.clock.advance(5000);
    await failLast(r);
    expect(r.sup.state()).toEqual({ kind: "given-up", reason: DID_NOT_START });
    expect(r.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-036
  it("does nothing unless given up", async () => {
    const r = rig();
    r.sup.tryAgain();
    expect(r.launcher.starts).toHaveLength(0);
    expect(r.sup.state()).toEqual({ kind: "not-started" });
    r.sup.start();
    r.sup.tryAgain();
    expect(r.launcher.starts).toHaveLength(1);
    await failLast(r);
    r.sup.tryAgain(); // restarting
    await flush();
    expect(r.launcher.starts).toHaveLength(1);
    await r.clock.advance(1000);
    r.answer = own(r);
    await spawnLast(r);
    r.sup.tryAgain(); // running
    await flush();
    expect(r.launcher.starts).toHaveLength(2);
    expect(r.sup.state()).toEqual({ kind: "running" });
  });
});

describe("a requested restart (exit code 12)", () => {
  // @spec DESK-SHELL-SRV-043, DESK-SHELL-SRV-021, DESK-SHELL-LOG-003
  it("starts the server again at once, counting nothing and clearing the count", async () => {
    const r = rig();
    r.sup.start();
    await failLast(r); // count 1
    await r.clock.advance(1000);
    r.answer = own(r);
    const child = await spawnLast(r);
    expect(r.dones).toEqual([{ requested: false }]);
    await r.clock.advance(5000);

    child.exit(12);
    await flush();
    expect(r.launcher.starts).toHaveLength(3); // at once: no time has passed
    expect(r.log).toContain("[server] exited with code 12");
    expect(r.log).toContain("[server] restart requested (exit code 12); starting again now");
    expect(r.exits.at(-1)).toEqual({ code: 12, requested: true });
    expect(failureLines(r)).toHaveLength(1);
    expect(r.sup.state()).toEqual({ kind: "starting", step: null });

    // Its next done is the requested one.
    const next = await spawnLast(r);
    expect(r.dones).toEqual([{ requested: false }, { requested: true }]);

    // The count was cleared: this failure is the first again.
    next.exit(1);
    await flush();
    expect(r.exits.at(-1)).toEqual({ code: 1, requested: false });
    expect(failureLines(r).at(-1)).toBe("[server] failure at start 1 of 3; starting again in 1 s");
    await r.clock.advance(1000);
    await spawnLast(r);
    expect(r.dones.at(-1)).toEqual({ requested: false });
  });
});

describe("staying out of the way", () => {
  // @spec DESK-SHELL-AWAY-005
  it("restarts by the rules while the sim is in use, never asking about it", async () => {
    const r = rig();
    r.facts.msfs = true;
    r.sup.start();
    await failLast(r);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(2);
    r.answer = own(r);
    const child = await spawnLast(r);
    await r.clock.advance(61_000);
    child.exit(1);
    await r.clock.advance(1000);
    expect(r.launcher.starts).toHaveLength(3);
    expect(r.facts.calls).not.toContain("msfsRunning");
  });
});
