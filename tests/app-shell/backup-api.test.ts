/**
 * **Back up now**'s route against a test server (APP-BAK-002) and the order backups are taken in
 * (APP-BAK-005): one at a time, in the order asked for, held while held and abandoned at shutdown.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupQueue } from "../../src/server/backup-queue.ts";
import { parseBackupName } from "../../src/server/backup.ts";
import { currentInputs } from "../../src/server/inputs.ts";
import { readLogbookId } from "../../src/server/logbook-id.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { queryLogbook } from "../support/logbooks.ts";

describe("POST /api/backups (APP-BAK-002)", () => {
  let server: TestServer;
  let backups: string;
  let logbookId: string;

  beforeAll(async () => {
    server = await startTestServer();
    const { db } = await import("../../src/server/db.ts");
    logbookId = readLogbookId(db)!;
    backups = path.join(currentInputs().dataFolder, "backups");
  });
  afterAll(async () => {
    await server.close();
  });

  const post = () => fetch(`${server.base}/api/backups`, { method: "POST" });

  // @spec APP-BAK-002, APP-BAK-004
  it("backs the logbook up as the pilot's own copy and answers 201 with the file's name", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["file"]);
    expect(path.basename(body.file)).toBe(body.file);
    expect(parseBackupName(body.file)).toMatchObject({ kind: "manual", logbookId });
    const file = path.join(backups, body.file);
    expect(fs.existsSync(file)).toBe(true);
    expect(queryLogbook(file, `SELECT COUNT(*) AS n FROM backup_icons`)).toEqual([{ n: 0 }]);
  });

  // @spec APP-BAK-002, APP-BAK-008
  it("answers a failure with its status, the full reason and the short one", async () => {
    fs.rmSync(backups, { recursive: true, force: true });
    fs.writeFileSync(backups, "a file where the backups folder goes");
    try {
      const res = await post();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.short).toBe("the backup failed");
      expect(body.error.startsWith(`the backup failed — ${backups}: `)).toBe(true);
    } finally {
      fs.rmSync(backups, { force: true });
    }
  });

  // @spec APP-BAK-002, APP-API-012
  it("refuses a backup another site's page asks for", async () => {
    const res = await fetch(`${server.base}/api/backups`, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
  });
});

describe("the order backups are taken in (APP-BAK-005)", () => {
  /** A run function whose backups finish when the test says so. */
  function controlledRun() {
    const started: string[] = [];
    const finishers = new Map<string, { ok(file: string): void; fail(e: Error): void }>();
    const signals = new Map<string, AbortSignal>();
    const run = (job: { kind: string; signal: AbortSignal }) =>
      new Promise<string>((ok, fail) => {
        started.push(job.kind);
        signals.set(job.kind, job.signal);
        finishers.set(job.kind, { ok, fail });
      });
    return { run, started, finish: (kind: string) => finishers.get(kind)!.ok(`/backups/${kind}.db`), failWith: (kind: string, e: Error) => finishers.get(kind)!.fail(e), signals };
  }
  const tick = () => new Promise((r) => setTimeout(r, 5));

  // @spec APP-BAK-005
  it("takes them one at a time, in the order asked for, each answered with its own file", async () => {
    const c = controlledRun();
    const q = new BackupQueue(c.run);
    const a = q.request("daily");
    const b = q.request("update-1.2.0");
    const d = q.request("quit");
    await tick();
    expect(c.started).toEqual(["daily"]);
    c.finish("daily");
    expect(await a).toBe("/backups/daily.db");
    await tick();
    expect(c.started).toEqual(["daily", "update-1.2.0"]);
    c.failWith("update-1.2.0", new Error("refused"));
    await expect(b).rejects.toThrow("refused");
    await tick();
    expect(c.started).toEqual(["daily", "update-1.2.0", "quit"]);
    c.finish("quit");
    expect(await d).toBe("/backups/quit.db");
  });

  // @spec APP-BAK-005
  it("holds backups asked for while held — the start-up work, a logbook being brought in — and takes them once released", async () => {
    const c = controlledRun();
    const q = new BackupQueue(c.run);
    q.hold("start");
    const a = q.request("daily");
    await tick();
    expect(c.started).toEqual([]);
    q.hold("import");
    q.release("start");
    await tick();
    expect(c.started).toEqual([]);
    q.release("import");
    await tick();
    expect(c.started).toEqual(["daily"]);
    c.finish("daily");
    expect(await a).toBe("/backups/daily.db");
  });

  // @spec APP-BAK-005, APP-SRV-016
  it("abandons the backup under way and leaves those waiting unanswered at shutdown", async () => {
    const c = controlledRun();
    const q = new BackupQueue(c.run);
    const a = q.request("daily");
    const b = q.request("quit");
    let bSettled = false;
    b.then(() => (bSettled = true), () => (bSettled = true));
    a.catch(() => {});
    await tick();
    q.abandon();
    expect(c.signals.get("daily")!.aborted).toBe(true);
    await tick();
    expect(c.started).toEqual(["daily"]);
    expect(bSettled).toBe(false);
    // Asked for after the shutdown began: never taken either.
    q.request("manual").catch(() => {});
    await tick();
    expect(c.started).toEqual(["daily"]);
  });
});
