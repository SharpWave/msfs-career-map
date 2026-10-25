/**
 * Airport preparation at start (AirportWork.prepareAtStart): leftovers cleared (APT-DATA-026),
 * seeding from the program folder (APT-DATA-017, APT-DATA-018), importing only into empty tables
 * (APT-DATA-001, APT-DATA-002), downloads on or off (APT-DATA-020), failures that end preparation
 * (APT-DATA-022), and what it reports (APT-DATA-021, APP-API-010).
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AIRPORTS_URL, AirportWork, RUNWAYS_URL, readDownloadTime } from "../../src/server/airport-data.ts";
import type { AirportDataReport } from "../../src/server/status.ts";
import { USER_AGENT } from "../../src/server/version.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { fixtureCounts } from "../support/run-folder.ts";
import {
  TEMP_NAMES,
  airportsCsv,
  countOf,
  emptyFolder,
  fixtureText,
  leftoverFiles,
  listResponse,
  scratchDb,
  tablesOf,
  userAgentOf,
} from "../support/airport-lists.ts";

const NOW = new Date("2026-10-25T12:00:00Z");
const PROGRAM_TIME = "2026-09-01T06:30:00Z";

const open: { db: DatabaseSync; work: AirportWork }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.work.stop();
    o.db.close();
  }
});

/** A program folder holding the given lists, each with a download time unless `noTime` names it. */
function programFolder(lists: ("airports" | "runways")[] = ["airports", "runways"], noTime: string[] = []): string {
  const dir = emptyFolder("program-");
  for (const list of lists) {
    fs.writeFileSync(path.join(dir, `${list}.csv`), fixtureText(list));
    if (!noTime.includes(list)) fs.writeFileSync(path.join(dir, `${list}.csv.downloaded`), `${PROGRAM_TIME}\n`);
  }
  return dir;
}

/** A data folder (lists given are written into it), its own database, and AirportWork on both. */
function setup(o: { program?: string | null; lists?: { airports?: string; runways?: string } } = {}) {
  const dataFolder = emptyFolder("data-");
  for (const [list, text] of Object.entries(o.lists ?? {})) fs.writeFileSync(path.join(dataFolder, `${list}.csv`), text!);
  const db = scratchDb(dataFolder);
  const reports: AirportDataReport[] = [];
  let counted = 0;
  const work = new AirportWork({
    db,
    dataFolder,
    programFolder: o.program === undefined ? null : o.program,
    report: (r) => reports.push(structuredClone(r)),
    counts: () => counted++,
    now: () => NOW,
    every: () => () => {},
  });
  open.push({ db, work });
  const file = (name: string) => path.join(dataFolder, name);
  return { dataFolder, db, work, reports, counted: () => counted, file };
}

/** The reports with the importing ones folded to one per list: [state, list?]. */
const steps = (reports: AirportDataReport[]) =>
  reports
    .map((r) => [r.state, r.list].filter(Boolean).join(" "))
    .filter((s, i, all) => i === 0 || s !== all[i - 1]);

describe("seeding from the program folder (APT-DATA-017, APT-DATA-018)", () => {
  // @spec APT-DATA-017, APT-DATA-018, APT-DATA-001, APT-DATA-002, APT-DATA-021, APP-API-010
  it("copies in each list a new data folder lacks with the program's download time, then imports both", async () => {
    const program = programFolder(["airports", "runways"], ["runways"]);
    const programRunwaysTime = fs.statSync(path.join(program, "runways.csv")).mtime;
    const s = setup({ program });
    await s.work.prepareAtStart({ downloads: false });

    expect(fs.readFileSync(s.file("airports.csv"), "utf8")).toBe(fixtureText("airports"));
    expect(fs.readFileSync(s.file("runways.csv"), "utf8")).toBe(fixtureText("runways"));
    expect(fs.readFileSync(s.file("airports.csv.downloaded"), "utf8").trim()).toBe(new Date(PROGRAM_TIME).toISOString());
    // A program list without a time carries its own last-modified time.
    expect(readDownloadTime(s.file("runways.csv"), NOW).getTime()).toBe(programRunwaysTime.getTime());
    expect(fs.existsSync(s.file("runways.csv.downloaded"))).toBe(true);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);

    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    expect(countOf(s.db, "runways")).toBe(fixtureCounts().runways);
    expect(steps(s.reports)).toEqual(["seeding", "importing airports", "importing runways", "done"]);
    expect(s.reports[0]).toEqual({ state: "seeding" });
    expect(s.counted()).toBeGreaterThanOrEqual(2);
  });

  // @spec APT-DATA-017
  it("leaves a list already in the data folder, and its time, as they are, seeding only the one it lacks", async () => {
    const own = airportsCsv([{ ident: "OWN1" }, { ident: "OWN2" }, { ident: "OWN3" }]);
    const s = setup({ program: programFolder(), lists: { airports: own } });
    fs.writeFileSync(s.file("airports.csv.downloaded"), "2026-01-01T00:00:00Z");
    await s.work.prepareAtStart({ downloads: false });

    expect(fs.readFileSync(s.file("airports.csv"), "utf8")).toBe(own);
    expect(fs.readFileSync(s.file("airports.csv.downloaded"), "utf8")).toBe("2026-01-01T00:00:00Z");
    expect(fs.readFileSync(s.file("runways.csv"), "utf8")).toBe(fixtureText("runways"));
    // The import takes the data folder's own list.
    expect(countOf(s.db, "airports")).toBe(3);
  });

  // @spec APT-DATA-017
  it("seeds nothing from a program folder without lists, or with none given, and reports no seeding", async () => {
    for (const program of [emptyFolder("program-"), null]) {
      const s = setup({ program, lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
      await s.work.prepareAtStart({ downloads: false });
      expect(s.reports.some((r) => r.state === "seeding")).toBe(false);
      expect(fs.existsSync(s.file("airports.csv.downloaded"))).toBe(false);
      expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    }
  });
});

describe("importing only what the database lacks (APT-DATA-001, APT-DATA-002)", () => {
  // @spec APT-DATA-001, APT-DATA-002
  it("imports nothing when the database holds airports and runways with headings, whatever the lists say", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
    await s.work.prepareAtStart({ downloads: false });
    fs.writeFileSync(s.file("airports.csv"), airportsCsv([{ ident: "NEW1" }]));
    s.reports.length = 0;
    await s.work.prepareAtStart({ downloads: false });
    expect(s.reports).toEqual([{ state: "done" }]);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
  });

  // @spec APT-DATA-002
  it("imports the runway list again when no runway has a heading, leaving the airports alone", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
    await s.work.prepareAtStart({ downloads: false });
    s.db.exec(`UPDATE runways SET le_heading = NULL`);
    s.reports.length = 0;
    await s.work.prepareAtStart({ downloads: false });
    expect(steps(s.reports)).toEqual(["importing runways", "done"]);
    expect(countOf(s.db, "runways WHERE le_heading IS NOT NULL")).toBeGreaterThan(0);
  });

  // @spec APT-DATA-001, APT-DATA-002
  it("needs no list for a table it does not import: a database holding both, with the lists gone, prepares as done", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
    await s.work.prepareAtStart({ downloads: false });
    fs.rmSync(s.file("airports.csv"));
    fs.rmSync(s.file("runways.csv"));
    s.reports.length = 0;
    await s.work.prepareAtStart({ downloads: true });
    expect(s.reports).toEqual([{ state: "done" }]);
  });
});

describe("downloads at preparation (APT-DATA-020, APT-DATA-001, APT-DATA-002)", () => {
  // @spec APT-DATA-001, APT-DATA-002, APT-DATA-018, APT-DATA-020, APT-DATA-021, APP-API-005
  it("with downloads on, downloads a list an import needs and the data folder still lacks, with the time of the download", async () => {
    const agents: (string | null)[] = [];
    for (const [url, list] of [[AIRPORTS_URL, "airports"], [RUNWAYS_URL, "runways"]] as const) {
      answerFetch(url, (_u, init) => {
        agents.push(userAgentOf(init));
        return listResponse(fixtureText(list), init);
      });
    }
    const s = setup();
    await s.work.prepareAtStart({ downloads: true });
    expect(agents).toEqual([USER_AGENT, USER_AGENT]);
    expect(fs.readFileSync(s.file("airports.csv"), "utf8")).toBe(fixtureText("airports"));
    expect(fs.readFileSync(s.file("runways.csv.downloaded"), "utf8").trim()).toBe(NOW.toISOString());
    expect(countOf(s.db, "runways")).toBe(fixtureCounts().runways);
    expect(steps(s.reports)).toEqual(["downloading airports", "importing airports", "downloading runways", "importing runways", "done"]);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
  });

  // @spec APT-DATA-020, APT-DATA-022, APT-DATA-021
  it("with downloads off, downloads nothing and fails naming the list that is missing", async () => {
    const s = setup({ lists: { runways: fixtureText("runways") } });
    await expect(s.work.prepareAtStart({ downloads: false })).rejects.toThrow("airports.csv is missing and airport downloads are off");
    expect(s.reports.at(-1)).toEqual({ state: "failed", error: "airports.csv is missing and airport downloads are off" });
    expect(countOf(s.db, "airports")).toBe(0);
  });

  // @spec APT-DATA-022, APT-DATA-019
  it("fails when a download fails, keeping what it had and leaving no list or temporary file behind", async () => {
    answerFetch(AIRPORTS_URL, () => new Response("", { status: 503, statusText: "Service Unavailable" }));
    const s = setup({ lists: { runways: fixtureText("runways") } });
    await expect(s.work.prepareAtStart({ downloads: true })).rejects.toThrow("download of airports.csv failed: HTTP 503 Service Unavailable");
    expect(s.reports.at(-1)).toEqual({ state: "failed", error: "download of airports.csv failed: HTTP 503 Service Unavailable" });
    expect(fs.existsSync(s.file("airports.csv"))).toBe(false);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
  });

  // @spec APT-DATA-022, APT-DATA-014
  it("fails when an import fails, the airport data it had kept", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways").replace('"surface",', '"surf",') } });
    const err = await s.work.prepareAtStart({ downloads: false }).catch((e) => e);
    expect(err.message).toBe(`${s.file("runways.csv")}: missing column surface`);
    expect(s.reports.at(-1)).toEqual({ state: "failed", error: err.message });
    // The airports imported before the failure stay; the runways were never replaced.
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    expect(countOf(s.db, "runways")).toBe(0);
    expect(tablesOf(s.db).filter((t) => t.endsWith("_staging"))).toEqual([]);
  });
});

describe("leftovers (APT-DATA-026)", () => {
  // @spec APT-DATA-026
  it("removes every temporary list file and staging table an earlier server left, and nothing else", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
    for (const name of TEMP_NAMES) fs.writeFileSync(s.file(name), "left over");
    fs.writeFileSync(s.file("airports.csv.bak"), "the pilot's own");
    s.db.exec(`CREATE TABLE airports_staging (ident TEXT PRIMARY KEY); CREATE TABLE runways_staging (id INTEGER PRIMARY KEY)`);
    await s.work.prepareAtStart({ downloads: false });
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
    expect(fs.readFileSync(s.file("airports.csv.bak"), "utf8")).toBe("the pilot's own");
    expect(tablesOf(s.db).filter((t) => t.endsWith("_staging"))).toEqual([]);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
  });
});

describe("what preparation reports (APT-DATA-021, APP-API-010)", () => {
  // @spec APT-DATA-021, APP-API-010
  it("reports each import's list with the rows so far and the list's total, ending at the total", async () => {
    const s = setup({ lists: { airports: fixtureText("airports"), runways: fixtureText("runways") } });
    await s.work.prepareAtStart({ downloads: false });
    for (const list of ["airports", "runways"] as const) {
      const mine = s.reports.filter((r) => r.state === "importing" && r.list === list);
      expect(mine.length, list).toBeGreaterThanOrEqual(1);
      const total = fixtureText(list).trim().split("\n").length - 1;
      for (const r of mine) expect(Object.keys(r).sort()).toEqual(["list", "rows", "state", "total"]);
      expect(mine.every((r) => r.total === total)).toBe(true);
      expect(mine.at(-1)!.rows).toBe(total);
    }
    expect(s.reports.at(-1)).toEqual({ state: "done" });
  });
});

