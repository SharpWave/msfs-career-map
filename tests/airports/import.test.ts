/**
 * The staged import: lists read and written in short batches into staging tables while the old
 * data stays in use (APT-DATA-023), one short swap, failures and stops leaving the old data
 * (APT-DATA-014, APT-DATA-025), and airports that hops reference kept when the lists drop them
 * (APT-DATA-007).
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { dropStaging, stageList, swapIn } from "../../src/server/airport-data.ts";
import { fixtureCounts } from "../support/run-folder.ts";
import {
  addHop,
  airportsCsv,
  bigAirportsCsv,
  countOf,
  emptyFolder,
  fixtureText,
  runwaysCsv,
  scratchDb,
  tablesOf,
} from "../support/airport-lists.ts";

const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** A folder with a database of its own and the given list files. */
function setup(lists: { airports?: string; runways?: string } = {}) {
  const dir = emptyFolder("import-");
  const db = scratchDb(dir);
  open.push(db);
  const file = (list: "airports" | "runways") => path.join(dir, `${list}.csv`);
  for (const list of ["airports", "runways"] as const) if (lists[list] !== undefined) fs.writeFileSync(file(list), lists[list]!);
  return { dir, db, file };
}

/** The fixture lists imported, staged and swapped as a preparation does. */
async function withFixtures() {
  const s = setup({ airports: fixtureText("airports"), runways: fixtureText("runways") });
  await stageList(s.db, "airports", s.file("airports"));
  await stageList(s.db, "runways", s.file("runways"));
  swapIn(s.db, ["airports", "runways"]);
  return s;
}

const STAGING = ["airports_staging", "runways_staging"];
const stagingLeft = (db: DatabaseSync) => tablesOf(db).filter((t) => STAGING.includes(t));
const airport = (db: DatabaseSync, ident: string) =>
  db.prepare(`SELECT ident, name, unlisted FROM airports WHERE ident = ?`).get(ident) as { ident: string; name: string; unlisted: number } | undefined;
const runwaysOf = (db: DatabaseSync, ident: string) => countOf(db, `runways WHERE airport_ident = '${ident}'`);

describe("staging and swapping (APT-DATA-023)", () => {
  // @spec APT-DATA-023, APT-DATA-006, APT-DATA-010
  it("stages the fixture lists and swaps them in, giving what the one-step import gave", async () => {
    const { db } = await withFixtures();
    expect(countOf(db, "airports")).toBe(fixtureCounts().airports);
    expect(countOf(db, "runways")).toBe(fixtureCounts().runways);
    expect(countOf(db, "airport_rwy")).toBeGreaterThan(0);
    expect(stagingLeft(db)).toEqual([]);
    // Closed airports skipped, as before.
    expect(countOf(db, "airports WHERE type = 'closed'")).toBe(0);
  });

  // @spec APT-DATA-023
  it("keeps the old data in use until the swap: mid-import readers see the old lists, then the new ones whole", async () => {
    const { db, file } = await withFixtures();
    fs.writeFileSync(file("airports"), bigAirportsCsv(60_000));
    const seen: number[] = [];
    const progress: [number, number][] = [];
    const staged = await stageList(db, "airports", file("airports"), {
      onProgress: (rows, total) => {
        progress.push([rows, total]);
        seen.push(countOf(db, "airports"));
      },
    });
    expect(staged).toBe(60_000);
    expect(progress.length).toBeGreaterThan(2);
    expect(new Set(seen)).toEqual(new Set([fixtureCounts().airports]));
    // Rows rise to the total, which is known from the first report.
    expect(progress[0]).toEqual([0, 60_000]);
    expect(progress.at(-1)).toEqual([60_000, 60_000]);
    for (let i = 1; i < progress.length; i++) expect(progress[i][0]).toBeGreaterThanOrEqual(progress[i - 1][0]);

    expect(swapIn(db, ["airports"])).toEqual({ airports: 60_000 });
    expect(countOf(db, "airports")).toBe(60_000);
    expect(stagingLeft(db)).toEqual([]);
  });

  // Wall-clock bounds: with every test file's process busy at once, the machine can stretch one turn
  // (a collection after the large allocations, say) past the bound. Tried again rather than loosened;
  // an import that really held the server would fail every try.
  const TIMED = { retry: 2 };

  // @spec APT-DATA-023
  it("holds the event loop for no more than about 100 ms at a time while it reads and writes a large list", TIMED, async () => {
    const { db, file } = setup({ airports: bigAirportsCsv(150_000) });
    let last = performance.now();
    let longest = 0;
    const tick = setInterval(() => {
      const t = performance.now();
      longest = Math.max(longest, t - last);
      last = t;
    }, 5);
    try {
      await stageList(db, "airports", file("airports"));
    } finally {
      clearInterval(tick);
    }
    expect(longest).toBeLessThan(150);
    // The swap itself is one synchronous step, short for a list this size.
    const t0 = performance.now();
    swapIn(db, ["airports"]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  // @spec APT-DATA-014, APT-DATA-023
  it("fails a list lacking a required column before staging anything, naming the file and the column, the old data unchanged", async () => {
    const { db, file } = await withFixtures();
    fs.writeFileSync(file("runways"), fixtureText("runways").replace('"surface",', '"surfaces",'));
    await expect(stageList(db, "runways", file("runways"))).rejects.toThrow(`${file("runways")}: missing column surface`);
    expect(countOf(db, "runways")).toBe(fixtureCounts().runways);
    expect(stagingLeft(db)).toEqual([]);
  });

  // @spec APT-DATA-025, APT-DATA-023
  it("stops within one batch when its signal aborts, dropping what it staged and leaving the old data", TIMED, async () => {
    const { db, file } = await withFixtures();
    fs.writeFileSync(file("airports"), bigAirportsCsv(150_000));
    const ac = new AbortController();
    let abortedAt = 0;
    const err = await stageList(db, "airports", file("airports"), {
      signal: ac.signal,
      onProgress: (rows) => {
        if (rows > 0 && !abortedAt) {
          abortedAt = performance.now();
          ac.abort();
        }
      },
    }).catch((e) => e);
    const stoppedAfter = performance.now() - abortedAt;
    expect(err.name).toBe("AbortError");
    expect(stoppedAfter).toBeLessThan(150);
    expect(stagingLeft(db)).toEqual([]);
    expect(countOf(db, "airports")).toBe(fixtureCounts().airports);
  });

  // @spec APT-DATA-026
  it("drops any staging table, left by an import an earlier server did not finish", async () => {
    const { db, file } = setup({ airports: fixtureText("airports") });
    fs.writeFileSync(file("airports"), bigAirportsCsv(100_000));
    const ac = new AbortController();
    // A staging table as a crash would leave it: some rows in, never swapped.
    await stageList(db, "airports", file("airports"), { signal: ac.signal, onProgress: (rows) => rows > 0 && ac.abort() }).catch(() => {});
    db.exec(`CREATE TABLE IF NOT EXISTS airports_staging (ident TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE IF NOT EXISTS runways_staging (id INTEGER PRIMARY KEY)`);
    dropStaging(db);
    expect(stagingLeft(db)).toEqual([]);
  });
});

describe("airports that leave the lists (APT-DATA-007)", () => {
  /** The fixture lists without `drop`, and with `close` marked closed. */
  function listsWithout(drop: string[], close: string[] = []) {
    const lines = fixtureText("airports").split("\n");
    return lines
      .filter((l) => !drop.some((d) => l.includes(`,"${d}",`)))
      .map((l) => (close.some((c) => l.includes(`,"${c}",`)) ? l.replace(/,"(small|medium|large)_airport",/, ',"closed",') : l))
      .join("\n");
  }

  async function reimport(db: DatabaseSync, file: (l: "airports" | "runways") => string, airports: string, runways = fixtureText("runways")) {
    fs.writeFileSync(file("airports"), airports);
    fs.writeFileSync(file("runways"), runways);
    await stageList(db, "airports", file("airports"));
    await stageList(db, "runways", file("runways"));
    return swapIn(db, ["airports", "runways"]);
  }

  // @spec APT-DATA-007
  it("keeps the last-known record and runways of an airport a hop references that the new lists omit or mark closed, flagged as no longer listed", async () => {
    const { db, file } = await withFixtures();
    addHop(db, "KPVD", "1M8");
    const before = { kpvd: airport(db, "KPVD")!, kpvdRunways: runwaysOf(db, "KPVD"), m8Runways: runwaysOf(db, "1M8") };
    expect(before.kpvdRunways).toBeGreaterThan(0);

    // KPVD omitted, 1M8 closed, KBOS (no hop) omitted; the runway list drops KPVD's runways too.
    await reimport(db, file, listsWithout(["KPVD", "KBOS"], ["1M8"]), fixtureText("runways").split("\n").filter((l) => !l.includes(',"KPVD",')).join("\n"));

    expect(airport(db, "KPVD")).toEqual({ ...before.kpvd, unlisted: 1 });
    expect(airport(db, "1M8")?.unlisted).toBe(1);
    expect(airport(db, "KBOS")).toBeUndefined();
    expect(runwaysOf(db, "KPVD")).toBe(before.kpvdRunways);
    expect(runwaysOf(db, "1M8")).toBe(before.m8Runways);
    // Listed airports are not flagged.
    expect(countOf(db, "airports WHERE unlisted = 1")).toBe(2);
    // The runway summary still covers the kept airports.
    expect(countOf(db, "airport_rwy WHERE ident = 'KPVD'")).toBe(1);
  });

  // @spec APT-DATA-007
  it("lists an airport again as the lists bring it back, and drops a kept one once no hop references it", async () => {
    const { db, file } = await withFixtures();
    addHop(db, "KPVD", "1M8");
    await reimport(db, file, listsWithout(["KPVD", "1M8"]));
    expect(countOf(db, "airports WHERE unlisted = 1")).toBe(2);

    // KPVD returns; 1M8 stays out.
    await reimport(db, file, listsWithout(["1M8"]));
    expect(airport(db, "KPVD")?.unlisted).toBe(0);
    expect(airport(db, "1M8")?.unlisted).toBe(1);

    // No hop references 1M8 any more: the next re-import drops it, and its runways go with a runway
    // list that no longer has them.
    db.exec(`DELETE FROM hops`);
    await reimport(db, file, listsWithout(["1M8"]), fixtureText("runways").split("\n").filter((l) => !l.includes(',"1M8",')).join("\n"));
    expect(airport(db, "1M8")).toBeUndefined();
    expect(runwaysOf(db, "1M8")).toBe(0);
  });

  // @spec APT-DATA-007, APT-DATA-006
  it("keeps nothing for a hop whose airport was never in the data", async () => {
    const { db, file } = await withFixtures();
    addHop(db, "ZZZZ", "KPVD");
    await reimport(db, file, airportsCsv([{ ident: "KPVD" }]), runwaysCsv([["KPVD"]]));
    expect(airport(db, "ZZZZ")).toBeUndefined();
    expect(countOf(db, "airports")).toBe(1);
    expect(airport(db, "KPVD")?.unlisted).toBe(0);
  });
});
