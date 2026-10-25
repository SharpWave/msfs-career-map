/**
 * An airport kept after the lists dropped it (APT-DATA-007) in the server's own queries: it resolves
 * by its codes and in the airport route, and is neither a planner candidate nor a nearest airport
 * (APT-DATA-008). Runs on this file's own database, which the shared setup filled from the fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stageList, swapIn } from "../../src/server/airport-data.ts";
import { AIRPORT_TYPES, findAirport, nearestAirport, planCandidates } from "../../src/server/airports.ts";
import { db } from "../../src/server/db.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { addHop, emptyFolder, fixtureText } from "../support/airport-lists.ts";

let server: TestServer;
let kpvd: { lat: number; lon: number };

beforeAll(async () => {
  server = await startTestServer();
  kpvd = findAirport("KPVD")!;
  addHop(db, "KBOS", "KPVD");
  // The lists drop KPVD; the re-import keeps it, flagged.
  const dir = emptyFolder("unlisted-");
  const airports = path.join(dir, "airports.csv");
  const runways = path.join(dir, "runways.csv");
  fs.writeFileSync(airports, fixtureText("airports").split("\n").filter((l) => !l.includes(',"KPVD",')).join("\n"));
  fs.writeFileSync(runways, fixtureText("runways"));
  await stageList(db, "airports", airports);
  await stageList(db, "runways", runways);
  swapIn(db, ["airports", "runways"]);
});
afterAll(() => server.close());

const plan = (from: string, rangeNm = 150) =>
  planCandidates(findAirport(from)!, { rangeNm, types: [...AIRPORT_TYPES], pavedOnly: false, minRunwayFt: null, maxElevationFt: null, limit: 500 });

describe("an airport no longer listed (APT-DATA-008)", () => {
  // @spec APT-DATA-008
  it("resolves by any of its codes, carrying the flag", () => {
    expect(findAirport("KPVD")).toMatchObject({ ident: "KPVD", unlisted: 1 });
    expect(findAirport("pvd")).toMatchObject({ ident: "KPVD", unlisted: 1 });
  });

  // @spec APT-DATA-008, APT-FIND-002
  it("is returned by the airport route with its runways and the flag", async () => {
    const res = await fetch(`${server.base}/api/airports/KPVD`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ident: "KPVD", unlisted: 1 });
    expect(body.runways.length).toBeGreaterThan(0);
  });

  // @spec APT-DATA-008
  it("is not offered as a planner candidate, while a plan can still start from it", () => {
    expect(plan("KBOS").candidates.map((c) => c.ident)).not.toContain("KPVD");
    expect(plan("KBOS").candidates.length).toBeGreaterThan(0);
    expect(plan("KPVD").candidates.length).toBeGreaterThan(0);
  });

  // @spec APT-DATA-008
  it("is never returned as the nearest airport, even standing on it", () => {
    expect(nearestAirport(kpvd.lat, kpvd.lon, 5)?.ident).not.toBe("KPVD");
    expect(nearestAirport(kpvd.lat, kpvd.lon, 5, { prefer: "KPVD", withinNm: 50 })?.ident).not.toBe("KPVD");
  });

  // @spec APT-DATA-008
  it("leaves the listed airports as they were in both", () => {
    const listed = findAirport("KBOS")!;
    expect(listed.unlisted).toBe(0);
    expect(nearestAirport(listed.lat, listed.lon, 5)?.ident).toBe("KBOS");
  });
});
