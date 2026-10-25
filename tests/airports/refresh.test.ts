/**
 * The daily checks (AirportWork.startChecks / check): the monthly refresh (APT-DATA-003) and its
 * failures (APT-DATA-005), a failed preparation prepared again (APT-DATA-022), both held while the
 * pilot is in the sim (APT-DATA-004), one import at a time (APT-DATA-024), requested re-imports
 * (APT-DATA-016, APT-DATA-020) and stopping (APT-DATA-025).
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AIRPORTS_URL, AirportWork, AirportsBusy, RUNWAYS_URL, type InSim } from "../../src/server/airport-data.ts";
import { serverStatus, setAirportData, type AirportDataReport } from "../../src/server/status.ts";
import { answerFetch, resetAnswers } from "../support/fetch-guard.ts";
import { fixtureCounts } from "../support/run-folder.ts";
import { airportsCsv, countOf, emptyFolder, fixtureText, heldAnswer, leftoverFiles, listResponse, runwaysCsv, scratchDb, tablesOf } from "../support/airport-lists.ts";

const DAY = 24 * 3600_000;
const NOW = new Date("2026-10-25T12:00:00Z");
const OLD = new Date(NOW.getTime() - 31 * DAY).toISOString();
const RECENT = new Date(NOW.getTime() - 29 * DAY).toISOString();
/** The lists a refresh downloads: different from the fixtures, so a swap shows. */
const NEW_AIRPORTS = airportsCsv([{ ident: "NEW1" }, { ident: "NEW2" }]);
const NEW_RUNWAYS = runwaysCsv([["NEW1"], ["NEW2", "09", "27"]]);

const open: { db: DatabaseSync; work: AirportWork }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.work.stop();
    o.db.close();
  }
});

/** A pilot who can be put into the sim and taken out of it. */
function pilot(inSim = false) {
  const listeners = new Set<() => void>();
  const check: InSim = {
    now: () => inSim,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    check,
    set(v: boolean) {
      inSim = v;
      for (const l of [...listeners]) l();
    },
    listening: () => listeners.size,
  };
}

/**
 * A data folder with the fixture lists (times as given), a database prepared from them, and
 * AirportWork whose daily timer the test fires by hand (`tick()`).
 */
async function prepared(o: { times?: string | null; downloads?: boolean; report?: (r: AirportDataReport) => void; lists?: boolean } = {}) {
  const dataFolder = emptyFolder("data-");
  const file = (name: string) => path.join(dataFolder, name);
  if (o.lists !== false) {
    for (const list of ["airports", "runways"]) {
      fs.writeFileSync(file(`${list}.csv`), fixtureText(list as "airports"));
      if (o.times !== null) fs.writeFileSync(file(`${list}.csv.downloaded`), o.times ?? OLD);
    }
  }
  const db = scratchDb(dataFolder);
  const reports: AirportDataReport[] = [];
  let daily: (() => void) | null = null;
  let cancelled = false;
  const work = new AirportWork({
    db,
    dataFolder,
    programFolder: null,
    report: o.report ?? ((r) => reports.push(structuredClone(r))),
    counts: () => {},
    now: () => NOW,
    every: (fn, ms) => {
      expect(ms).toBe(DAY);
      daily = fn;
      return () => {
        cancelled = true;
      };
    },
  });
  open.push({ db, work });
  const failed = await work.prepareAtStart({ downloads: o.downloads ?? true }).then(
    () => false,
    () => true,
  );
  return {
    dataFolder,
    file,
    db,
    work,
    reports,
    failed,
    tick: () => {
      if (!daily) throw new Error("no daily timer set");
      daily();
    },
    cancelled: () => cancelled,
  };
}

/** Both lists answered with the new lists; returns how many requests each got. */
function answerNewLists() {
  const asked = { airports: 0, runways: 0 };
  answerFetch(AIRPORTS_URL, (_u, init) => (asked.airports++, listResponse(NEW_AIRPORTS, init)));
  answerFetch(RUNWAYS_URL, (_u, init) => (asked.runways++, listResponse(NEW_RUNWAYS, init)));
  return asked;
}

/** Until the work is no longer busy. */
async function settled(work: AirportWork, ms = 5000) {
  const end = Date.now() + ms;
  while (work.busy()) {
    if (Date.now() > end) throw new Error("still busy");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const idents = (db: DatabaseSync) => (db.prepare(`SELECT ident FROM airports ORDER BY ident`).all() as { ident: string }[]).map((r) => r.ident);
const timeOf = (file: string) => fs.readFileSync(`${file}.downloaded`, "utf8").trim();

describe("the monthly refresh (APT-DATA-003)", () => {
  // @spec APT-DATA-003, APT-DATA-018
  it("at the check as preparation ends, downloads both lists whose time is more than 30 days ago, imports them, and only then puts them in place with new times", async () => {
    const s = await prepared();
    const asked = answerNewLists();
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(asked).toEqual({ airports: 1, runways: 1 });
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
    expect(countOf(s.db, "runways")).toBe(2);
    expect(fs.readFileSync(s.file("airports.csv"), "utf8")).toBe(NEW_AIRPORTS);
    expect(fs.readFileSync(s.file("runways.csv"), "utf8")).toBe(NEW_RUNWAYS);
    expect(timeOf(s.file("airports.csv"))).toBe(NOW.toISOString());
    expect(timeOf(s.file("runways.csv"))).toBe(NOW.toISOString());
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
    // A refresh is not preparation: the report stays as preparation left it.
    expect(s.reports.at(-1)).toEqual({ state: "done" });
  });

  // @spec APT-DATA-003
  it("does nothing while both lists are there and downloaded within 30 days", async () => {
    const s = await prepared({ times: RECENT });
    s.work.startChecks(pilot().check);
    s.tick();
    await settled(s.work);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
  });

  // @spec APT-DATA-003
  it("refreshes both lists when one of them is missing from the data folder, recent as the other is", async () => {
    const s = await prepared({ times: RECENT });
    fs.rmSync(s.file("runways.csv"));
    fs.rmSync(s.file("runways.csv.downloaded"));
    const asked = answerNewLists();
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(asked).toEqual({ airports: 1, runways: 1 });
    expect(fs.readFileSync(s.file("runways.csv"), "utf8")).toBe(NEW_RUNWAYS);
  });

  // @spec APT-DATA-003, APT-DATA-018
  it("judges a list without a download time by its last-modified time", async () => {
    const s = await prepared({ times: null });
    const old = new Date(NOW.getTime() - 40 * DAY);
    fs.utimesSync(s.file("airports.csv"), old, old);
    answerNewLists();
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
  });

  // @spec APT-DATA-003
  it("checks again every 24 hours", async () => {
    const s = await prepared({ times: RECENT });
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    fs.writeFileSync(s.file("airports.csv.downloaded"), OLD);
    answerNewLists();
    s.tick();
    await settled(s.work);
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
  });

  // @spec APT-DATA-020
  it("never refreshes with airport downloads off", async () => {
    const s = await prepared({ downloads: false });
    s.work.startChecks(pilot().check);
    s.tick();
    await settled(s.work);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
  });
});

describe("a refresh that fails (APT-DATA-005)", () => {
  const before = (s: Awaited<ReturnType<typeof prepared>>) => ({
    airports: fs.readFileSync(s.file("airports.csv"), "utf8"),
    runways: fs.readFileSync(s.file("runways.csv"), "utf8"),
    times: [timeOf(s.file("airports.csv")), timeOf(s.file("runways.csv"))],
    rows: idents(s.db),
    runwayRows: countOf(s.db, "runways"),
  });

  // @spec APT-DATA-005, APT-DATA-019
  it("leaves the lists, their times and the imported data as they were when a download fails, and tries again at the next check", async () => {
    const s = await prepared();
    const was = before(s);
    answerFetch(AIRPORTS_URL, (_u, init) => listResponse(NEW_AIRPORTS, init));
    answerFetch(RUNWAYS_URL, () => new Response("", { status: 500, statusText: "Internal Server Error" }));
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(before(s)).toEqual(was);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);

    // The service is back.
    resetAnswers();
    answerNewLists();
    s.tick();
    await settled(s.work);
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
  });

  // @spec APT-DATA-005, APT-DATA-014
  it("replaces nothing, the airports included, when the runway list cannot be imported", async () => {
    const s = await prepared();
    const was = before(s);
    answerFetch(AIRPORTS_URL, (_u, init) => listResponse(NEW_AIRPORTS, init));
    answerFetch(RUNWAYS_URL, (_u, init) => listResponse(NEW_RUNWAYS.replace('"surface",', '"surf",'), init));
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(before(s)).toEqual(was);
    expect(tablesOf(s.db).filter((t) => t.endsWith("_staging"))).toEqual([]);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
  });
});

describe("a failed preparation prepared again (APT-DATA-022)", () => {
  // @spec APT-DATA-022
  it("does nothing at the check run as preparation at start ends, and prepares again at the next one", async () => {
    const s = await prepared({ lists: false, downloads: false });
    expect(s.failed).toBe(true);
    s.work.startChecks(pilot().check);
    await settled(s.work);
    expect(s.reports.at(-1)?.state).toBe("failed");

    // The lists arrive (by hand); the next daily check prepares from them.
    fs.writeFileSync(s.file("airports.csv"), fixtureText("airports"));
    fs.writeFileSync(s.file("runways.csv"), fixtureText("runways"));
    s.tick();
    await settled(s.work);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    expect(s.reports.at(-1)).toEqual({ state: "done" });
  });

  // @spec APT-DATA-022, APP-API-009, APP-API-010
  it("replaces the failure's report from the moment the repeated preparation starts, ready staying true", async () => {
    let readyThroughout = true;
    const seen: AirportDataReport[] = [];
    const s = await prepared({
      lists: false,
      downloads: false,
      report: (r) => {
        setAirportData(r);
        seen.push(structuredClone(r));
        readyThroughout &&= serverStatus().ready;
      },
    });
    s.work.startChecks(pilot().check);
    fs.writeFileSync(s.file("airports.csv"), fixtureText("airports"));
    fs.writeFileSync(s.file("runways.csv"), fixtureText("runways"));
    const failedAt = seen.length;
    s.tick();
    await settled(s.work);
    const repeated = seen.slice(failedAt);
    expect(repeated[0].state).toBe("importing");
    expect(repeated.at(-1)).toEqual({ state: "done" });
    expect(serverStatus().airportData).toEqual({ state: "done" });
    expect(readyThroughout).toBe(true);
  });
});

describe("held while the pilot is in the sim (APT-DATA-004)", () => {
  // @spec APT-DATA-004, APT-DATA-024
  it("starts no refresh while the check reports the pilot in the sim, and starts it once it no longer does", async () => {
    const s = await prepared();
    const asked = answerNewLists();
    const p = pilot(true);
    s.work.startChecks(p.check);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toEqual({ airports: 0, runways: 0 });
    // Waiting counts as under way: a check does nothing, a re-import is refused.
    expect(s.work.busy()).toBe(true);
    s.tick();
    await expect(s.work.reimport({ download: false })).rejects.toBeInstanceOf(AirportsBusy);

    p.set(false);
    await settled(s.work);
    expect(asked).toEqual({ airports: 1, runways: 1 });
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
  });

  // @spec APT-DATA-004
  it("stops a refresh under way when the pilot comes into the sim, discarding its download, and starts it again from the beginning once they leave", async () => {
    const s = await prepared();
    const first = heldAnswer(NEW_AIRPORTS);
    answerFetch(AIRPORTS_URL, first.answer);
    const p = pilot(false);
    s.work.startChecks(p.check);
    await first.asked;
    p.set(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    expect(s.work.busy()).toBe(true);

    const runways = { asked: 0 };
    answerFetch(RUNWAYS_URL, (_u, init) => (runways.asked++, listResponse(NEW_RUNWAYS, init)));
    // The pilot leaves: the refresh asks for the airport list again, and this time it is answered.
    p.set(false);
    first.release();
    await settled(s.work);
    expect(first.requests).toBe(2);
    expect(runways.asked).toBe(1);
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
  });

  // @spec APT-DATA-004, APT-DATA-022
  it("holds a repeated preparation too", async () => {
    const s = await prepared({ lists: false, downloads: false });
    const p = pilot(false);
    s.work.startChecks(p.check);
    fs.writeFileSync(s.file("airports.csv"), fixtureText("airports"));
    fs.writeFileSync(s.file("runways.csv"), fixtureText("runways"));
    p.set(true);
    s.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(countOf(s.db, "airports")).toBe(0);
    p.set(false);
    await settled(s.work);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
  });
});

describe("one import at a time, and requested re-imports (APT-DATA-024, APT-DATA-016, APT-DATA-020)", () => {
  // @spec APT-DATA-016, APT-DATA-021
  it("re-imports both lists from disk, returning the counts and leaving the report as it was", async () => {
    const s = await prepared({ times: RECENT });
    fs.writeFileSync(s.file("airports.csv"), NEW_AIRPORTS);
    fs.writeFileSync(s.file("runways.csv"), NEW_RUNWAYS);
    const reportsBefore = s.reports.length;
    expect(await s.work.reimport({ download: false })).toEqual({ airports: 2, runways: 2 });
    expect(idents(s.db)).toEqual(["NEW1", "NEW2"]);
    expect(s.reports.length).toBe(reportsBefore);
  });

  // @spec APT-DATA-016, APT-DATA-020, APT-DATA-018
  it("downloads both lists first when asked to, airport downloads off or not, with new times", async () => {
    const s = await prepared({ times: RECENT, downloads: false });
    answerNewLists();
    expect(await s.work.reimport({ download: true })).toEqual({ airports: 2, runways: 2 });
    expect(fs.readFileSync(s.file("airports.csv"), "utf8")).toBe(NEW_AIRPORTS);
    expect(timeOf(s.file("runways.csv"))).toBe(NOW.toISOString());
  });

  // @spec APT-DATA-024
  it("refuses a second re-import, and a daily check does nothing, while one is under way", async () => {
    const s = await prepared({ times: RECENT });
    const held = heldAnswer(NEW_AIRPORTS);
    answerFetch(AIRPORTS_URL, held.answer);
    answerFetch(RUNWAYS_URL, (_u, init) => listResponse(NEW_RUNWAYS, init));
    s.work.startChecks(pilot().check);
    const first = s.work.reimport({ download: true });
    await held.asked;
    const err = await s.work.reimport({ download: false }).catch((e) => e);
    expect(err).toBeInstanceOf(AirportsBusy);
    expect(err.message).toBe("airport data is already being imported");
    expect(err.status).toBe(409);
    fs.writeFileSync(s.file("airports.csv.downloaded"), OLD);
    s.tick();
    held.release();
    expect(await first).toEqual({ airports: 2, runways: 2 });
    await settled(s.work);
    expect(held.requests).toBe(1);
  });

  // @spec APT-DATA-004
  it("does not hold a requested re-import while the pilot is in the sim", async () => {
    const s = await prepared({ times: RECENT });
    s.work.startChecks(pilot(true).check);
    fs.writeFileSync(s.file("airports.csv"), NEW_AIRPORTS);
    fs.writeFileSync(s.file("runways.csv"), NEW_RUNWAYS);
    expect(await s.work.reimport({ download: false })).toEqual({ airports: 2, runways: 2 });
  });
});

describe("stopping (APT-DATA-025)", () => {
  // @spec APT-DATA-025
  it("stops a refresh under way, discarding its download, and runs no check after", async () => {
    const s = await prepared();
    const held = heldAnswer(NEW_AIRPORTS);
    answerFetch(AIRPORTS_URL, held.answer);
    const p = pilot();
    s.work.startChecks(p.check);
    await held.asked;
    const started = Date.now();
    await s.work.stop();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(s.work.busy()).toBe(false);
    expect(leftoverFiles(s.dataFolder)).toEqual([]);
    expect(countOf(s.db, "airports")).toBe(fixtureCounts().airports);
    expect(s.cancelled()).toBe(true);
    expect(p.listening()).toBe(0);
    s.tick();
    p.set(false);
    expect(s.work.busy()).toBe(false);
    expect(held.requests).toBe(1);
  });
});
