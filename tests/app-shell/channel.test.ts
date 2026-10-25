/**
 * The private channel, the shutdown, the fresh run and the stop signals, through the server's real
 * process. The bundled entry is started with `fork`, so Node's IPC channel stands in for the
 * Electron utility process's own: the messages are the same. Stop signals cannot be delivered to a
 * process on Windows from outside, so the preload emits them inside the source entry's process.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { openEvents } from "../support/event-stream.ts";
import { makeDataFolder } from "../support/run-folder.ts";
import {
  checkpointAt,
  checkpointRowAt,
  killAllServers,
  killTestServers,
  launchServer,
  slowStalePort,
  writeCheckpointAt,
  type LaunchedServer,
  type ServerAct,
} from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const PROCESS = { timeout: 30_000 };
const READY = /^\[server\] ready$/;
const SHUTTING_DOWN = /^\[server\] shutting down\r?$/m;
const NOT_FOUND = { error: "not found" };
/** When casual mode went on in the checkpoints written below. */
const SINCE = Date.parse("2026-10-24T07:00:00.000Z");
const CASUAL_ON = { phase: "idle", pending: [], casual: { since: SINCE } };

const lockFile = (dir: string) => path.join(dir, "career.db.lock");
const dbFile = (dir: string) => path.join(dir, "career.db");
const SENTINEL = "2000-01-01T00:00:00.000Z";
/**
 * How far the server's clock may read behind this process's: on Windows each process's V8 clock is
 * calibrated on its own, and a write a moment after the request has been seen 1 ms "before" it.
 */
const CLOCK_SLACK_MS = 1000;

/** Set the checkpoint row's updated_at, while the server runs (WAL), when there is a row. */
function setUpdatedAt(dir: string, value: string): void {
  if (!fs.existsSync(dbFile(dir))) return;
  const db = new DatabaseSync(dbFile(dir));
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    db.prepare(`UPDATE tracker_state SET updated_at = ? WHERE id = 1`).run(value);
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  } finally {
    db.close();
  }
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ignoring = (msg: unknown) => `[server] ignoring a message on the private channel: ${JSON.stringify(msg)}`;
const exactLine = (line: string) => new RegExp(`^${escapeRe(line)}$`);
const trackerStatus = async (s: LaunchedServer) => (await fetch(`${s.base}/api/tracker`)).json();

/** A data folder with the fixture lists and, when given, a checkpoint already written. */
function folderWith(checkpoint?: object): string {
  const dir = makeDataFolder(runDir).dir;
  if (checkpoint) writeCheckpointAt(dir, checkpoint);
  return dir;
}

/** An airborne leg out of KPVD, times relative to T (epoch ms). */
function airborneCheckpoint(T: number) {
  const s = T / 1000;
  const last = {
    t: T + 60000, lat: 41.8, lon: -71.4, alt_ft: 1500, on_ground: false, gs_kts: 100, hdg_deg: 30,
    vs_fpm: 500, ias_kts: 95, g: 1, fuel_lb: 298, weight_lb: 2398, title: "Test Comanche", livery: "N1TC", atc_id: "N1TC",
  };
  return {
    phase: "airborne",
    sim: { title: "Test Comanche", livery: "N1TC", atc_id: "N1TC" },
    aircraft_id: null,
    leg: {
      origin: "KPVD", departed_at: T, touchdown_at: null, landings: [],
      track: [[41.7246, -71.4282, 55, s, 0, 0, 0, 300], [41.8, -71.4, 1500, s + 60, 100, 500, 95, 298]],
      fuel_start_lb: 300, weight_start_lb: 2400, max_alt_ft: 1500, max_gs_kts: 100,
      sim_departed_at: null, sim_touchdown_at: null, paused_ms: 0, touchdown_paused_ms: null,
    },
    pending: [],
    briefing: null,
    casual: null,
    last,
    lastGround: null,
    lastAirborne: { ...last },
    airborneSince: T,
    stopSince: null,
    message: null,
    message_at: null,
  };
}

/** Ask for a shutdown over the private channel; the exit, and how long it took from the request. */
async function shutDownOverChannel(s: LaunchedServer) {
  const asked = Date.now();
  s.send({ type: "shutdown" });
  const end = await s.exit();
  return { ...end, ms: Date.now() - asked };
}

/** The checkpoint's WAL file, after the exit: gone, or empty. */
const walClean = (dir: string) => {
  const wal = path.join(dir, "career.db-wal");
  return !fs.existsSync(wal) || fs.statSync(wal).size === 0;
};

describe("a running server's private channel", () => {
  let s: LaunchedServer;
  beforeAll(async () => {
    s = await launchServer({ entry: "bundled", shared: true });
    await s.waitForLine(READY);
  }, 30_000);

  // @spec APP-SRV-019, APP-SRV-022, LIVE-SAVE-004
  it("answers each save with saved and the same id once the checkpoint is written, changing nothing else", PROCESS, async () => {
    const from = s.messages().length;
    const ids: unknown[] = ["a", 7, null, { x: 1 }];
    for (const id of ids) {
      const what = `the checkpoint after the save with id ${JSON.stringify(id)}`;
      const before = await trackerStatus(s);
      // A time no write of the server's can give, so the answer shows that this save wrote.
      setUpdatedAt(s.dataFolder, SENTINEL);
      const asked = Date.now();
      s.send({ type: "save", id });
      const answer = await s.nextMessage((m) => m?.type === "saved" && isDeepStrictEqual(m.id, id));
      expect(answer).toStrictEqual({ type: "saved", id });
      const row = checkpointRowAt(s.dataFolder);
      expect(row, what).not.toBeNull();
      expect(row!.updated_at, what).not.toBe(SENTINEL);
      expect(Date.parse(row!.updated_at), what).toBeGreaterThanOrEqual(asked - CLOCK_SLACK_MS);
      expect(await trackerStatus(s)).toEqual(before);
    }
    // One answer per save, and nothing else.
    expect(s.messages().slice(from)).toStrictEqual(ids.map((id) => ({ type: "saved", id })));
  });

  // @spec APP-SRV-022
  it("writes out any other message with the exact line, answers none, and keeps running", PROCESS, async () => {
    const from = s.messages().length;
    const others: unknown[] = [{ type: "reboot", id: 1 }, { type: "save" }, "hello"];
    for (const msg of others) s.send(msg);
    // Messages are handled in order: the answer to this save comes after any answer to those.
    s.send({ type: "save", id: "after" });
    await s.nextMessage((m) => m?.type === "saved" && m.id === "after");
    for (const msg of others) await s.waitForLine(exactLine(ignoring(msg)));

    expect(s.messages().slice(from)).toStrictEqual([{ type: "saved", id: "after" }]);
    expect(s.child.exitCode).toBeNull();
    expect((await s.status()).ok).toBe(true);
    expect(s.output()).not.toMatch(SHUTTING_DOWN);
  });

  // @spec APP-SRV-022
  it("offers no save or shutdown over HTTP: each such POST gets the router's 404, and the server keeps running", PROCESS, async () => {
    const saved = checkpointRowAt(s.dataFolder);
    for (const p of ["/api/shutdown", "/api/save", "/api/tracker/save"]) {
      const res = await fetch(`${s.base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status, p).toBe(404);
      expect(await res.json(), p).toEqual(NOT_FOUND);
    }
    expect(checkpointRowAt(s.dataFolder)).toEqual(saved);
    expect(s.child.exitCode).toBeNull();
    expect((await s.status()).ok).toBe(true);
    expect(s.output()).not.toMatch(SHUTTING_DOWN);
  });
});

describe("saving during the start-up", () => {
  // @spec APP-SRV-019
  it("answers a save at once while the start is held in opening, before any database exists", PROCESS, async () => {
    const dataFolder = makeDataFolder(runDir).dir;
    // A lock naming a running process (this one) on a port that answers as another app after 1.5 s:
    // the server's stale check holds its start in `opening` until then, before it opens the database.
    const holder = await slowStalePort();
    fs.writeFileSync(lockFile(dataFolder), `${JSON.stringify({ pid: process.pid, port: holder.port })}\n`);
    try {
      const s = await launchServer({ entry: "bundled", dataFolder });
      expect((await s.status()).startup).toBe("opening");
      s.send({ type: "save", id: "held" });
      const answer = await s.nextMessage((m) => m?.type === "saved");
      expect(answer).toStrictEqual({ type: "saved", id: "held" });
      expect((await s.status()).startup).toBe("opening");
      expect(fs.existsSync(dbFile(dataFolder))).toBe(false);
      expect(s.output()).not.toContain("[server] start-up done");
    } finally {
      holder.close();
    }
  });
});

describe("shutting down over the private channel", () => {
  // @spec APP-SRV-016, LIVE-CASUAL-013, LIVE-SAVE-005
  it("exits 0 within 5 s, open event stream and all, having saved, closed the database and removed the lock, at any point of the start", PROCESS, async () => {
    /** Casual mode on, an event stream open: casual mode goes off in the final checkpoint. */
    const casualOn = async () => {
      const dataFolder = folderWith(CASUAL_ON);
      const s = await launchServer({ entry: "bundled", dataFolder });
      await s.waitForLine(READY);
      expect((await trackerStatus(s)).casual).toEqual({ since: new Date(SINCE).toISOString(), points: 0 });
      const events = await openEvents(s.base);
      try {
        expect(await events.until("status")).toMatchObject({ casual: { since: new Date(SINCE).toISOString() } });
        const end = await shutDownOverChannel(s);
        expect(end, s.output()).toMatchObject({ code: 0, signal: null });
        expect(end.ms).toBeLessThan(5000);
      } finally {
        events.close();
      }
      expect(s.output()).toMatch(SHUTTING_DOWN);
      expect(fs.existsSync(lockFile(dataFolder))).toBe(false);
      expect(walClean(dataFolder)).toBe(true);
      const cp = checkpointAt(dataFolder);
      expect(cp).not.toBeNull();
      expect(cp!.casual).toBeNull();
    };

    /** An airborne leg restored at start comes back in the final checkpoint as it was. */
    const airborne = async () => {
      const written = airborneCheckpoint(Date.now());
      const dataFolder = folderWith(written);
      const s = await launchServer({ entry: "bundled", dataFolder });
      await s.waitForLine(READY);
      expect((await trackerStatus(s)).phase).toBe("airborne");
      const end = await shutDownOverChannel(s);
      expect(end, s.output()).toMatchObject({ code: 0, signal: null });
      expect(end.ms).toBeLessThan(5000);
      expect(fs.existsSync(lockFile(dataFolder))).toBe(false);
      expect(walClean(dataFolder)).toBe(true);
      const cp = checkpointAt(dataFolder);
      expect(cp?.phase).toBe("airborne");
      expect(cp?.leg).toEqual(written.leg);
      expect(cp?.pending).toEqual([]);
    };

    /** Held in `opening` by a lock it is still judging: no database is opened, the lock is left alone. */
    const held = async () => {
      const dataFolder = makeDataFolder(runDir).dir;
      const holder = await slowStalePort();
      const lockText = `${JSON.stringify({ pid: process.pid, port: holder.port })}\n`;
      fs.writeFileSync(lockFile(dataFolder), lockText);
      try {
        const s = await launchServer({ entry: "bundled", dataFolder });
        expect((await s.status()).startup).toBe("opening");
        const end = await shutDownOverChannel(s);
        expect(end, s.output()).toMatchObject({ code: 0, signal: null });
        expect(end.ms).toBeLessThan(5000);
        expect(s.output()).toMatch(SHUTTING_DOWN);
        expect(s.output()).not.toContain("[server] start-up done");
        expect(fs.existsSync(dbFile(dataFolder))).toBe(false);
        expect(fs.readFileSync(lockFile(dataFolder), "utf8")).toBe(lockText);
      } finally {
        holder.close();
      }
    };

    await Promise.all([casualOn(), airborne(), held()]);
  });
});

describe("the fresh run", () => {
  // @spec APP-SRV-011, LIVE-CASUAL-015
  it("starts with casual mode off and written off by the time the start-up is done with --fresh-run, and keeps it on without", PROCESS, async () => {
    const run = async (args: string[]) => {
      const dataFolder = folderWith(CASUAL_ON);
      const s = await launchServer({ entry: "bundled", dataFolder, args });
      await s.waitForStatus((st) => st.startup === "done");
      return { tracker: (await trackerStatus(s)).casual, checkpoint: checkpointAt(dataFolder)?.casual };
    };
    const [fresh, kept] = await Promise.all([run(["--fresh-run"]), run([])]);

    expect(fresh.tracker).toBeNull();
    expect(fresh.checkpoint).toBeNull();
    expect(kept.tracker).toEqual({ since: new Date(SINCE).toISOString(), points: 0 });
    expect(kept.checkpoint).toEqual({ since: SINCE });
  });
});

describe("the stop signals", () => {
  // @spec APP-SRV-018, LIVE-CASUAL-013, LIVE-SAVE-005
  it("shut a copy run from source down on each of the four, exit 0, leave casual mode on and remove the lock", PROCESS, async () => {
    const stop = async (act: ServerAct, checkpoint: object) => {
      const dataFolder = folderWith(checkpoint);
      const s = await launchServer({ entry: "source", dataFolder, act });
      const end = await s.exit();
      expect(end, `${act}:\n${s.output()}`).toMatchObject({ code: 0, signal: null });
      expect(s.output(), act).toMatch(/^\[server\] ready\r?$/m);
      expect(s.output(), act).toMatch(SHUTTING_DOWN);
      expect(fs.existsSync(lockFile(dataFolder)), act).toBe(false);
      return checkpointAt(dataFolder);
    };
    const written = airborneCheckpoint(Date.now());
    const [sigint, sigbreak, sighup, sigterm, leg] = await Promise.all([
      stop("SIGINT", CASUAL_ON),
      stop("SIGBREAK", CASUAL_ON),
      stop("SIGHUP", CASUAL_ON),
      stop("SIGTERM", CASUAL_ON),
      stop("SIGINT", written),
    ]);

    for (const [sig, cp] of [["SIGINT", sigint], ["SIGBREAK", sigbreak], ["SIGHUP", sighup], ["SIGTERM", sigterm]] as const) {
      expect(cp?.casual, sig).toEqual({ since: SINCE });
    }
    expect(leg?.phase).toBe("airborne");
    expect(leg?.leg).toEqual(written.leg);
    expect(leg?.pending).toEqual([]);
  });

  // @spec APP-SRV-018
  it("are not handled by the bundled server, which keeps running", PROCESS, async () => {
    const s = await launchServer({ entry: "bundled", act: "SIGINT" });
    await s.waitForLine(READY);
    // The preload writes this once the emit has returned. A stop handler starts its shutdown inside
    // the emit, writing `[server] shutting down` first, so it would be out before this line.
    await s.waitForLine(/^\[server-preload\] emitted SIGINT$/);
    expect(s.output()).not.toMatch(SHUTTING_DOWN);
    expect(s.child.exitCode).toBeNull();
    expect((await s.status()).ready).toBe(true);
  });
});
