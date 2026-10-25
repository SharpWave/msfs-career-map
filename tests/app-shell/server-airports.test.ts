/**
 * Airport preparation through the server's real process: seeding a new data folder from the program
 * folder its inputs give (APP-SRV-001, APP-SRV-008, APT-DATA-017), a failed preparation that leaves the
 * server running (APT-DATA-022, APP-API-009), the status answering through a large import and
 * reporting its progress (APT-DATA-021, APT-DATA-023, APP-API-008, APP-API-010), a shutdown in the
 * middle of it (APT-DATA-025, APP-SRV-016), and leftovers cleared at start (APT-DATA-026).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { fixtureCounts, makeDataFolder } from "../support/run-folder.ts";
import { queryLogbook, writeLogbook } from "../support/logbooks.ts";
import { killAllServers, killTestServers, launchServer, makeProgramFolder } from "../support/server-process.ts";
import { TEMP_NAMES, bigAirportsCsv, emptyFolder, fixtureText, leftoverFiles } from "../support/airport-lists.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const PROCESS = { timeout: 90_000 };
/**
 * A wall-clock bound on a server process: with every test file's process busy at once, the swap at the
 * end of a large import can be stretched past it. Tried again rather than loosened; a server that
 * really stopped answering would fail every try.
 */
const TIMED_PROCESS = { ...PROCESS, retry: 1 };
const READY = /^\[server\] ready$/;
const PROGRAM_TIME = "2026-09-01T06:30:00Z";
const dbFile = (dir: string) => path.join(dir, "career.db");
const count = (dir: string, table: string) => queryLogbook<{ n: number }>(dbFile(dir), `SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const tables = (dir: string) => queryLogbook<{ name: string }>(dbFile(dir), `SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name);

/** A program folder with the page and the given seed lists, each with the program's download time. */
function programWith(lists: { airports?: string; runways?: string }): string {
  const dir = makeProgramFolder();
  for (const [list, text] of Object.entries(lists)) {
    fs.writeFileSync(path.join(dir, `${list}.csv`), text!);
    fs.writeFileSync(path.join(dir, `${list}.csv.downloaded`), PROGRAM_TIME);
  }
  return dir;
}

/** More airports than OurAirports lists (about 80 000 open ones): an import long enough to watch. */
const BIG = 100_000;
let big: string | null = null;
const bigList = () => (big ??= bigAirportsCsv(BIG));

describe("preparing a new data folder (APP-SRV-001, APT-DATA-017)", () => {
  // @spec APP-SRV-001, APP-SRV-008, APT-DATA-017, APT-DATA-018, APT-DATA-001, APT-DATA-002, APP-API-009
  it("seeds both lists from the program folder its inputs give, imports them, and only then is ready", PROCESS, async () => {
    const data = emptyFolder("data-");
    const program = programWith({ airports: fixtureText("airports"), runways: fixtureText("runways") });
    const s = await launchServer({ entry: "bundled", dataFolder: data, programFolder: program });
    await s.waitForLine(READY);
    const status = await s.status();
    expect(status).toMatchObject({ ready: true, airportData: { state: "done" }, airports: fixtureCounts().airports, runways: fixtureCounts().runways });
    for (const list of ["airports", "runways"]) {
      expect(fs.readFileSync(path.join(data, `${list}.csv`), "utf8")).toBe(fixtureText(list as "airports"));
      expect(fs.readFileSync(path.join(data, `${list}.csv.downloaded`), "utf8").trim()).toBe(new Date(PROGRAM_TIME).toISOString());
    }
    expect(leftoverFiles(data)).toEqual([]);
    // The order: the start-up work done, then the airport data, then ready.
    const out = s.output();
    expect(out.indexOf("[server] start-up done")).toBeGreaterThan(-1);
    expect(out.indexOf("[server] start-up done")).toBeLessThan(out.indexOf("[server] ready"));
  });
});

describe("a failed preparation (APT-DATA-022)", () => {
  // @spec APT-DATA-022, APT-DATA-020, APP-API-009, APP-API-010, APP-SRV-001
  it("with no list anywhere and downloads off, reports why, is ready, and keeps serving with no airports", PROCESS, async () => {
    const data = emptyFolder("data-");
    const s = await launchServer({ entry: "bundled", dataFolder: data, programFolder: programWith({}) });
    await s.waitForLine(READY);
    const message = "airports.csv is missing and airport downloads are off";
    expect(await s.status()).toMatchObject({ ready: true, airportData: { state: "failed", error: message }, airports: 0 });
    expect(s.output()).toContain(`[data] airport preparation failed: ${message}`);
    const res = await fetch(`${s.base}/api/aircraft`);
    expect(res.status).toBe(200);
    const search = await fetch(`${s.base}/api/airports/search?q=KBOS`);
    expect(await search.json()).toEqual([]);
  });
});

describe("a large import (APT-DATA-021, APT-DATA-023)", () => {
  // @spec APT-DATA-021, APT-DATA-023, APP-API-008, APP-API-010
  it("answers /api/status within 1 s throughout, reporting the rows imported so far out of the total", TIMED_PROCESS, async () => {
    const data = emptyFolder("data-");
    const program = programWith({ airports: bigList(), runways: fixtureText("runways") });
    const s = await launchServer({ entry: "bundled", dataFolder: data, programFolder: program });
    const importing: { rows: number; total: number }[] = [];
    const states: string[] = [];
    let slowest = 0;
    const end = Date.now() + 75_000;
    let last: any = null;
    while (Date.now() < end) {
      const asked = Date.now();
      last = await s.status();
      slowest = Math.max(slowest, Date.now() - asked);
      const a = last.airportData;
      if (states.at(-1) !== a.state) states.push(a.state);
      if (a.state === "importing" && a.list === "airports") importing.push({ rows: a.rows, total: a.total });
      if (a.state === "done" || a.state === "failed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(last.airportData, s.output()).toEqual({ state: "done" });
    expect(slowest).toBeLessThan(1000);
    expect(importing.length).toBeGreaterThan(1);
    expect(new Set(importing.map((i) => i.total))).toEqual(new Set([BIG]));
    expect(importing.some((i) => i.rows > 0 && i.rows < BIG)).toBe(true);
    // States in order, each at most once (seeding may be too quick to see).
    const order = ["waiting", "seeding", "importing", "done"];
    expect(states.map((x) => order.indexOf(x))).toEqual([...states.map((x) => order.indexOf(x))].sort((a, b) => a - b));
    expect(last.airports).toBe(BIG);
    await s.waitForLine(READY);
  });

  // @spec APT-DATA-025, APP-SRV-016
  it("stops within one batch at a shutdown, exiting 0 with the old data or the new whole and nothing staged or half-written", PROCESS, async () => {
    const data = emptyFolder("data-");
    const program = programWith({ airports: bigList(), runways: fixtureText("runways") });
    const s = await launchServer({ entry: "bundled", dataFolder: data, programFolder: program });
    await s.waitForStatus((st) => st.airportData.state === "importing" && st.airportData.rows > 0, 60_000);
    const asked = Date.now();
    s.send({ type: "shutdown" });
    const { code } = await s.exit(10_000);
    expect(code).toBe(0);
    expect(Date.now() - asked).toBeLessThan(5000);
    expect([0, BIG]).toContain(count(data, "airports"));
    expect(tables(data).filter((t) => t.endsWith("_staging"))).toEqual([]);
    expect(leftoverFiles(data)).toEqual([]);
    // The seeded list was put in place before the import began, and keeps its time.
    expect(fs.readFileSync(path.join(data, "airports.csv.downloaded"), "utf8").trim()).toBe(new Date(PROGRAM_TIME).toISOString());
    expect(s.output()).not.toContain("[server] ready");
  });
});

describe("leftovers (APT-DATA-026)", () => {
  // @spec APT-DATA-026
  it("clears temporary list files and staging tables an earlier server left, then prepares as usual", PROCESS, async () => {
    const { dir } = makeDataFolder(runDir);
    await writeLogbook(dbFile(dir), {});
    const db = new DatabaseSync(dbFile(dir));
    db.exec(`CREATE TABLE airports_staging (ident TEXT PRIMARY KEY); CREATE TABLE runways_staging (id INTEGER PRIMARY KEY)`);
    db.close();
    for (const name of TEMP_NAMES) fs.writeFileSync(path.join(dir, name), "left over");
    const s = await launchServer({ entry: "bundled", dataFolder: dir });
    await s.waitForLine(READY);
    expect(await s.status()).toMatchObject({ airportData: { state: "done" }, airports: fixtureCounts().airports });
    expect(leftoverFiles(dir)).toEqual([]);
    s.send({ type: "shutdown" });
    await s.exit(10_000);
    expect(tables(dir).filter((t) => t.endsWith("_staging"))).toEqual([]);
  });
});
