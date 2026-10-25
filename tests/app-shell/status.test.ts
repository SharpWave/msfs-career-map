/**
 * `GET /api/status` on a test server (APP-API-004): every field, answered from memory without
 * reading the database (APP-API-008), `ready` computed on every call (APP-API-009) and the airport
 * preparation's report (APP-API-010), as the test servers give them (APP-SRV-023).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { ROOT } from "../../src/server/locations.ts";
import { serverStatus, setCounts, setStartup } from "../../src/server/status.ts";
import { takeRefused } from "../support/fetch-guard.ts";
import { fixtureCounts } from "../support/run-folder.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
vi.mock("../../src/server/simconnect.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/simconnect.ts")>()),
  startSimLink: vi.fn(),
}));

const DATA_FOLDER = path.dirname(path.resolve(process.env.CAREER_DB!));
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const KEYS = [
  "airportData",
  "airports",
  "app",
  "dataFolder",
  "logbookId",
  "ok",
  "pid",
  "ready",
  "runways",
  "sim",
  "startup",
  "version",
];
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("/api/status on a test server", () => {
  let server: TestServer;
  const status = async (): Promise<any> => {
    const res = await fetch(`${server.base}/api/status`);
    expect(res.status).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    setStartup("done");
    await server.close();
  });

  // @spec APP-API-004, APP-API-005, APP-API-009, APP-API-010, APP-SRV-023
  it("reports every field with its type: start-up done, ready, airport data done, the sim off and this file's data folder", async () => {
    const body = await status();
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body).toEqual({
      ok: true,
      app: "msfs-career-map",
      version: VERSION,
      pid: process.pid,
      dataFolder: DATA_FOLDER,
      // 1c gives the logbook an id; 1b-i asserts only that the key is there.
      logbookId: body.logbookId,
      sim: "off",
      startup: "done",
      airportData: { state: "done" },
      ready: true,
      airports: fixtureCounts().airports,
      runways: fixtureCounts().runways,
    });
    expect(body.logbookId === null || typeof body.logbookId === "string").toBe(true);
    expect(path.isAbsolute(body.dataFolder)).toBe(true);
    expect(Number.isInteger(body.pid)).toBe(true);
    // The route answers what the module holds.
    expect(serverStatus()).toEqual(body);
  });

  // @spec APP-SRV-023
  it("takes no lock on the data folder", async () => {
    await status();
    expect(fs.existsSync(path.join(DATA_FOLDER, "career.db.lock"))).toBe(false);
    expect(fs.readdirSync(DATA_FOLDER).filter((f) => /\.lock$/i.test(f))).toEqual([]);
  });

  // @spec APP-API-008
  it("answers without reading the database", async () => {
    const prepare = vi.spyOn(db, "prepare");
    const exec = vi.spyOn(db, "exec");
    try {
      const body = await status();
      expect(body.airports).toBe(fixtureCounts().airports);
      expect(prepare).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
      exec.mockRestore();
    }
  });

  // @spec APP-API-008
  it("keeps the counts in memory: a row written behind its back leaves them as they were", async () => {
    db.prepare("INSERT INTO airports (ident, type, name, lat, lon) VALUES ('ZZST', 'small_airport', 'Status Test Field', 1, 2)").run();
    db.prepare("DELETE FROM runways WHERE id = (SELECT MIN(id) FROM runways)").run();
    expect(count("airports")).toBe(fixtureCounts().airports + 1);
    expect(count("runways")).toBe(fixtureCounts().runways - 1);
    const body = await status();
    expect(body.airports).toBe(fixtureCounts().airports);
    expect(body.runways).toBe(fixtureCounts().runways);

    // What the module is told is what it reports.
    setCounts({ airports: 7, runways: 11 });
    expect(await status()).toMatchObject({ airports: 7, runways: 11 });
  });

  // @spec APP-API-008, APP-API-009, APP-API-010
  it("takes the counts from POST /api/airports/reimport, leaving ready and the airport data report as they were", async () => {
    setCounts({ airports: 7, runways: 11 });
    const before = await status();
    expect(before).toMatchObject({ airports: 7, runways: 11, ready: true, airportData: { state: "done" } });

    const res = await fetch(`${server.base}/api/airports/reimport`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(takeRefused()).toEqual([]);

    const after = await status();
    expect(after.airports).toBe(fixtureCounts().airports);
    expect(after.runways).toBe(fixtureCounts().runways);
    expect(after.airports).toBe(count("airports"));
    expect(after.runways).toBe(count("runways"));
    expect(after.ready).toBe(true);
    expect(after.airportData).toEqual(before.airportData);
    expect(after.startup).toBe("done");
  });

  // @spec APP-API-009
  it("computes ready on every call: false while the start-up step is not done, true again once it is", async () => {
    try {
      setStartup("opening");
      const opening = await status();
      expect(opening.startup).toBe("opening");
      expect(opening.ready).toBe(false);
      expect(opening.airportData).toEqual({ state: "done" });
      expect(serverStatus()).toMatchObject({ startup: "opening", ready: false });
    } finally {
      setStartup("done");
    }
    const done = await status();
    expect(done.startup).toBe("done");
    expect(done.ready).toBe(true);
  });

  // Last in the file: it leaves the runways empty and the airport data failed.
  // @spec APP-API-009, APP-API-010, APP-SRV-023
  it("reports a failed preparation with its error when a list is missing and downloads are off, and stays ready", async () => {
    const { ensureReferenceData } = await import("../../src/server/airports.ts");
    const { RUNWAYS_CSV } = await import("../../src/server/db.ts");
    expect(path.dirname(RUNWAYS_CSV)).toBe(DATA_FOLDER);
    fs.rmSync(RUNWAYS_CSV);
    db.exec("DELETE FROM runways");

    const message = "runways.csv is missing and airport downloads are off";
    const failure = await ensureReferenceData({ downloads: false }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(message);
    // It downloaded nothing: no outside request was made.
    expect(takeRefused()).toEqual([]);
    expect(fs.existsSync(RUNWAYS_CSV)).toBe(false);

    const body = await status();
    expect(body.airportData).toEqual({ state: "failed", error: message });
    expect(body.ready).toBe(true);
    expect(body.startup).toBe("done");
  });
});
