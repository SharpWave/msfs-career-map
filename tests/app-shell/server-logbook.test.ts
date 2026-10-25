/**
 * The start-up work, backups and bringing in a logbook through the server's real process: the
 * status answering while the worker opens, backs up and upgrades a logbook (APP-SRV-010, APP-SRV-001);
 * a logbook it cannot back up before upgrading (APP-SRV-014, APP-BAK-010); backups over the private
 * channel (APP-BAK-001, APP-BAK-005); a shutdown during the start-up work (APP-SRV-016); and a
 * logbook brought in end to end — 202, exit 12, the swap at the next start, its icon served
 * (APP-IMP-003, APP-IMP-004, APP-IMP-005, APP-SRV-015).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { parseBackupName } from "../../src/server/backup.ts";
import { upgradeNeeded } from "../../src/server/schema.ts";
import { makeDataFolder } from "../support/run-folder.ts";
import { OLD_COLUMN, iconBytes, logbookIdOf, queryLogbook, schemaOf, someId, writeLogbook } from "../support/logbooks.ts";
import { REPO, killAllServers, killTestServers, launchServer, slowStalePort, type LaunchedServer } from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const PROCESS = { timeout: 60_000 };
const READY = /^\[server\] ready$/;
const VERSION: string = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
const dbFile = (dir: string) => path.join(dir, "career.db");
const filesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

/** An older logbook (a column the schema step adds missing) of about `mb` megabytes, with a fleet aircraft. */
async function oldLogbook(dir: string, mb: number, logbookId: string | null = someId(0x01d)) {
  await writeLogbook(dbFile(dir), { schema: "old", logbookId, aircraft: ["Old Cub"] });
  const db = new DatabaseSync(dbFile(dir));
  const insert = db.prepare(`INSERT INTO kv_cache (key, value, fetched_at) VALUES (?, ?, '')`);
  db.exec("BEGIN");
  const row = "x".repeat(4000);
  for (let i = 0; i < mb * 256; i++) insert.run(`filler-${i}`, row);
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

describe("the start-up work off the event loop (APP-SRV-010, APP-SRV-001)", () => {
  // @spec APP-SRV-010, APP-SRV-001, APP-BAK-010, APP-API-008, APP-API-004
  it("answers /api/status within 1 s throughout while it backs up and upgrades a large logbook, reporting each step", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    await oldLogbook(dir, 60);
    const s = await launchServer({ entry: "bundled", dataFolder: dir });
    const seen: string[] = [];
    let slowest = 0;
    let last: any = null;
    const end = Date.now() + 45_000;
    while (Date.now() < end) {
      const asked = Date.now();
      last = await s.status();
      slowest = Math.max(slowest, Date.now() - asked);
      if (seen.at(-1) !== last.startup) seen.push(last.startup);
      if (last.startup === "done") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(last.startup, s.output()).toBe("done");
    expect(slowest).toBeLessThan(1000);
    // In order, each at most once; the long steps are seen.
    const order = ["opening", "backing-up", "upgrading", "done"];
    expect(seen.map((x) => order.indexOf(x))).toEqual([...seen.map((x) => order.indexOf(x))].sort((a, b) => a - b));
    expect(seen).toContain("backing-up");
    expect(seen).toContain("done");
    expect(last.logbookId).toBe(someId(0x01d));

    const [backup] = filesIn(path.join(dir, "backups"));
    expect(parseBackupName(backup)).toMatchObject({ kind: `upgrade-${VERSION}`, logbookId: someId(0x01d) });
    await s.waitForLine(READY);
  });

  // @spec APP-API-004, APP-API-008, APP-DATA-006
  it("reports logbookId null while opening and the id it gave a new logbook once done", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    const holder = await slowStalePort();
    fs.writeFileSync(path.join(dir, "career.db.lock"), `${JSON.stringify({ pid: process.pid, port: holder.port })}\n`);
    try {
      const s = await launchServer({ entry: "bundled", dataFolder: dir });
      expect(await s.status()).toMatchObject({ startup: "opening", logbookId: null });
      const done = await s.waitForStatus((st) => st.startup === "done", 30_000);
      expect(done.logbookId).toMatch(/^[0-9a-f]{16}$/);
      expect(logbookIdOf(dbFile(dir))).toBe(done.logbookId);
    } finally {
      holder.close();
    }
  });
});

describe("a logbook it cannot back up before upgrading (APP-SRV-014, APP-BAK-010)", () => {
  // @spec APP-SRV-014, APP-BAK-010, APP-SRV-015
  it("leaves it unchanged, writes the reason as its last line and exits 1, its lock removed", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    await oldLogbook(dir, 1);
    const before = schemaOf(dbFile(dir));
    fs.writeFileSync(path.join(dir, "blocked"), "");
    fs.mkdirSync(path.join(dir, `career.before-${VERSION}.db.partial`));
    const s = await launchServer({ entry: "bundled", dataFolder: dir, args: [`--backups=${path.join(dir, "blocked", "Backups")}`] });
    const end = await s.exit(30_000);
    expect(end.code, s.output()).toBe(1);
    expect(s.lastErrorLine()).toMatch(/^Could not back up the logbook before upgrading it: the backup failed — .+: .+/);
    expect(schemaOf(dbFile(dir))).toEqual(before);
    expect(schemaOf(dbFile(dir))[OLD_COLUMN.table]).not.toContain(OLD_COLUMN.column);
    expect(fs.existsSync(path.join(dir, "career.db.lock"))).toBe(false);
  });
});

describe("backups over the private channel (APP-BAK-001, APP-BAK-005)", () => {
  let s: LaunchedServer;
  const ask = async (msg: { id: string; kind: string; version?: string }) => {
    s.send({ type: "backup", ...msg });
    return s.nextMessage((m) => (m?.type === "backup-done" || m?.type === "backup-failed") && m.id === msg.id, 30_000);
  };

  // @spec APP-BAK-001, APP-BAK-004
  it("takes a daily, an update and a quit backup, each answered with its full path and the request's id", PROCESS, async () => {
    s = await launchServer({ entry: "bundled" });
    await s.waitForLine(READY);
    const id = (await s.status()).logbookId;
    const backups = path.join(s.dataFolder, "backups");
    const daily = await ask({ id: "d1", kind: "daily" });
    expect(daily).toEqual({ type: "backup-done", id: "d1", file: expect.any(String) });
    expect(path.dirname(daily.file)).toBe(backups);
    expect(parseBackupName(path.basename(daily.file))).toMatchObject({ kind: "daily", logbookId: id });
    const update = await ask({ id: "u1", kind: "update", version: "1.2.3" });
    expect(parseBackupName(path.basename(update.file))).toMatchObject({ kind: "update-1.2.3", logbookId: id });
    const quit = await ask({ id: "q1", kind: "quit" });
    expect(parseBackupName(path.basename(quit.file))).toMatchObject({ kind: "quit", logbookId: id });
    for (const m of [daily, update, quit]) expect(fs.existsSync(m.file)).toBe(true);
    // Any progress sent carries its request's id.
    for (const m of s.messages() as any[]) if (m?.type === "backup-progress") expect(["d1", "u1", "q1"]).toContain(m.id);
  });

  // @spec APP-BAK-001, APP-BAK-008, APP-BAK-009
  it("answers backup-failed with both reasons, and takes an update backup into the data folder instead", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    fs.writeFileSync(path.join(dir, "blocked"), "");
    s = await launchServer({ entry: "bundled", dataFolder: dir, args: [`--backups=${path.join(dir, "blocked", "Backups")}`] });
    await s.waitForLine(READY);
    const failed = await ask({ id: "f1", kind: "daily" });
    expect(failed).toMatchObject({ type: "backup-failed", id: "f1", short: "the backup failed" });
    expect(failed.reason).toMatch(/^the backup failed — .+Backups: .+/);
    const update = await ask({ id: "u2", kind: "update", version: "2.0.0" });
    expect(update).toEqual({ type: "backup-done", id: "u2", file: path.join(dir, "career.before-update-2.0.0.db") });
  });

  // @spec APP-BAK-005, APP-BAK-001
  it("takes a backup asked for during the start-up work once that work is done", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    const holder = await slowStalePort();
    fs.writeFileSync(path.join(dir, "career.db.lock"), `${JSON.stringify({ pid: process.pid, port: holder.port })}\n`);
    try {
      s = await launchServer({ entry: "bundled", dataFolder: dir });
      expect((await s.status()).startup).toBe("opening");
      s.send({ type: "backup", id: "early", kind: "daily" });
      await new Promise((r) => setTimeout(r, 400));
      expect((s.messages() as any[]).filter((m) => m?.type === "backup-done")).toEqual([]);
      const done = await s.nextMessage((m) => m?.type === "backup-done" && m.id === "early", 30_000);
      expect((await s.status()).startup).toBe("done");
      expect(parseBackupName(path.basename(done.file))?.logbookId).toBe((await s.status()).logbookId);
    } finally {
      holder.close();
    }
  });

  // @spec APP-SRV-022, APP-BAK-001
  it("writes out a backup request of the wrong shape and answers nothing", PROCESS, async () => {
    s = await launchServer({ entry: "bundled" });
    await s.waitForLine(READY);
    const wrong = [{ type: "backup", id: "w1", kind: "weekly" }, { type: "backup", id: "w2", kind: "update" }];
    for (const m of wrong) s.send(m);
    for (const m of wrong) await s.waitForLine(new RegExp(`ignoring a message on the private channel: ${JSON.stringify(m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect((s.messages() as any[]).filter((m) => String(m?.id).startsWith("w"))).toEqual([]);
  });
});

describe("a shutdown during the start-up work (APP-SRV-016)", () => {
  // @spec APP-SRV-016, APP-DATA-005
  it("exits 0 within 5 s, leaving no unfinished backup and a logbook either as it was or upgraded whole", PROCESS, async () => {
    const dir = makeDataFolder(runDir).dir;
    await oldLogbook(dir, 60);
    const before = schemaOf(dbFile(dir));
    const s = await launchServer({ entry: "bundled", dataFolder: dir });
    await s.waitForStatus((st) => st.startup === "backing-up" || st.startup === "upgrading", 30_000);
    const asked = Date.now();
    s.send({ type: "shutdown" });
    const end = await s.exit(10_000);
    expect(end.code, s.output()).toBe(0);
    expect(Date.now() - asked).toBeLessThan(5500);
    expect(filesIn(path.join(dir, "backups")).filter((f) => f.endsWith(".partial"))).toEqual([]);
    expect(fs.existsSync(path.join(dir, "career.db.lock"))).toBe(false);
    const after = schemaOf(dbFile(dir));
    if (after[OLD_COLUMN.table].includes(OLD_COLUMN.column)) {
      const db = new DatabaseSync(dbFile(dir), { readOnly: true });
      try {
        expect(upgradeNeeded(db)).toBe(false);
      } finally {
        db.close();
      }
    } else {
      expect(after).toEqual(before);
    }
    expect(queryLogbook(dbFile(dir), `SELECT name FROM aircraft`)).toEqual([{ name: "Old Cub" }]);
  });
});

describe("a logbook brought in, end to end (APP-IMP-003, APP-IMP-004, APP-IMP-005, APP-SRV-015)", () => {
  // @spec APP-IMP-003, APP-IMP-004, APP-IMP-005, APP-SRV-015, APP-BAK-011
  it("answers 202, exits 12, and at the next start swaps the copy in with its icons, a new id and the outcome", PROCESS, async () => {
    const source = makeDataFolder(runDir).dir;
    await writeLogbook(dbFile(source), {
      logbookId: someId(0x50),
      aircraft: ["There Cub"],
      icons: { 0: iconBytes(50) },
      hops: [
        [0, "KPVD", "KBOS", "2026-09-01T10:00:00.000Z"],
        [0, "KBOS", "KORH", "2026-09-05T15:30:00.000Z"],
      ],
    });
    const dir = makeDataFolder(runDir).dir;
    const first = await launchServer({ entry: "bundled", dataFolder: dir, args: [`--offer=${source}`] });
    await first.waitForLine(READY);
    const firstId = (await first.status()).logbookId;
    const offer = await (await fetch(`${first.base}/api/logbook/offer`)).json();
    expect(offer.offers).toEqual([{ kind: "folder", folder: source, hops: 2, newestHop: "2026-09-05T15:30:00.000Z" }]);
    // Casual mode on here: the import's shutdown leaves it on, and the copy carries it.
    const casual = await fetch(`${first.base}/api/tracker/casual`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true }) });
    expect(casual.status).toBe(200);

    const res = await fetch(`${first.base}/api/logbook/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder: source }) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ restart: "automatic" });
    const end = await first.exit(15_000);
    expect(end.code, first.output()).toBe(12);
    expect(first.output()).toMatch(/\[server\] shutting down/);
    expect(fs.existsSync(path.join(dir, "career.db.lock"))).toBe(false);
    expect(filesIn(dir)).toEqual(expect.arrayContaining(["career.db.incoming", "career.db.incoming.json"]));

    const second = await launchServer({ entry: "bundled", dataFolder: dir });
    await second.waitForLine(READY);
    const st = await second.status();
    expect(st.logbookId).toMatch(/^[0-9a-f]{16}$/);
    expect(st.logbookId).not.toBe(firstId);
    expect(st.logbookId).not.toBe(someId(0x50));
    const hops = await (await fetch(`${second.base}/api/hops`)).json();
    expect(hops.map((h: { origin: string; dest: string }) => [h.origin, h.dest])).toEqual([
      ["KPVD", "KBOS"],
      ["KBOS", "KORH"],
    ]);
    const icon = await fetch(`${second.base}/images/aircraft-1.png`);
    expect(icon.status).toBe(200);
    expect(Buffer.from(await icon.arrayBuffer())).toEqual(iconBytes(50));
    const after = await (await fetch(`${second.base}/api/logbook/offer`)).json();
    expect(after.lastAttempt).toMatchObject({ outcome: "brought-in" });
    expect(after.offers).toEqual([]);
    const asideFiles = filesIn(dir).filter((f) => /^career\.before-import-\d{8}T\d{6}Z\.db$/.test(f));
    expect(asideFiles).toHaveLength(1);
    // @spec LIVE-CASUAL-013
    // The replaced logbook's final checkpoint kept casual mode on, and so does the logbook brought in.
    const [finalRow] = queryLogbook<{ json: string }>(path.join(dir, asideFiles[0]), `SELECT json FROM tracker_state WHERE id = 1`);
    expect(JSON.parse(finalRow.json).casual).not.toBeNull();
    expect((await (await fetch(`${second.base}/api/tracker`)).json()).casual).not.toBeNull();
    expect(filesIn(dir).filter((f) => f.startsWith("career.db.incoming"))).toEqual([]);
    // The source is left as it was.
    expect(queryLogbook(dbFile(source), `SELECT COUNT(*) AS n FROM hops`)).toEqual([{ n: 2 }]);
  });

  // @spec APP-IMP-003
  it("says a copy run from source must be started again by hand", PROCESS, async () => {
    const source = makeDataFolder(runDir).dir;
    await writeLogbook(dbFile(source), { logbookId: someId(0x51), aircraft: ["There Cub"], hops: [[0, "KPVD", "KBOS", null]] });
    const s = await launchServer({ entry: "source" });
    await s.waitForLine(READY);
    const res = await fetch(`${s.base}/api/logbook/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder: source }) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ restart: "manual" });
    expect((await s.exit(15_000)).code).toBe(12);
  });
});
