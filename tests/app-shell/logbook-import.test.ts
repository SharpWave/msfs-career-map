/**
 * Bringing in a logbook against a test server (APP-IMP-001, 002, 003, 005; LIVE-API-015): what is
 * offered, each refusal, a failure before the answer, and an accepted copy prepared and marked
 * complete with tracking paused — its shutdown left to the test (APP-SRV-023). The accepted import
 * is this file's last test: the server it leaves is a server about to exit.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { backupFileName } from "../../src/server/backup.ts";
import { db } from "../../src/server/db.ts";
import { currentInputs, useInputs } from "../../src/server/inputs.ts";
import { readLogbookId } from "../../src/server/logbook-id.ts";
import { setImportFinish, setLastAttempt } from "../../src/server/logbook-import.ts";
import { tracker } from "../../src/server/tracker.ts";
import { allowOrigin } from "../support/fetch-guard.ts";
import { iconBytes, logbookFolder, queryLogbook, someId, writeLogbook } from "../support/logbooks.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

let server: TestServer;
let dataFolder: string;
let backups: string;
let ownId: string;
const finish = vi.fn();
const inputsAtStart = currentInputs();

beforeAll(async () => {
  server = await startTestServer();
  dataFolder = inputsAtStart.dataFolder;
  backups = path.join(dataFolder, "backups");
  ownId = readLogbookId(db)!;
  setImportFinish(finish);
});
afterAll(async () => {
  useInputs(inputsAtStart);
  await server.close();
});
beforeEach(() => {
  db.exec(`DELETE FROM hops; DELETE FROM aircraft; DELETE FROM tracker_state;`);
  db.prepare(`INSERT INTO aircraft (name) VALUES ('Here One'), ('Here Two')`).run();
  fs.rmSync(backups, { recursive: true, force: true });
  useInputs({ ...inputsAtStart, offer: null });
});

const getOffer = async () => {
  const res = await fetch(`${server.base}/api/logbook/offer`);
  expect(res.status).toBe(200);
  return res.json();
};
const importing = (body: object) =>
  fetch(`${server.base}/api/logbook/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A copy run from source's data folder holding a logbook with hops. */
async function otherFolder(spec: Parameters<typeof writeLogbook>[1] = {}) {
  const folder = logbookFolder();
  await writeLogbook(path.join(folder, "career.db"), {
    logbookId: someId(0x5001),
    aircraft: ["There Cub"],
    hops: [
      [0, "KPVD", "KBOS", "2026-09-01T10:00:00.000Z"],
      [0, "KBOS", "KORH", "2026-09-05T15:30:00.000Z"],
      [0, "KORH", "KBED", null],
    ],
    ...spec,
  });
  return folder;
}

/** A backup in this server's backups folder, of logbook `id`, taken `daysAgo` days before a fixed day. */
async function backupOf(id: string, daysAgo: number, hops: [number, string, string, string | null][]) {
  fs.mkdirSync(backups, { recursive: true });
  const name = backupFileName(new Date(Date.parse("2026-10-20T12:00:00Z") - daysAgo * 86_400_000), "daily", id);
  await writeLogbook(path.join(backups, name), { logbookId: id, aircraft: ["Backed Cub"], hops, backupIcons: {} });
  return name;
}

describe("what is offered (APP-IMP-001, APP-IMP-005)", () => {
  // @spec APP-IMP-001
  it("offers nothing to bring in while there is nothing, saying what the logbook here holds", async () => {
    expect(await getOffer()).toEqual({ hops: 0, aircraft: 2, offers: [], lastAttempt: null });
  });

  // @spec APP-IMP-001
  it("offers the logbook to offer and the newest backup of each other logbook whose logbook holds hops, with their hops and newest hop", async () => {
    const folder = await otherFolder();
    useInputs({ ...inputsAtStart, offer: folder });
    const A = someId(0xa);
    const B = someId(0xb);
    await backupOf(A, 9, [[0, "KPVD", "KBOS", "2026-08-01T00:00:00.000Z"]]);
    const newestA = await backupOf(A, 2, [
      [0, "KPVD", "KBOS", "2026-08-01T00:00:00.000Z"],
      [0, "KBOS", "KACK", "2026-10-17T09:00:00.000Z"],
    ]);
    await backupOf(B, 1, []); // its logbook holds no hops
    await backupOf(ownId, 0, [[0, "KPVD", "KBOS", "2026-10-19T00:00:00.000Z"]]); // this logbook's own
    fs.writeFileSync(path.join(backups, "notes.txt"), "not a backup");

    const offer = await getOffer();
    expect(offer.hops).toBe(0);
    expect(offer.aircraft).toBe(2);
    expect(offer.offers).toEqual([
      { kind: "folder", folder, hops: 3, newestHop: "2026-09-05T15:30:00.000Z" },
      { kind: "backup", file: newestA, time: "2026-10-18T12:00:00.000Z", hops: 2, newestHop: "2026-10-17T09:00:00.000Z" },
    ]);
  });

  // @spec APP-IMP-001
  it("offers no folder that holds no career.db", async () => {
    useInputs({ ...inputsAtStart, offer: logbookFolder() });
    expect((await getOffer()).offers).toEqual([]);
  });

  // @spec APP-IMP-001
  it("offers nothing while the logbook here holds hops", async () => {
    useInputs({ ...inputsAtStart, offer: await otherFolder() });
    await backupOf(someId(0xa), 2, [[0, "KPVD", "KBOS", null]]);
    db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES ((SELECT MIN(id) FROM aircraft), 1, 'KPVD', 'KBOS', '')`).run();
    const offer = await getOffer();
    expect(offer.hops).toBe(1);
    expect(offer.offers).toEqual([]);
  });

  // @spec APP-IMP-005
  it("reports the outcome of the last attempt, whatever the logbook holds", async () => {
    setLastAttempt({ outcome: "not-brought-in", reason: "the logbook here held hops by then", at: "2026-10-25T05:00:00.000Z" });
    expect((await getOffer()).lastAttempt).toEqual({ outcome: "not-brought-in", reason: "the logbook here held hops by then", at: "2026-10-25T05:00:00.000Z" });
    setLastAttempt({ outcome: "brought-in", at: "2026-10-25T06:00:00.000Z" });
    expect((await getOffer()).lastAttempt).toEqual({ outcome: "brought-in", at: "2026-10-25T06:00:00.000Z" });
    setLastAttempt(null);
  });
});

describe("refusals (APP-IMP-002)", () => {
  /** A server that answers /api/status as a live MSFS Career Map on `folder`, with its lock there. */
  async function liveServerOn(folder: string) {
    const srv = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, app: "msfs-career-map", pid: process.ppid, dataFolder: folder, startup: "done" }));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as AddressInfo).port;
    const disallow = allowOrigin(`http://127.0.0.1:${port}`);
    fs.writeFileSync(path.join(folder, "career.db.lock"), JSON.stringify({ pid: process.ppid, port }));
    return () => {
      disallow();
      srv.close();
    };
  }

  // @spec APP-IMP-002
  it("refuses while the logbook here holds hops", async () => {
    const folder = await otherFolder();
    db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES ((SELECT MIN(id) FROM aircraft), 1, 'KPVD', 'KBOS', '')`).run();
    const res = await importing({ folder });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This logbook already holds hops" });
  });

  // @spec APP-IMP-002
  it("refuses the data folder in use", async () => {
    const res = await importing({ folder: dataFolder });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That is the logbook in use" });
  });

  // @spec APP-IMP-002
  it("refuses a folder with no career.db, and a backup not in the backups folder", async () => {
    for (const body of [{ folder: logbookFolder() }, { backup: backupFileName(new Date(), "daily", someId(0xa)) }]) {
      const res = await importing(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(await res.json()).toEqual({ error: "No logbook there" });
    }
  });

  // @spec APP-IMP-002
  it("refuses a request naming neither a folder nor a backup, or both", async () => {
    for (const body of [{}, { folder: logbookFolder(), backup: "x.db" }]) {
      const res = await importing(body);
      expect(res.status).toBe(400);
    }
  });

  // @spec APP-IMP-002, APP-DATA-007
  it("refuses a folder a server still runs on", async () => {
    const folder = await otherFolder();
    const stop = await liveServerOn(folder);
    try {
      const res = await importing({ folder });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Close the MSFS Career Map running on that folder first" });
    } finally {
      stop();
    }
  });

  // @spec APP-IMP-002, LIVE-SAVE-009
  it.each<[string, string]>([
    ["not JSON", "{half a checkpoint"],
    ["of an unknown shape", JSON.stringify({ phase: "hovering" })],
  ])("refuses a logbook whose checkpoint the tracker cannot read (%s)", async (_what, checkpoint) => {
    const folder = await otherFolder({ checkpoint });
    const res = await importing({ folder });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Log or discard its waiting legs in the other copy first, or update MSFS Career Map" });
    expect(fs.existsSync(path.join(dataFolder, "career.db.incoming"))).toBe(false);
  });
});

describe("a failure before the answer (APP-IMP-003)", () => {
  // @spec APP-IMP-003, LIVE-LINK-017
  it("deletes what it made, resumes tracking and lets backups go on", async () => {
    const folder = await otherFolder();
    // A folder stands where the copy is made, so the copy fails.
    const blocker = path.join(dataFolder, "career.db.incoming.partial");
    fs.mkdirSync(blocker, { recursive: true });
    try {
      const res = await importing({ folder });
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBeTruthy();
    } finally {
      fs.rmSync(blocker, { recursive: true, force: true });
    }
    expect(fs.existsSync(path.join(dataFolder, "career.db.incoming"))).toBe(false);
    expect(fs.existsSync(path.join(dataFolder, "career.db.incoming.json"))).toBe(false);
    expect(tracker.isPausedForImport()).toBe(false);
    const bind = await fetch(`${server.base}/api/tracker/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aircraft_id: 1 }) });
    expect(bind.status).not.toBe(409);
    expect((await fetch(`${server.base}/api/backups`, { method: "POST" })).status).toBe(201);
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("an accepted logbook (APP-IMP-003, LIVE-API-015)", () => {
  // @spec APP-IMP-003, APP-SRV-023
  it("pauses tracking, prepares the copy with its icons and the merged checkpoint, marks it complete, answers 202 and hands the shutdown on", async () => {
    const folder = await otherFolder({ icons: { 0: iconBytes(42) } });
    const res = await importing({ folder });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ restart: "manual" });

    const copy = path.join(dataFolder, "career.db.incoming");
    expect(queryLogbook(copy, `SELECT origin, dest FROM hops ORDER BY seq`)).toEqual([
      { origin: "KPVD", dest: "KBOS" },
      { origin: "KBOS", dest: "KORH" },
      { origin: "KORH", dest: "KBED" },
    ]);
    const icons = queryLogbook<{ file: string; data: Uint8Array }>(copy, `SELECT file, data FROM backup_icons`);
    expect(icons.map((i) => i.file)).toEqual(["aircraft-1.png"]);
    expect(Buffer.from(icons[0].data)).toEqual(iconBytes(42));
    expect(queryLogbook(copy, `SELECT COUNT(*) AS n FROM tracker_state`)).toEqual([{ n: 1 }]);
    const mark = JSON.parse(fs.readFileSync(path.join(dataFolder, "career.db.incoming.json"), "utf8"));
    expect(mark.complete).toBe(true);
    expect(fs.readdirSync(dataFolder).filter((f) => f.endsWith(".partial"))).toEqual([]);
    // The source is left as it was.
    expect(fs.existsSync(path.join(folder, "career.db"))).toBe(true);

    await vi.waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(tracker.isPausedForImport()).toBe(true);

    // @spec LIVE-API-015
    const changing: [string, string, object?][] = [
      ["POST", "/api/tracker/bind", { aircraft_id: 1 }],
      ["POST", "/api/tracker/pending/00000000-0000-0000-0000-000000000000", { aircraft_id: 1 }],
      ["DELETE", "/api/tracker/pending/00000000-0000-0000-0000-000000000000"],
      ["POST", "/api/tracker/complete"],
      ["DELETE", "/api/tracker/leg"],
      ["PUT", "/api/tracker/casual", { on: true }],
      ["DELETE", "/api/tracker/path"],
      ["POST", "/api/tracker/sample", { t: 1, lat: 41, lon: -71, alt_ft: 0, gs_kts: 0, hdg_deg: 0 }],
    ];
    for (const [method, route, body] of changing) {
      const r = await fetch(`${server.base}${route}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(r.status, `${method} ${route}`).toBe(409);
      expect(await r.json(), `${method} ${route}`).toEqual({ error: "Bringing in a logbook" });
    }
    expect((await fetch(`${server.base}/api/tracker`)).status).toBe(200);

    // A second import, and a backup asked for meanwhile, wait for the exit or are refused.
    const again = await importing({ folder });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "A logbook is already being brought in" });
    const held = await fetch(`${server.base}/api/backups`, { method: "POST", signal: AbortSignal.timeout(400) }).catch((e) => e);
    expect(held).toBeInstanceOf(Error);
  });
});
