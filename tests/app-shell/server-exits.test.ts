/**
 * The ways the server started as a process ends on its own: an input missing or empty, a port it
 * cannot have, a data folder or database it cannot use, and an error outside its request handlers.
 * Every launch here passes `waitForListening: false` and awaits the exit.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { makeDataFolder } from "../support/run-folder.ts";
import {
  excludedPort,
  heldPort,
  killAllServers,
  killTestServers,
  launchServer,
  lockAt,
  type LaunchOptions,
  type ServerAct,
  type ServerEntry,
} from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const PROCESS = { timeout: 30_000 };
const LISTENING = /\[server\] listening on /;

/** A path in the run folder that does not exist yet (its parent does). */
const absentFolder = () => path.join(fs.mkdtempSync(path.join(runDir, "exits-")), "data");

/** Launches without waiting for the listening line, and waits for the exit. */
async function run(o: LaunchOptions, exitMs?: number) {
  const s = await launchServer({ ...o, waitForListening: false });
  const exit = await s.exit(exitMs);
  return { s, exit };
}

describe("an input missing or empty (bundled form)", () => {
  // @spec APP-SRV-006, APP-SRV-014, LIVE-LINK-012
  it("exits 1 for each required argument left out, naming it, before it listens or creates anything", PROCESS, async () => {
    // Everything a copy run from source would fall back on, all of it set, none of it read.
    const elsewhere = fs.mkdtempSync(path.join(runDir, "elsewhere-"));
    const env = {
      CAREER_DB: path.join(elsewhere, "career.db"),
      PORT: "0",
      TRACKER_FAKE: "1",
      SIMCONNECT_HOST: "192.0.2.1",
      SIMCONNECT_PORT: "500",
    };
    const cases: [string, string][] = [
      ["--data", "Cannot start: no --data given"],
      ["--program", "Cannot start: no --program given"],
      ["--port", "Cannot start: no --port given"],
      ["--backups", "Cannot start: no --backups or --backups-documents given"],
      ["--sim", "Cannot start: no --sim given"],
      ["--airport-downloads", "Cannot start: no --airport-downloads given"],
    ];
    const runs = await Promise.all(
      cases.map(async ([name, line]) => {
        const dataFolder = absentFolder();
        return { name, line, dataFolder, ...(await run({ entry: "bundled", omit: [name], dataFolder, env })) };
      }),
    );
    for (const r of runs) {
      expect(r.exit, r.name).toEqual({ code: 1, signal: null });
      expect(r.s.lastErrorLine(), r.name).toBe(r.line);
      expect(r.s.output(), r.name).not.toMatch(LISTENING);
      expect(fs.existsSync(r.dataFolder), r.name).toBe(false);
    }
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  // @spec APP-SRV-006, APP-SRV-014
  it("exits 1 for an argument given with an empty value or none, never taking it as a default", PROCESS, async () => {
    const cases: [string, string][] = [
      ["--data=", "Cannot start: --data needs a value"],
      ["--sim", "Cannot start: --sim needs a value"],
    ];
    const runs = await Promise.all(
      cases.map(async ([arg, line]) => {
        const dataFolder = absentFolder();
        return { arg, line, dataFolder, ...(await run({ entry: "bundled", args: [arg], dataFolder })) };
      }),
    );
    for (const r of runs) {
      expect(r.exit, r.arg).toEqual({ code: 1, signal: null });
      expect(r.s.lastErrorLine(), r.arg).toBe(r.line);
      expect(r.s.output(), r.arg).not.toMatch(LISTENING);
      expect(fs.existsSync(r.dataFolder), r.arg).toBe(false);
    }
  });
});

describe("a port, data folder or database it cannot use", () => {
  // @spec APP-SRV-013, APP-SRV-014
  it("exits 10 for a port in use, and 1 for a data folder it cannot create or a database it cannot open", PROCESS, async () => {
    const held = await heldPort();
    try {
      const portFolder = absentFolder();

      const file = path.join(fs.mkdtempSync(path.join(runDir, "exits-")), "a-file");
      fs.writeFileSync(file, "not a folder");
      const underFile = path.join(file, "sub");

      const dbFolder = makeDataFolder(runDir).dir;
      fs.mkdirSync(path.join(dbFolder, "career.db"));

      const [inUse, folder, database] = await Promise.all([
        run({ entry: "bundled", dataFolder: portFolder, args: [`--port=${held.port}`] }),
        run({ entry: "bundled", dataFolder: underFile }),
        run({ entry: "bundled", dataFolder: dbFolder }),
      ]);

      expect(inUse.exit).toEqual({ code: 10, signal: null });
      expect(inUse.s.lastErrorLine()).toBe(`Port ${held.port} is already in use`);
      expect(inUse.s.output()).not.toMatch(LISTENING);
      expect(fs.existsSync(portFolder)).toBe(false);

      // It listens first, then fails on the folder.
      expect(folder.exit).toEqual({ code: 1, signal: null });
      expect(folder.s.output()).toMatch(LISTENING);
      expect(folder.s.lastErrorLine().startsWith(`Cannot start: cannot use the data folder ${path.resolve(underFile)}: `)).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe("not a folder");

      expect(database.exit).toEqual({ code: 1, signal: null });
      expect(database.s.output()).toMatch(LISTENING);
      expect(
        database.s.lastErrorLine().startsWith(`Cannot start: cannot open the database ${path.join(path.resolve(dbFolder), "career.db")}: `),
        database.s.lastErrorLine(),
      ).toBe(true);
      expect(fs.existsSync(path.join(dbFolder, "career.db.lock"))).toBe(false);
      expect(fs.readdirSync(path.join(dbFolder, "career.db"))).toEqual([]);
    } finally {
      held.close();
    }
  });

  // @spec APP-SRV-013
  it.skipIf(excludedPort() === null)("exits 11 for a port Windows refuses, trying no other", PROCESS, async () => {
    const port = excludedPort()!;
    const dataFolder = absentFolder();
    const { s, exit } = await run({ entry: "bundled", dataFolder, args: [`--port=${port}`] });
    expect(exit).toEqual({ code: 11, signal: null });
    expect(s.lastErrorLine()).toBe(`Windows refuses port ${port}`);
    expect(s.output()).not.toMatch(LISTENING);
    expect(fs.existsSync(dataFolder)).toBe(false);
  });
});

describe("an error outside the request handlers", () => {
  // The preload's own do-nothing listeners turn off Node's handling (write the stack, exit 1), so
  // only the server's own uncaughtException and unhandledRejection handlers can end the process: a
  // server without them keeps running, and the wait for its exit fails.
  // @spec APP-SRV-020
  it("writes it out with its stack and exits 1 at once, saving nothing and leaving the lock", PROCESS, async () => {
    const cases: { entry: ServerEntry; act: ServerAct; message: string }[] = [
      { entry: "bundled", act: "uncaught", message: "test: an error outside the request handlers" },
      { entry: "bundled", act: "rejection", message: "test: a rejection outside the request handlers" },
      { entry: "source", act: "uncaught", message: "test: an error outside the request handlers" },
      { entry: "source", act: "rejection", message: "test: a rejection outside the request handlers" },
    ];
    const runs = await Promise.all(cases.map(async (c) => ({ ...c, ...(await run({ entry: c.entry, act: c.act }, 10_000)) })));
    for (const r of runs) {
      const what = `${r.entry} ${r.act}`;
      expect(r.exit, what).toEqual({ code: 1, signal: null });
      expect(r.s.output(), what).toMatch(/^\[server\] ready$/m);
      expect(r.s.stderr(), what).toContain(r.message);
      expect(r.s.stderr(), what).toMatch(/^ {4}at /m);
      expect(r.s.output(), what).not.toContain("[server] shutting down");
      expect(lockAt(r.s.dataFolder), what).toEqual({ pid: r.s.child.pid, port: r.s.port });
    }
  });
});
