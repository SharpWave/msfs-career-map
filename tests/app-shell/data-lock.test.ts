/**
 * The data folder's lock (career.db.lock): taken exclusively, judged live or stale, taken over when
 * stale, and refused when live. First in process with lock.ts and stand-in servers, then between
 * real server processes.
 *
 * A live holder's pid here is `process.ppid`, the Vitest main process: it is running and it is not
 * this process. A lock naming `process.pid` is stale by rule.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { allowOrigin } from "../support/fetch-guard.ts";
import { makeDataFolder } from "../support/run-folder.ts";
import {
  deadPid,
  heldPort,
  killAllServers,
  killTestServers,
  launchServer,
  lockAt,
  lockContenders,
  silentPort,
  type LaunchedServer,
} from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const PROCESS = { timeout: 30_000 };
/** The lock this process takes in the in-process tests. Its port is never asked. */
const ME = { pid: process.pid, port: 45_999 };
const meText = `{"pid":${ME.pid},"port":${ME.port}}\n`;

const newFolder = () => fs.mkdtempSync(path.join(runDir, "lock-"));
const lockFile = (dir: string) => path.join(dir, "career.db.lock");
const writeLock = (dir: string, info: { pid: number; port: number }) => {
  const text = `${JSON.stringify(info)}\n`;
  fs.writeFileSync(lockFile(dir), text);
  return text;
};
const inUse = (pid: number, port: number) =>
  `Another MSFS Career Map server (process ${pid}, port ${port}) is using this data folder`;

/** What a server's /api/status says about itself, as far as the lock looks. */
const statusOf = (pid: number, dataFolder: string, app = "msfs-career-map") => ({
  ok: true, app, version: "0.0.0", pid, dataFolder, sim: "off", startup: "done", ready: true,
});

interface Stub {
  port: number;
  base: string;
  /** Requests it has had. */
  requests: number;
  close(): void;
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/**
 * A stand-in server answering GET /api/status with `answer()`, after `delayMs`, on 127.0.0.1, let
 * through the fetch guard.
 */
async function statusStub(answer: () => unknown, delayMs = 0): Promise<Stub> {
  const stub: Stub = { port: 0, base: "", requests: 0, close: () => {} };
  const srv = http.createServer((req, res) => {
    stub.requests++;
    if (req.method !== "GET" || req.url !== "/api/status") {
      res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    const reply = () => {
      if (!res.destroyed) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer()));
    };
    if (delayMs > 0) setTimeout(reply, delayMs);
    else reply();
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  stub.port = (srv.address() as AddressInfo).port;
  stub.base = `http://127.0.0.1:${stub.port}`;
  const disallow = allowOrigin(stub.base);
  stub.close = () => {
    disallow();
    srv.closeAllConnections();
    srv.close();
  };
  cleanups.push(stub.close);
  return stub;
}

/** Lets a bare port through the fetch guard for this test. */
const allowPort = (port: number) => cleanups.push(allowOrigin(`http://127.0.0.1:${port}`));

const lockModule = () => import("../../src/server/lock.ts");

describe("the lock, in process", () => {
  // @spec APP-DATA-007
  it("takes a free folder with an exclusive file naming its pid and port", async () => {
    const { LOCK_FILE, liveHolder, takeLock } = await lockModule();
    expect(LOCK_FILE).toBe("career.db.lock");
    const dir = newFolder();
    expect(await liveHolder(dir)).toBeNull();
    const lock = await takeLock(dir, ME);
    expect(lock.file).toBe(lockFile(dir));
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(meText);
    lock.release();
  });

  // @spec APP-DATA-007, APP-DATA-008
  it("refuses a folder a live server holds, naming it, and leaves its lock alone", async () => {
    const { FolderInUse, liveHolder, takeLock } = await lockModule();
    const dir = newFolder();
    const stub = await statusStub(() => statusOf(process.ppid, dir));
    const text = writeLock(dir, { pid: process.ppid, port: stub.port });

    expect(await liveHolder(dir)).toEqual({ pid: process.ppid, port: stub.port });
    const err = await takeLock(dir, ME).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FolderInUse);
    expect((err as Error).message).toBe(inUse(process.ppid, stub.port));
    expect((err as InstanceType<typeof FolderInUse>).holder).toEqual({ pid: process.ppid, port: stub.port });
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(text);
  });

  // @spec APP-DATA-007
  it.runIf(process.platform === "win32")("compares data folders case-insensitively on Windows, after resolving them", async () => {
    const { liveHolder } = await lockModule();
    const dir = newFolder();
    const stub = await statusStub(() => statusOf(process.ppid, `${dir.toUpperCase()}${path.sep}`));
    writeLock(dir, { pid: process.ppid, port: stub.port });
    expect(await liveHolder(dir)).toEqual({ pid: process.ppid, port: stub.port });
  });

  // @spec APP-DATA-007, APP-DATA-008
  it("refuses a live holder's folder reached through a junction, the same folder under another spelling", async () => {
    const { FolderInUse, liveHolder, takeLock } = await lockModule();
    const dir = newFolder();
    const link = path.join(runDir, `lock-junction-${path.basename(dir)}`);
    fs.symlinkSync(dir, link, "junction");
    // Removes the junction itself, never what it leads to.
    cleanups.push(() => fs.unlinkSync(link));
    // The holder names its folder by its own spelling; the new server knows it by the junction.
    const stub = await statusStub(() => statusOf(process.ppid, dir));
    const text = writeLock(dir, { pid: process.ppid, port: stub.port });

    expect(await liveHolder(link)).toEqual({ pid: process.ppid, port: stub.port });
    const err = await takeLock(link, ME).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FolderInUse);
    expect((err as Error).message).toBe(inUse(process.ppid, stub.port));
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(text);
  });

  // @spec APP-DATA-007, APP-DATA-008
  it("refuses a busy holder: a running process whose port accepts the connection but has not answered in time", async () => {
    const { FolderInUse, liveHolder, takeLock } = await lockModule();
    const dir = newFolder();
    const silent = await silentPort();
    cleanups.push(silent.close);
    allowPort(silent.port);
    const text = writeLock(dir, { pid: process.ppid, port: silent.port });

    const t0 = Date.now();
    expect(await liveHolder(dir, { timeoutMs: 300 })).toEqual({ pid: process.ppid, port: silent.port });
    // It waited for the answer the timeout allows, and no longer than the plain connection takes.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
    expect(Date.now() - t0).toBeLessThan(1500);
    const err = await takeLock(dir, ME, { timeoutMs: 300 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FolderInUse);
    expect((err as Error).message).toBe(inUse(process.ppid, silent.port));
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(text);
  });

  /** Each sets up a stale lock in `dir`; `check` runs after the takeover. */
  const staleCases: [string, (dir: string) => Promise<{ check?: () => void }>][] = [
    ["a server on another data folder", async (dir) => {
      const stub = await statusStub(() => statusOf(process.ppid, newFolder()));
      writeLock(dir, { pid: process.ppid, port: stub.port });
      return {};
    }],
    ["a server with another pid", async (dir) => {
      const stub = await statusStub(() => statusOf(process.pid, dir));
      writeLock(dir, { pid: process.ppid, port: stub.port });
      return {};
    }],
    ["another app on the port", async (dir) => {
      const stub = await statusStub(() => statusOf(process.ppid, dir, "some-other-app"));
      writeLock(dir, { pid: process.ppid, port: stub.port });
      return {};
    }],
    ["a running process whose port nothing listens on", async (dir) => {
      const gone = await heldPort();
      gone.close();
      allowPort(gone.port);
      writeLock(dir, { pid: process.ppid, port: gone.port });
      return {};
    }],
    ["a process no longer running, judged without any request", async (dir) => {
      const dead = await deadPid();
      // Another folder: should Windows give the pid to a new process meanwhile, the lock is still stale.
      const stub = await statusStub(() => statusOf(dead, newFolder()));
      writeLock(dir, { pid: dead, port: stub.port });
      return { check: () => expect(stub.requests).toBe(0) };
    }],
    ["this process's own pid", async (dir) => {
      const stub = await statusStub(() => statusOf(process.pid, dir));
      writeLock(dir, { pid: process.pid, port: stub.port });
      return {};
    }],
    ["a file that is not a lock", async (dir) => {
      fs.writeFileSync(lockFile(dir), "not a lock at all");
      return {};
    }],
  ];

  // @spec APP-DATA-007
  it.each(staleCases)("takes over a stale lock: %s", async (_name, setUp) => {
    const { liveHolder, takeLock } = await lockModule();
    const dir = newFolder();
    const { check } = await setUp(dir);
    const t0 = Date.now();
    expect(await liveHolder(dir, { timeoutMs: 300 })).toBeNull();
    // The timeout given is the one used (2 s by default).
    expect(Date.now() - t0).toBeLessThan(1500);
    const lock = await takeLock(dir, ME, { timeoutMs: 300 });
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(meText);
    check?.();
    lock.release();
  });

  // @spec APP-DATA-007, APP-DATA-008
  it("judges a lock again when another server takes it over first, and refuses a live one", async () => {
    const { FolderInUse, takeLock } = await lockModule();
    const dir = newFolder();
    const s2 = await statusStub(() => statusOf(process.ppid, dir));
    const s2Text = `{"pid":${process.ppid},"port":${s2.port}}\n`;
    // S1 is stale (another folder); while it answers, a live server S2 takes the folder.
    const s1 = await statusStub(() => {
      fs.writeFileSync(lockFile(dir), s2Text);
      return statusOf(process.ppid, newFolder());
    });
    writeLock(dir, { pid: process.ppid, port: s1.port });

    const err = await takeLock(dir, ME).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FolderInUse);
    expect((err as InstanceType<typeof FolderInUse>).holder).toEqual({ pid: process.ppid, port: s2.port });
    expect((err as Error).message).toBe(inUse(process.ppid, s2.port));
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(s2Text);
  });

  // @spec APP-DATA-007, APP-DATA-008
  it("waits up to its 2 s for an answer: a live server that answers after 0.7 s still holds the folder", async () => {
    const { FolderInUse, liveHolder, takeLock } = await lockModule();
    const dir = newFolder();
    const stub = await statusStub(() => statusOf(process.ppid, dir), 700);
    const text = writeLock(dir, { pid: process.ppid, port: stub.port });

    const t0 = Date.now();
    expect(await liveHolder(dir)).toEqual({ pid: process.ppid, port: stub.port });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(650);
    const err = await takeLock(dir, ME).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FolderInUse);
    expect((err as Error).message).toBe(inUse(process.ppid, stub.port));
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(text);
  });

  // @spec APP-DATA-007
  it("gives up after 3 takeovers of a stale lock that keeps changing, leaving the file to the server writing it", async () => {
    const { FolderInUse, takeLock } = await lockModule();
    const dir = newFolder();
    // A stale holder (another folder) that writes the lock afresh, in a new text, each time it is asked.
    let writes = 0;
    const stub: Stub = await statusStub(() => {
      writes++;
      fs.writeFileSync(lockFile(dir), `${JSON.stringify({ pid: process.ppid, port: stub.port })}${" ".repeat(writes)}\n`);
      return statusOf(process.ppid, newFolder());
    });
    writeLock(dir, { pid: process.ppid, port: stub.port });

    const err = await takeLock(dir, ME, { timeoutMs: 1000 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FolderInUse);
    expect((err as Error).message).toMatch(/^cannot take .*career\.db\.lock: it keeps changing$/);
    // Each try met a file changed since it was read; the takeover never wrote this process's lock.
    expect(writes).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(lockFile(dir), "utf8")).not.toBe(meText);
    expect(JSON.parse(fs.readFileSync(lockFile(dir), "utf8"))).toEqual({ pid: process.ppid, port: stub.port });
  });

  // @spec APP-DATA-007
  it("releases its own lock, more than once without harm, and never one naming another pid", async () => {
    const { takeLock } = await lockModule();
    const dir = newFolder();
    const lock = await takeLock(dir, ME);
    lock.release();
    expect(fs.existsSync(lockFile(dir))).toBe(false);
    expect(() => lock.release()).not.toThrow();

    const again = await takeLock(dir, ME);
    const otherText = `{"pid":${process.ppid},"port":45998}\n`;
    fs.writeFileSync(lockFile(dir), otherText);
    again.release();
    expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(otherText);
  });
});

describe("the lock, between server processes", () => {
  let a: LaunchedServer;
  beforeAll(async () => {
    a = await launchServer({ entry: "bundled", shared: true });
    await a.waitForLine(/^\[server\] ready$/);
  }, 30_000);

  // @spec APP-DATA-008, APP-DATA-007, APP-SRV-014
  it("refuses to start on a folder a running server holds, after listening, naming that server", PROCESS, async () => {
    const before = fs.readFileSync(lockFile(a.dataFolder), "utf8");
    expect(lockAt(a.dataFolder)).toEqual({ pid: a.child.pid, port: a.port });

    const b = await launchServer({ entry: "bundled", dataFolder: a.dataFolder });
    expect(b.port).toBeGreaterThan(0);
    expect(await b.exit()).toEqual({ code: 1, signal: null });
    expect(b.lastErrorLine()).toBe(inUse(a.child.pid!, a.port));
    expect(b.output()).not.toContain("[server] start-up done");

    expect(fs.readFileSync(lockFile(a.dataFolder), "utf8")).toBe(before);
    expect(await a.status()).toMatchObject({ ok: true, pid: a.child.pid, ready: true });
  });

  // @spec APP-DATA-007
  it("takes over the lock of a process no longer running, without asking its port", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    const dead = await deadPid();
    // Another folder: should Windows give the pid to a new process meanwhile, the lock is still stale.
    const stub = await statusStub(() => statusOf(dead, newFolder()));
    writeLock(dir, { pid: dead, port: stub.port });

    const s = await launchServer({ entry: "bundled", dataFolder: dir });
    await s.waitForLine(/^\[server\] start-up done$/);
    expect(lockAt(dir)).toEqual({ pid: s.child.pid, port: s.port });
    expect(stub.requests).toBe(0);
  });

  // @spec APP-DATA-007
  it("takes over a lock naming a running server that uses another data folder", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    const aLock = fs.readFileSync(lockFile(a.dataFolder), "utf8");
    writeLock(dir, { pid: a.child.pid!, port: a.port });

    const d = await launchServer({ entry: "bundled", dataFolder: dir });
    await d.waitForLine(/^\[server\] start-up done$/);
    expect(lockAt(dir)).toEqual({ pid: d.child.pid, port: d.port });
    expect(fs.readFileSync(lockFile(a.dataFolder), "utf8")).toBe(aLock);
    expect((await a.status()).pid).toBe(a.child.pid);
  });

  // @spec APP-DATA-008, APP-DATA-007, APP-SRV-014
  it("refuses to start on a folder whose holder runs and accepts on its port but does not answer in 2 s", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    // This process stands for a server whose main thread is busy: running, its port accepting.
    const silent = await silentPort();
    try {
      const text = writeLock(dir, { pid: process.pid, port: silent.port });
      const b = await launchServer({ entry: "bundled", dataFolder: dir });
      expect(await b.exit()).toEqual({ code: 1, signal: null });
      expect(b.lastErrorLine()).toBe(inUse(process.pid, silent.port));
      expect(b.output()).not.toContain("[server] start-up done");
      expect(fs.existsSync(path.join(dir, "career.db"))).toBe(false);
      expect(fs.readFileSync(lockFile(dir), "utf8")).toBe(text);
    } finally {
      silent.close();
    }
  });
});

describe("the lock, taken over by two processes at once", () => {
  const FOLDERS = 25;

  // @spec APP-DATA-007, APP-DATA-008
  it("gives each stale lock to exactly one of two processes taking it over at the same moment", { timeout: 60_000 }, async () => {
    const dead = await deadPid();
    const folders = Array.from({ length: FOLDERS }, () => {
      const dir = newFolder();
      writeLock(dir, { pid: dead, port: 1 });
      return dir;
    });
    const [first, second] = await lockContenders(folders, { spacingMs: 120 });

    // They raced: in most folders both began within a few ms of the moment.
    const together = folders.filter((_, i) => first[i].lateMs < 20 && second[i].lateMs < 20).length;
    expect(together, "the contenders did not start their takeovers together").toBeGreaterThanOrEqual(FOLDERS / 2);
    const outcomes = folders.map((dir, i) => {
      const winners = [first[i], second[i]].filter((r) => r.got);
      return {
        winners: winners.length,
        lockNamesWinner: winners.length === 1 && lockAt(dir)?.pid === winners[0].pid,
        loser: [first[i], second[i]].find((r) => !r.got)?.err,
      };
    });
    expect(outcomes).toEqual(
      folders.map(() => ({ winners: 1, lockNamesWinner: true, loser: expect.stringMatching(/^Another MSFS Career Map server|keeps changing$/) })),
    );
    // Nothing is left beside the lock: every renamed copy was deleted or put back.
    for (const dir of folders) expect(fs.readdirSync(dir)).toEqual(["career.db.lock"]);
  });
});
