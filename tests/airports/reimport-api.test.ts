/**
 * `POST /api/airports/reimport` through the server's own airport work: the counts from the lists on
 * disk (APT-DATA-016), and 409 while another import is under way (APT-DATA-024). Runs on this file's
 * own data folder, whose airport list it replaces with a large one.
 */
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIRPORTS_CSV, RUNWAYS_CSV } from "../../src/server/db.ts";
import { serverStatus } from "../../src/server/status.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { bigAirportsCsv, fixtureText } from "../support/airport-lists.ts";
import { fixtureCounts } from "../support/run-folder.ts";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.close());

const reimport = () => fetch(`${server.base}/api/airports/reimport`, { method: "POST" });

describe("POST /api/airports/reimport (APT-DATA-016, APT-DATA-024)", () => {
  // @spec APT-DATA-016, APP-API-008
  it("re-imports both lists from disk and answers their counts, the status's counts following", async () => {
    const res = await reimport();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ airports: fixtureCounts().airports, runways: fixtureCounts().runways });
    expect(serverStatus()).toMatchObject({ airports: fixtureCounts().airports, runways: fixtureCounts().runways });
  });

  // @spec APT-DATA-024, APP-API-001
  it("answers 409 while another import is under way, and the first one finishes", async () => {
    fs.writeFileSync(AIRPORTS_CSV, bigAirportsCsv(150_000));
    try {
      const first = reimport();
      await new Promise((r) => setTimeout(r, 150));
      const second = await reimport();
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: "airport data is already being imported" });
      const done = await first;
      expect(done.status).toBe(200);
      expect((await done.json()).airports).toBe(150_000);
      expect(serverStatus().airports).toBe(150_000);
    } finally {
      fs.writeFileSync(AIRPORTS_CSV, fixtureText("airports"));
      fs.writeFileSync(RUNWAYS_CSV, fixtureText("runways"));
    }
  });
});
